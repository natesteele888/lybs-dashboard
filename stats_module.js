// ═══════════════════════════════════════════════════════════
// LYBS STATS MODULE
// Reads from GC_STATS (gc_stats.js) — loaded before this file
// ═══════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────

// Match a draft player object to GC stats entries.
// GC key = "firstname|LastInitial" — same as draftPlayerKey without sport/year.
// Returns ALL matching records across years (for career history views).
// Use gcLookupYear(playerObj) when you only want a specific season's record.
// ── Player alias map ─────────────────────────────────────────────────────────
// Maps canonical lookup key → additional historical keys to also include.
// Used when a player registered under a different name in prior years.
// Ships empty in this public copy: the real entries are player names and live
// only in the private lybs-reporting repo. Shape: { 'first|L': ['other|L'] }
const GC_PLAYER_ALIASES = {};

function gcLookup(playerObj) {
  if (typeof GC_STATS === 'undefined') return [];
  const first = (playerObj.first || '').toLowerCase();
  const last  = (playerObj.last  || '')[0]?.toUpperCase() || '';
  const key   = `${first}|${last}`;

  // Collect all keys to search: canonical + any aliases
  const keysToSearch = [key, ...(GC_PLAYER_ALIASES[key] || [])];
  const matches = GC_STATS.filter(s => keysToSearch.includes(s.key));

  // Deduplicate: if multiple records share the same key+year, keep the one with the most games played
  const seen = new Map();
  for (const s of matches) {
    const k = `${s.key}|${s.year ?? ''}`;
    const gp = (s.batting?.gp || 0) + (s.pitching?.gp || 0);
    if (!seen.has(k) || gp > seen.get(k).gp) {
      seen.set(k, { rec: s, gp });
    }
  }
  return [...seen.values()].map(v => v.rec);
}

// Year-scoped lookup: returns records that match the player's registration year.
// Falls back to all-years records if no exact year match (e.g. stats not yet year-tagged).
function gcLookupYear(playerObj) {
  if (typeof GC_STATS === 'undefined') return [];
  const all = gcLookup(playerObj);
  if (!all.length) return [];
  const yr = playerObj.year;
  if (!yr) return all;
  const yearMatched = all.filter(s => s.year === yr);
  return yearMatched.length ? yearMatched : all;
}


// ── Infer positions from GC fielding + pitching history ─────────────────
// Returns array of position strings, deduplicated across all years.
// Inference rules (youth baseball):
//   C  : tc >= 30 AND a <= 3  (high putouts = every K is a C putout)
//   C/1B: tc >= 12 AND a == 0  (moderate putouts, no assists)
//   OF : tc >= 5 AND a == 0 AND po > 0 (fly-ball putouts, no assists)
//   IF : a > 0 AND a/tc > 0.10 (assists = infield play)
//   SP : ip_dec >= 8 AND gs >= 2 (starting pitcher)
//   P  : ip_dec >= 3             (pitcher, relief or start)
function gcInferPositions(playerObj) {
  const records = gcLookup(playerObj);
  if (!records.length) return [];

  const posSet = new Set();

  records.forEach(r => {
    const f  = r.fielding;
    const pi = r.pitching;
    const tc = f.tc || 0, a = f.a || 0, po = f.po || 0;
    const ip = pi.ip_dec || 0, gs = pi.gs || 0;

    // Pitching
    if (ip >= 8 && gs >= 2) posSet.add('SP');
    else if (ip >= 3)        posSet.add('P');

    // Fielding
    if      (tc >= 30 && a <= 3)                 posSet.add('C');
    else if (tc >= 12 && a === 0)                posSet.add('C/1B');
    else if (tc >= 5 && a === 0 && po > 0)       posSet.add('OF');
    else if (a > 0 && a / Math.max(tc, 1) > 0.1) posSet.add('IF');
  });

  // Consolidate: if both SP and P exist, keep only SP
  if (posSet.has('SP')) posSet.delete('P');
  // Preferred order
  const order = ['C','C/1B','SP','P','IF','OF'];
  return order.filter(p => posSet.has(p));
}

// Return a compact HTML string of position badges for a player
function gcPositionBadges(playerObj, small = false) {
  const pos = gcInferPositions(playerObj);
  if (!pos.length) return '';
  const sz = small ? '9px' : '10px';
  const pad = small ? '1px 5px' : '2px 7px';
  const posColors = {
    C:'#f59e0b', 'C/1B':'#f59e0b', SP:'#10b981', P:'#34d399',
    IF:'#60a5fa', OF:'#a78bfa'
  };
  return pos.map(p =>
    `<span title="Position inferred from GameChanger stats"
      style="font-size:${sz};padding:${pad};border-radius:4px;font-weight:700;
             background:${posColors[p]||'var(--border)'}22;
             color:${posColors[p]||'var(--text2)'};
             border:1px solid ${posColors[p]||'var(--border)'}44;">${p}</span>`
  ).join('');
}


// Parse IP string "16.2" → decimal innings (16 + 2/3)
function ipToDecimal(ipStr) {
  const s = String(ipStr || '0').trim();
  if (!s || s === '-') return 0;
  const [full, outs='0'] = s.split('.');
  return parseInt(full) + parseInt(outs) / 3;
}

// Format decimal innings back to display "16.2"
function fmtIP(ipStr) {
  return ipStr && ipStr !== '0' && ipStr !== '0.0' ? ipStr : '—';
}

function fmtStat(v, fallback = '—') {
  if (v === null || v === undefined || v === '' || v === '-') return fallback;
  return v;
}

// ── Compute team leaders & badges for a set of GC records ──
function computeTeamBadges(gcRecords) {
  const active = gcRecords.filter(p => p.batting.ab > 0 || p.pitching.ip_dec > 0);
  if (!active.length) return {};

  const badges = {}; // key → [badge strings]

  const addBadge = (key, b) => {
    if (!badges[key]) badges[key] = [];
    badges[key].push(b);
  };

  const maxBy = (field, path='batting', minVal=1) => {
    const best = active.reduce((a,b) => {
      const av = path==='batting' ? a.batting[field] : a.pitching[field];
      const bv = path==='batting' ? b.batting[field] : b.pitching[field];
      return bv > av ? b : a;
    });
    const val = path==='batting' ? best.batting[field] : best.pitching[field];
    if (val >= minVal) addBadge(best.key, field.toUpperCase());
  };

  // Batting leaders
  maxBy('avg',  'batting', 0.001);  // needs special string handling
  maxBy('rbi',  'batting', 1);
  maxBy('h',    'batting', 1);
  maxBy('hr',   'batting', 1);
  maxBy('r',    'batting', 1);
  maxBy('sb',   'batting', 1);
  maxBy('bb',   'batting', 1);
  maxBy('xbh',  'batting', 1);
  maxBy('tb',   'batting', 1);

  // Handle AVG separately (string)
  const withAVG = active.filter(p => p.batting.avg && p.batting.avg !== '-' && p.batting.ab >= 5);
  if (withAVG.length) {
    const best = withAVG.reduce((a,b) => parseFloat(b.batting.avg) > parseFloat(a.batting.avg) ? b : a);
    if (!badges[best.key]) badges[best.key] = [];
    if (!badges[best.key].includes('AVG')) badges[best.key].push('AVG');
  }

  // Pitching leaders (only among those who actually pitched)
  const pitchers = active.filter(p => p.pitching.ip_dec >= 2);
  if (pitchers.length) {
    const bestIP  = pitchers.reduce((a,b) => b.pitching.ip_dec > a.pitching.ip_dec ? b : a);
    addBadge(bestIP.key, 'IP');
    const bestSO  = pitchers.reduce((a,b) => b.pitching.so > a.pitching.so ? b : a);
    if (bestSO.pitching.so > 0) addBadge(bestSO.key, 'K');
    const bestERA = pitchers.filter(p=>p.pitching.era&&p.pitching.era!=='-').reduce((a,b)=>parseFloat(b.pitching.era)<parseFloat(a.pitching.era)?b:a, pitchers[0]);
    if (bestERA) addBadge(bestERA.key, 'ERA');
  }

  // Ninja badge: top 5 base stealers on the team
  const sbRanked = [...active].sort((a,b) => b.batting.sb - a.batting.sb);
  const sbTop5   = sbRanked.slice(0, 5).filter(p => p.batting.sb > 0);
  sbTop5.forEach(p => addBadge(p.key, 'NINJA'));

  // Auto-pitching experience flag
  active.filter(p => p.pitching.ip_dec > 2).forEach(p => addBadge(p.key, 'PITCHER'));

  return badges;
}

// ── Cache: compute once per draft session ──
let _gcBadgeCache = null;

function gcGetBadges(playerKey) {
  if (!_gcBadgeCache) {
    // Build badge map from all available GC stats grouped by team+year
    const allBadges = {};
    const groups = {};
    (typeof GC_STATS !== 'undefined' ? GC_STATS : []).forEach(p => {
      const gk = `${p.team}|${p.year}`;
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(p);
    });
    Object.values(groups).forEach(group => {
      const b = computeTeamBadges(group);
      Object.entries(b).forEach(([k, badges]) => {
        if (!allBadges[k]) allBadges[k] = new Set();
        badges.forEach(badge => allBadges[k].add(badge));
      });
    });
    // Convert sets to arrays
    _gcBadgeCache = {};
    Object.entries(allBadges).forEach(([k,s]) => _gcBadgeCache[k] = [...s]);
  }

  // Match to player key (first|LastInitial portion of draftPlayerKey)
  const shortKey = playerKey.split('|').slice(0,2).join('|');
  return _gcBadgeCache[shortKey] || [];
}

function gcClearCache() { _gcBadgeCache = null; }


// ── Player Rating (1-5 stars based on available GC stats) ─────────────────
// Composite of AVG, OBP, SB rate, pitching, and tenure. Returns 0-5.
function gcPlayerRating(playerObj) {
  const records = gcLookup(playerObj);
  if (!records.length) return null;

  // Use most recent record
  const rec = records.sort((a,b) => b.year - a.year)[0];
  const b = rec.batting;
  const p = rec.pitching;

  let score = 0;
  let weight = 0;

  // Batting — only count if meaningful AB
  if (b.ab >= 4) {
    const avg = parseFloat(b.avg) || 0;
    const obp = parseFloat(b.obp) || 0;
    const ops = parseFloat(b.ops) || 0;
    // AVG: >.600=5, >.450=4, >.300=3, >.150=2, else 1
    score  += avg > .600 ? 5 : avg > .450 ? 4 : avg > .300 ? 3 : avg > .150 ? 2 : 1;
    score  += obp > .700 ? 5 : obp > .550 ? 4 : obp > .400 ? 3 : obp > .250 ? 2 : 1;
    score  += ops > 1.2  ? 5 : ops > .900 ? 4 : ops > .650 ? 3 : ops > .400 ? 2 : 1;
    weight += 3;
    // SB bonus
    if (b.sb >= 20) { score += 1; weight += 0.5; }
  }

  // Pitching — only if meaningful IP
  if (p.ip_dec >= 2) {
    const era = parseFloat(p.era) || 99;
    const kRate = p.ip_dec > 0 ? p.so / p.ip_dec : 0;
    score  += era < 3.0 ? 5 : era < 5.0 ? 4 : era < 7.0 ? 3 : era < 9.0 ? 2 : 1;
    score  += kRate > 3 ? 5 : kRate > 2 ? 4 : kRate > 1.5 ? 3 : kRate > 1 ? 2 : 1;
    weight += 2;
  }

  if (weight === 0) return null;
  const raw = score / weight;  // 1-5
  return Math.round(Math.min(5, Math.max(1, raw)));
}

function gcRatingStars(rating) {
  if (!rating) return '';
  const filled = '★'.repeat(rating);
  const empty  = '☆'.repeat(5 - rating);
  const color  = rating >= 4 ? '#f5a623' : rating === 3 ? '#10b981' : '#60a5fa';
  return `<div style="font-size:12px;color:${color};letter-spacing:1px;line-height:1;" title="${rating}/5 rating">${filled}<span style="color:rgba(255,255,255,0.2);">${empty}</span></div>`;
}

