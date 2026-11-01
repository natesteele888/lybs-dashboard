"""
LYBS Data Middleware
====================
Reads raw registration files from raw_data/, scrubs all personal info,
and outputs:
  - processed_data.xlsx  (clean combined spreadsheet, safe to commit)
  - data.js              (regenerated app data file)

Scrubbed fields: email, phone, address, zip, state, DOB
Anonymized fields: last name → first initial only

Supported input formats:
  - Crossbar CSV  (2026+ exports)
  - SportsEngine XLSX  (2025 export)

Usage:
  python3 process.py
"""

import csv, json, re, glob
from pathlib import Path
from openpyxl import Workbook
import openpyxl

RAW_DIR   = Path('raw_data')
OUT_XLSX  = Path('processed_data.xlsx')
OUT_JS    = Path('data.js')


# ── Division normalization ────────────────────────────────

def normalize_division(price_text, sport=None):
    t = (price_text or '').lower()
    # Softball uses different division labels in the registration form.
    # "Majors"  in a softball export = 12U bracket
    # "Minors"  in a softball export = 10U bracket
    # "Seniors" / "Senior" = Senior (top softball division)
    if sport == 'Softball':
        if '16u'    in t:                        return '16U'
        if 'senior' in t:                        return 'Senior'
        if 'majors' in t or 'major' in t:        return '12U'
        if 'minors' in t or 'minor' in t:        return '10U'
        if 'farm'   in t:                        return 'Farm'
        if '12u'    in t:                        return '12U'
        if '10u'    in t:                        return '10U'
        if '8u'     in t:                        return 'Farm'
        return 'Unknown'
    # Baseball / T-Ball
    if 'majors'  in t: return 'Majors'
    if 'minors'  in t: return 'Minors'
    if 'rookies' in t or 'rookie' in t: return 'Rookies'
    if 'farm'    in t: return 'Farm'
    if 'senior'  in t: return 'Senior'
    if '12u'     in t: return '12U'
    if '10u'     in t: return '10U'
    if 't-ball'  in t or 'tball' in t or 'coed t' in t: return 'T-Ball'
    return 'Unknown'


# ── All-Star bracket from DOB ─────────────────────────────
# A player is "NU" if they are exactly N years old on May 1 of the season year.
# Brackets: 8U–12U. T-Ball never eligible.
# DOB is used here and then discarded — never stored in output.

def allstar_bracket(dob, year):
    from datetime import date
    if not dob:
        return ''
    try:
        if hasattr(dob, 'year'):          # already a date/datetime object
            d = dob.date() if hasattr(dob, 'date') else dob
        else:
            parts = str(dob)[:10].split('-')
            d = date(int(parts[0]), int(parts[1]), int(parts[2]))
    except Exception:
        return ''

    for age in [8, 9, 10, 11, 12]:
        oldest  = date(year - age,     5, 1)   # born May 1 → turns age exactly on May 1
        youngest = date(year - age - 1, 5, 2)  # born May 2 → still age on May 1
        if youngest <= d <= oldest:
            return f'{age}U'
    return ''


# ── Field helpers ─────────────────────────────────────────

def last_initial(name):
    name = (name or '').strip()
    return name[0].upper() if name else ''

def title(s):
    return (s or '').strip().title()

# State abbreviations that sometimes appear appended to city names in registrations
# e.g. "Lunenburg Ma", "Lunenburg, MA" → "Lunenburg"
_STATE_ABBREVS = {
    'Al','Ak','Az','Ar','Ca','Co','Ct','De','Fl','Ga','Hi','Id','Il','In','Ia',
    'Ks','Ky','La','Me','Md','Ma','Mi','Mn','Ms','Mo','Mt','Ne','Nv','Nh','Nj',
    'Nm','Ny','Nc','Nd','Oh','Ok','Or','Pa','Ri','Sc','Sd','Tn','Tx','Ut','Vt',
    'Va','Wa','Wv','Wi','Wy','Dc',
}

def normalize_city(s):
    """Title-case a city name and strip trailing state abbreviations.
    e.g. 'Lunenburg Ma' → 'Lunenburg', 'Lunenburg, MA' → 'Lunenburg'
    """
    s = (s or '').strip().title()
    # Remove trailing ', XX' or ' XX' where XX is a state abbreviation
    parts = s.rstrip(',').rsplit(',', 1)
    if len(parts) == 2:
        suffix = parts[1].strip()
        if suffix in _STATE_ABBREVS:
            return parts[0].strip()
    # Also handle space-separated suffix: "Lunenburg Ma"
    words = s.split()
    if len(words) >= 2 and words[-1].rstrip(',') in _STATE_ABBREVS:
        return ' '.join(words[:-1]).rstrip(',').strip()
    return s

