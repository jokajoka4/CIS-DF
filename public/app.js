// CIS-DF mock exam simulator: single-page app, hash-routed, no framework.

const app = document.getElementById('app');
const LETTERS = 'ABCDEFGH';
const MODE_LABEL = { full: 'Full mock', quick: 'Quick exam', drill: 'Domain drill', retry: 'Retry mistakes' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (c, t) => (t ? Math.round((c / t) * 100) : 0);
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtClock = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
};

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function masthead(sub = 'ServiceNow CIS · Data Foundations') {
  return `<header class="masthead">
    <div><small>${esc(sub)}</small><h1><a href="#/" style="text-decoration:none">Mock Exam</a></h1></div>
    <nav><a href="#/history">History</a></nav>
  </header>`;
}

function showError(err) {
  app.insertAdjacentHTML('afterbegin', `<p class="error" role="alert">${esc(err.message || err)}</p>`);
}

// Wire up every [data-discard] button on the page; re-renders the current view afterwards.
function bindDiscard() {
  app.querySelectorAll('[data-discard]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Discard this unfinished attempt? Its answers will be deleted.')) return;
    try {
      await api('DELETE', `/api/attempts/${b.dataset.discard}`);
      sessionStorage.removeItem(`cisdf-pos-${b.dataset.discard}`);
      route();
    } catch (err) {
      showError(err);
    }
  }));
}

// ---------- Router ----------

let teardown = () => {};
async function route() {
  teardown();
  teardown = () => {};
  const hash = location.hash || '#/';
  let m;
  try {
    if ((m = hash.match(/^#\/a\/(\d+)$/))) return await examView(Number(m[1]));
    if ((m = hash.match(/^#\/r\/(\d+)$/))) return await resultsView(Number(m[1]));
    if (hash === '#/history') return await historyView();
    return await homeView();
  } catch (err) {
    app.innerHTML = masthead();
    showError(err);
  }
}
window.addEventListener('hashchange', route);
route();

// ---------- Home ----------

async function homeView() {
  const [stats, attempts] = await Promise.all([api('GET', '/api/stats'), api('GET', '/api/attempts')]);
  const open = attempts.find((a) => !a.submittedAt);
  const bank = {};
  for (const b of stats.bank) bank[b.type] = (bank[b.type] || 0) + b.n;
  const full = stats.modes.full;
  let study = false;
  let drillDomain = null;

  app.innerHTML = `${masthead()}
    ${open ? `<div class="resume"><div><b class="display">In progress</b><br><small>${esc(MODE_LABEL[open.mode])}${open.study ? ' · study' : ''} · started ${esc(fmtDate(open.startedAt))}</small></div>
      <div class="row"><button class="btn" data-discard="${open.id}">Discard</button>
      <a class="btn primary" href="#/a/${open.id}">Resume</a></div></div>` : ''}
    <h2>Start</h2>
    <ul class="modes">
      <li class="mode featured"><div><h3>Full mock</h3><p>${full.count} questions · ${full.minutes} min · weighted like the real exam</p></div>
        <button class="btn primary" data-mode="full">Start</button></li>
      <li class="mode"><div><h3>Quick exam</h3><p>20 questions · untimed · weighted</p></div>
        <button class="btn" data-mode="quick">Start</button></li>
      <li class="mode"><div><h3>Domain drill</h3><p>15 questions from one domain</p></div>
        <button class="btn" data-mode="drill" disabled>Start</button>
        <div class="chips" role="group" aria-label="Domain">${Object.entries(stats.domainInfo).map(([d, info]) =>
          `<button class="chip" data-domain="${d}" aria-pressed="false">${esc(info.name)} <small>${info.weight}%</small></button>`).join('')}</div></li>
      <li class="mode"><div><h3>Retry mistakes</h3><p>Up to 20 questions you last got wrong</p></div>
        <button class="btn" data-mode="retry">Start</button></li>
    </ul>
    <label class="switch"><div><b class="display">Study mode</b><p>Check each answer right away, with explanation. No timer.</p></div>
      <input type="checkbox" id="study"></label>
    <p class="meta">Question bank: ${(bank.single || 0) + (bank.multi || 0)} multiple-choice + ${bank.match || 0} matching · practice target ${stats.passPct}%${stats.flagged ? ` · ${stats.flagged} flagged` : ''}</p>
    <p class="meta">The practice target is a study goal. ServiceNow does not publish the exam passing score.</p>`;

  bindDiscard();
  app.querySelector('#study').addEventListener('change', (e) => { study = e.target.checked; });
  const drillBtn = app.querySelector('[data-mode="drill"]');
  app.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
    drillDomain = Number(chip.dataset.domain);
    app.querySelectorAll('.chip').forEach((c) => {
      const on = c === chip;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', on);
    });
    drillBtn.disabled = false;
  }));
  app.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    if (open && !confirm('You have an unfinished attempt. Start a new one anyway?')) return;
    btn.disabled = true;
    try {
      const a = await api('POST', '/api/attempts', { mode, study, domain: drillDomain });
      location.hash = `#/a/${a.id}`;
    } catch (err) {
      btn.disabled = false;
      showError(err);
    }
  }));
}

