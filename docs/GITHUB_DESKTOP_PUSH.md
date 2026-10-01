# GitHub Desktop — push planning docs (step by step)

**Your GitHub repo:** https://github.com/devdigifingers/RMM-PSA-Design.git  

**Why Desktop looks empty:** GitHub Desktop only shows files in the **local folder** it opened. The planning docs were built in the Cursor cloud project and are **not yet** in that folder / on GitHub. You must put the files in the local folder, then push.

You do **not** create a branch named `/workspace/...`.  
Optional branch name later: `cursor/platform-phased-plan-b80e`.  
For simplicity, push to **`main`** first.

---

## Step 1 — Confirm what folder GitHub Desktop is using

In GitHub Desktop:

1. **Repository → Show in Explorer** (Windows) or **Show in Finder** (Mac).  
2. Look inside that folder.

**Ask:** Is there a `docs` folder with `CHAT_HANDOFF.md`?

| Answer | What it means |
|--------|----------------|
| **No** | Empty/wrong folder — continue with Step 2 |
| **Yes** | Skip to Step 3 |

---

## Step 2 — Put the planning files into that folder

### Option A (easiest): unzip the planning pack

1. Download `RMM-PSA-Design-planning-docs.zip` (from the agent artifacts / chat attachment if provided).  
2. Open your local `RMM-PSA-Design` folder (the one from Step 1).  
3. Extract the zip **into that folder** so you get:

```text
RMM-PSA-Design/
  README.md
  docs/
    CHAT_HANDOFF.md
    DECISIONS.md
    PHASED_PLAN.md
    SETUP_AND_DR.md
```

4. Go back to GitHub Desktop — you should now see those files listed as changes.

### Option B: you already have the Cursor project with `docs/`

1. GitHub Desktop → **File → Add Local Repository…**  
2. Choose the Cursor project folder that **already contains** `docs/CHAT_HANDOFF.md` (not an empty clone).  
3. **Repository → Repository settings → Remote**  
   - Primary remote URL: `https://github.com/devdigifingers/RMM-PSA-Design.git`  
4. Continue to Step 3.

---

## Step 3 — Commit in GitHub Desktop

1. Left side: you should see changed files (`README.md`, `docs/...`).  
2. Summary (bottom left): e.g. `Add Digital Fingers RMM/PSA planning docs`  
3. Click **Commit to main** (or commit to current branch).

If Desktop says the repo has no commits yet, make this the **first commit** on `main`.

---

## Step 4 — Push to GitHub

1. Click **Push origin** (or **Publish branch** if it says that).  
2. Wait until it finishes with no error.

---

## Step 5 — Verify in the browser

Open: https://github.com/devdigifingers/RMM-PSA-Design  

You should see `README.md` and a `docs` folder.  
If yes — you’re done. The project can read the md files from the repo.

---

## Step 6 — Open in Cursor IDE

1. Cursor → Open the **same** `RMM-PSA-Design` folder (or clone from GitHub).  
2. Open `docs/CHAT_HANDOFF.md`.  
3. New chat → type `@CHAT_HANDOFF` or `@docs/CHAT_HANDOFF.md`.

---

## If something still fails

| Problem | Fix |
|---------|-----|
| Desktop still shows no files | Wrong folder — Step 1 again; unzip into that folder |
| Push asks for login | Sign into GitHub inside GitHub Desktop (File → Options → Accounts) |
| “Repository not found” | Confirm remote URL is exactly `https://github.com/devdigifingers/RMM-PSA-Design.git` and your account can access it |
| Confused about branch `/workspace/...` | Ignore that path. Use **`main`**. |

**Bottom line:** Empty Desktop = empty local folder. Add the `docs` + `README`, commit, push to `main`.
