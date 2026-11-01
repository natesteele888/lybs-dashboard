# Lunenburg Youth Baseball & Softball — Registration Dashboard

A single-page web dashboard for tracking and analyzing player registration data for the Lunenburg Youth Baseball & Softball (LYBS) league.

## What It Does

### Overview Tab
Displays top-level registration stats for the current season — total players by sport (Baseball, Softball, T-Ball), division breakdowns, and a revenue snapshot. Includes charts for sport distribution and division counts.

### Year-over-Year Tab
Compares registration numbers across seasons. Shows total registrations and per-sport trends from 2025 to 2026, with growth/decline indicators.

### League Health Tab
Tracks player retention by matching 2025 registrants to 2026 data (matched on last name + date of birth). Shows a retention score, new vs. returning player breakdown, and health bars per division.

### All-Stars Eligible Tab
Lists players eligible for All-Stars competition by age division. T-Ball is excluded. Useful for planning tryouts and roster submissions.

### Full Roster Tab
A searchable, sortable table of all registered players. Filterable by year, sport, and division. Includes player name, DOB, city, team, and registration status.

### Manage Data Tab
- **Upload** new season data via CSV (Crossbar export format) or XLSX
- **Export** filtered data to CSV (by year, sport, or all)
- **Manually add or edit** individual players
- **Clear** season data or reset everything

## File Structure

| File | Purpose |
|------|---------|
| `index.html` | Page structure and tab layout |
| `styles.css` | All visual styling |
| `data.js` | Seeded player roster (`INITIAL_DATA`) |
| `app.js` | Dashboard logic, charts, filters, and data management |

## Data Workflow

Raw registration exports go in `raw_data/` (gitignored — never committed). Run the middleware script to scrub PII and regenerate the app data:

```bash
python3 process.py
```

This reads all files in `raw_data/`, scrubs personal information, and outputs:
- **`processed_data.xlsx`** — clean combined spreadsheet (safe to share/commit)
- **`data.js`** — regenerated app data file (what the dashboard reads)

Refresh the browser after running to see updated data.

### Supported input formats
| Format | File type | Source |
|--------|-----------|--------|
| Crossbar export | `.csv` | 2026+ seasons |
| SportsEngine export | `.xlsx` | 2025 season |

### Scrubbed fields
The following are removed and never stored: email addresses, phone numbers, street addresses, zip codes, dates of birth.

Last names are replaced with first initial only (e.g. `Smith` → `S`).

## Running Locally

Requires a local web server (the browser needs to load separate JS/CSS files over HTTP).

```bash
python3 -m http.server 8080
```

Then open **http://localhost:8080** in your browser.

## Data & Privacy

No personal data is committed to this repository. `raw_data/` is gitignored. `data.js` and `processed_data.xlsx` contain only: first name, last initial, sport, division, gender, city, team name, and registration amount.

Data entered or uploaded during a browser session is stored in `sessionStorage` only and does not persist after the tab is closed.