// ── League Leader detection (across all GC_STATS for same year+sport) ──────
function gcLeagueLeaders() {
  if (typeof GC_STATS === 'undefined' || !GC_STATS.length) return {};
  if (gcLeagueLeaders._cache) return gcLeagueLeaders._cache;

  // Group by year+team so each team/season has its own leaders.
  // This means a Minors pitcher in 2025 and a Braves pitcher in 2024 can
  // both be K Leader in their respective groups independently.
  const groups = {};
  GC_STATS.forEach(p => {
    const gk = `${p.year}|${p.team||p.sport}`;
    if (!groups[gk]) groups[gk] = [];
    groups[gk].push(p);
  });

  const leaders = {}; // key → Set of badge strings
  const addL = (key, badge) => {
    if (!leaders[key]) leaders[key] = new Set();
    leaders[key].add(badge);
  };

  Object.values(groups).forEach(group => {
    const active = group.filter(p => (p.batting?.ab||0) >= 4 || (p.pitching?.ip_dec||0) >= 1);
    if (!active.length) return;

    const maxBy = (arr, fn, minVal, badge) => {
      const best = arr.reduce((a,b) => fn(b) > fn(a) ? b : a);
      if (fn(best) >= minVal) addL(best.key, badge);
    };
    const maxByStr = (arr, fn, minVal, badge) => {
      const valid = arr.filter(p => fn(p) && fn(p) !== '-');
      if (!valid.length) return;
      const best = valid.reduce((a,b) => parseFloat(fn(b)) > parseFloat(fn(a)) ? b : a);
      if (parseFloat(fn(best)) >= minVal) addL(best.key, badge);
    };
    const minByStr = (arr, fn, maxVal, badge) => {
      const valid = arr.filter(p => fn(p) && fn(p) !== '-' && parseFloat(fn(p)) > 0);
      if (!valid.length) return;
      const best = valid.reduce((a,b) => parseFloat(fn(b)) < parseFloat(fn(a)) ? b : a);
      if (parseFloat(fn(best)) <= maxVal) addL(best.key, badge);
    };

    // Batting leaders (min 4 AB)
    const batters = active.filter(p => (p.batting?.ab||0) >= 4);
    if (batters.length) {
      maxByStr(batters, p=>p.batting?.avg, 0, '📈 AVG Leader');
      maxByStr(batters, p=>p.batting?.obp, 0, 'OBP Leader');
      maxByStr(batters, p=>p.batting?.ops, 0, 'OPS Leader');
      maxBy(batters, p=>p.batting?.rbi||0, 1, '🏆 RBI Leader');
      maxBy(batters, p=>p.batting?.h||0, 1, 'H Leader');
      maxBy(batters, p=>p.batting?.r||0, 1, 'R Leader');
      maxBy(batters, p=>p.batting?.sb||0, 1, '🥷 SB Leader');
      maxBy(batters, p=>p.batting?.hr||0, 1, '💥 HR Leader');
      maxBy(batters, p=>(p.batting?.['2b']||0)+(p.batting?.['3b']||0)+(p.batting?.hr||0), 1, 'XBH Leader');
    }

    // Pitching leaders (min 2 IP)
    const pitchers = active.filter(p => (p.pitching?.ip_dec||0) >= 2);
    if (pitchers.length) {
      maxBy(pitchers, p=>p.pitching?.so||0, 1, '🔥 K Leader');
      maxBy(pitchers, p=>p.pitching?.ip_dec||0, 1, 'IP Leader');
      maxBy(pitchers, p=>p.pitching?.w||0, 1, 'W Leader');
      minByStr(pitchers, p=>p.pitching?.era, 9.99, '🎯 ERA Leader');
    }
  });

  // Convert Sets to arrays
  const result = {};
  Object.entries(leaders).forEach(([k,s]) => result[k] = [...s]);
  gcLeagueLeaders._cache = result;
  return result;
}
gcLeagueLeaders._cache = null;

function gcGetLeaderBadges(playerKey) {
  const shortKey = playerKey.split('|').slice(0,2).join('|');
  return gcLeagueLeaders()[shortKey] || [];
}


// ── Player Grade System ───────────────────────────────────────────────────
// Returns { grade, color, source } where source = 'stats' | 'manual' | null

function gcPlayerGrade(playerObj) {
  const scoreColors = (s) => s>=88?'#10b981':s>=70?'#60a5fa':s>=52?'#f5a623':s>=35?'#f97316':'#ef4444';

  // 1. Eval score (0-100) takes highest priority — set via evalCommit
  if (playerObj._evalScore) {
    const s = playerObj._evalScore;
    const grade = s>=88?'A+':s>=78?'A':s>=68?'B+':s>=58?'B':s>=48?'C+':s>=38?'C':'D';
    return { grade, score: s, color: scoreColors(s), source:'eval' };
  }

  // 2. Manual letter grade
  if (playerObj.grade) {
    const colors = {'A+':'#10b981','A':'#10b981','B+':'#60a5fa','B':'#60a5fa',
                    'C+':'#f5a623','C':'#f5a623','D':'#ef4444'};
    return { grade: playerObj.grade, color: colors[playerObj.grade]||'var(--text2)', source:'manual' };
  }

  // 2. Compute from GC stats if available
  if (typeof GC_STATS === 'undefined') return null;
  const records = gcLookup(playerObj);
  if (!records.length) return null;

  // For grading, score each season and use the best one (not just most recent)
  // This prevents a strong player's grade from dropping because of a tough travel season
  let bestRec = null, bestScore = -1;
  records.forEach(r => {
    const rb = r.batting||{}, rp = r.pitching||{};
    const ab2 = parseInt(rb.ab||0), ip2 = parseFloat(rp.ip_dec||0);
    if (ab2 < 5 && ip2 < 3) return;
    const avgS = ab2>=5 ? Math.max(0, Math.min((parseFloat(rb.avg||'0')-0.150)/0.500,1)) : 0;
    const opsS = ab2>=5 ? Math.max(0, Math.min((parseFloat(rb.ops||'0')-0.400)/1.100,1)) : 0;
    const era2 = parseFloat(rp.era||'9.99'); const kpi2 = ip2>0?(rp.so||0)/ip2:0;
    const pitS = ip2>=3 ? (Math.max(0,Math.min((10-era2)/9,1))*0.5 + Math.min(kpi2/3.5,1)*0.5) : 0;
    const s = (avgS*0.55+opsS*0.35)*0.6 + pitS*0.4;
    if (s > bestScore) { bestScore = s; bestRec = r; }
  });
  if (!bestRec) bestRec = records.sort((a,b)=>b.year-a.year)[0];
  const rec = bestRec;
  const b = rec.batting || {}, pi = rec.pitching || {};
  const ab = parseInt(b.ab||0);

  // No league/level adjustments — stats compared within same level only
  const leagueFactor = 1.0;

  // Composite 0-1 score — AVG + OPS for hitters, K/IP + ERA for pitchers
  let score = 0, weight = 0;

  if (ab >= 5) {
    const avg = parseFloat(b.avg)||0;
    const ops = parseFloat(b.ops)||0;
    // Youth baseball realistic ceilings: AVG .150-.650, OPS .400-1.500
    const avgScore = Math.max(0, Math.min((avg - 0.150) / 0.500, 1));
    const opsScore = Math.max(0, Math.min((ops - 0.400) / 1.100, 1));
    // AB volume factor — rewards consistent playing time
    const abFactor = Math.min(ab / 30, 1.0);
    score  += avgScore * 0.55 + opsScore * 0.35 + abFactor * 0.10;
    weight += 1;
  }

  const ipDec = parseFloat(pi.ip_dec||0);
  if (ipDec >= 3) {
    const era    = parseFloat(pi.era)||9.99;
    const kPerIP = ipDec > 0 ? (pi.so||0) / ipDec : 0;
    const eraScore = Math.max(0, Math.min((10 - era) / 9, 1));
    const kScore   = Math.min(kPerIP / 3.5, 1);
    const ipVol    = Math.min(ipDec / 20, 1);
    score  += (eraScore * 0.40 + kScore * 0.40 + ipVol * 0.20) * 0.70;
    weight += 0.70;
  }

  if (weight === 0) return null;

  // Apply league factor and floor — no stat-based score below 62
  const rawS  = score / weight;
  const adjS  = rawS * leagueFactor;
  const numericScore = Math.max(62, Math.round(adjS * 100));

  let grade, color;
  if      (adjS >= 0.88) { grade='A+'; color='#10b981'; }
  else if (adjS >= 0.76) { grade='A';  color='#10b981'; }
  else if (adjS >= 0.64) { grade='B+'; color='#60a5fa'; }
  else if (adjS >= 0.52) { grade='B';  color='#60a5fa'; }
  else if (adjS >= 0.40) { grade='C+'; color='#f5a623'; }
  else if (adjS >= 0.28) { grade='C';  color='#f5a623'; }
  else                   { grade='D';  color='#ef4444'; }

  return { grade, score: numericScore, color, source:'stats',
           leagueAdjusted: false };
}

function gcGradeHtml(playerObj, size) {
  const g = gcPlayerGrade(playerObj);
  if (!g) return '';
  const sz = size || 13;
  const label = g.source==='eval' ? `${g.score}` : g.grade;
  const title = g.source==='eval' ? `Eval score: ${g.score}/100` :
                g.source==='manual' ? 'Manual grade' : 'Stats-based grade';
  return `<span title="${title}"
    style="font-family:'Bebas Neue';font-size:${sz}px;letter-spacing:.5px;
           padding:1px 6px;border-radius:5px;background:${g.color}22;
           color:${g.color};border:1px solid ${g.color}44;flex-shrink:0;">${label}</span>`;
}

// ── Draft card icon helpers ──────────────────────────────

function gcDraftIcons(playerObj) {
  const records = gcLookup(playerObj);
  if (!records.length) return '';

  const shortKey = `${(playerObj.first||'').toLowerCase()}|${(playerObj.last||'')[0]?.toUpperCase()||''}`;
  const badges = gcGetBadges(
    `${(playerObj.first||'').toLowerCase()}|${(playerObj.last||'')[0]?.toUpperCase()||''}|x|x`
  );

  const icons = [];

  // Pitching exp
  if (badges.includes('PITCHER') || records.some(r => r.pitching.ip_dec > 2)) {
    icons.push(`<span title="Pitching Experience" style="font-size:13px;" class="gc-icon">⚾</span>`);
  }
  // Catching exp
  if (playerObj.catching) {
    icons.push(`<span title="Catching Experience" style="font-size:13px;" class="gc-icon">🎯</span>`);
  }
  // All-Star history
  const asYears = playerObj.allstar_years || [];
  if (asYears.length) {
    icons.push(`<span title="All-Star: ${asYears.join(', ')}" style="font-size:13px;" class="gc-icon">${'⭐'.repeat(Math.min(asYears.length,3))}</span>`);
  }
  // Ninja: top-5 base stealer
  if (badges.includes('NINJA')) {
    const topSB = Math.max(...records.map(r=>r.batting.sb));
    icons.push(`<span title="Top Base Stealer (${topSB} SB)" style="font-size:14px;" class="gc-icon">🥷</span>`);
  }

  // League leader badges — gated by settings (default OFF)
  const _sLB = (typeof settingsGet !== 'undefined') ? settingsGet() : {};
  if (_sLB.showLeaderBadges) {
    const leagueBadges = gcGetLeaderBadges(shortKey);
    leagueBadges.slice(0, 2).forEach(b => {
      icons.push(`<span class="gc-stat-badge" style="font-size:9px;" title="${b}">${b}</span>`);
    });
  }

  if (!icons.length) return '';
  return `<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center;margin-top:4px;">${icons.join('')}</div>`;
}


// ── LEAGUE & BRACKET RANKINGS ─────────────────────────────────────────────
// Ranks a player within:
//   (a) All players in GC_STATS for the same year+sport (league rank)
//   (b) Players matching the same allstar_division bracket (e.g. "9U")
//
// Returns { leagueRanks: {stat: {rank,total}}, bracketRanks: {stat:{rank,total}}, bracket }

