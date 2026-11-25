# CIS-DF Exam Simulator

A small web app for practising the **ServiceNow Certified Implementation Specialist – Data Foundations (CMDB and CSDM)** exam, also called "CIS-DF".

It runs on your own computer and you use it in your browser. It gives you:

- **Full mock.** 75 questions in 90 minutes, weighted like the real exam blueprint.
- **Quick exam.** 20 questions with no timer.
- **Domain drill.** 15 questions from one exam domain.
- **Retry mistakes.** Up to 20 questions you got wrong last time.
- **Study mode.** A switch on the start page. Each answer is checked right away and you see the explanation.
- **History.** Your score trend, accuracy by domain and weak spots.

Everything stays on your computer. You don't need an account or internet access (except to download it).

---

## Quick start (about 5 minutes)

### Step 1: Install Node.js (one time only)

The app runs on **Node.js**, a free program for running JavaScript.

1. Go to **https://nodejs.org** and download the **LTS** version (the big green button).
2. Run the installer and keep all the default options.
3. To check that it worked, open a terminal and run `node --version`:
   - **Windows:** press the Windows key, type `cmd` and press Enter.
   - **Mac:** press Cmd+Space, type `Terminal` and press Enter.

   You should see a version number such as `v24.11.0`. It must be **22.13 or higher**.

Nothing else needs to be installed. The app has no other dependencies, so you don't need to run `npm install`.

### Step 2: Get the code

**Option A: Download a ZIP (easiest).**
On the GitHub page of this repository, click the green **Code** button, then **Download ZIP**. Unzip it wherever you like, for example in your Documents folder.

**Option B: Use Git**, if you already have it:

```bash
git clone https://github.com/jokajoka4/CIS-DF.git
cd CIS-DF
```

> The repository is private. If you get a "not found" error, ask the owner to add you as a collaborator on GitHub.

### Step 3: Start the app

**Windows:** double-click **`Start-Windows.bat`** in the folder.

**Mac:** double-click **`Start-Mac.command`** in the folder.
The first time, macOS may say it "cannot be opened because it is from an unidentified developer". If so, right-click the file, choose **Open**, then click **Open** again.

Your browser opens the app at **http://localhost:4460**. A terminal window also opens. Leave it open while you practise, because it is the app running.

**To stop the app**, close that terminal window or press `Ctrl+C` in it.

<details>
<summary>Prefer the terminal? (Windows, Mac and Linux)</summary>

Open a terminal in the project folder and run:

```bash
npm start
```

Then open **http://localhost:4460** in your browser. Press `Ctrl+C` to stop.
</details>

---

## How to use it

1. **Turn on Study mode and run a few Domain drills.** You see the right answer and an explanation after each question, so you learn as you go.
2. **Take a Full mock** when you feel ready. It is timed like the real exam. You can **Mark** questions to come back to and use **Sheet** to jump between questions.
3. **Look at your results.** Every question shows your answer and the correct one, and you get a score for each domain.
4. **Use Retry mistakes** to work on your weak spots, and check **History** to see which domains need more work. Study-mode attempts don't count towards your statistics.

A note on the pass mark: the app uses **70% as a practice target**. ServiceNow does not publish the real exam's pass mark, so treat it as a guide. Aim to score **80% or more in every domain** before you book the real exam.

**Matching questions** (where you pick an answer from a dropdown for each statement) are scored all-or-nothing, like on the real exam: every dropdown has to be right.

### Your progress

Your answers and history are saved in `data/cisdf.sqlite` in the project folder, and they are kept when you restart the app.

- **Back up your progress:** copy that file somewhere safe.
- **Start over with a clean history:** stop the app, delete `data/cisdf.sqlite` (and any `cisdf.sqlite-wal` and `cisdf.sqlite-shm` files next to it), then start the app again.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `'node' is not recognized…` or `node: command not found` | Node.js isn't installed, or the terminal was opened before you installed it. Install Node.js (Step 1), then **open a new terminal** or restart your computer. |
| "This app needs Node.js 22.13 or newer" | Your Node.js is too old. Install the current LTS version from https://nodejs.org. |
| "Port 4460 is already in use" | The app is probably already running in another window, so just open http://localhost:4460. Or use another port, as in the next row. |
| Need a different port | **Mac/Linux:** `PORT=4461 npm start` · **Windows (cmd):** `set PORT=4461 && npm start` · **Windows (PowerShell):** `$env:PORT=4461; npm start`. Then open `http://localhost:4461`. |
| Double-clicking `Start-Mac.command` does nothing or shows "permission denied" | Open Terminal in the folder and run `chmod +x Start-Mac.command`, or use `npm start` instead. |
| The page looks plain or the fonts look different | The fonts come from the internet. Without a connection the app still works with your system's default fonts. |

---

## Technical details (for maintainers)

- **Requirements:** Node.js 22.13+ (it uses the built-in `node:sqlite`). There are no npm dependencies.
- **Run the tests:** `npm test`
- **Project layout:**
  - `server.js`: the web server and API
  - `lib/exam.js`: exam logic (domain weighting, question selection, scoring), with unit tests
  - `lib/db.js`: the SQLite database and how questions are loaded into it
  - `public/`: the browser app (plain HTML, CSS and JavaScript, no framework)
  - `data/questions.json`: the question bank
  - `test/`: tests
  - `docs/PRD-cis-df-exam-simulator.md`: the original requirements
- **Editing questions:** edit `data/questions.json` and restart the app. Questions are reloaded on every start. Past attempts keep the questions and answer keys they were taken with.
  - Types: `single`, `multi` (`correct` lists every correct option index) and `match`.
  - In a `match` question, `items` are the statements, `options` fill each dropdown, and `correct[i]` is the option index for item `i`.
  - Set `"active": false` to hide a question without deleting it.
- **Settings** (environment variables):

  | Variable | Default | Meaning |
  |---|---|---|
  | `PORT` | `4460` | Port to listen on |
  | `HOST` | `127.0.0.1` | `127.0.0.1` means only this computer can open the app. Set it to `0.0.0.0` to allow other devices on your network, such as your phone, at `http://<your-computer's-IP>:4460`. The app has **no login**, so only do this on a network you trust. |
  | `EXAM_QUESTIONS` | `75` | Questions in a full mock exam |
  | `EXAM_MINUTES` | `90` | Time limit of a full mock exam |
  | `PASS_PCT` | `70` | Practice pass target, in % |
  | `DB_FILE` | `data/cisdf.sqlite` | Where progress is stored |
  | `OPEN_BROWSER` | (unset) | If set, opens the browser on start. The launchers set it. |

- **Owner's server deployment:** the app runs in the tmux session `cisdf-app`:

  ```bash
  tmux new-session -d -s cisdf-app -c ~/workstation/repos/cis-df 'HOST=0.0.0.0 PORT=4460 npm start'
  ```
