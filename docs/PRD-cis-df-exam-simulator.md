# PRD — CIS-DF Exam Simulator (throwaway prep app)

| | |
|---|---|
| **Owner** | Johan |
| **Status** | v0.3 — 2026-10-28 · prototype built (M1 + M2 done, see §9) |
| **Lifetime** | Throwaway. Use until the exam is passed (deadline: before 2026-12-31), then delete. |
| **Goal exam** | ServiceNow Certified Implementation Specialist – Data Foundations (CMDB and CSDM), "CIS-DF" |

---

## 1. Problem & goal

I need to pass CIS-DF before the end of the year and have only a few days to prepare.
I have a pile of practice Q&A in a PDF, but reading a PDF isn't the same as answering
under exam conditions, and it doesn't show me which topics I'm weak in.

**Goal:** a small mobile-friendly web app on this server that:

1. builds realistic mock exams from a question bank, weighted like the real exam blueprint,
2. lets me answer them on my phone (primary device),
3. scores the attempt, shows every question with my answer and the correct one, and
4. keeps a history so I can see whether I'm improving and which domains are weak.

**Success criteria:** I take at least 3 full mock exams, my score goes up over time, and
I consistently score ≥ 80% in every domain before booking the real exam.

### Non-goals (on purpose)
- No user accounts, authentication, roles or multi-user support (single user only, see §8 for exposure risk).
- No admin UI for editing questions in v1. The question bank is a seed file I edit by hand.
- No production hardening, CI/CD, monitoring or backups beyond "copy the DB file".
- No spaced-repetition algorithm, AI-generated explanations or gamification in v1.

---

## 2. Source material (already in `docs/`)

| File | What it contains | Use |
|---|---|---|
| `CIS-DF Assessment.pdf` (40 pages, Pribhav IT Solutions) | ~150 practice questions, grouped by section: Assessment 1 (Configuration: IRE, CI Class Manager, Multisource/CMDB 360, Dynamic Reconciliation, roles), Ingest (Discovery, Service Mapping, ACC, IntegrationHub ETL, Import Sets, Service Graph Connectors), Govern (Health, Duplicate CI Remediator, de-dup templates, reclassification, lifecycle sync, Data Manager), Insight (Data Foundations dashboards, Unified Map, Query Builder, NLQ) | **Primary question bank source** |
| `CIS - CMDB _ CSDM Data Foundation.pdf` (45 pages) | Course notes plus the **official exam scope and domain weightings** (below), study path, links to the blueprint | Domain model, exam weighting, explanations |

### Official exam domains (from the course notes)

| # | Domain | Weight | Key sub-topics |
|---|---|---|---|
| 1 | Configuration | 15% | CI Class Manager, IRE, CMDB 360 / Multisource CMDB |
| 2 | Ingest | 19% | Relationships, ingestion method choice, technical debt / upgradeability, non-discoverable CIs and attributes, compliance identifiers, Asset ↔ CI alignment |
| 3 | Govern | 35% | 6 health metrics, Data Manager policies, governance roles, Health dashboards and KPIs, duplicates and the de-dup wizard, CMDB Workspace, principal classes, lifecycle attributes, Data Foundations dashboard |
| 4 | Insight | 20% | Business value, NLQ, CMDB 360 saved queries, Query Builder, Unified Map, Foundation dashboards and playbooks |
| 5 | CSDM Fundamentals | 11% | Mapping CIs to CSDM domains, stakeholders, approach, benefits |

### Known data quality issues to handle during import
- The PDF has no text tools on this server. Text was extracted with a small stdlib Python
  script (Word-generated PDF, literal text strings). This works but isn't perfect.
- Questions use several inconsistent formats: `Question:` / `Q:` / `Question -`, options as
  `A.` / `A:` / `A -`, answers as `Answer:` / `Ans -` / `Correct Answer:`, and some
  inline as `Q: … A: …`.
- Stray footnote digits stick to question text (e.g. `CMDB?1`, `(Choose 2)586`). Strip them.
- Some questions are **open-ended** (no options), and some "Match the following" / "Map below"
  items are **images** and can't be extracted as text.
