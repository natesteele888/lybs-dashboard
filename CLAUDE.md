# LYBS Reporting — AI Contributor Rules

> **Nov 2026 — this public repo is CODE ONLY.** Nathan's rule: no player data in any public repo, not even first name + last initial.
> `data.js` and `gc_stats.js` ship empty here and `processed_data.xlsx` is gitignored. Player records, stats and amounts live only in the
> private `lybs-reporting` repo. Never run `process.py` output into this repo. Coaches' published contact info is the one allowed exception.

## Privacy Rules — Non-Negotiable

The following personal information must **never** appear in any committed file under any circumstances:

- **Email addresses** — no player, parent, or contact emails
- **Phone numbers** — no mobile, home, or work numbers
- **Dates of birth** — no full birthdates in any format (DOB, birthdate, dob, birth_date, etc.)
- **Full last names** — last names must always be reduced to first initial only (e.g. `Smith` → `S`)
- **Street addresses** — no house numbers, street names, apartment numbers
- **Zip / postal codes**
- **State** (when paired with other identifying info)

This applies to **every file** in the repo: `.js`, `.json`, `.xlsx`, `.csv`, `.md`, `.html`, `.txt`, or any other format.

## Data Flow — How This Repo Works

```
raw_data/          ← NEVER committed (gitignored). Contains original exports with PII.
    ↓
process.py         ← Middleware. Reads raw_data/, scrubs all PII, writes outputs.
    ↓
data.js            ← Committed. Contains only scrubbed player records.
processed_data.xlsx← Committed. Same scrubbed data in spreadsheet form.
```

**The only way to update player data is:**
1. Drop new registration export files into `raw_data/`
2. Run `python3 process.py`
3. Commit the updated `data.js` and `processed_data.xlsx`

Never manually edit `data.js` with player data. Never bypass `process.py`.

## What Is Safe to Commit

| Field | Committed? |
|-------|-----------|
| First name | Yes |
| Last initial (single letter) | Yes |
| Sport | Yes |
| Division | Yes |
| All-Star bracket (8U–12U) | Yes — computed from DOB during processing, DOB discarded |
| City | Yes |
| Team name | Yes |
| Registration amount | Yes |
| Gender | Yes |
| Year | Yes |
| Email | **NO** |
| Phone | **NO** |
| Date of birth | **NO** |
| Full last name | **NO** |
| Street address | **NO** |
| Zip code | **NO** |

## Raw Data Files

- `raw_data/` is in `.gitignore` and must stay there
- Never remove `raw_data/` from `.gitignore`
- Never use `git add -f` or `--force` on any file in `raw_data/`
- If you receive a new registration export, place it in `raw_data/` and run `process.py` — do not manually copy data from it into any committed file

## Before Every Commit — Checklist

- [ ] Does any `.js` or `.json` file contain `@` (email address)?
- [ ] Does any file contain a string matching a phone number pattern (e.g. `978-`, `(978)`)?
- [ ] Does any file contain a field named `dob`, `birthdate`, or `birth_date` with a value?
- [ ] Does any file contain a last name longer than 1 character in player records?
- [ ] Is `raw_data/` still in `.gitignore`?

If any answer is **yes** — do not commit. Fix the issue first.

## Nate AI Brain (shared memory)
This app is one of several that share parts and lessons through the private
`natesteele888/nate-brain` repo.
- **Apps & links:** `apps.md` lists every app's live link, repo and Toolbox id,
  explains Nate's Toolbox app (his hub, natesteele888.github.io/apps/toolbox/) and
  how to send it updates. Never guess an app URL; if one changes, update
  `natesteele888/apps/registry.json`.
- **Read first:** before building, check `lessons.md`, and check `parts.md` for
  anything that already exists (sign-in, rules, calendar export, offline install,
  rosters…). Reuse the keeper version and follow its `playbooks/<id>.md`.
- **Write back:** when you hit a bug, gotcha or better way another project would
  want, add a dated entry to `nate-brain/lessons.md`. If you change a shared part
  here, update its entry in `parts.md`.
- Know-how only in nate-brain: never copy names, contact info, stats or secrets into it.