// ---------- Exam ----------

async function examView(id) {
  const attempt = await api('GET', `/api/attempts/${id}`);
  if (attempt.submittedAt) { location.replace(`#/r/${id}`); return; }
  const qs = attempt.questions;
  const key = `cisdf-pos-${id}`;
  let idx = Math.min(Number(sessionStorage.getItem(key)) || 0, qs.length - 1);
  let sheetOpen = false;
  let timerId = null;
  const deadline = attempt.timeLimitSec ? new Date(attempt.startedAt).getTime() + attempt.timeLimitSec * 1000 : null;

  const answered = (q) => (q.type === 'recall' ? q.revealed && q.selected != null
    : q.type === 'match' ? !!q.selected?.length && q.selected.every((v) => v != null)
    : q.selected?.length > 0);

  function render() {
    sessionStorage.setItem(key, idx);
    const q = qs[idx];
    const done = qs.filter(answered).length;
    const locked = attempt.study && q.revealed;
    app.innerHTML = `
      <div class="exambar">
        <a class="btn ghost" href="#/" aria-label="Leave exam (progress is saved)">✕</a>
        <span class="count">${idx + 1}<span style="color:var(--color-muted)"> / ${qs.length}</span></span>
        <span class="timer" id="timer">${attempt.study ? 'STUDY' : deadline ? '' : esc(MODE_LABEL[attempt.mode])}</span>
      </div>
      <div class="progress" aria-hidden="true"><i style="width:${pct(done, qs.length)}%"></i></div>
      <div class="qhead"><span class="tag">${esc(q.domainName)}</span><span>${esc(q.subtopic || '')}</span>
        ${q.marked ? '<span class="tag" style="color:var(--color-accent)">Marked</span>' : ''}</div>
      <p class="qtext">${esc(q.text)}</p>
      ${q.type === 'multi' ? `<span class="choose">Choose ${q.choose}</span>` : ''}
      ${q.type === 'match' ? '<span class="choose">Select an answer for each item</span>' : ''}
      ${q.type === 'recall' ? recallBody(q) : q.type === 'match' ? matchBody(q, locked) : optionsBody(q, locked)}
      ${attempt.study && q.type !== 'recall' && !q.revealed ? `<div class="row"><button class="btn primary" id="check" ${answered(q) ? '' : 'disabled'}>Check answer</button></div>` : ''}
      ${locked && q.type !== 'recall' ? feedback(q) : ''}
      ${sheetOpen ? sheet() : ''}
      <nav class="dock" aria-label="Question navigation"><div class="inner">
        <button class="btn" id="prev" ${idx === 0 ? 'disabled' : ''}>‹ Prev</button>
        <button class="btn ${q.marked ? 'on' : ''}" id="mark" aria-pressed="${q.marked}" title="Mark for review">Mark</button>
        <button class="btn ${sheetOpen ? 'on' : ''}" id="sheet" aria-expanded="${sheetOpen}">Sheet</button>
        ${idx === qs.length - 1
          ? '<button class="btn primary" id="finish">Finish</button>'
          : '<button class="btn primary" id="next">Next ›</button>'}
      </div></nav>`;
    bind(q);
    tick();
  }

  function optionsBody(q, locked) {
    const multi = q.type === 'multi';
    return `<ul class="options" role="${multi ? 'group' : 'radiogroup'}">${q.options.map((o, n) => {
      const sel = q.selected?.includes(o.i);
      let cls = sel ? 'sel' : '';
      if (locked) cls += q.correct.includes(o.i) ? ' right' : sel ? ' wrong' : '';
      return `<li><label class="opt ${cls} ${locked ? 'locked' : ''}">
        <input type="${multi ? 'checkbox' : 'radio'}" name="opt" value="${o.i}" ${sel ? 'checked' : ''} ${locked ? 'disabled' : ''}>
        <span class="bubble">${LETTERS[n]}</span><span>${esc(o.text)}</span></label></li>`;
    }).join('')}</ul>`;
  }

  function matchBody(q, locked) {
    return matchList(q, locked, (k, sel) => `<select class="mselect" data-item="${k}" aria-label="Answer for item ${k + 1}" ${locked ? 'disabled' : ''}>
      <option value="">Select…</option>
      ${q.options.map((o) => `<option value="${o.i}" ${sel === o.i ? 'selected' : ''}>${esc(o.text)}</option>`).join('')}
    </select>`);
  }

  function recallBody(q) {
    if (!q.revealed) {
      return `<p class="note">Recall card: answer in your head, then reveal.</p>
        <div class="row"><button class="btn primary" id="reveal">Show answer</button></div>`;
    }
    return `<div class="answerbox"><strong>Answer</strong><p>${esc(q.answer)}</p>
        ${q.explanation ? `<p class="note">${esc(q.explanation)}</p>` : ''}</div>
      <div class="row">
        <button class="btn ${q.selected?.[0] === 1 ? 'on' : ''}" data-grade="1">I knew it</button>
        <button class="btn ${q.selected?.[0] === 0 ? 'on' : ''}" data-grade="0">I didn't</button>
      </div>`;
  }

  function feedback(q) {
    const ok = q.isCorrect;
    return `<div class="answerbox ${ok ? '' : 'bad'}"><strong>${ok ? 'Correct' : 'Incorrect'}</strong>
      ${q.explanation ? `<p>${esc(q.explanation)}</p>` : ''}
      ${q.note ? `<p class="note">${esc(q.note)}</p>` : ''}</div>`;
  }

  function sheet() {
    const unanswered = qs.length - qs.filter(answered).length;
    return `<section class="sheet" aria-label="Answer sheet">
      <div class="legend"><span class="l-done">Answered</span><span class="l-mark">Marked</span><span>Open</span></div>
      <div class="sheet-grid">${qs.map((q, n) => {
        let cls = answered(q) ? 'done' : '';
        if (attempt.study && q.revealed && q.isCorrect != null) cls = q.isCorrect ? 'ok' : 'ko';
        if (q.marked) cls += ' mark';
        if (n === idx) cls += ' cur';
        return `<button class="${cls}" data-go="${n}" style="--i:${n}" aria-label="Question ${n + 1}">${n + 1}</button>`;
      }).join('')}</div>
      <div class="row"><button class="btn primary" id="submit">Submit exam${unanswered ? ` (${unanswered} open)` : ''}</button></div>
    </section>`;
  }

  async function save(body) {
    try {
      Object.assign(qs[idx], await api('PUT', `/api/attempts/${id}/answers/${idx}`, body));
    } catch (err) {
      showError(err);
    }
  }

  async function reveal() {
    try {
      Object.assign(qs[idx], await api('POST', `/api/attempts/${id}/reveal/${idx}`));
      render();
    } catch (err) {
      showError(err);
    }
  }

  async function submit(auto = false) {
    const open = qs.length - qs.filter(answered).length;
    if (!auto && open && !confirm(`${open} question${open > 1 ? 's are' : ' is'} unanswered. Submit anyway?`)) return;
    if (!auto && !open && !confirm('Submit the exam?')) return;
    clearInterval(timerId);
    await api('POST', `/api/attempts/${id}/submit`);
    sessionStorage.removeItem(key);
    location.hash = `#/r/${id}`;
  }

  function go(n) {
    idx = Math.max(0, Math.min(qs.length - 1, n));
    render();
    window.scrollTo(0, 0);
  }

  function bind(q) {
    app.querySelectorAll('input[name="opt"]').forEach((input) => input.addEventListener('change', () => {
      const selected = [...app.querySelectorAll('input[name="opt"]:checked')].map((i) => Number(i.value));
      q.selected = selected;
      app.querySelectorAll('.opt').forEach((l) => l.classList.toggle('sel', l.querySelector('input').checked));
      const check = app.querySelector('#check');
      if (check) check.disabled = !selected.length;
      save({ selected });
    }));
    app.querySelectorAll('select.mselect').forEach((el) => el.addEventListener('change', () => {
      const selected = [...app.querySelectorAll('select.mselect')].map((s) => (s.value === '' ? null : Number(s.value)));
      q.selected = selected;
      const check = app.querySelector('#check');
      if (check) check.disabled = !answered(q);
      save({ selected });
    }));
    app.querySelector('#check')?.addEventListener('click', reveal);
    app.querySelector('#reveal')?.addEventListener('click', reveal);
    app.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', async () => {
      await save({ selected: [Number(b.dataset.grade)] });
      if (idx < qs.length - 1) go(idx + 1); else render();
    }));
    app.querySelector('#prev').addEventListener('click', () => go(idx - 1));
    app.querySelector('#next')?.addEventListener('click', () => go(idx + 1));
    app.querySelector('#finish')?.addEventListener('click', () => { sheetOpen = true; render(); app.querySelector('.sheet')?.scrollIntoView({ behavior: 'smooth' }); });
    app.querySelector('#mark').addEventListener('click', async () => { await save({ marked: !q.marked }); render(); });
    app.querySelector('#sheet').addEventListener('click', () => { sheetOpen = !sheetOpen; render(); });
    app.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.go))));
    app.querySelector('#submit')?.addEventListener('click', () => submit().catch(showError));
  }

  function tick() {
    if (!deadline) return;
    const el = app.querySelector('#timer');
    const left = (deadline - Date.now()) / 1000;
    if (el) {
      el.textContent = fmtClock(left);
      el.classList.toggle('low', left < 300);
    }
    if (left <= 0) {
      clearInterval(timerId);
      timerId = null;
      alert('Time is up. Your exam is being submitted.');
      submit(true).catch(showError);
    }
  }

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowRight' && idx < qs.length - 1) go(idx + 1);
    if (e.key === 'ArrowLeft' && idx > 0) go(idx - 1);
  };
  document.addEventListener('keydown', onKey);
  if (deadline) timerId = setInterval(tick, 1000);
  teardown = () => { clearInterval(timerId); document.removeEventListener('keydown', onKey); };
  render();
}

