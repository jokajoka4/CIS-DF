import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const QUESTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  domain INTEGER NOT NULL,
  subtopic TEXT,
  type TEXT NOT NULL CHECK (type IN ('single','multi','recall','match')),
  text TEXT NOT NULL,
  options_json TEXT,
  items_json TEXT,
  correct_json TEXT,
  answer TEXT,
  explanation TEXT,
  shuffle INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  flagged INTEGER NOT NULL DEFAULT 0
)`;
const SCHEMA = `${QUESTIONS_TABLE};
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  study INTEGER NOT NULL DEFAULT 0,
  domain_filter INTEGER,
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  time_limit_sec INTEGER,
  score_pct REAL,
  correct INTEGER,
  total INTEGER
);
CREATE TABLE IF NOT EXISTS attempt_questions (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  position INTEGER NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id),
  option_order_json TEXT,
  selected_json TEXT,
  marked INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  is_correct INTEGER,
  question_snapshot_json TEXT,
  PRIMARY KEY (attempt_id, position)
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrateQuestionsTable(db);
  // Existing attempts must retain their original question content on reseed.
  if (!db.prepare('PRAGMA table_info(attempt_questions)').all()
    .some((column) => column.name === 'question_snapshot_json')) {
    db.exec('ALTER TABLE attempt_questions ADD COLUMN question_snapshot_json TEXT');
  }
  return db;
}

// Databases created before matching questions have a narrower type CHECK and
// no items_json column. SQLite can't alter a CHECK, so rebuild the table.
function migrateQuestionsTable(db) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'questions'").get();
  if (sql.includes("'match'")) return;
  const cols = db.prepare('PRAGMA table_info(questions)').all().map((c) => c.name).join(', ');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    // Renaming the old table would repoint attempt_questions' foreign key, so
    // build the new table under a temporary name and rename it into place.
    db.exec(QUESTIONS_TABLE.replace('IF NOT EXISTS questions', 'questions_new'));
    db.exec(`INSERT INTO questions_new (${cols}) SELECT ${cols} FROM questions`);
    db.exec('DROP TABLE questions');
    db.exec('ALTER TABLE questions_new RENAME TO questions');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function readAttemptQuestions(db, attemptId) {
  return db.prepare(`
    SELECT aq.*, q.domain, q.subtopic, q.type, q.text, q.options_json, q.items_json, q.correct_json,
           q.answer, q.explanation, q.note, q.flagged
    FROM attempt_questions aq JOIN questions q ON q.id = aq.question_id
    WHERE aq.attempt_id = ? ORDER BY aq.position`).all(attemptId)
    .map((row) => ({ ...row, ...JSON.parse(row.question_snapshot_json) }));
}

// Upsert questions from the JSON bank. Keeps the `flagged` state and never
// touches attempt history. Questions removed from the file become inactive.
export function seed(db, questions) {
  const upsert = db.prepare(`
    INSERT INTO questions (id, domain, subtopic, type, text, options_json, items_json, correct_json,
                           answer, explanation, shuffle, source, note, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      domain = excluded.domain, subtopic = excluded.subtopic, type = excluded.type,
      text = excluded.text, options_json = excluded.options_json, items_json = excluded.items_json,
      correct_json = excluded.correct_json, answer = excluded.answer,
      explanation = excluded.explanation, shuffle = excluded.shuffle,
      source = excluded.source, note = excluded.note, active = excluded.active`);
  db.exec('BEGIN');
  try {
    // Freeze existing attempts before replacing the bank. New attempts use the
    // live bank until the next reseed, when their original content is frozen too.
    db.exec(`UPDATE attempt_questions AS aq SET question_snapshot_json = (
      SELECT json_object(
        'domain', q.domain, 'subtopic', q.subtopic, 'type', q.type, 'text', q.text,
        'options_json', q.options_json, 'items_json', q.items_json, 'correct_json', q.correct_json,
        'answer', q.answer, 'explanation', q.explanation, 'note', q.note
      ) FROM questions q WHERE q.id = aq.question_id
    ) WHERE question_snapshot_json IS NULL`);
    db.exec('UPDATE questions SET active = 0');
    for (const q of questions) {
      upsert.run(
        q.id, q.domain, q.subtopic ?? null, q.type, q.text,
        q.options ? JSON.stringify(q.options) : null,
        q.items ? JSON.stringify(q.items) : null,
        q.correct ? JSON.stringify(q.correct) : null,
        q.answer ?? null, q.explanation ?? null, q.shuffle === false ? 0 : 1,
        q.source ?? 'pdf-assessment', q.note ?? null, q.active === false ? 0 : 1,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
