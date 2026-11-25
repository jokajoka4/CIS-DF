import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, seed, readAttemptQuestions } from './lib/db.js';
import { DOMAINS, pickQuestions, shuffle, grade, summarise } from './lib/exam.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4460);
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'cisdf.sqlite');
const PASS_PCT = Number(process.env.PASS_PCT || 70);

// Exam modes. Recall cards (no options) are retired from the bank; their type is
// kept only so older attempts that contain them still display and score.
const MODES = {
  full: { count: Number(process.env.EXAM_QUESTIONS || 75), minutes: Number(process.env.EXAM_MINUTES || 90), weighted: true },
  quick: { count: 20, minutes: 0, weighted: true },
  drill: { count: 15, minutes: 0, weighted: false },
  retry: { count: 20, minutes: 0, weighted: false },
};

const db = openDb(DB_FILE);
seed(db, JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'questions.json'), 'utf8')));

const now = () => new Date().toISOString();
const parse = (s) => (s == null ? null : JSON.parse(s));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function getAttempt(id) {
  const a = db.prepare('SELECT * FROM attempts WHERE id = ?').get(id);
  if (!a) throw new HttpError(404, 'Attempt not found');
  return a;
}

function attemptRows(id) {
  return readAttemptQuestions(db, id);
}

// What the client sees for one question. Answers are only included once the
// attempt is submitted, or when that question was revealed in study mode.
function questionView(r, showAnswer) {
  const options = parse(r.options_json);
  const order = parse(r.option_order_json);
  const correct = parse(r.correct_json) || [];
  const view = {
    position: r.position,
    id: r.question_id,
    domain: r.domain,
    domainName: DOMAINS[r.domain].name,
    subtopic: r.subtopic,
    type: r.type,
    text: r.text,
    choose: r.type === 'multi' ? correct.length : r.type === 'single' ? 1 : 0,
    options: order ? order.map((i) => ({ i, text: options[i] })) : [],
    items: parse(r.items_json) || [],
    selected: parse(r.selected_json),
    marked: !!r.marked,
    revealed: !!r.revealed,
    flagged: !!r.flagged,
  };
  if (showAnswer || r.revealed) {
    Object.assign(view, {
      correct, answer: r.answer, explanation: r.explanation, note: r.note,
      isCorrect: r.is_correct == null ? null : !!r.is_correct,
    });
  }
  return view;
}

function attemptView(id) {
  const a = getAttempt(id);
  const submitted = !!a.submitted_at;
  const rows = attemptRows(id);
  const view = {
    id: a.id, mode: a.mode, study: !!a.study, domainFilter: a.domain_filter,
    startedAt: a.started_at, submittedAt: a.submitted_at, timeLimitSec: a.time_limit_sec,
    passPct: PASS_PCT,
    questions: rows.map((r) => questionView(r, submitted)),
  };
  if (submitted) view.summary = summarise(rows.filter((r) => r.type !== 'recall' || a.study), PASS_PCT);
  return view;
}