// ---------- Matching questions ----------

const optText = (q, i) => q.options.find((o) => o.i === i)?.text ?? '';

// One row per item: the statement, then the control rendered by `pick`.
// Once locked (checked in study mode, or on the results page) each row shows
// right/wrong and, when wrong, the correct option.
function matchList(q, locked, pick) {
  return `<ol class="matches">${q.items.map((text, k) => {
    const sel = q.selected?.[k] ?? null;
    const right = locked && sel === q.correct[k];
    const cls = locked ? (right ? 'right' : 'wrong') : sel != null ? 'sel' : '';
    return `<li class="match ${cls}"><span class="mtext">${esc(text)}</span>
      ${pick(k, sel)}
      ${locked && !right ? `<small class="mfix">Correct: ${esc(optText(q, q.correct[k]))}</small>` : ''}</li>`;
  }).join('')}</ol>`;
}

// ---------- Results ----------

function domainBars(domains, passPct) {
  const list = domains.filter((d) => d.total > 0);
  const weakest = list.length > 1 ? list.reduce((a, b) => (pct(b.correct, b.total) < pct(a.correct, a.total) ? b : a)) : null;
  return `<div class="bars">${list.map((d) => `
    <div class="bar ${d === weakest && pct(d.correct, d.total) < 100 ? 'weak' : ''}">
      <header><b>${esc(d.name)}</b><span>${d.correct}/${d.total} · ${pct(d.correct, d.total)}%</span></header>
      <div class="track" role="img" aria-label="${pct(d.correct, d.total)} percent"><i style="width:${pct(d.correct, d.total)}%"></i><span class="pass" style="left:${passPct}%"></span></div>
    </div>`).join('')}</div>`;
}