def parse_amount(val):
    try:
        return round(float(str(val).replace('$', '').replace(',', '').strip()), 2)
    except Exception:
        return 0.0

def year_from_filename(name):
    m = re.search(r'(20\d\d)', name)
    return int(m.group(1)) if m else None

def sport_from_filename(name):
    n = name.lower()
    if 'softball' in n:           return 'Softball'
    if 'baseball' in n:           return 'Baseball'
    if 't-ball' in n or 'tball' in n: return 'T-Ball'
    return None


# ── CSV format detection ──────────────────────────────────
#
# Four known CSV formats:
#
# FORMAT CB26 — 2026 Crossbar (current):
#   Row 0 = headers: Last, First, Birthdate, Price, Total, Paid, ..., Team, City
#
# FORMAT CB24 — 2024 Crossbar:
#   Row 0 = program descriptor (e.g. "spring-baseball-...")  ← skip
#   Row 1 = headers: Last, First, Birthdate, Price, ... (same as CB26)
#
# FORMAT SE25 — 2025 SportsEngine:
#   Row 0 = headers: (blank), Price, Player First Name, Player Last Name, ...
#   Row 1+ = data where col 0 = group string like "2025 Baseball"
#
# FORMAT SE22 — 2022–2023 SportsEngine legacy:
#   Row 0 = headers: Program Name, Division Name, Player First Name, ...
#   Row 1+ = data where col 0 = group string like "2022 tball"

def _detect_csv_format(path):
    """Return one of 'CB26', 'CB24', 'SE25', 'SE22', or None."""
    import chardet
    with open(path, 'rb') as fh:
        raw = fh.read()
    enc = chardet.detect(raw).get('encoding') or 'utf-8'
    if enc.lower().replace('-', '') in ('utf8', 'ascii'):
        enc = 'utf-8-sig'

    with open(path, newline='', encoding=enc, errors='replace') as f:
        reader = csv.reader(f)
        rows = [next(reader, None) for _ in range(2)]

    h0 = [str(c or '').strip().lower() for c in (rows[0] or [])]
    h1 = [str(c or '').strip().lower() for c in (rows[1] or [])]

    if 'program name' in h0 or (h0 and h0[0] == 'program'):
        return 'SE22', enc
    if 'player first name' in h0:
        return 'SE25', enc
    if 'first' in h0 and 'last' in h0:
        return 'CB26', enc
    if 'first' in h1 and 'last' in h1:
        return 'CB24', enc
    return None, enc


# ── Parse Crossbar CSV ────────────────────────────────────

def parse_crossbar_csv(path, enc, skip_first_row=False):
    sport = sport_from_filename(path.name)
    year  = year_from_filename(path.name)
    if not sport or not year:
        print(f'  SKIP {path.name} — could not detect sport/year from filename')
        return []

    records = []
    with open(path, newline='', encoding=enc, errors='replace') as f:
        if skip_first_row:
            next(f)   # discard program-descriptor row, real headers on row 2
        for row in csv.DictReader(f):
            first = title(row.get('First', ''))
            last  = last_initial(row.get('Last', ''))
            if not first:
                continue

            division = normalize_division(row.get('Price', ''), sport=sport)
            city     = normalize_city(row.get('City', ''))
            team     = (row.get('Team') or '').strip()
            amount   = parse_amount(row.get('Total') or row.get('Paid') or 0)
            dob_raw  = row.get('Birthdate', '')
            bracket  = allstar_bracket(dob_raw, year) if sport != 'T-Ball' else ''

            # CSVs don't carry a Gender column — leave blank
            records.append({
                'year':             year,
                'first':            first,
                'last':             last,
                'sport':            sport,
                'division':         division,
                'allstar_division': bracket,
                'gender':           '',
                'city':             city,
                'team':             team if team and team.lower() != 'nan' else '',
                'amount':           amount,
            })

    print(f'  {path.name}: {len(records)} players ({sport} {year})')
    return records


# ── Parse SportsEngine 2025 CSV ───────────────────────────
# Headers: (blank), Price, Player First Name, Player Last Name, Player Gender,
#          Player Birth Date, Street Address, Unit, City, State, ..., Team Name,
#          ..., OrderItem Amount, ...
# Col 0 in data rows = group string like "2025 Baseball"