- **CSDM Fundamentals (11%) is thin** in the source. It needs extra questions (see §6).
- Some questions are **duplicated** across sections (e.g. the dynamic reconciliation ones).

---

## 3. Users & usage context

One user (me), studying in short sessions:
- **Phone** (main use): on the go, portrait, one hand. Needs big tap targets and no hover.
- **Work laptop:** not supported in v1 (no Tailscale). Could be added later via Funnel.

Both reach the app over the **Tailscale tailnet** (`https://thinkcentre.tail3d85f9.ts.net`),
**tailnet only**. The work laptop has no Tailscale, so it's out of scope for now.
Public access through Funnel is postponed (see §7.5).

---

## 4. Functional requirements

Priorities: **P0** = prototype must have, **P1** = nice to have if time allows, **P2** = later / probably never.

### 4.1 Question bank
| ID | Req | Pri |
|---|---|---|
| QB-1 | Store questions with: text, options (2–7), correct option(s), type (`single` / `multi` / `recall`), domain (1–5), sub-topic, optional explanation, source (`pdf-assessment`, `manual`, `ai-draft`) + reference URL, active flag | P0 |
| QB-2 | Seed the DB from a hand-reviewable `questions.json` file (idempotent re-seed keyed by a stable question id) | P0 |
| QB-3 | One-off import script that parses the extracted PDF text into `questions.json` as a **first draft**, which I then review by hand | P0 |
| QB-4 | Open-ended PDF questions (no options) become **recall cards**: show the question, reveal the answer, self-grade. No invented distractors. They appear only in Study mode. **Superseded 2026-11-04:** recall cards were converted to single-choice questions with drafted wrong options ([change log](question-bank-changes.md)) | P0 |
| QB-5 | Multi-select questions state "(Choose N)" in the text, like the real exam | P0 |
| QB-6 | "Flag as wrong/unclear" button on a question during review, saved for later fixing | P1 |

### 4.2 Exam simulation
| ID | Req | Pri |
|---|---|---|
| EX-1 | **Start a full mock exam**: draw N questions (default **75**) at random, **stratified by domain weight** (§2). E.g. 75 → 12 / 14 / 26 / 15 / 8 | P0 |
| EX-2 | Avoid repeats: prefer questions I've seen least, then ones I got wrong before | P1 |
| EX-3 | **Exam modes**: `Full mock` (75 q, timed), `Quick` (20 q, untimed), `Domain drill` (pick 1 domain, 15 q), `Retry mistakes` (questions answered wrong in the last N attempts) | P0: Full + Quick · P1: Drill + Retry |
| EX-4 | Shuffle option order per attempt (keep the mapping so scoring is correct) | P0 |
| EX-5 | One question per screen, with Prev / Next, a question map (grid of numbers showing answered / unanswered / flagged), and "Mark for review" | P0 |
| EX-6 | Countdown timer for Full mock (default **90 min**); auto-submit when it runs out | P0 |
| EX-7 | **No feedback during the exam** (as in the real thing). Answers are revealed only after submit | P0 |
| EX-8 | Progress survives a reload or phone lock: answers are saved to the server on every change, and the attempt can be resumed | P0 |
| EX-9 | Confirm before submitting if questions are unanswered | P0 |
| EX-10 | **Study mode**: a toggle when starting an attempt. After I answer, it immediately shows right/wrong, the correct answer and the explanation. Study-mode attempts are stored, but kept apart from mock scores in the progress trend | P0 |

### 4.3 Results & review
| ID | Req | Pri |
|---|---|---|
| RS-1 | Results summary: score %, correct/total, target met/below target against a configurable practice target (default **70%**), time used. ServiceNow's exam cut score is private. | P0 |
| RS-2 | **Per-domain breakdown**: correct/total and % per domain, with the weakest domain highlighted | P0 |
| RS-3 | Review list: every question with my answer, the correct answer, right/wrong marker, and explanation. Filter: All / Wrong / Flagged | P0 |
| RS-4 | Multi-select scoring is all-or-nothing (as on ServiceNow exams) | P0 |

