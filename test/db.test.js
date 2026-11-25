import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, seed, readAttemptQuestions } from '../lib/db.js';

const original = {
  id: 'example', domain: 1, subtopic: 'IRE', type: 'single',
  text: 'Original question', options: ['Original A', 'Original B'], correct: [0],
};

function addAttempt(db, submitted = false) {
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO attempts (mode, started_at, submitted_at, score_pct, correct, total)
    VALUES ('quick', '2026-11-01T10:00:00Z', ?, ?, ?, ?)`)
    .run(submitted ? '2026-11-01T10:01:00Z' : null,
      submitted ? 100 : null, submitted ? 1 : null, submitted ? 1 : null);
  db.prepare(`INSERT INTO attempt_questions
    (attempt_id, position, question_id, option_order_json, selected_json, is_correct)
    VALUES (?, 0, 'example', '[1,0]', '[0]', ?)`)
    .run(id, submitted ? 1 : null);
  return Number(id);
}

test('reseed preserves submitted and unfinished attempts while new attempts use corrected content', () => {
  const db = openDb(':memory:');
  try {
    seed(db, [original]);
    db.prepare('UPDATE questions SET flagged = 1').run();
    const submitted = addAttempt(db, true);
    const unfinished = addAttempt(db);
    const historyBefore = db.prepare('SELECT * FROM attempts ORDER BY id').all();
    const corrected = {
      ...original, text: 'Corrected question', options: ['New A', 'New B'],
      correct: [1], explanation: 'New explanation', note: 'New note',
    };
    seed(db, [corrected]);
    for (const id of [submitted, unfinished]) {
      const [row] = readAttemptQuestions(db, id);
      assert.equal(row.text, original.text);
      assert.deepEqual(JSON.parse(row.options_json), original.options);
      assert.deepEqual(JSON.parse(row.correct_json), original.correct);
      assert.equal(row.explanation, null);
      assert.equal(row.note, null);
      assert.equal(row.selected_json, '[0]');
      assert.equal(row.option_order_json, '[1,0]');
      assert.equal(row.flagged, 1);
    }
    assert.deepEqual(db.prepare('SELECT * FROM attempts ORDER BY id').all(), historyBefore);
    assert.equal(readAttemptQuestions(db, submitted)[0].is_correct, 1);
    assert.equal(readAttemptQuestions(db, unfinished)[0].is_correct, null);

    const fresh = addAttempt(db);
    assert.equal(readAttemptQuestions(db, fresh)[0].text, corrected.text);
    assert.deepEqual(JSON.parse(readAttemptQuestions(db, fresh)[0].correct_json), [1]);
    seed(db, [{ ...corrected, text: 'Another revision' }]);
    assert.equal(readAttemptQuestions(db, fresh)[0].text, corrected.text);
    assert.equal(readAttemptQuestions(db, submitted)[0].text, original.text);
    assert.equal(db.prepare('SELECT text FROM questions').get().text, 'Another revision');
  } finally {
    db.close();
  }
});

test('failed reseed rolls back question changes and attempt snapshots together', () => {
  const db = openDb(':memory:');
  try {
    seed(db, [original]);
    const attempt = addAttempt(db);
    assert.throws(() => seed(db, [{ ...original, type: 'unsupported' }]));
    assert.equal(db.prepare('SELECT text, active FROM questions').get().text, original.text);
    assert.equal(db.prepare('SELECT active FROM questions').get().active, 1);
    assert.equal(db.prepare('SELECT question_snapshot_json FROM attempt_questions').get().question_snapshot_json, null);
    assert.equal(readAttemptQuestions(db, attempt)[0].text, original.text);
  } finally {
    db.close();
  }
});

test('existing database gains the snapshot column once without losing stored answers', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cisdf-migration-'));
  const file = path.join(dir, 'legacy.sqlite');
  let db;
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE attempt_questions (
      attempt_id INTEGER NOT NULL, position INTEGER NOT NULL, question_id TEXT NOT NULL,
      option_order_json TEXT, selected_json TEXT, marked INTEGER NOT NULL DEFAULT 0,
      revealed INTEGER NOT NULL DEFAULT 0, is_correct INTEGER,
      PRIMARY KEY (attempt_id, position)
    )`);
    legacy.close();
    db = openDb(file);
    seed(db, [original]);
    const id = addAttempt(db, true);
    db.close();
    db = openDb(file);
    const columns = db.prepare('PRAGMA table_info(attempt_questions)').all();
    assert.equal(columns.filter((c) => c.name === 'question_snapshot_json').length, 1);
    seed(db, [{ ...original, correct: [1] }]);
    assert.deepEqual(JSON.parse(readAttemptQuestions(db, id)[0].correct_json), [0]);
    assert.equal(readAttemptQuestions(db, id)[0].selected_json, '[0]');
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const match = {
  id: 'match-example', domain: 2, subtopic: 'Ingestion methods', type: 'match',
  text: 'Match each description', items: ['Agentless', 'Agent-based'],
  options: ['ACC', 'Discovery', 'Import Sets'], correct: [1, 0],
};