function gcComputeRankings(playerObj) {
  if (typeof GC_STATS === 'undefined') return null;
  const records = gcLookup(playerObj);
  if (!records.length) return null;
  const rec = records.sort((a,b) => b.year - a.year)[0];

  // Get the player's allstar_division bracket from the registration data
  // IMPORTANT: match the SAME year as the GC record, not the most recent registration.
  // A player may have been 10U when the GC data was collected (2025) but is now 11U (2026).
  let bracket = null;
  if (typeof players !== 'undefined') {
    // First try: same year as GC record
    let match = players.find(p =>
      p.sport === rec.sport &&
      p.year === rec.year &&
      p.first.toLowerCase() === playerObj.first.toLowerCase() &&
      p.last[0]?.toUpperCase() === playerObj.last[0]?.toUpperCase()
    );
    // Fallback: most recent registration if no same-year match
    if (!match) {
      match = [...players]
        .filter(p => p.sport === rec.sport &&
          p.first.toLowerCase() === playerObj.first.toLowerCase() &&
          p.last[0]?.toUpperCase() === playerObj.last[0]?.toUpperCase())
        .sort((a,b) => b.year - a.year)[0];
    }
    if (match) bracket = match.allstar_division || null;
  }

  // Pool: same year + sport + same team/level name
  // Extract the level keyword from the team name for like-for-like comparison
  function _levelKey(teamName) {
    const t = (teamName || '').toLowerCase();
    if (t.includes('minors black')) return 'minors black';
    if (t.includes('minors blue'))  return 'minors blue';
    if (t.includes('minors'))       return 'minors';
    if (t.includes('majors b'))     return 'majors b';
    if (t.includes('majors'))       return 'majors';
    if (t.includes('select'))       return 'select';
    if (t.includes('rookie'))       return 'rookie';
    if (t.includes('farm'))         return 'farm';
    if (t.includes('leominster'))   return 'leominster';
    if (t.includes('lunenburg'))    return 'lunenburg';
    return t.split(' ').slice(0, 2).join(' '); // fallback: first two words
  }
  const myLevel = _levelKey(rec.team);
  const pool = GC_STATS.filter(p =>
    p.year === rec.year &&
    p.sport === rec.sport &&
    _levelKey(p.team) === myLevel
  );

  // bracketTotal: all players in THIS bracket in the GC record's year only (correct denominator)
  // bracketPool: GC records that match those players (subset with stats)
  let bracketPool = [];
  let bracketTotal = 0;
  if (bracket && typeof players !== 'undefined') {
    const bracketRegistrants = players.filter(p =>
      p.sport === rec.sport &&
      p.year === rec.year &&         // ← same year as GC record
      (p.allstar_division||'') === bracket
    );
    bracketTotal = bracketRegistrants.length;
    const bracketKeys = new Set(
      bracketRegistrants.map(p => `${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`)
    );
    bracketPool = pool.filter(p => bracketKeys.has(p.key));
  }

  // rankIn: rank among players with stats, but report total as full bracket/league size
  function rankIn(statPool, statFn, fullTotal, higherIsBetter = true, minVal = 0) {
    const vals = statPool
      .map(p => ({ key: p.key, val: parseFloat(statFn(p)) || 0 }))
      .filter(x => !isNaN(x.val) && x.val > minVal);
    if (!vals.length) return null;
    vals.sort((a,b) => higherIsBetter ? b.val - a.val : a.val - b.val);
    const rank = vals.findIndex(x => x.key === rec.key) + 1;
    if (!rank) return null;
    // total = full eligible pool (not just those with stats), min = number with stats
    return { rank, total: fullTotal || vals.length, withStats: vals.length, val: parseFloat(statFn(rec))||0 };
  }

  const minAB = 4;
  const minIP = 2;

  const leagueTotal   = pool.length;
  const batting       = pool.filter(p => (p.batting?.ab||0) >= minAB);
  const pitching      = pool.filter(p => (p.pitching?.ip_dec||0) >= minIP);
  const bBracket      = bracketPool.filter(p => (p.batting?.ab||0) >= minAB);
  const pBracket      = bracketPool.filter(p => (p.pitching?.ip_dec||0) >= minIP);

  const leagueRanks = {};
  const bracketRanks = {};

  // Batting stats to rank
  if (rec.batting?.ab >= minAB) {
    leagueRanks.avg = rankIn(batting, p => p.batting?.avg, leagueTotal);
    leagueRanks.obp = rankIn(batting, p => p.batting?.obp, leagueTotal);
    leagueRanks.ops = rankIn(batting, p => p.batting?.ops, leagueTotal);
    leagueRanks.rbi = rankIn(batting, p => p.batting?.rbi, leagueTotal);
    leagueRanks.h   = rankIn(batting, p => p.batting?.h,   leagueTotal);
    leagueRanks.sb  = rankIn(batting, p => p.batting?.sb,  leagueTotal);
    leagueRanks.r   = rankIn(batting, p => p.batting?.r,   leagueTotal);
    leagueRanks.hr  = rankIn(batting, p => p.batting?.hr,  leagueTotal);

    if (bBracket.length >= 1) {
      bracketRanks.avg = rankIn(bBracket, p => p.batting?.avg, bracketTotal);
      bracketRanks.obp = rankIn(bBracket, p => p.batting?.obp, bracketTotal);
      bracketRanks.ops = rankIn(bBracket, p => p.batting?.ops, bracketTotal);
      bracketRanks.rbi = rankIn(bBracket, p => p.batting?.rbi, bracketTotal);
      bracketRanks.h   = rankIn(bBracket, p => p.batting?.h,   bracketTotal);
      bracketRanks.sb  = rankIn(bBracket, p => p.batting?.sb,  bracketTotal);
    }
  }

  // Pitching
  if (rec.pitching?.ip_dec >= minIP) {
    leagueRanks.era  = rankIn(pitching, p => p.pitching?.era,  leagueTotal, false, 0);
    leagueRanks.ip   = rankIn(pitching, p => p.pitching?.ip_dec, leagueTotal);
    leagueRanks.pSO  = rankIn(pitching, p => p.pitching?.so,   leagueTotal);
    leagueRanks.whip = rankIn(pitching, p => p.pitching?.whip, leagueTotal, false, 0);

    if (pBracket.length >= 1) {
      bracketRanks.era  = rankIn(pBracket, p => p.pitching?.era,   bracketTotal, false, 0);
      bracketRanks.ip   = rankIn(pBracket, p => p.pitching?.ip_dec, bracketTotal);
      bracketRanks.pSO  = rankIn(pBracket, p => p.pitching?.so,    bracketTotal);
    }
  }

  return { leagueRanks, bracketRanks, bracket, pool: leagueTotal, bracketTotal,
           rec, bracketPool, recYear: rec.year, recSport: rec.sport };
}

function _rankBadge(r, label, color) {
  if (!r) return '';
  const pct  = Math.round((1 - (r.rank-1)/r.total) * 100);
  const bg   = r.rank === 1 ? 'rgba(245,166,35,0.2)' : r.rank <= 3 ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.07)';
  const col  = r.rank === 1 ? 'var(--gold)' : r.rank <= 3 ? 'var(--green)' : 'var(--text2)';
  const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : '';
  return `<div style="display:flex;align-items:center;justify-content:space-between;
      padding:4px 10px;border-radius:6px;background:${bg};margin-bottom:3px;">
    <span style="font-size:12px;color:var(--text2);min-width:50px;">${label}</span>
    <span style="font-family:'Bebas Neue';font-size:16px;color:${col};">${medal} #${r.rank}</span>
    <span style="font-size:11px;color:var(--text2);">of ${r.total}</span>
    <div style="width:60px;background:rgba(255,255,255,0.08);border-radius:3px;height:4px;margin:0 6px;">
      <div style="width:${pct}%;background:${col};height:100%;border-radius:3px;"></div>
    </div>
    <span style="font-size:10px;color:${col};min-width:34px;text-align:right;">Top ${100-pct+1}%</span>
  </div>`;
}

// Composite score: average percentile across key batting stats
function _compositeHittingPct(rec, pool) {
  const batters = pool.filter(p => (p.batting?.ab||0) >= 4);
  if (batters.length < 2) return null;
  const stats = ['avg','obp','ops','rbi','sb','h'];
  let total = 0, count = 0;
  stats.forEach(s => {
    const vals = batters.map(p => parseFloat(p.batting?.[s])||0).sort((a,b)=>b-a);
    const myVal = parseFloat(rec.batting?.[s])||0;
    const rank = vals.findIndex(v => v <= myVal);
    if (rank >= 0) { total += (1 - rank/vals.length)*100; count++; }
  });
  return count ? Math.round(total/count) : null;
}

function _compositePitchingPct(rec, pool) {
  const pitchers = pool.filter(p => (p.pitching?.ip_dec||0) >= 2);
  if (pitchers.length < 2) return null;
  // ERA/WHIP: lower is better
  const eraVals = pitchers.map(p=>parseFloat(p.pitching?.era)||99).sort((a,b)=>a-b);
  const whipVals = pitchers.map(p=>parseFloat(p.pitching?.whip)||99).sort((a,b)=>a-b);
  const soVals  = pitchers.map(p=>p.pitching?.so||0).sort((a,b)=>b-a);
  const myEra  = parseFloat(rec.pitching?.era)||99;
  const myWhip = parseFloat(rec.pitching?.whip)||99;
  const mySO   = rec.pitching?.so||0;
  const eraRank  = eraVals.findIndex(v => v >= myEra);
  const whipRank = whipVals.findIndex(v => v >= myWhip);
  const soRank   = soVals.findIndex(v => v <= mySO);
  let total = 0, count = 0;
  if (eraRank >= 0)  { total += (1 - eraRank/pitchers.length)*100;  count++; }
  if (whipRank >= 0) { total += (1 - whipRank/pitchers.length)*100; count++; }
  if (soRank >= 0)   { total += (1 - soRank/pitchers.length)*100;   count++; }
  return count ? Math.round(total/count) : null;
}

function _overallRankInPool(rec, pool, type, fullTotal) {
  // Rank each player by composite score, return {rank, total, pct}
  const scoreFn = type === 'hitting' ? _compositeHittingPct : _compositePitchingPct;
  const eligible = type === 'hitting'
    ? pool.filter(p => (p.batting?.ab||0) >= 4)
    : pool.filter(p => (p.pitching?.ip_dec||0) >= 2);
  if (!eligible.length) return null;
  const scored = eligible
    .map(p => ({ key: p.key, score: scoreFn(p, pool) }))
    .filter(x => x.score !== null)
    .sort((a,b) => b.score - a.score);
  const idx = scored.findIndex(x => x.key === rec.key);
  if (idx < 0) return null;
  // Use fullTotal (all registrants in bracket/league) as denominator when available
  return { rank: idx+1, total: fullTotal || scored.length, withStats: scored.length, pct: scored[idx].score };
}

