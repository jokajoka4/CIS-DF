// Pure exam logic: domain weighting, question selection and scoring.
// Kept free of I/O so it can be unit tested.

export const DOMAINS = {
  1: { name: 'Configuration', weight: 15 },
  2: { name: 'Ingest', weight: 19 },
  3: { name: 'Govern', weight: 35 },
  4: { name: 'Insight', weight: 20 },
  5: { name: 'CSDM Fundamentals', weight: 11 },
};

// Split `total` questions across domains by weight (largest remainder),
// capped by how many questions each domain actually has. Shortfalls are
// handed to domains with spare questions, heaviest weight first.
export function allocate(total, available, domains = DOMAINS) {
  const ids = Object.keys(domains).map(Number);
  const weightSum = ids.reduce((s, d) => s + domains[d].weight, 0);
  const exact = ids.map((d) => ({ d, x: (total * domains[d].weight) / weightSum }));
  const alloc = Object.fromEntries(exact.map(({ d, x }) => [d, Math.floor(x)]));
  let left = total - Object.values(alloc).reduce((a, b) => a + b, 0);
  for (const { d } of [...exact].sort((a, b) => (b.x % 1) - (a.x % 1))) {
    if (left-- <= 0) break;
    alloc[d] += 1;
  }
  let shortfall = 0;
  for (const d of ids) {
    const have = available[d] || 0;
    if (alloc[d] > have) { shortfall += alloc[d] - have; alloc[d] = have; }
  }
  const byWeight = [...ids].sort((a, b) => domains[b].weight - domains[a].weight);
  while (shortfall > 0) {
    const d = byWeight.find((id) => alloc[id] < (available[id] || 0));
    if (d === undefined) break;
    alloc[d] += 1;
    shortfall -= 1;
  }
  return alloc;
}

export function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick questions for an exam. `pool` items need {id, domain, seen}.
// Within a domain, least-seen questions come first, ties broken randomly.
export function pickQuestions(pool, total, rand = Math.random, weighted = true) {
  if (!weighted) {
    return leastSeenFirst(pool, rand).slice(0, total);
  }
  const byDomain = {};
  for (const q of pool) (byDomain[q.domain] ||= []).push(q);
  const available = Object.fromEntries(Object.entries(byDomain).map(([d, qs]) => [d, qs.length]));
  const alloc = allocate(total, available);
  const picked = [];
  for (const [d, n] of Object.entries(alloc)) {
    picked.push(...leastSeenFirst(byDomain[d] || [], rand).slice(0, n));
  }
  return shuffle(picked, rand);
}

function leastSeenFirst(qs, rand) {
  return shuffle(qs, rand).sort((a, b) => (a.seen || 0) - (b.seen || 0));
}

// A question is correct only when the selected set equals the correct set
// (all-or-nothing, like the real exam).
export function isCorrect(selected, correct) {
  if (!Array.isArray(selected) || selected.length !== correct.length) return false;
  const s = new Set(selected);
  return s.size === correct.length && correct.every((c) => s.has(c));
}

// Matching questions: `correct[i]` is the option index for item i. Every
// dropdown must be set to its correct option (all-or-nothing).
export function isMatchCorrect(selected, correct) {
  return Array.isArray(selected) && selected.length === correct.length
    && correct.every((c, i) => selected[i] === c);
}

export function grade(type, selected, correct) {
  return type === 'match' ? isMatchCorrect(selected, correct) : isCorrect(selected, correct);
}

// Summarise graded rows ({domain, is_correct}) into totals and per-domain stats.
export function summarise(rows, passPct) {
  const domains = {};
  for (const d of Object.keys(DOMAINS)) domains[d] = { name: DOMAINS[d].name, correct: 0, total: 0 };
  let correct = 0;
  for (const r of rows) {
    const s = domains[r.domain];
    s.total += 1;
    if (r.is_correct) { s.correct += 1; correct += 1; }
  }
  const total = rows.length;
  const scorePct = total ? Math.round((correct / total) * 1000) / 10 : 0;
  return { correct, total, scorePct, passed: scorePct >= passPct, domains };
}