def parse_se25_csv(path, enc):
    sport = sport_from_filename(path.name)
    year  = year_from_filename(path.name)
    if not sport or not year:
        print(f'  SKIP {path.name} — could not detect sport/year from filename')
        return []

    records = []
    with open(path, newline='', encoding=enc, errors='replace') as f:
        for row in csv.DictReader(f):
            first = title(row.get('Player First Name', ''))
            last  = last_initial(row.get('Player Last Name', ''))
            if not first:
                continue

            division = normalize_division(row.get('Price', ''), sport=sport)
            city     = normalize_city(row.get('City', ''))
            team     = (row.get('Team Name') or '').strip()
            gender   = (row.get('Player Gender') or '').strip()
            dob_raw  = row.get('Player Birth Date', '')
            bracket  = allstar_bracket(dob_raw, year) if sport != 'T-Ball' else ''
            amount   = parse_amount(row.get('OrderItem Amount Paid') or row.get('OrderItem Amount') or 0)

            records.append({
                'year':             year,
                'first':            first,
                'last':             last,
                'sport':            sport,
                'division':         division,
                'allstar_division': bracket,
                'gender':           gender,
                'city':             city,
                'team':             team if team and team.lower() != 'nan' else '',
                'amount':           amount,
            })

    print(f'  {path.name}: {len(records)} players ({sport} {year})')
    return records


# ── Parse SportsEngine 2022–2023 Legacy CSV ───────────────
# Headers: Program Name, Division Name, Player First Name, Player Last Name,
#          Player Birth Date, City, Team Name, Registration Date, Registration Cost
# Col 0 in data rows = group string like "2022 tball"

def parse_se22_csv(path, enc):
    sport = sport_from_filename(path.name)
    year  = year_from_filename(path.name)
    if not sport or not year:
        print(f'  SKIP {path.name} — could not detect sport/year from filename')
        return []

    records = []
    with open(path, newline='', encoding=enc, errors='replace') as f:
        for row in csv.DictReader(f):
            first = title(row.get('Player First Name', ''))
            last  = last_initial(row.get('Player Last Name', ''))
            if not first:
                continue

            division = normalize_division(row.get('Division Name', ''), sport=sport)
            city     = normalize_city(row.get('City', ''))
            team     = (row.get('Team Name') or '').strip()
            dob_raw  = row.get('Player Birth Date', '')
            bracket  = allstar_bracket(dob_raw, year) if sport != 'T-Ball' else ''
            amount   = parse_amount(row.get('Registration Cost') or row.get('Registration Fee') or 0)

            records.append({
                'year':             year,
                'first':            first,
                'last':             last,
                'sport':            sport,
                'division':         division,
                'allstar_division': bracket,
                'gender':           '',
                'city':             city,
                'team':             team if team and team.lower() != 'nan' else '',
                'amount':           amount,
            })

    print(f'  {path.name}: {len(records)} players ({sport} {year})')
    return records


# ── Parse SportsEngine XLSX ───────────────────────────────
#
# Two known export formats (auto-detected from header row):
#
# FORMAT A — 2025+ (newer SportsEngine):
#   0  group          "2025 Baseball"
#   1  price label    "Majors Registration"   ← division extracted via normalize_division
#   2  first name
#   3  last name
#   4  gender
#   5  dob
#   6  street
#   7  unit
#   8  city
#   9  state
#  10  zip
#  11  email
#  12  cell
#  13  other phone
#  14  team name
#  18  amount paid
#
# FORMAT B — 2022–2024 (older SportsEngine):
#   0  group          "2022 Softball"
#   1  division name  "Farm" / "10U" / "12U" / "Senior"   ← used directly
#   2  first name
#   3  last name
#   4  gender
#   5  dob
#   6  street
#   7  unit
#   8  Registration Cost   ← amount is HERE in older exports
#   9  city (sometimes)
#  14  team name
#
# Detection: if header row col 8 contains "registration cost" → Format B
#            otherwise → Format A

def _detect_se_format(header_row):
    """Returns 'B' if older format (Registration Cost at col 8), else 'A'."""
    if not header_row:
        return 'A'
    h8 = str(header_row[8] or '').strip().lower() if len(header_row) > 8 else ''
    if 'registration' in h8 or 'cost' in h8 or 'fee' in h8:
        return 'B'
    return 'A'