test('matching questions store their items and freeze them in attempt snapshots', () => {
  const db = openDb(':memory:');
  try {
    seed(db, [match]);
    const { lastInsertRowid: id } = db.prepare(
      "INSERT INTO attempts (mode, started_at) VALUES ('quick', '2026-11-04T10:00:00Z')").run();
    db.prepare(`INSERT INTO attempt_questions (attempt_id, position, question_id, option_order_json)
      VALUES (?, 0, 'match-example', '[2,0,1]')`).run(id);
    seed(db, [{ ...match, items: ['Changed', 'Changed too'] }]);
    const [row] = readAttemptQuestions(db, Number(id));
    assert.equal(row.type, 'match');
    assert.deepEqual(JSON.parse(row.items_json), match.items);
    assert.deepEqual(JSON.parse(row.correct_json), [1, 0]);
  } finally {
    db.close();
  }
});

test('database created before matching questions is migrated without losing attempts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cisdf-match-migration-'));
  const file = path.join(dir, 'legacy.sqlite');
  let db;
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE questions (
        id TEXT PRIMARY KEY, domain INTEGER NOT NULL, subtopic TEXT,
        type TEXT NOT NULL CHECK (type IN ('single','multi','recall')),
        text TEXT NOT NULL, options_json TEXT, correct_json TEXT, answer TEXT, explanation TEXT,
        shuffle INTEGER NOT NULL DEFAULT 1, source TEXT, note TEXT,
        active INTEGER NOT NULL DEFAULT 1, flagged INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL,
        study INTEGER NOT NULL DEFAULT 0, domain_filter INTEGER, started_at TEXT NOT NULL,
        submitted_at TEXT, time_limit_sec INTEGER, score_pct REAL, correct INTEGER, total INTEGER);
      CREATE TABLE attempt_questions (
        attempt_id INTEGER NOT NULL REFERENCES attempts(id), position INTEGER NOT NULL,
        question_id TEXT NOT NULL REFERENCES questions(id), option_order_json TEXT,
        selected_json TEXT, marked INTEGER NOT NULL DEFAULT 0, revealed INTEGER NOT NULL DEFAULT 0,
        is_correct INTEGER, question_snapshot_json TEXT, PRIMARY KEY (attempt_id, position));
      INSERT INTO questions (id, domain, type, text, options_json, correct_json, flagged)
        VALUES ('example', 1, 'single', 'Original question', '["A","B"]', '[0]', 1);
      INSERT INTO attempts (mode, started_at, submitted_at) VALUES ('quick', 'x', 'y');
      INSERT INTO attempt_questions (attempt_id, position, question_id, selected_json, is_correct)
        VALUES (1, 0, 'example', '[0]', 1);`);
    legacy.close();
    db = openDb(file);
    seed(db, [original, match]);
    db.close();
    db = openDb(file);
    assert.equal(db.prepare("SELECT type FROM questions WHERE id = 'match-example'").get().type, 'match');
    assert.equal(db.prepare("SELECT flagged FROM questions WHERE id = 'example'").get().flagged, 1);
    assert.equal(readAttemptQuestions(db, 1)[0].selected_json, '[0]');
    const fk = db.prepare('PRAGMA foreign_key_list(attempt_questions)').all();
    assert.ok(fk.some((k) => k.table === 'questions'));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