function _overallBadge(r, label, bracket) {
  if (!r) return '';
  const medal = r.rank===1?'🥇':r.rank===2?'🥈':r.rank===3?'🥉':'';
  const col   = r.rank<=1?'var(--gold)':r.rank<=3?'var(--green)':r.rank<=Math.ceil(r.total/2)?'var(--text)':'var(--text2)';
  const bg    = r.rank<=1?'rgba(245,166,35,0.15)':r.rank<=3?'rgba(16,185,129,0.12)':'rgba(255,255,255,0.05)';
  const barW  = Math.round((1-(r.rank-1)/r.total)*100);
  const totalLabel = r.withStats && r.withStats < r.total
    ? `of ${r.total} <span style="color:var(--text2);font-size:9px;">(${r.withStats} w/ stats)</span>`
    : `of ${r.total}`;
  return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:${bg};margin-bottom:6px;">
    <div style="flex:1;">
      <div style="font-size:11px;color:var(--text2);margin-bottom:2px;">${bracket ? bracket+' · ' : ''}${label}</div>
      <div style="background:rgba(255,255,255,0.08);border-radius:3px;height:5px;width:100%;">
        <div style="width:${barW}%;background:${col};height:100%;border-radius:3px;"></div>
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <span style="font-family:'Bebas Neue';font-size:20px;color:${col};">${medal}#${r.rank}</span>
      <div style="font-size:10px;color:var(--text2);">${totalLabel}</div>
    </div>
  </div>`;
}

// Expandable detail rows (hidden by default)
function _detailRankRow(r, label) {
  if (!r) return '';
  const medal = r.rank===1?'🥇':r.rank===2?'🥈':r.rank===3?'🥉':'';
  const col   = r.rank<=1?'var(--gold)':r.rank<=3?'var(--green)':'var(--text2)';
  return `<div style="display:flex;align-items:center;justify-content:space-between;
      padding:3px 10px;font-size:11px;border-bottom:1px solid rgba(255,255,255,0.04);">
    <span style="color:var(--text2);min-width:50px;">${label}</span>
    <span style="color:${col};font-weight:700;">${medal}#${r.rank} <span style="color:var(--text2);font-weight:400;">of ${r.total}</span></span>
  </div>`;
}

let _rankDetailOpen = {};
function toggleRankDetail(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  const btn = document.getElementById(id+'_btn');
  if (btn) btn.textContent = open ? '▾ Show breakdown' : '▴ Hide breakdown';
}

function gcRankingsHtml(rankings) {
  if (!rankings) return '';
  const { leagueRanks: lr, bracketRanks: br, bracket, pool, rec } = rankings;

  // Same-level filter helper
  function _rlvl(t) {
    const s = (t||'').toLowerCase();
    if (s.includes('minors black')) return 'minors black';
    if (s.includes('minors blue'))  return 'minors blue';
    if (s.includes('minors'))       return 'minors';
    if (s.includes('majors b'))     return 'majors b';
    if (s.includes('majors'))       return 'majors';
    if (s.includes('select'))       return 'select';
    if (s.includes('rookie'))       return 'rookie';
    if (s.includes('leominster'))   return 'leominster';
    if (s.includes('lunenburg'))    return 'lunenburg';
    return s.split(' ').slice(0,2).join(' ');
  }
  const myLvl = _rlvl(rec?.team);
  const leaguePool = typeof GC_STATS!=='undefined'
    ? GC_STATS.filter(p => p.year===rankings.recYear && p.sport===rankings.recSport && _rlvl(p.team)===myLvl) : [];
  const bracketPool = rankings.bracketPool || [];

  // Overall ranks
  const leagueHit  = _overallRankInPool(rankings.rec, leaguePool, 'hitting',  rankings.pool);
  const leaguePit  = _overallRankInPool(rankings.rec, leaguePool, 'pitching', rankings.pool);
  const bracketHit = bracketPool.length>=1 ? _overallRankInPool(rankings.rec, bracketPool, 'hitting',  rankings.bracketTotal) : null;
  const bracketPit = bracketPool.length>=1 ? _overallRankInPool(rankings.rec, bracketPool, 'pitching', rankings.bracketTotal) : null;

  const hasLeague  = leagueHit || leaguePit;
  const hasBracket = bracketHit || bracketPit;
  if (!hasLeague && !hasBracket) return '';

  // Unique detail ID
  const uid = Math.random().toString(36).slice(2,7);

  const statLabels = {avg:'AVG',obp:'OBP',ops:'OPS',rbi:'RBI',h:'H',sb:'SB',r:'R',hr:'HR',era:'ERA',ip:'IP',pSO:'SO (P)',whip:'WHIP'};
  const leagueDetails = Object.entries(lr).filter(([,v])=>v?.rank).sort(([,a],[,b])=>a.rank-b.rank)
    .map(([k,v])=>_detailRankRow(v, statLabels[k]||k)).join('');
  const bracketDetails = br ? Object.entries(br).filter(([,v])=>v?.rank).sort(([,a],[,b])=>a.rank-b.rank)
    .map(([k,v])=>_detailRankRow(v, statLabels[k]||k)).join('') : '';

  let html = `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">`;

  if (hasLeague) {
    const lvlLabel = rec?.team ? rec.team.replace(/\s*'?\d{2}$/, '').trim() : 'Level';
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
        color:var(--text2);margin-bottom:8px;">📊 ${lvlLabel} Rankings <span style="font-weight:400;">(${leaguePool.length} players)</span></div>`;
    html += _overallBadge(leagueHit, 'Overall Hitting', '');
    html += _overallBadge(leaguePit, 'Overall Pitching', '');
    if (leagueDetails) {
      html += `<button id="${uid}l_btn" onclick="toggleRankDetail('${uid}l')"
        style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:11px;padding:2px 0;margin-bottom:4px;">
        ▾ Show breakdown</button>
      <div id="${uid}l" style="display:none;border-radius:6px;overflow:hidden;border:1px solid var(--border);margin-bottom:8px;">
        ${leagueDetails}
      </div>`;
    }
  }

  if (hasBracket && bracket) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
        color:var(--text2);margin:8px 0;">🎖️ ${bracket} Bracket</div>`;
    html += _overallBadge(bracketHit, 'Overall Hitting', bracket);
    html += _overallBadge(bracketPit, 'Overall Pitching', bracket);
    if (bracketDetails) {
      html += `<button id="${uid}b_btn" onclick="toggleRankDetail('${uid}b')"
        style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:11px;padding:2px 0;margin-bottom:4px;">
        ▾ Show breakdown</button>
      <div id="${uid}b" style="display:none;border-radius:6px;overflow:hidden;border:1px solid var(--border);">
        ${bracketDetails}
      </div>`;
    }
  }

  html += '</div>';
  return html;
}

// ── Stats Modal ──────────────────────────────────────────