### 4.4 History & progress
| ID | Req | Pri |
|---|---|---|
| HI-1 | Attempt history list: date, mode, score, practice target outcome. Tap one to open its review (RS-3) | P0 |
| HI-2 | Progress view: score trend over attempts, plus per-domain % across all attempts (simple bars, no heavy chart lib) | P1 |
| HI-3 | "Weak spots": sub-topics with the lowest accuracy (min. 3 answers) | P1 |
| HI-4 | Export history as JSON/CSV | P2 |

---

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Mobile | Mobile-first responsive layout. Works at 360px width, tap targets ≥ 44px, no horizontal scroll, readable without zoom. Dark mode follows the system setting |
| Performance | Pages load in < 1s on the tailnet. The question bank is < 1 MB |
| Simplicity | As few dependencies as possible. Must run with `npm start` and no build step |
| Data safety | A single SQLite file. "Backup" = copy the file. Re-seeding questions must **never** wipe attempt history |
| Reversibility | Everything lives in this repo plus one tmux session. Teardown = stop the session, turn off the funnel, delete the repo |

---

## 6. Content plan (question bank)

**Current bank (v1):** `data/questions.json`, transcribed from `CIS-DF Assessment.pdf` only:
130 multiple-choice + 48 recall cards (1 more inactive because the source gives no answer).

| Domain | Per 75-q exam | MC in bank | Recall cards |
|---|---|---|---|
| Configuration | 12 | 23 | 8 |
| Ingest | 14 | 33 | 6 |
| Govern | 26 | 42 | 23 |
| Insight | 15 | 23 | 8 |
| CSDM Fundamentals | 8 | 9 | 3 |

Fixes made while transcribing:
- removed duplicate questions, stripped footnote digits, normalised option labels;
- a source option that duplicated another one was dropped (`csdm-grp-01`), and the reason is in `note`;
- the ambiguous lifecycle migration question (`gov-lc-01`) was subsequently clarified to ask explicitly about Life Cycle Mapping; see the [applied review changes](question-bank-changes.md).

**Later (deferred):** grow the bank toward ≥ 250 questions from other free practice exam
sets, with CSDM Fundamentals as the priority. Each imported question gets `source` and
`reference` (URL). Repeats across mock exams are expected until then. Selection prefers
questions you have seen least.

## 7. Proposed solution (prototype)

### 7.1 Stack
- **Backend:** Node 22 (already installed, v22.23) using the built-in **`node:sqlite`** module
  and `node:http`. Zero npm dependencies, so nothing to install. If the routing gets
  annoying, Express is the one allowed addition.
- **Frontend:** one static `index.html` with vanilla JS and CSS (no framework, no build).
  The views are hash routes: `#/`, `#/exam/:id`, `#/results/:id`, `#/history`.
- **DB:** `data/cisdf.sqlite` (git-ignored).

### 7.2 Data model (SQLite)

```sql
questions (
  id TEXT PRIMARY KEY,            -- stable slug, e.g. "cfg-ire-001"
  domain INTEGER NOT NULL,        -- 1..5
  subtopic TEXT,
  type TEXT CHECK(type IN ('single','multi')),
  text TEXT NOT NULL,
  options_json TEXT NOT NULL,     -- ["...", "...", ...]
  correct_json TEXT NOT NULL,     -- [0, 2]  (indexes into options)
  explanation TEXT,
  source TEXT, reference TEXT,
  active INTEGER DEFAULT 1,
  flagged INTEGER DEFAULT 0
);

attempts (
  id INTEGER PRIMARY KEY,
  mode TEXT,                      -- full | quick | drill | retry
  domain_filter INTEGER,
  started_at TEXT, submitted_at TEXT,
  time_limit_sec INTEGER,
  score_pct REAL, correct INTEGER, total INTEGER
);

attempt_questions (
  attempt_id INTEGER, position INTEGER,
  question_id TEXT,
  option_order_json TEXT,         -- shuffled order shown to the user
  selected_json TEXT,             -- user's picks (original indexes)
  marked INTEGER DEFAULT 0,
  is_correct INTEGER,             -- set on submit
  PRIMARY KEY (attempt_id, position)
);
```