function createAttempt({ mode = 'quick', study = false, domain = null }) {
  const cfg = MODES[mode];
  if (!cfg) throw new HttpError(400, `Unknown mode: ${mode}`);
  if (mode === 'drill' && !DOMAINS[domain]) throw new HttpError(400, 'Drill needs a domain (1-5)');

  const types = study ? "('single','multi','recall','match')" : "('single','multi','match')";
  let pool = db.prepare(`
    SELECT q.id, q.domain, q.type, q.options_json, q.shuffle,
      (SELECT COUNT(*) FROM attempt_questions aq WHERE aq.question_id = q.id) AS seen
    FROM questions q WHERE q.active = 1 AND q.type IN ${types}`).all();
  if (mode === 'drill') pool = pool.filter((q) => q.domain === Number(domain));
  if (mode === 'retry') {
    // Questions whose most recent graded answer was wrong.
    const latest = new Map();
    for (const r of db.prepare(`
      SELECT aq.question_id, aq.is_correct FROM attempt_questions aq
      JOIN attempts a ON a.id = aq.attempt_id
      WHERE a.submitted_at IS NOT NULL AND aq.is_correct IS NOT NULL
      ORDER BY a.submitted_at`).all()) latest.set(r.question_id, r.is_correct);
    pool = pool.filter((q) => latest.get(q.id) === 0);
  }
  if (!pool.length) throw new HttpError(400, mode === 'retry' ? 'No wrong answers to retry yet' : 'No questions available');

  const picked = pickQuestions(pool, cfg.count, Math.random, cfg.weighted);
  const limit = study || !cfg.minutes ? null : cfg.minutes * 60;
  // Scale the time limit when the bank can't fill the whole exam.
  const timeLimit = limit && Math.round((limit * picked.length) / cfg.count);

  db.exec('BEGIN');
  try {
    const { lastInsertRowid: id } = db.prepare(
      'INSERT INTO attempts (mode, study, domain_filter, started_at, time_limit_sec) VALUES (?, ?, ?, ?, ?)',
    ).run(mode, study ? 1 : 0, mode === 'drill' ? Number(domain) : null, now(), timeLimit);
    const ins = db.prepare(
      'INSERT INTO attempt_questions (attempt_id, position, question_id, option_order_json) VALUES (?, ?, ?, ?)',
    );
    picked.forEach((q, pos) => {
      const n = q.options_json ? parse(q.options_json).length : 0;
      const order = [...Array(n).keys()];
      ins.run(id, pos, q.id, n ? JSON.stringify(q.shuffle ? shuffle(order) : order) : null);
    });
    db.exec('COMMIT');
    return Number(id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getRow(attemptId, pos) {
  const r = attemptRows(attemptId).find((x) => x.position === Number(pos));
  if (!r) throw new HttpError(404, 'Question not in attempt');
  return r;
}

// Matching answers are one option index (or null) per item, in item order.
// An all-empty match is stored as unanswered.
function parseSelected(r, selected) {
  if (selected == null) return null;
  if (!Array.isArray(selected)) throw new HttpError(400, 'selected must be an array');
  if (r.type !== 'match') return selected.map(Number);
  const items = parse(r.items_json) || [];
  if (selected.length !== items.length) throw new HttpError(400, `Expected ${items.length} answers`);
  const sel = selected.map((v) => (v == null || v === '' ? null : Number(v)));
  return sel.every((v) => v == null) ? null : sel;
}

function saveAnswer(attemptId, pos, body) {
  const a = getAttempt(attemptId);
  if (a.submitted_at) throw new HttpError(409, 'Attempt already submitted');
  const r = getRow(attemptId, pos);
  const sets = [];
  const args = [];
  if ('marked' in body) { sets.push('marked = ?'); args.push(body.marked ? 1 : 0); }
  if ('selected' in body) {
    if (r.revealed && r.type !== 'recall') throw new HttpError(409, 'Answer already revealed');
    const sel = parseSelected(r, body.selected);
    sets.push('selected_json = ?'); args.push(sel == null ? null : JSON.stringify(sel));
    if (r.type === 'recall') {
      // Recall cards are self-graded: [1] = knew it, [0] = didn't.
      sets.push('is_correct = ?'); args.push(sel == null ? null : sel[0] === 1 ? 1 : 0);
    }
  }
  if (sets.length) {
    db.prepare(`UPDATE attempt_questions SET ${sets.join(', ')} WHERE attempt_id = ? AND position = ?`)
      .run(...args, attemptId, Number(pos));
  }
  return questionView(getRow(attemptId, pos), false);
}

// Study mode only: lock the answer and show whether it was right.
function reveal(attemptId, pos) {
  const a = getAttempt(attemptId);
  if (!a.study) throw new HttpError(403, 'Reveal is only available in study mode');
  const r = getRow(attemptId, pos);
  const result = r.type === 'recall' ? r.is_correct
    : grade(r.type, parse(r.selected_json), parse(r.correct_json)) ? 1 : 0;
  db.prepare('UPDATE attempt_questions SET revealed = 1, is_correct = ? WHERE attempt_id = ? AND position = ?')
    .run(result, attemptId, Number(pos));
  return questionView(getRow(attemptId, pos), false);
}

function submit(attemptId) {
  const a = getAttempt(attemptId);
  if (a.submitted_at) return attemptView(attemptId);
  const rows = attemptRows(attemptId);
  const setGrade = db.prepare('UPDATE attempt_questions SET is_correct = ? WHERE attempt_id = ? AND position = ?');
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      if (r.type === 'recall') {
        r.is_correct = r.is_correct ? 1 : 0;
      } else {
        r.is_correct = grade(r.type, parse(r.selected_json), parse(r.correct_json)) ? 1 : 0;
      }
      setGrade.run(r.is_correct, attemptId, r.position);
    }
    const s = summarise(rows, PASS_PCT);
    db.prepare('UPDATE attempts SET submitted_at = ?, score_pct = ?, correct = ?, total = ? WHERE id = ?')
      .run(now(), s.scorePct, s.correct, s.total, attemptId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return attemptView(attemptId);
}

// Only unfinished attempts can be discarded; submitted ones are history.
function discard(attemptId) {
  const a = getAttempt(attemptId);
  if (a.submitted_at) throw new HttpError(409, 'Submitted attempts cannot be deleted');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM attempt_questions WHERE attempt_id = ?').run(attemptId);
    db.prepare('DELETE FROM attempts WHERE id = ?').run(attemptId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { id: attemptId, deleted: true };
}

function history() {
  return db.prepare(`
    SELECT id, mode, study, domain_filter AS domainFilter, started_at AS startedAt,
           submitted_at AS submittedAt, score_pct AS scorePct, correct, total,
           (SELECT COUNT(*) FROM attempt_questions WHERE attempt_id = attempts.id) AS questionCount
    FROM attempts ORDER BY id DESC LIMIT 100`).all()
    .map((r) => ({ ...r, study: !!r.study, passed: r.scorePct != null && r.scorePct >= PASS_PCT }));
}

// Accuracy across graded, non-study attempts.
function stats() {
  const base = `FROM attempt_questions aq JOIN attempts a ON a.id = aq.attempt_id
    JOIN questions q ON q.id = aq.question_id
    WHERE a.submitted_at IS NOT NULL AND a.study = 0 AND q.type != 'recall'`;
  const domains = db.prepare(`SELECT q.domain, SUM(aq.is_correct) AS correct, COUNT(*) AS total ${base} GROUP BY q.domain`)
    .all().map((r) => ({ ...r, name: DOMAINS[r.domain].name, weight: DOMAINS[r.domain].weight }));
  const weak = db.prepare(`
    SELECT q.domain, q.subtopic, SUM(aq.is_correct) AS correct, COUNT(*) AS total ${base}
    GROUP BY q.domain, q.subtopic HAVING COUNT(*) >= 3
    ORDER BY 1.0 * SUM(aq.is_correct) / COUNT(*) ASC, COUNT(*) DESC LIMIT 6`).all();
  const bank = db.prepare(`SELECT domain, type, COUNT(*) AS n FROM questions WHERE active = 1 GROUP BY domain, type`).all();
  const flagged = db.prepare('SELECT COUNT(*) AS n FROM questions WHERE flagged = 1').get().n;
  return { domains, weak, bank, flagged, passPct: PASS_PCT, domainInfo: DOMAINS, modes: MODES };
}

function toggleFlag(id) {
  const r = db.prepare('UPDATE questions SET flagged = 1 - flagged WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'Question not found');
  return { id, flagged: !!db.prepare('SELECT flagged FROM questions WHERE id = ?').get(id).flagged };
}

// ---- HTTP ----

const routes = [
  ['GET', /^\/api\/stats$/, () => stats()],
  ['GET', /^\/api\/attempts$/, () => history()],
  ['POST', /^\/api\/attempts$/, (m, body) => attemptView(createAttempt(body))],
  ['GET', /^\/api\/attempts\/(\d+)$/, (m) => attemptView(Number(m[1]))],
  ['DELETE', /^\/api\/attempts\/(\d+)$/, (m) => discard(Number(m[1]))],
  ['PUT', /^\/api\/attempts\/(\d+)\/answers\/(\d+)$/, (m, body) => saveAnswer(Number(m[1]), m[2], body)],
  ['POST', /^\/api\/attempts\/(\d+)\/reveal\/(\d+)$/, (m) => reveal(Number(m[1]), m[2])],
  ['POST', /^\/api\/attempts\/(\d+)\/submit$/, (m) => submit(Number(m[1]))],
  ['POST', /^\/api\/questions\/([\w-]+)\/flag$/, (m) => toggleFlag(m[1])],
];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const PUBLIC = path.join(ROOT, 'public');

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1e5) throw new HttpError(413, 'Body too large');
  }
  if (!data) return {};
  try { return JSON.parse(data); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) return send(res, 200, handler(m, await readBody(req)));
      }
      throw new HttpError(404, 'Not found');
    }
    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), MIME['.html']);
    }
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    send(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Internal error' });
  }
});

// Opens the app in the default browser (used by the double-click launchers).
function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`\nPort ${PORT} is already in use. Either the simulator is already running`
    + ` (open http://localhost:${PORT}), or another program uses that port.`
    + `\nTo use another port, see "Troubleshooting" in README.md.\n`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`CIS-DF exam simulator on http://${HOST}:${PORT}`);
  console.log(`\n  Open ${url} in your browser.\n  Press Ctrl+C (or close this window) to stop.\n`);
  if (process.env.OPEN_BROWSER) openBrowser(url);
});