function showPlayerStats(playerFirst, playerLast, opts) {
  if (typeof canShowStats === 'function' && !canShowStats()) return;
  const _fromDraft = opts && opts.fromDraft;
  const _inline    = opts && opts.inline; // renders into journey tab instead of popup
  const _cmpTarget = opts && opts._compareTarget; // for compare mode sub-render

  // Track current player for compare feature (non-inline modal only)
  if (!_inline && !_cmpTarget) {
    // Resolve this player's division from the players array for compare filtering
    const _pDiv = (() => {
      if (typeof players === 'undefined') return null;
      const match = players.slice().reverse().find(p =>
        p.first?.toLowerCase() === playerFirst?.toLowerCase() &&
        p.last?.[0]?.toUpperCase() === playerLast?.[0]?.toUpperCase()
      );
      return match?.division || null;
    })();
    _statsMainPlayer = { first: playerFirst, last: playerLast, division: _pDiv };
    // Reset compare state when opening a new player
    if (_statsComparePlayer && !_statsCompareActive) _statsComparePlayer = null;
  }
  if (typeof GC_STATS === 'undefined' || !GC_STATS.length) {
    if (!_inline) toast('No stats data loaded', 'error'); return;
  }
  const records = gcLookup({ first: playerFirst, last: playerLast });
  if (!records.length) {
    if (_inline) {
      const el = document.getElementById('journeyStatsContent');
      if (el) el.innerHTML = `<div style="text-align:center;padding:32px 0;color:var(--text2);font-size:13px;">
        No stats found for ${playerFirst} ${playerLast}.<br>
        <span style="font-size:11px;">Use <strong style="color:#60a5fa;">✏️ Add Stats</strong> to enter manually.</span>
      </div>`;
    } else {
      toast(`No stats found for ${playerFirst} ${playerLast}`, 'error');
    }
    return;
  }

  // Choose target elements based on inline vs popup mode
  const titleEl   = _inline ? null : (_cmpTarget ? null : document.getElementById('statsModalTitle'));
  const contentEl = _inline ? document.getElementById('journeyStatsContent')
                  : _cmpTarget ? document.getElementById(_cmpTarget)
                  : document.getElementById('statsModalContent');
  const badgesContainer = _inline ? document.getElementById('journeyStatsLeaderBadges')
                                  : (_cmpTarget ? null : document.getElementById('statsModalTitle')?.parentElement);

  // ── Leader badges ─────────────────────────────────────────────────────
  const _key = `${playerFirst.toLowerCase()}|${(playerLast[0]||'').toUpperCase()}`;
  const _leaders = gcGetLeaderBadges(_key);
  if (!_inline && titleEl) {
    titleEl.innerHTML = `📊 ${playerFirst} ${playerLast}`;
    const _eb = document.getElementById('statsLeaderBadges');
    if (_eb) _eb.remove();
    if (_leaders.length) {
      titleEl.insertAdjacentHTML('afterend',
        `<div id="statsLeaderBadges" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">${_leaders.map(b=>`<span class="gc-stat-badge">${b}</span>`).join('')}</div>`);
    }
  } else if (_inline && badgesContainer) {
    badgesContainer.innerHTML = _leaders.length
      ? _leaders.map(b=>`<span class="gc-stat-badge">${b}</span>`).join('')
      : '';
  }

  // ── Footer coaching buttons — cleared ────────────────────────────────
  const _footerBtns = document.getElementById('statsModalFooterBtns');
  if (_footerBtns) _footerBtns.innerHTML = '';

  // ── Data prep ─────────────────────────────────────────────────────────
  const sortedRecs = [...records].sort((a,b) => a.year - b.year);
  const hasMultiYear = sortedRecs.length >= 2;
  const hasPitch = sortedRecs.some(r => (r.pitching?.ip_dec||0) > 0);
  const years = sortedRecs.map(r => r.year);
  const chartId = (playerFirst+playerLast).replace(/\W/g,'');

  function leagueAvg(year, stat, cat) {
    const pool = GC_STATS.filter(r => r.year===year && r[cat] && parseFloat(r[cat][stat])>0);
    if (!pool.length) return null;
    return pool.reduce((s,r)=>s+(parseFloat(r[cat][stat])||0),0)/pool.length;
  }
  function teamAvg(year, team, stat, cat) {
    if (!team) return null;
    const pool = GC_STATS.filter(r => r.year===year && r.team===team && r[cat] && parseFloat(r[cat][stat])>0);
    if (!pool.length) return null;
    return pool.reduce((s,r)=>s+(parseFloat(r[cat][stat])||0),0)/pool.length;
  }
  function kipVal(rec) {
    const ip = rec.pitching?.ip_dec||0;
    return ip>0 ? +(rec.pitching.so/ip).toFixed(2) : null;
  }

  // ── Tab definitions ────────────────────────────────────────────────────
  const TABS = [
    { id:'avg',  label:'AVG',  cat:'batting',  field:'avg',  lowerBetter:false, color:'#60a5fa', fmt:v=>v?.toFixed(3)||'—', yLabel:'Batting Average' },
    { id:'obp',  label:'OBP',  cat:'batting',  field:'obp',  lowerBetter:false, color:'#10b981', fmt:v=>v?.toFixed(3)||'—', yLabel:'On-Base %' },
    { id:'ops',  label:'OPS',  cat:'batting',  field:'ops',  lowerBetter:false, color:'#f5a623', fmt:v=>v?.toFixed(3)||'—', yLabel:'OPS' },
    { id:'sb',   label:'SB',   cat:'batting',  field:'sb',   lowerBetter:false, color:'#a78bfa', fmt:v=>Math.round(v)||'—', yLabel:'Stolen Bases', isCount:true },
    { id:'rbi',  label:'RBI',  cat:'batting',  field:'rbi',  lowerBetter:false, color:'#fb923c', fmt:v=>Math.round(v)||'—', yLabel:'RBI', isCount:true },
  ];
  if (hasPitch) {
    TABS.push({ id:'era',  label:'ERA',  cat:'pitching', field:'era',  lowerBetter:true,  color:'#ef4444', fmt:v=>v?.toFixed(2)||'—', yLabel:'ERA' });
    TABS.push({ id:'kip',  label:'K/IP', cat:'pitching', field:'_kip', lowerBetter:false, color:'#f97316', fmt:v=>v?.toFixed(2)||'—', yLabel:'Strikeouts per IP' });
    TABS.push({ id:'whip', label:'WHIP', cat:'pitching', field:'whip', lowerBetter:true,  color:'#e879f9', fmt:v=>v?.toFixed(3)||'—', yLabel:'WHIP' });
  }

  // Compute data per tab
  const tabData = TABS.map(tab => {
    const playerVals = sortedRecs.map(r => {
      if (tab.field==='_kip') return kipVal(r);
      const v = parseFloat(r[tab.cat]?.[tab.field]);
      return isNaN(v) ? null : v;
    });
    const leagueVals = sortedRecs.map(r => {
      if (tab.field==='_kip') {
        const pool = GC_STATS.filter(x=>x.year===r.year && x.pitching?.ip_dec>0);
        return pool.length ? +(pool.reduce((s,x)=>s+x.pitching.so/x.pitching.ip_dec,0)/pool.length).toFixed(2) : null;
      }
      return leagueAvg(r.year, tab.field, tab.cat);
    });
    const teamVals = sortedRecs.map(r => {
      if (tab.field==='_kip') return null;
      return teamAvg(r.year, r.team, tab.field, tab.cat);
    });
    const latest = playerVals[playerVals.length-1];
    const latestLeague = leagueVals[leagueVals.length-1];
    let vsLeague = null;
    if (latest!==null && latestLeague!==null && latestLeague>0.001) {
      const diff = tab.lowerBetter ? latestLeague-latest : latest-latestLeague;
      if (Math.abs(diff/latestLeague) >= 0.03)
        vsLeague = { pct: Math.round(Math.abs(diff)/latestLeague*100), good: diff>0 };
    }
    return { ...tab, playerVals, leagueVals, teamVals, latest, latestLeague, vsLeague };
  });

  // Store for tab switching
  window._statsTabData = { chartId, tabData, years };

  // ── Build trend section ────────────────────────────────────────────────
  let trendHtml = '';
  if (hasMultiYear) {
    const firstTab = tabData[0];

    // Tab buttons — scrollable row
    const tabBtns = TABS.map((t,i) => {
      const td = tabData[i];
      const isFirst = i===0;
      const vsHtml = td.vsLeague
        ? `<span style="font-size:8px;color:${td.vsLeague.good?'#10b981':'#ef4444'};margin-left:3px;">${td.vsLeague.good?'▲':'▼'}${td.vsLeague.pct}%</span>`
        : '';
      return `<button id="stab_${t.id}_${chartId}"
        onclick="statsTabSwitch('${t.id}','${chartId}')"
        style="padding:5px 12px;border-radius:20px;border:1.5px solid ${isFirst?t.color:'rgba(255,255,255,0.1)'};
               background:${isFirst?t.color+'22':'rgba(255,255,255,0.03)'};
               color:${isFirst?t.color:'var(--text2)'};font-size:11px;font-weight:700;
               cursor:pointer;white-space:nowrap;transition:all .15s;letter-spacing:.3px;flex-shrink:0;">
        ${t.label}${vsHtml}
      </button>`;
    }).join('');

    // Current year value callouts (will update on tab switch)
    const callouts = years.map((y,i) => {
      const pv = firstTab.playerVals[i];
      const lv = firstTab.leagueVals[i];
      const tv = firstTab.teamVals[i];
      if (pv===null) return '';
      const diff = lv!==null && lv>0.001 ? (firstTab.lowerBetter?lv-pv:pv-lv) : null;
      const badge = diff!==null && Math.abs(diff/lv)>=0.03
        ? `<span style="font-size:8px;color:${diff>0?'#10b981':'#ef4444'};margin-left:2px;">${diff>0?'▲':'▼'}${Math.round(Math.abs(diff/lv)*100)}%</span>`
        : '';
      return `<div style="flex:1;min-width:60px;text-align:center;padding:7px 8px;
                          background:rgba(255,255,255,.04);border-radius:9px;border:1px solid rgba(255,255,255,.07);">
        <div style="font-family:'Bebas Neue';font-size:22px;color:${firstTab.color};">${firstTab.fmt(pv)}${badge}</div>
        <div style="font-size:9px;color:var(--text2);margin-top:1px;">${y}</div>
        ${lv!==null?`<div style="font-size:8px;color:#94a3b8;margin-top:1px;">Lg ${firstTab.fmt(lv)}</div>`:''}
        ${tv!==null?`<div style="font-size:8px;color:#fbbf24;">Tm ${firstTab.fmt(tv)}</div>`:''}
      </div>`;
    }).join('');

    trendHtml = `
    <div style="padding:14px;" id="strend_${chartId}">
      <!-- Section header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:6px;">
        <div>
          <span style="font-family:'Bebas Neue';font-size:18px;letter-spacing:.5px;color:var(--text);">Stats </span>
          <span style="font-family:'Bebas Neue';font-size:18px;letter-spacing:.5px;color:#60a5fa;">Over Time</span>
          <span style="font-size:10px;color:var(--text2);margin-left:8px;">${years.length} season${years.length>1?'s':''}</span>
        </div>
      </div>

      <!-- Tab pill row -->
      <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px;-webkit-overflow-scrolling:touch;scrollbar-width:none;" id="stabrow_${chartId}">
        ${tabBtns}
      </div>

      <!-- Chart card -->
      <div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px 16px;">
        <!-- Chart header row -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <div id="slabel_${chartId}" style="font-size:12px;font-weight:700;color:${firstTab.color};text-transform:uppercase;letter-spacing:.6px;">${firstTab.yLabel}</div>
          <!-- Legend -->
          <div style="display:flex;gap:14px;align-items:center;">
            <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text2);">
              <span style="width:20px;height:3px;border-radius:2px;background:${firstTab.color};display:inline-block;"></span>Player
            </div>
            <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text2);">
              <svg width="20" height="8" style="overflow:visible;"><line x1="0" y1="4" x2="20" y2="4" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4,3"/></svg>League
            </div>
            <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text2);">
              <svg width="20" height="8" style="overflow:visible;"><line x1="0" y1="4" x2="20" y2="4" stroke="#fbbf24" stroke-width="2" stroke-dasharray="4,3"/></svg>Team
            </div>
          </div>
        </div>
        <!-- The chart canvas -->
        <div style="position:relative;height:160px;width:100%;">
          <canvas id="schart_${chartId}" style="display:block;"></canvas>
        </div>
      </div>

      <!-- Per-year callout cards -->
      <div id="sval_${chartId}" style="display:flex;gap:7px;margin-top:10px;flex-wrap:wrap;">
        ${callouts}
      </div>
    </div>`;
  }

  // ── Season-by-season stat blocks ──────────────────────────────────────
  // Pre-compute best season key for badge
  let _bestSeasonKey = null;
  if (sortedRecs.length >= 1) {
    let bestS = -1;
    sortedRecs.forEach(r => {
      const rb = r.batting || {}, rp = r.pitching || {};
      const ab2 = parseInt(rb.ab || 0), ip2 = parseFloat(rp.ip_dec || 0);
      if (ab2 < 5 && ip2 < 3) return;
      const avgS = ab2 >= 5 ? Math.max(0, Math.min((parseFloat(rb.avg || '0') - 0.150) / 0.500, 1)) : 0;
      const opsS = ab2 >= 5 ? Math.max(0, Math.min((parseFloat(rb.ops || '0') - 0.400) / 1.100, 1)) : 0;
      const era2 = parseFloat(rp.era || '9.99'); const kpi2 = ip2 > 0 ? (rp.so || 0) / ip2 : 0;
      const pitS = ip2 >= 3 ? (Math.max(0, Math.min((10 - era2) / 9, 1)) * 0.5 + Math.min(kpi2 / 3.5, 1) * 0.5) : 0;
      const s = (avgS * 0.55 + opsS * 0.35) * 0.6 + pitS * 0.4;
      if (s > bestS) { bestS = s; _bestSeasonKey = `${r.key}|${r.year}`; }
    });
  }

  let seasonHtml = '';
  records.forEach(rec => {
    const b = rec.batting;
    const pi = rec.pitching;
    const fi = rec.fielding;
    const hp = (pi?.ip_dec||0) > 0;
    const isBestSeason = sortedRecs.length >= 2 && _bestSeasonKey === `${rec.key}|${rec.year}`;

    function vsLbl(field, cat, lower) {
      const pv = parseFloat(rec[cat]?.[field]);
      const lv = leagueAvg(rec.year, field, cat);
      if (isNaN(pv)||!lv||lv<0.001) return '';
      const diff = lower ? lv-pv : pv-lv;
      const p = Math.round(Math.abs(diff)/lv*100);
      if (p<3) return '';
      return `<span style="font-size:8px;color:${diff>0?'#10b981':'#ef4444'};font-weight:700;margin-left:2px;">${diff>0?'▲':'▼'}${p}%</span>`;
    }

    seasonHtml += `
    <div class="stats-season-block" ${isBestSeason ? 'style="border-color:var(--gold);box-shadow:0 0 0 1px rgba(245,166,35,0.2);"' : ''}>
      <div class="stats-season-header" style="background:${rec.sport==='Baseball'?'rgba(37,99,235,0.15)':'rgba(236,72,153,0.15)'}">
        <div style="font-family:'Bebas Neue';font-size:18px;letter-spacing:1px;">${rec.year} ${rec.team}${isBestSeason ? ' <span style="font-size:11px;background:rgba(245,166,35,0.2);color:var(--gold);border-radius:5px;padding:1px 8px;font-family:\'DM Sans\';font-weight:700;letter-spacing:0;vertical-align:middle;">⭐ Best Season</span>' : ''}</div>
        <div style="font-size:12px;color:var(--text2);">${rec.sport} · #${rec.number||'—'}</div>
      </div>
      <div style="padding:10px 12px;">
        <div class="stats-section-label" onclick="toggleRankDetail('bat_${rec.key.replace(/\|/g,'_')}')" style="cursor:pointer;user-select:none;">
          ⚾ Batting <span style="font-size:10px;color:var(--text2);font-weight:400;">▾</span>
        </div>
        <div id="bat_${rec.key.replace(/\|/g,'_')}">
        <div class="stats-grid-4">
          <div class="stat-pill"><div class="sp-val">${fmtStat(b.avg)}${vsLbl('avg','batting',false)}</div><div class="sp-lbl">AVG</div></div>
          <div class="stat-pill"><div class="sp-val">${fmtStat(b.obp)}${vsLbl('obp','batting',false)}</div><div class="sp-lbl">OBP</div></div>
          <div class="stat-pill"><div class="sp-val">${fmtStat(b.slg)}</div><div class="sp-lbl">SLG</div></div>
          <div class="stat-pill"><div class="sp-val">${fmtStat(b.ops)}${vsLbl('ops','batting',false)}</div><div class="sp-lbl">OPS</div></div>
          <div class="stat-pill"><div class="sp-val">${b.h}</div><div class="sp-lbl">H</div></div>
          <div class="stat-pill"><div class="sp-val">${b.rbi}</div><div class="sp-lbl">RBI</div></div>
          <div class="stat-pill"><div class="sp-val">${b.r}</div><div class="sp-lbl">R</div></div>
          <div class="stat-pill"><div class="sp-val">${b.sb}</div><div class="sp-lbl">SB</div></div>
          <div class="stat-pill"><div class="sp-val">${b.hr}</div><div class="sp-lbl">HR</div></div>
          <div class="stat-pill"><div class="sp-val">${b['2b']}</div><div class="sp-lbl">2B</div></div>
          <div class="stat-pill"><div class="sp-val">${b['3b']}</div><div class="sp-lbl">3B</div></div>
          <div class="stat-pill"><div class="sp-val">${b.bb}</div><div class="sp-lbl">BB</div></div>
          <div class="stat-pill"><div class="sp-val">${b.so}</div><div class="sp-lbl">K</div></div>
          <div class="stat-pill"><div class="sp-val">${b.gp}</div><div class="sp-lbl">GP</div></div>
          <div class="stat-pill"><div class="sp-val">${b.pa}</div><div class="sp-lbl">PA</div></div>
          <div class="stat-pill"><div class="sp-val">${fmtStat(b.qab_pct)}%</div><div class="sp-lbl">QAB%</div></div>
        </div>
        </div>
      </div>
      ${hp ? `
      <div style="padding:0 12px 10px;">
        <div class="stats-section-label" onclick="toggleRankDetail('pit_${rec.key.replace(/\|/g,'_')}')" style="cursor:pointer;user-select:none;">
          🔥 Pitching <span style="font-size:10px;color:var(--text2);font-weight:400;">▾</span>
        </div>
        <div id="pit_${rec.key.replace(/\|/g,'_')}">
        <div class="stats-grid-4">
          <div class="stat-pill"><div class="sp-val">${fmtIP(pi.ip)}</div><div class="sp-lbl">IP</div></div>
          <div class="stat-pill"><div class="sp-val">${fmtStat(pi.era)}${vsLbl('era','pitching',true)}</div><div class="sp-lbl">ERA</div></div>
          <div class="stat-pill"><div class="sp-val">${fmtStat(pi.whip)}${vsLbl('whip','pitching',true)}</div><div class="sp-lbl">WHIP</div></div>
          <div class="stat-pill"><div class="sp-val">${fmtStat(pi.baa)}</div><div class="sp-lbl">BAA</div></div>
          <div class="stat-pill"><div class="sp-val">${pi.so}</div><div class="sp-lbl">K</div></div>
          <div class="stat-pill"><div class="sp-val">${pi.bb}</div><div class="sp-lbl">BB</div></div>
          <div class="stat-pill"><div class="sp-val">${pi.h}</div><div class="sp-lbl">H</div></div>
          <div class="stat-pill"><div class="sp-val">${pi.er}</div><div class="sp-lbl">ER</div></div>
          <div class="stat-pill"><div class="sp-val">${pi.w}-${pi.l}</div><div class="sp-lbl">W-L</div></div>
          <div class="stat-pill"><div class="sp-val">${pi.sv}</div><div class="sp-lbl">SV</div></div>
          <div class="stat-pill"><div class="sp-val">${pi.gs}</div><div class="sp-lbl">GS</div></div>
          <div class="stat-pill"><div class="sp-val">${pi.pitches||0}</div><div class="sp-lbl">#P</div></div>
        </div>
        </div>
      </div>` : ''}
      <div style="padding:0 12px 12px;">
        <div class="stats-section-label">🧤 Fielding</div>
        <div class="stats-grid-4">
          <div class="stat-pill"><div class="sp-val">${fmtStat(fi.fpct)}</div><div class="sp-lbl">FPCT</div></div>
          <div class="stat-pill"><div class="sp-val">${fi.tc}</div><div class="sp-lbl">TC</div></div>
          <div class="stat-pill"><div class="sp-val">${fi.po}</div><div class="sp-lbl">PO</div></div>
          <div class="stat-pill"><div class="sp-val">${fi.a}</div><div class="sp-lbl">A</div></div>
          <div class="stat-pill"><div class="sp-val">${fi.e}</div><div class="sp-lbl">E</div></div>
        </div>
      </div>
    </div>`;
  });


  // ── Career Totals ──────────────────────────────────────────────────────
  let careerHtml = '';
  if (sortedRecs.length >= 2) {
    // Sum all counting stats
    const ct = { gp:0,pa:0,ab:0,h:0,r:0,rbi:0,bb:0,so:0,hbp:0,sb:0,cs:0,tb:0,hr:0,xbh:0,
                 b2:0,b3:0,qab:0, ip:0,gs:0,w:0,l:0,sv:0,ph:0,pr:0,per:0,pbb:0,pso:0,pitches:0 };
    sortedRecs.forEach(r => {
      const b = r.batting||{}, p = r.pitching||{};
      ct.gp  += (+b.gp||0);  ct.pa  += (+b.pa||0);  ct.ab  += (+b.ab||0);
      ct.h   += (+b.h||0);   ct.r   += (+b.r||0);   ct.rbi += (+b.rbi||0);
      ct.bb  += (+b.bb||0);  ct.so  += (+b.so||0);  ct.hbp += (+b.hbp||0);
      ct.sb  += (+b.sb||0);  ct.cs  += (+b.cs||0);  ct.tb  += (+b.tb||0);
      ct.hr  += (+b.hr||0);  ct.xbh += (+b.xbh||0); ct.b2  += (+b['2b']||0);
      ct.b3  += (+b['3b']||0); ct.qab += (+b.qab||0);
      ct.ip  += +(p.ip_dec||0); ct.gs += +(p.gs||0); ct.w  += +(p.w||0);
      ct.l   += +(p.l||0);  ct.sv  += +(p.sv||0);  ct.ph  += +(p.h||0);
      ct.per += +(p.er||0); ct.pbb += +(p.bb||0);  ct.pso += +(p.so||0);
      ct.pitches += +(p.pitches||0);
    });

    const cAVG = ct.ab ? ct.h / ct.ab : 0;
    const cOBP = (ct.ab+ct.bb+ct.hbp) ? (ct.h+ct.bb+ct.hbp)/(ct.ab+ct.bb+ct.hbp) : 0;
    const cSLG = ct.ab ? ct.tb / ct.ab : 0;
    const cOPS = cOBP + cSLG;
    const cERA = ct.ip ? (ct.per / ct.ip * 9) : null;
    const cWHIP = ct.ip ? ((ct.ph + ct.pbb) / ct.ip) : null;
    const hasPitchCareer = ct.ip >= 1;
    const sbPct = (ct.sb+ct.cs) ? Math.round(ct.sb/(ct.sb+ct.cs)*100) : null;

    const pill = (val, lbl, color='#fff') =>
      `<div class="stat-pill"><div class="sp-val" style="color:${color};">${val}</div><div class="sp-lbl">${lbl}</div></div>`;

    careerHtml = `
    <div style="background:linear-gradient(135deg,rgba(96,165,250,0.08),rgba(245,166,35,0.06));
                border:1px solid rgba(96,165,250,0.25);border-radius:14px;
                padding:14px 16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-family:'Bebas Neue';font-size:18px;letter-spacing:.5px;color:#60a5fa;">Career</span>
        <span style="font-size:11px;color:var(--text2);">${sortedRecs.length} seasons · ${sortedRecs.map(r=>r.year).join(', ')}</span>
      </div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--text2);font-weight:700;margin-bottom:6px;">⚾ Batting</div>
      <div class="stats-grid-4" style="margin-bottom:10px;">
        ${pill(cAVG.toFixed(3),'AVG','#60a5fa')}
        ${pill(cOBP.toFixed(3),'OBP','#10b981')}
        ${pill(cSLG.toFixed(3),'SLG','#f5a623')}
        ${pill(cOPS.toFixed(3),'OPS','#a78bfa')}
        ${pill(ct.h,'H')}
        ${pill(ct.hr,'HR')}
        ${pill(ct.rbi,'RBI')}
        ${pill(ct.r,'R')}
        ${pill(ct.sb,'SB')}
        ${pill(sbPct!==null?sbPct+'%':'—','SB%')}
        ${pill(ct.b2,'2B')}
        ${pill(ct.b3,'3B')}
        ${pill(ct.bb,'BB')}
        ${pill(ct.so,'K')}
        ${pill(ct.ab,'AB')}
        ${pill(ct.gp,'GP')}
      </div>
      ${hasPitchCareer ? `
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:var(--text2);font-weight:700;margin-bottom:6px;">🔥 Pitching</div>
      <div class="stats-grid-4">
        ${pill(cERA!==null?cERA.toFixed(2):'—','ERA','#ef4444')}
        ${pill(cWHIP!==null?cWHIP.toFixed(3):'—','WHIP','#e879f9')}
        ${pill(ct.pso,'K')}
        ${pill(ct.pbb,'BB')}
        ${pill(ct.ip%1===0?ct.ip:ct.ip.toFixed(1),'IP')}
        ${pill(ct.w+'-'+ct.l,'W-L')}
        ${pill(ct.sv,'SV')}
        ${pill(ct.gs,'GS')}
      </div>` : ''}
    </div>`;
  }

  // ── Single-season league context (replaces empty trend area for 1-year players) ──
  let singleSeasonCtx = '';
  if (!hasMultiYear && sortedRecs.length === 1) {
    const sr = sortedRecs[0];
    const b = sr.batting || {};
    const pi = sr.pitching || {};
    const hasBat = (b.ab || 0) >= 4;
    const hasPit = (pi.ip_dec || 0) >= 2;
    if (hasBat || hasPit) {
      // Compare only against same level (same team/division name) in same year
      function _lvl(t) {
        const s = (t||'').toLowerCase();
        if (s.includes('minors black')) return 'minors black';
        if (s.includes('minors blue'))  return 'minors blue';
        if (s.includes('minors'))       return 'minors';
        if (s.includes('majors b'))     return 'majors b';
        if (s.includes('majors'))       return 'majors';
        if (s.includes('select'))       return 'select';
        if (s.includes('rookie'))       return 'rookie';
        if (s.includes('leominster'))   return 'leominster';
        if (s.includes('lunenburg'))    return 'lunenburg';
        return s.split(' ').slice(0,2).join(' ');
      }
      const myLvl = _lvl(sr.team);
      const pool = GC_STATS.filter(r =>
        r.year === sr.year &&
        r.sport === sr.sport &&
        _lvl(r.team) === myLvl
      );
      const batPool = pool.filter(p => (p.batting?.ab || 0) >= 4);
      const pitPool = pool.filter(p => (p.pitching?.ip_dec || 0) >= 2);
      function pctile(val, arr, lower = false) {
        if (!arr.length || val === null || isNaN(val)) return null;
        const sorted = arr.slice().sort((a, b) => lower ? a - b : b - a);
        const idx = sorted.findIndex(v => lower ? v >= val : v <= val);
        return idx < 0 ? 100 : Math.round((1 - idx / sorted.length) * 100);
      }
      const pctBar = (pct, label, color = '#60a5fa') => {
        if (pct === null) return '';
        const medal = pct >= 90 ? '🥇' : pct >= 75 ? '🥈' : pct >= 50 ? '🥉' : '';
        const col = pct >= 90 ? 'var(--gold)' : pct >= 75 ? 'var(--green)' : pct >= 50 ? color : 'var(--text2)';
        return `<div style="margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
            <span style="color:var(--text2);">${label}</span>
            <span style="color:${col};font-weight:700;">${medal} Top ${100 - pct + 1}%</span>
          </div>
          <div style="height:5px;background:rgba(255,255,255,0.07);border-radius:3px;">
            <div style="width:${pct}%;height:100%;background:${col};border-radius:3px;transition:width .4s;"></div>
          </div>
        </div>`;
      };
      let ctx = '';
      if (hasBat) {
        ctx += pctBar(pctile(parseFloat(b.avg), batPool.map(p => parseFloat(p.batting?.avg) || 0)), 'AVG');
        ctx += pctBar(pctile(parseFloat(b.obp), batPool.map(p => parseFloat(p.batting?.obp) || 0)), 'OBP', '#10b981');
        ctx += pctBar(pctile(parseFloat(b.ops), batPool.map(p => parseFloat(p.batting?.ops) || 0)), 'OPS', '#a78bfa');
        ctx += pctBar(pctile(parseInt(b.rbi), batPool.map(p => parseInt(p.batting?.rbi) || 0)), 'RBI', '#fb923c');
      }
      if (hasPit) {
        ctx += pctBar(pctile(parseFloat(pi.era), pitPool.map(p => parseFloat(p.pitching?.era) || 9.99), true), 'ERA', '#ef4444');
        ctx += pctBar(pctile(parseFloat(pi.whip), pitPool.map(p => parseFloat(p.pitching?.whip) || 9.99), true), 'WHIP', '#e879f9');
      }
      singleSeasonCtx = '';
      const _canShowPct = typeof canShowRankings === 'function' ? canShowRankings() : true;
      if (_canShowPct) {
        singleSeasonCtx = `
        <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px 16px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <span style="font-family:'Bebas Neue';font-size:18px;color:#60a5fa;">Level </span>
            <span style="font-family:'Bebas Neue';font-size:18px;color:var(--text);margin-left:4px;">Percentiles</span>
            <span style="font-size:10px;color:var(--text2);margin-left:auto;">${sr.year} ${sr.team||''} · ${pool.length} players</span>
          </div>
          ${ctx}
        </div>`;
      }
    }
  }

  // ── Rankings (league + bracket) ────────────────────────────────────────
  let rankingsHtml = '';
  const _canRank = typeof canShowRankings === 'function' ? canShowRankings() : true;
  if (!_inline && !_cmpTarget && _canRank) {
    const playerObj = { first: playerFirst, last: playerLast };
    const rankings = gcComputeRankings(playerObj);
    rankingsHtml = gcRankingsHtml(rankings);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (contentEl) contentEl.innerHTML = careerHtml + singleSeasonCtx + trendHtml + seasonHtml + rankingsHtml;

  // ── Draw initial chart ────────────────────────────────────────────────
  if (hasMultiYear) {
    requestAnimationFrame(() => {
      statsTabSwitch('avg', chartId);
    });
  }

  if (!_inline && !_cmpTarget) {
    document.getElementById('statsModal').classList.add('open');
    // Apply compare button visibility based on feature flags
    const compareBtn = document.getElementById('statsCompareBtn');
    if (compareBtn) {
      const _canCompare = typeof canShowCompare === 'function' ? canShowCompare() : true;
      compareBtn.style.display = _canCompare ? '' : 'none';
    }
    // If compare player is set, render compare after main stats load
    if (_statsComparePlayer && _statsCompareActive) {
      setTimeout(() => _statsRenderWithCompare(_statsMainPlayer, _statsComparePlayer), 50);
    }
  }
}


// Convenience wrapper — silently does nothing if no stats found
function statsTabSwitch(tabId, chartId) {
  if (!window._statsTabData || window._statsTabData.chartId !== chartId) return;
  const { tabData, years } = window._statsTabData;
  const td = tabData.find(t => t.id === tabId);
  if (!td) return;

  // Update tab pill styles
  tabData.forEach(t => {
    const btn = document.getElementById(`stab_${t.id}_${chartId}`);
    if (!btn) return;
    const on = t.id === tabId;
    btn.style.background  = on ? td.color+'22' : 'rgba(255,255,255,0.03)';
    btn.style.borderColor = on ? td.color : 'rgba(255,255,255,0.1)';
    btn.style.color       = on ? td.color : 'var(--text2)';
  });

  // Update label
  const lbl = document.getElementById(`slabel_${chartId}`);
  if (lbl) { lbl.textContent = td.yLabel; lbl.style.color = td.color; }

  // Update callout cards
  const valEl = document.getElementById(`sval_${chartId}`);
  if (valEl) {
    valEl.innerHTML = years.map((y,i) => {
      const pv = td.playerVals[i];
      if (pv===null) return '';
      const lv = td.leagueVals[i];
      const tv = td.teamVals[i];
      const diff = lv!==null&&lv>0.001 ? (td.lowerBetter?lv-pv:pv-lv) : null;
      const badge = diff!==null&&Math.abs(diff/lv)>=0.03
        ? `<span style="font-size:8px;color:${diff>0?'#10b981':'#ef4444'};margin-left:2px;">${diff>0?'▲':'▼'}${Math.round(Math.abs(diff/lv)*100)}%</span>`
        : '';
      return `<div style="flex:1;min-width:60px;text-align:center;padding:7px 8px;
                          background:rgba(255,255,255,.04);border-radius:9px;border:1px solid rgba(255,255,255,.07);">
        <div style="font-family:'Bebas Neue';font-size:22px;color:${td.color};">${td.fmt(pv)}${badge}</div>
        <div style="font-size:9px;color:var(--text2);margin-top:1px;">${y}</div>
        ${lv!==null?`<div style="font-size:8px;color:#94a3b8;margin-top:1px;">Lg ${td.fmt(lv)}</div>`:''}
        ${tv!==null?`<div style="font-size:8px;color:#fbbf24;">Tm ${td.fmt(tv)}</div>`:''}
      </div>`;
    }).join('');
  }

  // ── Draw Chart.js line chart ────────────────────────────────────────
  const canvas = document.getElementById(`schart_${chartId}`);
  if (!canvas) return;

  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const playerData = years.map((y,i) => td.playerVals[i]);
  const leagueData = years.map((y,i) => td.leagueVals[i]);
  const teamData   = years.map((y,i) => td.teamVals[i]);

  const allVals = [...playerData,...leagueData,...teamData].filter(v=>v!==null&&!isNaN(v));
  const spread = allVals.length ? Math.max(...allVals)-Math.min(...allVals) : 1;
  const pad = spread*0.3 || 0.05;
  const minVal = Math.max(0, Math.min(...allVals)-pad);
  const maxVal = Math.max(...allVals)+pad;

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        {
          label: 'Player',
          data: playerData,
          borderColor: td.color,
          backgroundColor: td.color+'18',
          borderWidth: 3,
          pointRadius: 5,
          pointBackgroundColor: td.color,
          pointBorderColor: '#0f172a',
          pointBorderWidth: 2,
          tension: 0.4,
          fill: true,
          order: 1,
        },
        {
          label: 'League Avg',
          data: leagueData,
          borderColor: '#64748b',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          order: 2,
        },
        ...(teamData.some(v=>v!==null) ? [{
          label: 'Team Avg',
          data: teamData,
          borderColor: '#fbbf24',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          order: 3,
        }] : []),
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350, easing: 'easeInOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)',
          borderColor: td.color+'44',
          borderWidth: 1,
          callbacks: {
            title: ctx => `${ctx[0].label}`,
            label: ctx => {
              const v = ctx.parsed.y;
              if (v===null) return null;
              return `${ctx.dataset.label}: ${td.fmt(v)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#64748b', font: { size: 11 } }
        },
        y: {
          min: minVal,
          max: maxVal,
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: v => td.isCount ? Math.round(v) : v.toFixed(td.field==='sb'||td.field==='rbi'?0:3)
          }
        }
      }
    }
  });
}


function showPlayerStatsIfAvailable(first, last) {
  if (typeof canShowStats === 'function' && !canShowStats()) return;
  if (typeof GC_STATS === 'undefined') return;
  const key = `${(first||'').toLowerCase()}|${(last||'')[0]?.toUpperCase()||''}`;
  if (!GC_STATS.some(s => s.key === key)) return;
  showPlayerStats(first, last);
}

// ── Stats Compare Feature ──────────────────────────────────────────────────
let _statsCompareActive = false;
let _statsMainPlayer   = null; // {first, last}
let _statsComparePlayer = null;

function statsToggleCompare() {
  // Guard: compare only available to admin or when flag is enabled
  if (typeof canShowCompare === 'function' && !canShowCompare()) return;
  _statsCompareActive = !_statsCompareActive;
  const btn    = document.getElementById('statsCompareBtn');
  const search = document.getElementById('statsCompareSearch');
  const modal  = document.querySelector('#statsModal .modal');
  if (_statsCompareActive) {
    btn.textContent = '⚔ Comparing';
    btn.style.color = 'var(--gold)';
    btn.style.borderColor = 'var(--gold)';
    if (search) { search.style.display = 'flex'; }
    const inp = document.getElementById('statsCompareInput');
    if (inp) { inp.value = ''; inp.focus(); }
    // Add extra top padding so the modal-close-x doesn't overlap the search row
    if (modal) modal.style.paddingTop = '42px';
  } else {
    statsClearCompare();
  }
}

function statsClearCompare() {
  _statsCompareActive = false;
  _statsComparePlayer = null;
  const btn = document.getElementById('statsCompareBtn');
  if (btn) { btn.textContent = '⚔ Compare'; btn.style.color = ''; btn.style.borderColor = ''; }
  const search = document.getElementById('statsCompareSearch');
  if (search) search.style.display = 'none';
  const dd = document.getElementById('statsCompareDropdown');
  if (dd) dd.innerHTML = '';
  // Restore normal padding
  const modal = document.querySelector('#statsModal .modal');
  if (modal) modal.style.paddingTop = '';
  // Re-render just main player
  if (_statsMainPlayer) showPlayerStats(_statsMainPlayer.first, _statsMainPlayer.last);
}

function statsCompareSearch(query) {
  const dd = document.getElementById('statsCompareDropdown');
  if (!dd) return;
  if (!query || query.length < 2) { dd.innerHTML = ''; dd.style.display = 'none'; return; }
  const q = query.toLowerCase();

  // Division of the main player — only show candidates from the same division
  // so you can't compare a Majors Select year against a Minors year
  const mainDiv = _statsMainPlayer?.division || null;

  // Division tier map: players must share the same tier to be comparable
  const _divTier = { 'T-Ball':0, 'Farm':1, 'Rookies':2, '10U':2, 'Minors':3,
                     'Senior':3, 'Majors':4, 'Majors Select':4, '12U':3 };
  const mainTier = mainDiv ? (_divTier[mainDiv] ?? null) : null;

  // Search players with GC stats — deduplicate by first+last+sport
  const seenKeys = new Set();
  const matches = (typeof players !== 'undefined' ? players : [])
    .sort((a, b) => b.year - a.year) // newest first so we keep best context
    .filter(p => {
      const name = `${p.first} ${p.last}`.toLowerCase();
      if (!name.includes(q)) return false;

      // Skip the main player themselves
      if (p.first?.toLowerCase() === _statsMainPlayer?.first?.toLowerCase() &&
          p.last?.[0]?.toUpperCase() === _statsMainPlayer?.last?.[0]?.toUpperCase()) return false;

      // Division tier filter — must match same competitive level
      if (mainTier !== null) {
        const pTier = _divTier[p.division] ?? null;
        if (pTier !== null && pTier !== mainTier) return false;
      }

      if (!gcLookup(p).length) return false;
      const uk = `${p.first}|${p.last}|${p.sport}`.toLowerCase();
      if (seenKeys.has(uk)) return false;
      seenKeys.add(uk);
      return true;
    })
    .slice(0, 8);

  if (!matches.length) {
    const msg = mainDiv
      ? `No ${mainDiv}-level players with stats found`
      : 'No players with stats found';
    dd.innerHTML = `<div style="padding:8px 12px;color:var(--text2);font-size:12px;">${msg}</div>`;
    dd.style.display = 'block';
    return;
  }
  dd.style.display = 'block';
  dd.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:8px;margin-top:6px;overflow:hidden;">
    ${matches.map(p => `<div onclick="statsSelectCompare('${p.first}','${p.last}')"
      style="padding:8px 14px;cursor:pointer;font-size:13px;color:#fff;"
      onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background=''">
      ${p.first} ${p.last} <span style="color:var(--text2);font-size:11px;">${p.division||''} ${p.year||''}</span>
    </div>`).join('')}
  </div>`;
}

function statsSelectCompare(first, last) {
  _statsComparePlayer = { first, last };
  const dd = document.getElementById('statsCompareDropdown');
  if (dd) dd.innerHTML = '';
  const inp = document.getElementById('statsCompareInput');
  if (inp) inp.value = `${first} ${last}`;
  // Re-render with comparison
  if (_statsMainPlayer) _statsRenderWithCompare(_statsMainPlayer, _statsComparePlayer);
}

function _statsRenderWithCompare(mainP, cmpP) {
  if (typeof GC_STATS === 'undefined') return;
  const mainRecsAll = gcLookup(mainP);
  const cmpRecsAll  = gcLookup(cmpP);
  if (!mainRecsAll.length || !cmpRecsAll.length) return;

  // ── Division-tier normalization ──────────────────────────────────────
  // Only compare seasons played at the same competitive level.
  // e.g. if player A is now Majors but player B is Minors, compare only
  // player A's Minors seasons vs player B's Minors seasons.
  const _divTier = {
    'T-Ball':0, 'Farm':1, 'Rookies':2, '10U':2,
    'Minors':3, 'Senior':3, '12U':3,
    'Majors':4, 'Majors Select':4, 'Majors A':4, 'Majors B':4
  };

  // Look up a GC_STATS record's division via the players array
  function recTier(rec) {
    if (typeof players === 'undefined') return null;
    const p = players.find(x =>
      x.year === rec.year &&
      x.first?.toLowerCase() === rec.first?.toLowerCase() &&
      x.last?.[0]?.toUpperCase() === rec.last?.[0]?.toUpperCase()
    );
    if (p?.division) return _divTier[p.division] ?? null;
    // Fallback: infer from team name
    const t = (rec.team || '').toLowerCase();
    if (t.includes('majors') || t.includes('select')) return 4;
    if (t.includes('minor')) return 3;
    if (t.includes('rookie')) return 2;
    return null;
  }

  // Build sets of tiers each player has played at
  const mainTiers = new Set(mainRecsAll.map(recTier).filter(t => t !== null));
  const cmpTiers  = new Set(cmpRecsAll.map(recTier).filter(t => t !== null));

  // Find overlapping tiers (both players have seasons at these levels)
  const sharedTiers = [...mainTiers].filter(t => cmpTiers.has(t));

  // If there's an overlap, restrict to those tiers; otherwise use all records
  let mainRecs = mainRecsAll;
  let cmpRecs  = cmpRecsAll;
  let divNote  = '';

  if (sharedTiers.length > 0 && sharedTiers.length < Math.max(mainTiers.size, cmpTiers.size)) {
    // Filter to overlapping tiers only
    mainRecs = mainRecsAll.filter(r => sharedTiers.includes(recTier(r)));
    cmpRecs  = cmpRecsAll.filter(r => sharedTiers.includes(recTier(r)));
    // Build human-readable tier label
    const tierLabel = { 0:'T-Ball', 1:'Farm', 2:'Rookies/10U', 3:'Minors', 4:'Majors' };
    const tierNames = sharedTiers.map(t => tierLabel[t] || t).join(' & ');
    divNote = `<div style="font-size:10px;color:#60a5fa;background:rgba(96,165,250,0.08);border:1px solid rgba(96,165,250,0.2);border-radius:5px;padding:4px 10px;margin-bottom:10px;text-align:center;">
      ⚡ Comparing ${tierNames}-level seasons only · ${mainP.first}: ${mainRecs.length} season${mainRecs.length!==1?'s':''} · ${cmpP.first}: ${cmpRecs.length} season${cmpRecs.length!==1?'s':''}
    </div>`;
    // Guard: if either has zero records after filter, fall back to all
    if (!mainRecs.length || !cmpRecs.length) {
      mainRecs = mainRecsAll;
      cmpRecs  = cmpRecsAll;
      divNote  = '';
    }
  }
  // (else: no filtering needed — same tiers or can't determine)

  // Compute career averages for compare bar
  function careerAvg(recs) {
    const tot = { ab:0, h:0, hr:0, rbi:0, sb:0, bb:0, k:0 };
    recs.forEach(r => {
      tot.ab  += r.batting?.ab   || 0;
      tot.h   += r.batting?.h    || 0;
      tot.hr  += r.batting?.hr   || 0;
      tot.rbi += r.batting?.rbi  || 0;
      tot.sb  += r.batting?.sb   || 0;
      tot.bb  += r.batting?.bb   || 0;
      tot.k   += r.batting?.so   || 0;
    });
    const avg = tot.ab ? (tot.h / tot.ab) : 0;
    const obp = tot.ab ? ((tot.h + tot.bb) / (tot.ab + tot.bb)) : 0;
    return { avg: avg.toFixed(3), obp: obp.toFixed(3), hr: tot.hr, rbi: tot.rbi, sb: tot.sb, k: tot.k, ab: tot.ab, h: tot.h };
  }

  const mainStats = careerAvg(mainRecs);
  const cmpStats  = careerAvg(cmpRecs);

  // Compute extra stats
  function extraStats(recs) {
    const tot = { ab:0, h:0, hr:0, rbi:0, sb:0, bb:0, k:0, xbh:0, tb:0, hbp:0, r:0,
                  ip:0, er:0, ph:0, pbb:0, pso:0, gs:0, w:0, l:0, sv:0 };
    recs.forEach(r => {
      tot.ab  += r.batting?.ab   || 0;
      tot.h   += r.batting?.h    || 0;
      tot.hr  += r.batting?.hr   || 0;
      tot.rbi += r.batting?.rbi  || 0;
      tot.sb  += r.batting?.sb   || 0;
      tot.bb  += r.batting?.bb   || 0;
      tot.k   += r.batting?.so   || 0;
      tot.xbh += r.batting?.xbh  || 0;
      tot.tb  += r.batting?.tb   || 0;
      tot.hbp += r.batting?.hbp  || 0;
      tot.r   += r.batting?.r    || 0;
      tot.ip  += r.pitching?.ip_dec || 0;
      tot.er  += r.pitching?.er  || 0;
      tot.ph  += r.pitching?.h   || 0;
      tot.pbb += r.pitching?.bb  || 0;
      tot.pso += r.pitching?.so  || 0;
      tot.gs  += r.pitching?.gs  || 0;
      tot.w   += r.pitching?.w   || 0;
      tot.l   += r.pitching?.l   || 0;
      tot.sv  += r.pitching?.sv  || 0;
    });
    const avg = tot.ab ? (tot.h / tot.ab) : 0;
    const obp = tot.ab ? ((tot.h + tot.bb + tot.hbp) / (tot.ab + tot.bb + tot.hbp)) : 0;
    const slg = tot.ab ? (tot.tb / tot.ab) : 0;
    const ops = obp + slg;
    const bbPct = (tot.ab + tot.bb + tot.hbp) ? (tot.bb / (tot.ab + tot.bb + tot.hbp) * 100) : 0;
    const era  = tot.ip >= 1 ? (tot.er / tot.ip * 9) : null;
    const whip = tot.ip >= 1 ? ((tot.ph + tot.pbb) / tot.ip) : null;
    const kip  = tot.ip >= 1 ? (tot.pso / tot.ip) : null;
    return {
      avg: avg.toFixed(3), obp: obp.toFixed(3), slg: slg.toFixed(3), ops: ops.toFixed(3),
      hr: tot.hr, rbi: tot.rbi, sb: tot.sb, k: tot.k,
      xbh: tot.xbh, bb: tot.bb, r: tot.r,
      bbPct: bbPct.toFixed(1),
      ab: tot.ab, h: tot.h,
      ip: tot.ip >= 1 ? +tot.ip.toFixed(1) : 0,
      era: era !== null ? era.toFixed(2) : null,
      whip: whip !== null ? whip.toFixed(3) : null,
      kip: kip !== null ? kip.toFixed(2) : null,
      pso: tot.pso, wl: `${tot.w}-${tot.l}`, sv: tot.sv, gs: tot.gs
    };
  }

  const mainFull = extraStats(mainRecs);
  const cmpFull  = extraStats(cmpRecs);

  function statBar(mVal, cVal, label, isLower=false) {
    const m = parseFloat(mVal) || 0;
    const c = parseFloat(cVal) || 0;
    const max = Math.max(m, c, 0.001);
    const mPct = Math.round((m / max) * 100);
    const cPct = Math.round((c / max) * 100);
    const mBetter = isLower ? m <= c : m >= c;
    const cBetter = isLower ? c <= m : c >= m;
    return `<div style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:2px;">
        <span style="color:${mBetter?'#60a5fa':'#fff'};font-weight:600;">${mVal}</span>
        <span style="font-weight:600;color:var(--text2);font-size:10px;letter-spacing:.3px;">${label}</span>
        <span style="color:${cBetter?'var(--gold)':'#fff'};font-weight:600;">${cVal}</span>
      </div>
      <div style="display:flex;gap:3px;align-items:center;">
        <div style="flex:1;display:flex;justify-content:flex-end;">
          <div style="width:${mPct}%;height:5px;background:#60a5fa;border-radius:3px;"></div>
        </div>
        <div style="width:1px;height:10px;background:var(--border);flex-shrink:0;"></div>
        <div style="flex:1;">
          <div style="width:${cPct}%;height:5px;background:var(--gold);border-radius:3px;"></div>
        </div>
      </div>
    </div>`;
  }

  // Split into two columns: rate stats left, counting stats right
  const leftBars = [
    statBar(mainFull.avg, cmpFull.avg, 'AVG'),
    statBar(mainFull.obp, cmpFull.obp, 'OBP'),
    statBar(mainFull.slg, cmpFull.slg, 'SLG'),
    statBar(mainFull.ops, cmpFull.ops, 'OPS'),
    statBar(mainFull.bbPct+'%', cmpFull.bbPct+'%', 'BB%'),
    statBar(mainFull.k, cmpFull.k, 'K', true),
  ].join('');
  const rightBars = [
    statBar(mainFull.rbi, cmpFull.rbi, 'RBI'),
    statBar(mainFull.sb, cmpFull.sb, 'SB'),
    statBar(mainFull.xbh, cmpFull.xbh, 'XBH'),
    statBar(mainFull.hr, cmpFull.hr, 'HR'),
    statBar(mainFull.r, cmpFull.r, 'R'),
    statBar(mainFull.bb, cmpFull.bb, 'BB'),
  ].join('');

  // Pitching section — only if either player has IP
  const hasCmpPitch = (mainFull.ip >= 1) || (cmpFull.ip >= 1);
  const pitchBars = hasCmpPitch ? [
    mainFull.era !== null || cmpFull.era !== null ? statBar(mainFull.era ?? '—', cmpFull.era ?? '—', 'ERA', true) : '',
    mainFull.whip !== null || cmpFull.whip !== null ? statBar(mainFull.whip ?? '—', cmpFull.whip ?? '—', 'WHIP', true) : '',
    statBar(mainFull.pso, cmpFull.pso, 'K (P)'),
    statBar(mainFull.ip, cmpFull.ip, 'IP'),
  ].join('') : '';

  // Fix 5: category win tally
  const catComps = [
    { m: parseFloat(mainFull.avg), c: parseFloat(cmpFull.avg), lower: false },
    { m: parseFloat(mainFull.obp), c: parseFloat(cmpFull.obp), lower: false },
    { m: parseFloat(mainFull.ops), c: parseFloat(cmpFull.ops), lower: false },
    { m: mainFull.rbi, c: cmpFull.rbi, lower: false },
    { m: mainFull.sb, c: cmpFull.sb, lower: false },
    { m: mainFull.hr, c: cmpFull.hr, lower: false },
    { m: mainFull.r,  c: cmpFull.r,  lower: false },
    { m: mainFull.xbh,c: cmpFull.xbh,lower: false },
    ...(hasCmpPitch && mainFull.era !== null && cmpFull.era !== null
      ? [{ m: parseFloat(mainFull.era), c: parseFloat(cmpFull.era), lower: true  },
         { m: parseFloat(mainFull.whip),c: parseFloat(cmpFull.whip),lower: true  },
         { m: mainFull.pso, c: cmpFull.pso, lower: false }] : []),
  ].filter(x => !isNaN(x.m) && !isNaN(x.c) && x.m !== x.c);
  const mainWins = catComps.filter(x => x.lower ? x.m < x.c : x.m > x.c).length;
  const cmpWins  = catComps.filter(x => x.lower ? x.c < x.m : x.c > x.m).length;
  const totalCats = catComps.length;
  const winnerName = mainWins > cmpWins ? mainP.first : cmpWins > mainWins ? cmpP.first : null;
  const winnerColor = mainWins > cmpWins ? '#60a5fa' : 'var(--gold)';
  const tallyHtml = totalCats > 0 ? `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;
                background:rgba(255,255,255,0.03);border:1px solid var(--border);margin-bottom:10px;">
      <span style="font-size:11px;color:var(--text2);">Categories won:</span>
      <span style="color:#60a5fa;font-weight:700;font-size:13px;">${mainWins}</span>
      <span style="color:var(--text2);font-size:11px;">–</span>
      <span style="color:var(--gold);font-weight:700;font-size:13px;">${cmpWins}</span>
      ${winnerName ? `<span style="margin-left:auto;font-size:11px;font-weight:700;color:${winnerColor};">▶ ${winnerName} leads</span>` : `<span style="margin-left:auto;font-size:11px;color:var(--text2);">Tied</span>`}
      <span style="font-size:10px;color:var(--text2);">of ${totalCats}</span>
    </div>` : '';

  const html = `
    <div style="display:flex;gap:8px;align-items:center;margin:12px 0 10px;padding:10px 14px;background:rgba(26,86,219,0.08);border-radius:10px;border:1px solid rgba(96,165,250,0.2);">
      <span style="flex:1;text-align:center;font-weight:700;color:#60a5fa;font-size:14px;">${mainP.first} ${mainP.last}</span>
      <span style="font-size:16px;color:var(--text2);">vs</span>
      <span style="flex:1;text-align:center;font-weight:700;color:var(--gold);font-size:14px;">${cmpP.first} ${cmpP.last}</span>
    </div>
    ${divNote}
    ${tallyHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;padding:0 2px;">
      <div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:6px;">Rate Stats</div>
        ${leftBars}
      </div>
      <div>
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:6px;">Counting Stats</div>
        ${rightBars}
      </div>
    </div>
    ${hasCmpPitch ? `
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#f97316;margin-bottom:6px;">🔥 Pitching</div>
      ${pitchBars}
    </div>` : ''}
    <div style="display:flex;gap:8px;margin:10px 0 14px;">
      <div style="flex:1;background:var(--card);border-radius:8px;padding:8px;text-align:center;">
        <div style="font-size:10px;color:var(--text2);margin-bottom:3px;">Seasons</div>
        <span style="color:#60a5fa;font-weight:700;">${mainRecs.length}</span>
        <span style="color:var(--text2);font-size:12px;"> vs </span>
        <span style="color:var(--gold);font-weight:700;">${cmpRecs.length}</span>
        ${mainRecs.length !== mainRecsAll.length || cmpRecs.length !== cmpRecsAll.length
          ? `<div style="font-size:9px;color:var(--text2);margin-top:2px;">(filtered from ${mainRecsAll.length} & ${cmpRecsAll.length})</div>`
          : ''
        }
      </div>
      <div style="flex:1;background:var(--card);border-radius:8px;padding:8px;text-align:center;">
        <div style="font-size:10px;color:var(--text2);margin-bottom:3px;">AB</div>
        <span style="color:#60a5fa;font-weight:700;">${mainFull.ab}</span>
        <span style="color:var(--text2);font-size:12px;"> vs </span>
        <span style="color:var(--gold);font-weight:700;">${cmpFull.ab}</span>
      </div>
      <div style="flex:1;background:var(--card);border-radius:8px;padding:8px;text-align:center;">
        <div style="font-size:10px;color:var(--text2);margin-bottom:3px;">H</div>
        <span style="color:#60a5fa;font-weight:700;">${mainFull.h}</span>
        <span style="color:var(--text2);font-size:12px;"> vs </span>
        <span style="color:var(--gold);font-weight:700;">${cmpFull.h}</span>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px;">
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;">Season Detail — ${mainP.first} ${mainP.last}</div>
  `;

  const contentEl = document.getElementById('statsModalContent');
  if (contentEl) {
    // Show compare section, then re-render main player stats below
    contentEl.innerHTML = '';
    const cmpDiv = document.createElement('div');
    cmpDiv.id = 'statsComparePanel';
    cmpDiv.innerHTML = html;
    contentEl.appendChild(cmpDiv);
    // Now render main player's season detail into a sub-div
    const detailDiv = document.createElement('div');
    detailDiv.id = 'statsCompareMainDetail';
    contentEl.appendChild(detailDiv);

    // Temporarily redirect render to sub-div
    const origContent = document.getElementById('statsModalContent');
    showPlayerStats(mainP.first, mainP.last, { _compareTarget: detailDiv.id });
  }
}