def parse_se_xlsx(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    records = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        fmt = _detect_se_format(rows[0])
        print(f'    Sheet "{sheet_name}": Format {fmt}')

        for row in rows[1:]:           # skip header row
            if len(row) < 5:
                continue
            group = str(row[0] or '').strip()
            if not group:
                continue

            # Parse year and sport from group cell, e.g. "2025 Baseball"
            parts = group.split()
            try:
                year = int(parts[0])
            except (IndexError, ValueError):
                continue
            sport_raw = parts[1].lower() if len(parts) > 1 else ''
            if   'baseball' in sport_raw: sport = 'Baseball'
            elif 'softball' in sport_raw: sport = 'Softball'
            elif 'tball'    in sport_raw or 't-ball' in sport_raw: sport = 'T-Ball'
            else: sport = 'Unknown'

            first = title(str(row[2] or ''))
            last  = last_initial(str(row[3] or ''))
            if not first:
                continue

            gender  = str(row[4] or '').strip()
            dob_raw = row[5] if len(row) > 5 else None

            if fmt == 'B':
                # Older format: col 1 = division name directly, col 8 = Registration Cost
                division = normalize_division(str(row[1] or ''), sport=sport)
                # In Format B the city may be at a different column; try common positions
                city_raw = ''
                for ci in [9, 8, 10]:
                    val = str(row[ci] or '').strip() if len(row) > ci else ''
                    # City looks like a town name not a number
                    if val and not val.replace('.','').replace(',','').isnumeric():
                        city_raw = val
                        break
                city   = normalize_city(city_raw)
                team   = str(row[14] or '').strip() if len(row) > 14 else ''
                # Amount: col 8 = Registration Cost in older format
                amount = parse_amount(row[8] if len(row) > 8 else 0)
            else:
                # Newer format (2025+): col 1 = price label, col 8 = city, col 18 = amount
                division = normalize_division(str(row[1] or ''), sport=sport)
                city     = normalize_city(str(row[8] or ''))
                team     = str(row[14] or '').strip() if len(row) > 14 else ''
                amount   = parse_amount(row[18] if len(row) > 18 else 0)

            bracket = allstar_bracket(dob_raw, year) if sport != 'T-Ball' else ''

            records.append({
                'year':             year,
                'first':            first,
                'last':             last,
                'sport':            sport,
                'division':         division,
                'allstar_division': bracket,
                'gender':           gender,
                'city':             city,
                'team':             team if team and team.lower() != 'nan' else '',
                'amount':           amount,
            })

    print(f'  {path.name}: {len(records)} players')
    wb.close()
    return records


# ── Main ──────────────────────────────────────────────────

def main():
    if not RAW_DIR.exists():
        print(f'ERROR: {RAW_DIR}/ not found. Create the folder and add raw data files.')
        return

    all_players = []

    print('Reading raw_data/ ...')

    for path in sorted(RAW_DIR.glob('*.csv')):
        if path.name.startswith('._'):
            continue
        fmt, enc = _detect_csv_format(path)
        if fmt == 'CB26':
            all_players.extend(parse_crossbar_csv(path, enc, skip_first_row=False))
        elif fmt == 'CB24':
            all_players.extend(parse_crossbar_csv(path, enc, skip_first_row=True))
        elif fmt == 'SE25':
            all_players.extend(parse_se25_csv(path, enc))
        elif fmt == 'SE22':
            all_players.extend(parse_se22_csv(path, enc))
        else:
            print(f'  SKIP {path.name} — unrecognised CSV format')

    for path in sorted(RAW_DIR.glob('*.xlsx')):
        all_players.extend(parse_se_xlsx(path))

    if not all_players:
        print('No players found. Check that raw_data/ contains CSV or XLSX files.')
        return

    print(f'\nTotal players processed: {len(all_players)}')

    # ── Write processed_data.xlsx ─────────────────────────
    COLS = ['year', 'first', 'last', 'sport', 'division', 'allstar_division', 'gender', 'city', 'team', 'amount']
    COL_LABELS = ['Year', 'First', 'Last Initial', 'Sport', 'Division', 'All-Star Division', 'Gender', 'City', 'Team', 'Amount']

    wb_out = Workbook()

    # All players sheet
    ws_all = wb_out.active
    ws_all.title = 'All Players'
    ws_all.append(COL_LABELS)
    for p in all_players:
        ws_all.append([p[c] for c in COLS])

    # Per-year sheets
    years = sorted({p['year'] for p in all_players})
    for yr in years:
        ws = wb_out.create_sheet(str(yr))
        ws.append(COL_LABELS)
        for p in all_players:
            if p['year'] == yr:
                ws.append([p[c] for c in COLS])

    wb_out.save(OUT_XLSX)
    print(f'Written: {OUT_XLSX}')

    # ── Write data.js ─────────────────────────────────────
    js_data = json.dumps(all_players, separators=(',', ':'))
    OUT_JS.write_text(f'const INITIAL_DATA = {js_data};\n', encoding='utf-8')
    print(f'Written: {OUT_JS}')
    print('\nDone. Refresh your browser to see the updated dashboard.')


if __name__ == '__main__':
    main()