### 7.3 API (JSON)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/attempts` `{mode, count?, domain?}` | Build an exam and return the attempt id plus questions **without answers** |
| `GET` | `/api/attempts/:id` | Resume an attempt (answers hidden until it's submitted) |
| `PUT` | `/api/attempts/:id/answers/:pos` `{selected, marked}` | Autosave one answer |
| `POST` | `/api/attempts/:id/submit` | Score it and return the results with per-domain breakdown and full review |
| `GET` | `/api/attempts` | History list |
| `GET` | `/api/stats` | Per-domain and sub-topic accuracy, score trend |
| `POST` | `/api/questions/:id/flag` | Flag a question |

The correct answers are never sent to the client before submit (so the browser's
dev tools can't "help" during a mock).

### 7.4 Repo layout

```
cis-df/
  docs/                      # source PDFs + this PRD
  data/questions.json        # reviewed question bank (committed)
  data/cisdf.sqlite          # runtime DB (git-ignored)
  lib/exam.js                # weighting, selection, scoring (unit tested)
  lib/db.js                  # schema + seed
  test/exam.test.js          # node:test
  server.js                  # http server + API + seed on start
  public/index.html, app.js, style.css
  package.json               # "start": "node server.js"
```

### 7.5 Deployment
- Runs in its own tmux session, **`cisdf-app`**, on **port 4460** (free; 4444 is the Workstation UI):
  `tmux new-session -d -s cisdf-app -c ~/workstation/repos/cis-df 'HOST=0.0.0.0 PORT=4460 npm start'`
- **Tailnet access (default):** `http://thinkcentre.tail3d85f9.ts.net:4460`, or Tailscale Serve on its own HTTPS path/port.
- **Public access: postponed (decision 2026-10-28).** If needed later: Tailscale Funnel on public port **10000** → 4460 (Funnel only allows 443, 8443 and 10000,
  and 443/8443 already appear to be in use on this host) **only if**
  the work laptop can't join the tailnet. Turn it off after the exam.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Funnel makes an unauthenticated app public; anyone with the URL can see and edit history | v1 is tailnet-only, no Funnel. If Funnel is added later: add a single shared-secret token in the URL/cookie (one env var, ~10 lines), and disable Funnel after the exam |
| Practice questions are wrong or outdated (third-party PDF) | `explanation` + `reference` fields, a flag button, and checks against official docs for anything flagged |
| Questions too easy / memorized → false confidence | Shuffle options, stratified random draw, bank ≥ 250, and track first-try accuracy separately from retries |
| Running out of prep time building the app | Strict P0 scope. Content beats features: if time is short, ship the P0 UI with the ~150 parsed questions and add content later |
| Exam simulation differs from the official exam | Defaults verified against KB0012913: 75 questions / 90 min. The 70% practice target is configurable and is not the private exam cut score. Drag/drop matching remains a simulation gap. |

---

## 9. Milestones

| # | Deliverable | Est. |
|---|---|---|
| M1 ✅ | Transcribe the PDF into `questions.json` (178 active items) | done |
| M2 ✅ | Server + DB + seed + all modes + study mode + results/review, running in tmux | done |
| M3 ⏸ | Add questions from free practice exam sets (deferred) | later |
| M4 ✅ | P1: domain drill, retry mistakes, progress view, weak spots | done |
| — | Study: ≥ 3 full mocks, drill the weak domains, ≥ 80% everywhere → book the exam | rest |

---

## 10. Decisions (resolved 2026-10-28)
1. **Exam format (updated 2026-11-03):** use 75 questions / 90 min, verified against the
   [official blueprint (KB0012913)](https://learning.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0012913).
   The configurable 70% threshold is a practice target; ServiceNow does not publish the exam cut score.
2. **Access:** phone over the tailnet only. No Funnel and no token in v1. The work laptop is out of scope.
3. **Study mode:** in v1 (EX-10 promoted to P0).
4. **Content (updated):** no self-drafted questions. Extra questions may later come only from
   other free practice exam sets found online. **Deferred**: v1 uses only the assessment PDF.
5. **PDF extraction:** done with the `mupdf` npm package (WASM, no sudo). Image-only
   matching exercises were transcribed by hand and split into one question per pair.
6. **Content review (2026-11-03):** 35 items corrected or clarified using official documentation;
   six unverified items left unchanged. See [exact before/after changes](question-bank-changes.md).
   Existing attempts retain their original questions and keys when the bank is reseeded.
