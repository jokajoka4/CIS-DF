import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, pickQuestions, isCorrect, isMatchCorrect, grade, summarise } from '../lib/exam.js';

const plenty = { 1: 50, 2: 50, 3: 50, 4: 50, 5: 50 };

test('allocate follows the blueprint weights for a 75-question exam', () => {
  assert.deepEqual(allocate(75, plenty), { 1: 12, 2: 14, 3: 26, 4: 15, 5: 8 });
});

test('allocate always sums to the requested total', () => {
  for (const n of [1, 7, 20, 33, 60, 75, 100]) {
    const a = allocate(n, plenty);
    assert.equal(Object.values(a).reduce((x, y) => x + y, 0), n);
  }
});

test('allocate moves shortfall to domains with spare questions', () => {
  const a = allocate(60, { 1: 50, 2: 50, 3: 50, 4: 50, 5: 3 });
  assert.equal(a[5], 3);
  assert.equal(Object.values(a).reduce((x, y) => x + y, 0), 60);
});

test('allocate cannot exceed the pool', () => {
  const a = allocate(60, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 });
  assert.equal(Object.values(a).reduce((x, y) => x + y, 0), 10);
});

test('pickQuestions prefers questions seen least', () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `old${i}`, domain: 3, seen: 5 })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `new${i}`, domain: 3, seen: 0 })),
  ];
  const ids = pickQuestions(pool, 3, Math.random, false).map((q) => q.id).sort();
  assert.deepEqual(ids, ['new0', 'new1', 'new2']);
});

test('pickQuestions returns unique questions', () => {
  const pool = Array.from({ length: 100 }, (_, i) => ({ id: `q${i}`, domain: (i % 5) + 1, seen: 0 }));
  const picked = pickQuestions(pool, 60);
  assert.equal(new Set(picked.map((q) => q.id)).size, 60);
});

test('isCorrect is all-or-nothing and order independent', () => {
  assert.equal(isCorrect([2, 0], [0, 2]), true);
  assert.equal(isCorrect([0], [0, 2]), false);
  assert.equal(isCorrect([0, 1, 2], [0, 2]), false);
  assert.equal(isCorrect([0, 0], [0, 2]), false);
  assert.equal(isCorrect(null, [1]), false);
});

test('summarise computes score, pass flag and per-domain totals', () => {
  const s = summarise(
    [{ domain: 1, is_correct: 1 }, { domain: 1, is_correct: 0 }, { domain: 3, is_correct: 1 }],
    70,
  );
  assert.equal(s.correct, 2);
  assert.equal(s.scorePct, 66.7);
  assert.equal(s.passed, false);
  assert.deepEqual(s.domains[1], { name: 'Configuration', correct: 1, total: 2 });
});

test('matching questions need every dropdown set to its correct option', () => {
  assert.equal(isMatchCorrect([2, 0, 1], [2, 0, 1]), true);
  assert.equal(isMatchCorrect([2, 1, 0], [2, 0, 1]), false);
  assert.equal(isMatchCorrect([2, 0, null], [2, 0, 1]), false);
  assert.equal(isMatchCorrect([2, 0], [2, 0, 1]), false);
  assert.equal(isMatchCorrect(null, [2, 0, 1]), false);
});

test('grade checks order for matching but not for multiple choice', () => {
  assert.equal(grade('match', [1, 0], [0, 1]), false);
  assert.equal(grade('multi', [1, 0], [0, 1]), true);
});