async function resultsView(id) {
  const a = await api('GET', `/api/attempts/${id}`);
  if (!a.submittedAt) { location.replace(`#/a/${id}`); return; }
  const s = a.summary;
  const used = (new Date(a.submittedAt) - new Date(a.startedAt)) / 1000;
  let filter = 'all';

  function reviewItem(q, n) {
    const options = q.type === 'match'
      ? matchList(q, true, (k, sel) => `<span class="mpick">${sel == null ? '<small>No answer</small>' : esc(optText(q, sel))}</span>`)
      : q.type === 'recall'
      ? `<div class="answerbox"><strong>Answer</strong><p>${esc(q.answer)}</p></div>
         <p class="note">Self-graded: ${q.selected?.[0] === 1 ? 'knew it' : q.selected?.[0] === 0 ? "didn't know" : 'not graded'}</p>`
      : `<ul class="options">${q.options.map((o, k) => {
          const sel = q.selected?.includes(o.i);
          const right = q.correct.includes(o.i);
          const cls = right ? 'right' : sel ? 'wrong' : '';
          const label = right && sel ? 'Your answer · correct' : right ? 'Correct answer' : sel ? 'Your answer' : '';
          return `<li><div class="opt locked ${cls} ${sel ? 'sel' : ''}"><span class="bubble">${LETTERS[k]}</span>
            <span>${label ? `<small>${label}</small>` : ''}${esc(o.text)}</span></div></li>`;
        }).join('')}</ul>`;
    return `<li>
      <div class="qhead"><span class="verdict ${q.isCorrect ? 'ok' : 'ko'}">${q.isCorrect ? '✓ Correct' : q.selected == null ? '— Unanswered' : '✗ Wrong'}</span>
        <span>Q${n + 1}</span><span class="tag">${esc(q.domainName)}</span><span>${esc(q.subtopic || '')}</span></div>
      <p class="qtext">${esc(q.text)}</p>
      ${options}
      ${q.explanation && q.type !== 'recall' ? `<div class="answerbox"><strong>Explanation</strong><p>${esc(q.explanation)}</p></div>` : ''}
      <button class="btn ghost" data-flag="${esc(q.id)}">${q.flagged ? 'Unflag question' : 'Flag as wrong / unclear'}</button>
    </li>`;
  }

  function render() {
    const shown = a.questions.map((q, n) => [q, n]).filter(([q]) =>
      filter === 'all' || (filter === 'wrong' && !q.isCorrect) || (filter === 'marked' && q.marked));
    app.innerHTML = `${masthead(`${MODE_LABEL[a.mode]}${a.study ? ' · study' : ''} · ${fmtDate(a.submittedAt)}`)}
      <section class="score">
        <div class="big">${Math.round(s.scorePct)}<sup>%</sup></div>
        <div><span class="stamp ${s.passed ? 'pass' : 'fail'}">${s.passed ? 'Target met' : 'Below target'}</span>
          <p>${s.correct} of ${s.total} correct · practice target ${a.passPct}% · ${fmtClock(used)} used</p></div>
      </section>
      <h2>By domain</h2>
      ${domainBars(Object.values(s.domains), a.passPct)}
      <div class="row" style="margin-top:var(--s3)"><a class="btn primary" href="#/">New exam</a></div>
      <h2>Review</h2>
      <div class="filters" role="group" aria-label="Filter">
        ${[['all', `All ${a.questions.length}`], ['wrong', `Wrong ${a.questions.filter((q) => !q.isCorrect).length}`], ['marked', `Marked ${a.questions.filter((q) => q.marked).length}`]]
          .map(([k, label]) => `<button class="chip ${filter === k ? 'on' : ''}" data-filter="${k}" aria-pressed="${filter === k}">${label}</button>`).join('')}
      </div>
      <ol class="review">${shown.map(([q, n]) => reviewItem(q, n)).join('') || '<li class="empty">Nothing here.</li>'}</ol>`;

    app.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; render(); }));
    app.querySelectorAll('[data-flag]').forEach((b) => b.addEventListener('click', async () => {
      const r = await api('POST', `/api/questions/${b.dataset.flag}/flag`);
      a.questions.filter((q) => q.id === r.id).forEach((q) => { q.flagged = r.flagged; });
      b.textContent = r.flagged ? 'Unflag question' : 'Flag as wrong / unclear';
    }));
  }
  render();
}

// ---------- History ----------

async function historyView() {
  const [attempts, stats] = await Promise.all([api('GET', '/api/attempts'), api('GET', '/api/stats')]);
  const graded = attempts.filter((a) => a.submittedAt && !a.study).reverse();
  app.innerHTML = `${masthead('Progress')}
    <h2>Score trend</h2>
    ${graded.length ? `<div class="trend" role="img" aria-label="Scores of graded attempts, oldest first">
        <span class="pass" style="bottom:${stats.passPct}%"></span>
        ${graded.map((a) => `<i class="${a.passed ? '' : 'ko'}" style="height:${a.scorePct}%" title="${esc(MODE_LABEL[a.mode])}: ${a.scorePct}%"></i>`).join('')}
      </div>` : '<p class="empty">No graded exams yet. Study-mode attempts are not counted.</p>'}
    <h2>Accuracy by domain (all graded exams)</h2>
    ${stats.domains.length ? domainBars(stats.domains, stats.passPct) : '<p class="empty">Nothing yet.</p>'}
    ${stats.weak.length ? `<h2>Weak spots</h2><div class="bars">${stats.weak.map((w) => `
      <div class="bar weak"><header><span>${esc(w.subtopic)}</span><span>${w.correct}/${w.total}</span></header>
      <div class="track"><i style="width:${pct(w.correct, w.total)}%"></i></div></div>`).join('')}</div>` : ''}
    <h2>Attempts</h2>
    <ul class="attempts">${attempts.map((a) => `<li><a href="#/${a.submittedAt ? 'r' : 'a'}/${a.id}">
      <span>${esc(MODE_LABEL[a.mode])}${a.study ? ' · study' : ''}${a.domainFilter ? ` · ${esc(stats.domainInfo[a.domainFilter].name)}` : ''}
        <small>${esc(fmtDate(a.startedAt))} · ${a.questionCount} questions</small></span>
      <span class="num ${a.submittedAt ? (a.passed ? 'ok' : 'ko') : ''}">${a.submittedAt ? `${Math.round(a.scorePct)}%` : 'Resume'}</span>
    </a>${a.submittedAt ? '' : `<button class="btn ghost" data-discard="${a.id}" aria-label="Discard unfinished attempt">Discard</button>`}</li>`).join('') || '<li class="empty">No attempts yet.</li>'}</ul>`;
  bindDiscard();
}
