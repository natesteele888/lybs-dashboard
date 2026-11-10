
// STATE
let players = JSON.parse(JSON.stringify(INITIAL_DATA));
let sortKey = 'last', sortDir = 1;
let chartInstances = {};
let pendingUploadData = null;
let yoyMode = 'alltime'; // 'alltime' | 'yoy'

// USER_DATA holds cloud-synced per-user settings (positions, preferences etc.)
// Initialised here so it always exists even before cloud login
if (typeof USER_DATA === 'undefined') { var USER_DATA = {}; }
if (!USER_DATA.playerPositions) USER_DATA.playerPositions = {};
if (!USER_DATA.playerActivity)  USER_DATA.playerActivity  = {};
if (!USER_DATA.playerHeadshots) USER_DATA.playerHeadshots = {};

// ── Player headshot helpers ───────────────────────────────────────────────
function headshotKey(p) {
  return `${(p.first||'').toLowerCase()}|${(p.last||'')[0]?.toUpperCase()||''}|${p.sport||''}`;
}
function getHeadshot(p) {
  return (USER_DATA.playerHeadshots || {})[headshotKey(p)] || null;
}
function setHeadshot(p, dataUrl) {
  if (!USER_DATA.playerHeadshots) USER_DATA.playerHeadshots = {};
  USER_DATA.playerHeadshots[headshotKey(p)] = dataUrl;
  saveUserData();
}
function getFullPhoto(p) {
  return (USER_DATA.playerFullPhotos || {})[headshotKey(p)] || null;
}
function setFullPhoto(p, dataUrl) {
  if (!USER_DATA.playerFullPhotos) USER_DATA.playerFullPhotos = {};
  USER_DATA.playerFullPhotos[headshotKey(p)] = dataUrl;
  saveUserData();
}

function uploadHeadshot(playerIdx, file) {
  const p = players[playerIdx];
  if (!p || !file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      // Crop square from center, resize to 200×200
      const size = 200;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      setHeadshot(p, canvas.toDataURL('image/jpeg', 0.85));
      // Refresh any open profile
      if (typeof _buildJourneyContent === 'function' && typeof _msPlayerIdx !== 'undefined' && _msPlayerIdx === playerIdx) {
        showJourney(playerIdx);
      }
      // Refresh draft if open
      if (typeof renderAvailablePlayers === 'function') {
        renderAvailablePlayers();
        renderDraftedPlayers && renderDraftedPlayers();
      }
      toast('✓ Photo saved!');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// Load from sessionStorage — same-tab fast restore only.
// Cloud overrides are loaded in initApp() after login via loadPlayerOverrides().
(function() {
  try {
    const fingerprint = INITIAL_DATA.length + '|' + (INITIAL_DATA[INITIAL_DATA.length-1]?.first||'') + '|' + (INITIAL_DATA[INITIAL_DATA.length-1]?.year||'');
    const stored = sessionStorage.getItem('lll_players');
    const storedFp = sessionStorage.getItem('lll_players_fp');
    if (stored && storedFp === fingerprint) {
      players = JSON.parse(stored);
    } else if (stored && storedFp !== fingerprint) {
      sessionStorage.removeItem('lll_players');
      sessionStorage.removeItem('lll_players_fp');
    }
  } catch(e) {}
})();

// Restore any admin-imported GC stats from localStorage so they survive refresh
(function() {
  try {
    // Try anonymous key first, then fall back to keyed variants
    const keys = Object.keys(localStorage).filter(k => k.includes('gc_stats_extra'));
    keys.forEach(k => {
      const extra = JSON.parse(localStorage.getItem(k) || '[]');
      if (!extra.length) return;
      // Merge: replace same key+year combos, keep the rest
      extra.forEach(entry => {
        const existing = GC_STATS.findIndex(s => s.key === entry.key && s.year === entry.year && s.team === entry.team);
        if (existing >= 0) GC_STATS[existing] = entry;
        else GC_STATS.push(entry);
      });
    });
  } catch(e) {}
})();

function save() {
  try {
    // sessionStorage for fast same-tab reload detection
    sessionStorage.setItem('lll_players', JSON.stringify(players));
    const fingerprint = INITIAL_DATA.length + '|' + (INITIAL_DATA[INITIAL_DATA.length-1]?.first||'') + '|' + (INITIAL_DATA[INITIAL_DATA.length-1]?.year||'');
    sessionStorage.setItem('lll_players_fp', fingerprint);
    // Also persist to localStorage under user namespace so authCloudPush picks it up
    localStorage.setItem(userKey('players_override'), JSON.stringify(players));
  } catch(e) {}
  // Debounced cloud sync — all player changes automatically sync across devices
  clearTimeout(save._cloudTimer);
  save._cloudTimer = setTimeout(authCloudPush, 1500);
}

// Load any player overrides saved by admin edits/registrations
// Called at startup and after cloud restore so edits persist across devices.
// Merges new entries from INITIAL_DATA so hardcoded additions (e.g. a new
// registration added directly to data.js) always appear even on devices
// that have an older cloud snapshot.
function loadPlayerOverrides() {
  try {
    const namespacedKey = userKey('players_override');
    const genericKey = 'lll_players_override';
    const candidates = [];
    [namespacedKey, genericKey].forEach(k => {
      try {
        const s = localStorage.getItem(k);
        if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) candidates.push({key:k, data:a}); }
      } catch(e) {}
    });

    // ── INITIAL_DATA-first merge strategy ────────────────────────────────
    // INITIAL_DATA is the authoritative roster (all registrations live there).
    // The cached override only contributes USER EDITS: team assignments, positions,
    // allstar_years, pitching/catching flags, pids, and eval/journey data.
    // This means new registrations added to data.js always show up immediately,
    // and players removed from data.js (e.g. full-name duplicates) stay gone.
    //
    // User-edit fields we carry over from cache:
    const EDIT_FIELDS = ['team','teamIdx','positions','allstar_years','pitching','catching','pid',
                         'pitching_speed','catching_exp','notes','jersey','gender','allstar_division'];

    // Build a lookup of cached edits keyed by player identity
    const editMap = {};
    if (candidates.length) {
      const best = candidates.reduce((a, b) => a.data.length >= b.data.length ? a : b);
      best.data.forEach(p => {
        // Anonymize full last names in the cache as a safety measure
        const last = (p.last||'').length > 1 ? p.last[0].toUpperCase() : (p.last||'');
        const k = (p.year||0)+'|'+(p.first||'').toLowerCase()+'|'+last.toLowerCase()+'|'+(p.sport||'');
        const edits = {};
        EDIT_FIELDS.forEach(f => {
          if (p[f] !== undefined) {
            // Never let an empty allstar_division from cache overwrite a
            // DOB-computed value in INITIAL_DATA — only carry real overrides
            if (f === 'allstar_division' && !p[f]) return;
            // Never let an empty/blank team from cache overwrite a real team
            // assignment in INITIAL_DATA (e.g. after a draft is saved to data.js)
            if (f === 'team' && !p[f]) return;
            edits[f] = p[f];
          }
        });
        // Keep the richest set of edits if the same key appears multiple times
        if (!editMap[k] || Object.keys(edits).length > Object.keys(editMap[k]).length) {
          editMap[k] = edits;
        }
      });
    }

    // Start from INITIAL_DATA and apply any cached user edits on top
    players = INITIAL_DATA.map(p => {
      const k = (p.year||0)+'|'+(p.first||'').toLowerCase()+'|'+(p.last||'').toLowerCase()+'|'+(p.sport||'');
      const edits = editMap[k];
      return edits ? Object.assign({}, p, edits) : Object.assign({}, p);
    });

    // Persist the cleaned-up merged result so other devices get it
    localStorage.setItem(namespacedKey, JSON.stringify(players));

    ensurePlayerIDs();
  } catch(e) {}
}

// ── Player ID assignment ─────────────────────────────────────────────────
// Assigns a stable numeric pid to every player from 2022 onward.
// IDs are deterministic: sorted by year+sport+last+first then numbered from 10000.
// Once assigned they're stored on the player object and persisted.
function ensurePlayerIDs() {
  const eligible = players.filter(p => (p.year||0) >= 2022);
  let changed = false;

  // Build a stable sort to assign deterministic IDs to new players
  const sorted = [...eligible].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    if (a.sport !== b.sport) return (a.sport||'').localeCompare(b.sport||'');
    if (a.last !== b.last)   return (a.last||'').localeCompare(b.last||'');
    return (a.first||'').localeCompare(b.first||'');
  });

  // Find the max existing pid so we never collide
  const existingIDs = new Set(players.filter(p=>p.pid).map(p=>p.pid));
  let nextId = Math.max(10000, ...Array.from(existingIDs)) + 1;

  // First pass: keep existing IDs, flag unassigned
  sorted.forEach(p => {
    if (!p.pid) {
      p.pid = nextId++;
      changed = true;
    }
  });

  if (changed) save();
  return changed;
}


// changes made on another device show up when you switch back
async function authCloudPull() {
  if (!jbEnabled()) return;
  const u = authCurrentUser();
  if (!u) return;
  try {
    const dir = await jbGetDir();
    const entry = dir.users?.[u.username.toLowerCase()];
    if (!entry?.binId) return;
    const rec = await jbGet(entry.binId);
    if (!rec?.data) return;
    if (rec.dirBinId && !jbDirBin()) localStorage.setItem(JSONBIN_DIR_KEY, rec.dirBinId);
    _restoreUserData(rec.data);
    loadUserData();
    // NOTE: do NOT call loadPlayerOverrides() here — _restoreUserData already
    // applied the cloud players_override directly and is the source of truth on pull.
    // Calling loadPlayerOverrides would risk reverting to a stale local cache.
    _mergeManualIntoGCStats(getAllManualStats());
    if (typeof applyFeatureFlags === 'function') applyFeatureFlags();
    // Apply draft state (pre-assignments, pick history) to the live DRAFT object
    if (typeof loadDraftState === 'function') loadDraftState();
    refreshAll();
    // Re-render draft saved list so imported drafts are visible immediately
    if (typeof renderDraftSavedList === 'function') setTimeout(renderDraftSavedList, 200);
    // Push back immediately so cloud reflects the authoritative local evals state
    setTimeout(authCloudPush, 1500);
  } catch(e) { console.warn('cloud pull failed', e); }
}

// HELPERS
function count(yr, sport) {
  return players.filter(p => (!yr||p.year==yr) && (!sport||p.sport===sport)).length;
}
function countDiv(yr, sport, div) {
  return players.filter(p => (!yr||p.year==yr) && (!sport||p.sport===sport) && p.division===div).length;
}
function revenue(yr, sport) {
  return players.filter(p => (!yr||p.year==yr) && (!sport||p.sport===sport)).reduce((s,p)=>s+(p.amount||0),0);
}
// REVENUE HELPERS
// Returns known revenue for a year (sum of actual amounts)
function revenueKnown(yr, sport) {
  return players.filter(p => (!yr||p.year==yr) && (!sport||p.sport===sport)).reduce((s,p)=>s+(p.amount||0),0);
}

// For years with missing/partial fee data, estimate from median fees per division/sport
// using 2025 as the baseline (most complete year).
function revenueEstimated(yr, sport) {
  // Build median fee table from best available data year (most complete)
  const baseYr = (() => {
    const yrs = years().filter(y => {
      const ps = players.filter(p => p.year===y && (!sport||p.sport===sport));
      const withAmt = ps.filter(p => (p.amount||0) > 0);
      return withAmt.length > ps.length * 0.7; // at least 70% coverage
    });
    return yrs.length ? yrs[yrs.length - 1] : null;
  })();
  if (!baseYr) return 0;

  // Median per (sport, division) bucket
  const buckets = {};
  players.filter(p => p.year===baseYr && (p.amount||0)>0 && (!sport||p.sport===sport)).forEach(p => {
    const k = p.sport+'|'+p.division;
    if (!buckets[k]) buckets[k] = [];
    buckets[k].push(p.amount);
  });
  const median = arr => { const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
  const medians = {};
  Object.entries(buckets).forEach(([k,v]) => medians[k] = median(v));

  // Sport-level fallback medians
  const sportMeds = {};
  players.filter(p => p.year===baseYr && (p.amount||0)>0).forEach(p => {
    if (!sportMeds[p.sport]) sportMeds[p.sport] = [];
    sportMeds[p.sport].push(p.amount);
  });
  const sportMedians = {};
  Object.entries(sportMeds).forEach(([s,v]) => sportMedians[s] = median(v));

  return Math.round(players.filter(p => (!yr||p.year==yr) && (!sport||p.sport===sport)).reduce((sum, p) => {
    const fee = medians[p.sport+'|'+p.division] || sportMedians[p.sport] || 100;
    return sum + fee;
  }, 0));
}

// Returns {value, isEstimated} — real data if >70% players have amounts, otherwise estimated
function revenueSmart(yr, sport) {
  const ps = players.filter(p => (!yr||p.year==yr) && (!sport||p.sport===sport));
  const withAmt = ps.filter(p => (p.amount||0) > 0);
  const coverage = ps.length ? withAmt.length / ps.length : 0;
  if (coverage >= 0.7) return { value: revenueKnown(yr, sport), isEstimated: false };
  return { value: revenueEstimated(yr, sport), isEstimated: true };
}

function delta(v1, v2) {
  if(!v1 || !v2) return '';
  const d = Math.round(v2) - Math.round(v1), pct = Math.round(d/v1*100);
  if(d>0) return `<span class="delta-up">▲ ${d} (+${pct}%)</span>`;
  if(d<0) return `<span class="delta-down">▼ ${Math.abs(d)} (${pct}%)</span>`;
  return `<span class="delta-same">→ No change</span>`;
}
function deltaFmt$(v1, v2) {
  if(!v1 || !v2) return '';
  const d = Math.round(v2) - Math.round(v1), pct = Math.round(d/v1*100);
  if(d>0) return `<span class="delta-up">▲ ${fmt$(d)} (+${pct}%)</span>`;
  if(d<0) return `<span class="delta-down">▼ ${fmt$(Math.abs(d))} (${pct}%)</span>`;
  return `<span class="delta-same">→ No change</span>`;
}
function fmt$(n) { return '$'+Math.round(n).toLocaleString(); }
function years() { return [...new Set(players.map(p=>p.year))].sort(); }
function sportColor(s) {
  if(s==='Baseball') return '#2563eb';
  if(s==='Softball') return '#ec4899';
  if(s==='T-Ball') return '#8b5cf6';
  return '#94a3b8';
}
function divColor(d) {
  const m = {Majors:'#f5a623',Minors:'#10b981',Rookies:'#f97316',Senior:'#ef4444',Majors:'#a78bfa',Minors:'#60a5fa',Farm:'#14b8a6','T-Ball':'#8b5cf6',Unknown:'#475569'};
  return m[d]||'#94a3b8';
}
function destroyChart(id) {
  if(chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}
function mkChart(id, type, labels, datasets, opts={}) {
  destroyChart(id);
  const ctx = document.getElementById(id);
  if(!ctx) return;
  chartInstances[id] = new Chart(ctx, {
    type, data:{labels,datasets},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction: { mode: 'nearest', intersect: false },
      plugins:{
        legend:{labels:{color:'#94a3b8',font:{family:'DM Sans',size:11}},position:'bottom'},
        tooltip:{
          enabled: true,
          backgroundColor: 'rgba(10,20,40,0.92)',
          titleColor: '#f5a623',
          bodyColor: '#e2e8f0',
          padding: 10,
          cornerRadius: 8,
          callbacks:{label:function(c){return ` ${c.dataset.label||c.label}: ${c.raw}`;}}
        }
      },
      scales: type!=='pie'&&type!=='doughnut' ? {
        x:{ticks:{color:'#94a3b8',font:{size:11}},grid:{color:'rgba(255,255,255,0.05)'}},
        y:{ticks:{color:'#94a3b8',font:{size:11}},grid:{color:'rgba(255,255,255,0.07)'},beginAtZero:true}
      } : {},
      onClick: (e, elements) => {
        if (!elements.length) return;
        const el = elements[0];
        const label = labels[el.index] || '';
        const ds = datasets[el.datasetIndex] || datasets[0] || {};
        const val = ds.data?.[el.index] ?? '';
        const dsLabel = ds.label || '';
        // Show mini tooltip popup for mobile
        _chartTap(e.native, dsLabel ? `${label} — ${dsLabel}: ${val}` : `${label}: ${val}`);
      },
      ...opts
    }
  });
  // Make canvas cursor pointer on hover
  ctx.style.cursor = 'pointer';
}

// Patch a manually-created Chart instance with the same click behavior as mkChart
function patchChartClick(chartId, labels, datasets) {
  const instance = chartInstances[chartId];
  if (!instance) return;
  const canvas = document.getElementById(chartId);
  if (canvas) canvas.style.cursor = 'pointer';
  instance.options.onClick = (e, elements) => {
    if (!elements.length) return;
    const el = elements[0];
    const label = (labels || instance.data.labels || [])[el.index] || '';
    const ds = (datasets || instance.data.datasets || [])[el.datasetIndex] || {};
    const val = ds.data?.[el.index] ?? '';
    const dsLabel = ds.label || '';
    _chartTap(e.native, dsLabel ? `${label} — ${dsLabel}: ${val}` : `${label}: ${val}`);
  };
  instance.update('none');
}


function _chartTap(nativeEvent, text) {
  document.getElementById('_ct_tip')?.remove();
  const tip = document.createElement('div');
  tip.id = '_ct_tip';
  tip.textContent = text;
  tip.style.cssText = `
    position:fixed;z-index:9999;background:rgba(10,20,40,.95);color:#f5a623;
    font-family:'DM Sans';font-size:13px;font-weight:700;padding:8px 14px;
    border-radius:10px;border:1px solid rgba(245,166,35,.4);
    pointer-events:none;white-space:nowrap;max-width:calc(100vw - 32px);
    box-shadow:0 4px 20px rgba(0,0,0,.5);
  `;
  const x = nativeEvent ? nativeEvent.clientX : window.innerWidth / 2;
  const y = nativeEvent ? nativeEvent.clientY - 52 : 100;
  document.body.appendChild(tip);
  // Reposition after render so we know actual width
  requestAnimationFrame(() => {
    const w = tip.offsetWidth;
    const clampedX = Math.min(Math.max(x - w/2, 8), window.innerWidth - w - 8);
    tip.style.left = clampedX + 'px';
    tip.style.top  = Math.max(y, 60) + 'px';
  });
  setTimeout(() => tip.remove(), 2600);
}
function toast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show '+type;
  setTimeout(()=>t.className='',3000);
}

// TENURE PERCENTILE
function computeTenurePercentile(firstName, lastName) {
  const myKey = `${firstName}|${lastName}`.toLowerCase();
  const groups = {};
  players.forEach(x => {
    const k = `${x.first}|${x.last}`.toLowerCase();
    if (!groups[k]) groups[k] = new Set();
    groups[k].add(x.year);
  });
  const myCount = (groups[myKey]||new Set()).size;
  const allTenures = Object.values(groups).map(s => s.size);
  const below = allTenures.filter(t => t < myCount).length;
  const pct = Math.round((below / allTenures.length) * 100);
  return { pct, myCount, avgTenure: (allTenures.reduce((a,b)=>a+b,0)/allTenures.length).toFixed(1) };
}

// DIVISION ASSIGNMENT
function assignDivision(sport, dob, seasonYear) {
  if(!dob) return 'Unknown';
  const d = new Date(dob);
  if(isNaN(d)) return 'Unknown';
  const yr = seasonYear || new Date().getFullYear();
  const t = (y,m,dy) => new Date(y,m-1,dy);
  if(sport==='Baseball') {
    if(d>=t(yr-13,5,1)&&d<=t(yr-11,5,1)) return 'Majors';
    if(d>t(yr-11,5,1)&&d<=t(yr-9,5,1))   return 'Minors';
    if(d>t(yr-9,5,1)&&d<=t(yr-7,5,1))    return 'Rookies';
  } else if(sport==='Softball') {
    if(d>=t(yr-16,9,1)&&d<=t(yr-12,8,31)) return '12U';
    if(d>=t(yr-12,9,1)&&d<=t(yr-10,8,31)) return '10U';
    if(d>=t(yr-10,9,1)&&d<=t(yr-7,8,31))  return 'Farm';
    if(d<t(yr-16,9,1)) return 'Senior';
  } else if(sport==='T-Ball') {
    return 'T-Ball';
  }
  return 'Unknown';
}

// Computes all-star eligibility bracket from DOB relative to a given season year.
// Mirrors the Python allstar_bracket() logic in process.py.
// A player qualifies for bracket NU if they are N years old on May 1 of the season year.
function calcAllstarBracket(sport, dob, seasonYear) {
  if (!dob || sport === 'T-Ball') return '';
  let d;
  try { d = new Date(dob); if (isNaN(d)) return ''; } catch(e) { return ''; }
  for (const age of [8, 9, 10, 11, 12]) {
    const oldest  = new Date(seasonYear - age,     4, 1);  // May 1 (month=4)
    const youngest = new Date(seasonYear - age - 1, 4, 2); // May 2
    if (d >= youngest && d <= oldest) return `${age}U`;
  }
  return '';
}

// RETENTION
function retentionKey(p) {
  return `${p.first}|${p.last}|${p.sport}`.toLowerCase();
}

// Player identity key — just name, sport-agnostic — used for cross-sport progression
function playerKey(p) {
  return `${p.first}|${p.last}`.toLowerCase();
}

// Natural progression map: where a player is EXPECTED to go next year
// T-Ball (ages 4-6) → Baseball Rookies or Softball Farm
// Rookies → Minors, Farm → 10U, Minors → Majors, 10U → 12U, 12U → Senior/Majors
const PROGRESSION = {
  'T-Ball':  { nextSport: ['Baseball','Softball'], nextDiv: ['Rookies','Farm'] },
  'Rookies': { nextSport: ['Baseball'],            nextDiv: ['Minors','Rookies'] },
  'Farm':    { nextSport: ['Softball'],            nextDiv: ['Minors','Farm'] },
  'Minors':  { nextSport: ['Baseball'],            nextDiv: ['Majors','Minors'] },
  '10U':     { nextSport: ['Softball'],            nextDiv: ['Majors','Minors'] },
  'Majors':  { nextSport: ['Baseball'],            nextDiv: ['Majors'] },
  '12U':     { nextSport: ['Softball'],            nextDiv: ['Senior','Majors'] },
  'Senior':  { nextSport: ['Softball'],            nextDiv: ['Senior'] },
};

// Returns true if player p (from year Y) is "retained" in nextYearPlayers (year Y+1)
// Counts same sport/division AND natural progressions (e.g. T-Ball → Rookies)
function isRetained(p, nextYearPlayers) {
  const pname = playerKey(p);
  // Check same sport (standard same-sport retention)
  if (nextYearPlayers.some(nx => playerKey(nx) === pname && nx.sport === p.sport)) return true;
  // Check natural progression paths
  const prog = PROGRESSION[p.division];
  if (prog) {
    return nextYearPlayers.some(nx => {
      if (playerKey(nx) !== pname) return false;
      return prog.nextSport.includes(nx.sport) && prog.nextDiv.includes(nx.division);
    });
  }
  return false;
}

// Aged-out: Baseball 12U allstar (graduated out of Little League)
function isAgedOut(p) {
  return p.sport === 'Baseball' && p.allstar_division === '12U';
}

function computeRetention() {
  const yr25 = years()[years().length-2]||2025;
  const yr26 = years()[years().length-1]||2026;
  const p25 = players.filter(p=>p.year===yr25);
  const p26 = players.filter(p=>p.year===yr26);

  const result = {};
  const sports = ['Baseball','Softball','T-Ball'];
  const divMap = {
    Baseball: ['Majors','Minors','Rookies'],
    Softball: ['Senior','Majors','Minors','Farm'],
    'T-Ball': ['T-Ball']
  };

  sports.forEach(s => {
    result[s] = {};
    divMap[s].forEach(d => {
      const all      = p25.filter(p => p.sport===s && p.division===d);
      const agedOut  = all.filter(p => isAgedOut(p));
      const eligible = all.filter(p => !isAgedOut(p));
      const retained = eligible.filter(p => isRetained(p, p26));
      result[s][d] = { total25: all.length, agedOut: agedOut.length, eligible: eligible.length, retained: retained.length };
    });
    const all25    = p25.filter(p => p.sport===s);
    const agedOut  = all25.filter(p => isAgedOut(p));
    const eligible = all25.filter(p => !isAgedOut(p));
    const retained = eligible.filter(p => isRetained(p, p26));
    result[s]._league = { total25: all25.length, agedOut: agedOut.length, eligible: eligible.length, retained: retained.length };
  });

  // Also handle T-Ball players that moved to Baseball/Softball — count them as retained in T-Ball stats
  const tball25  = p25.filter(p => p.sport==='T-Ball');
  const tball25E = tball25.filter(p => !isAgedOut(p));
  if (result['T-Ball']) {
    result['T-Ball']['T-Ball'].retained = tball25E.filter(p => isRetained(p, p26)).length;
    result['T-Ball']['T-Ball'].eligible = tball25E.length;
    result['T-Ball']._league.retained  = tball25E.filter(p => isRetained(p, p26)).length;
    result['T-Ball']._league.eligible  = tball25E.length;
  }

  const all25    = p25;
  const agedOut  = all25.filter(p => isAgedOut(p));
  const eligible = all25.filter(p => !isAgedOut(p));
  const retained = eligible.filter(p => isRetained(p, p26));
  result._league = { total25: all25.length, agedOut: agedOut.length, eligible: eligible.length, retained: retained.length };
  return result;
}

// ALL-STARS ELIGIBILITY
function getAllStarEligible(year) {
  const brackets = ['8U','9U','10U','11U','12U'];
  const result = [];
  for (const sport of ['Baseball','Softball']) {
    for (const bracket of brackets) {
      const eligible = players.filter(p =>
        p.year === year && p.sport === sport && p.allstar_division === bracket
      );
      result.push({ label: bracket + ' ' + sport, sport, bracket, players: eligible });
    }
  }
  return result;
}

// REGISTRATION TRENDS (Overview)
let trendMode = 'count'; // 'count' | 'revenue'

function setTrendMode(mode) {
  trendMode = mode;
  document.getElementById('trendBtn-count').className = 'btn btn-sm ' + (mode==='count' ? 'btn-gold' : 'btn-ghost');
  document.getElementById('trendBtn-revenue').className = 'btn btn-sm ' + (mode==='revenue' ? 'btn-gold' : 'btn-ghost');
  renderRegTrends();
}

function renderRegTrends() {
  const yr = years();
  const sports = ['Baseball','Softball','T-Ball'];
  const colors = ['#2563eb','#ec4899','#8b5cf6'];
  const estNote = document.getElementById('trendEstNote');

  if (trendMode === 'count') {
    if (estNote) estNote.style.display = 'none';
    const datasets = sports.map((s, i) => ({
      label: s,
      data: yr.map(y => count(y, s)),
      borderColor: colors[i],
      backgroundColor: colors[i] + '22',
      pointBackgroundColor: colors[i],
      pointRadius: 5,
      pointHoverRadius: 7,
      fill: true,
      tension: 0.3,
      borderWidth: 2.5
    }));
    destroyChart('regTrendsChart');
    const ctx = document.getElementById('regTrendsChart');
    if (ctx) {
      chartInstances['regTrendsChart'] = new Chart(ctx, {
        type: 'line',
        data: { labels: yr.map(String), datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { family: 'DM Sans', size: 11 } }, position: 'bottom' },
            tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw} players` } }
          },
          scales: {
            x: { ticks: { color:'#94a3b8' }, grid: { color:'rgba(255,255,255,0.05)' } },
            y: { ticks: { color:'#94a3b8' }, grid: { color:'rgba(255,255,255,0.07)' }, beginAtZero: true }
          }
        }
      });
    patchChartClick('regTrendsChart', null, null);
    }
    // Legend: peak / growth
    const legendEl = document.getElementById('regTrendLegend');
    if (legendEl) {
      legendEl.innerHTML = sports.map((s, i) => {
        const vals = yr.map(y => count(y, s));
        const peak = Math.max(...vals);
        const peakYr = yr[vals.indexOf(peak)];
        const latest = vals[vals.length - 1];
        const first = vals[0];
        const growth = first ? Math.round((latest - first) / first * 100) : 0;
        return `<span style="display:flex;align-items:center;gap:5px;padding:4px 10px;background:${colors[i]}18;border-radius:6px;border:1px solid ${colors[i]}44;">
          <span style="width:8px;height:8px;border-radius:50%;background:${colors[i]};flex-shrink:0;"></span>
          <strong style="color:${colors[i]};">${s}</strong>
          <span style="color:var(--text2);">Peak: ${peak} (${peakYr})</span>
          <span style="color:${growth>=0?'var(--green)':'var(--red)'};">${growth>=0?'▲':'▼'}${Math.abs(growth)}% since ${yr[0]}</span>
        </span>`;
      }).join('');
    }
  } else {
    // Revenue mode
    const hasEstimated = yr.some(y => revenueSmart(y).isEstimated);
    if (estNote) estNote.style.display = hasEstimated ? 'block' : 'none';
    const revVals = yr.map(y => revenueSmart(y).value);
    const revEsts = yr.map(y => revenueSmart(y).isEstimated);
    // Split into two datasets: known and estimated (shown differently)
    const knownData  = revVals.map((v, i) => revEsts[i] ? null : v);
    const estData    = revVals.map((v, i) => revEsts[i] ? v : null);
    // Also a faint full line for continuity
    const fullLine   = revVals;

    destroyChart('regTrendsChart');
    const ctx = document.getElementById('regTrendsChart');
    if (ctx) {
      chartInstances['regTrendsChart'] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: yr.map((y, i) => revEsts[i] ? y + ' (est.)' : String(y)),
          datasets: [
            {
              label: 'Revenue (actual)',
              data: knownData,
              borderColor: '#10b981',
              backgroundColor: '#10b98122',
              pointBackgroundColor: yr.map((y, i) => revEsts[i] ? 'transparent' : '#10b981'),
              pointRadius: yr.map((y, i) => revEsts[i] ? 0 : 5),
              pointHoverRadius: 7,
              fill: true,
              tension: 0.3,
              borderWidth: 2.5,
              spanGaps: false
            },
            {
              label: 'Revenue (estimated)',
              data: estData,
              borderColor: '#f5a623',
              backgroundColor: '#f5a62318',
              pointBackgroundColor: '#f5a623',
              pointRadius: yr.map((y, i) => revEsts[i] ? 5 : 0),
              pointHoverRadius: 7,
              borderDash: [5, 4],
              fill: true,
              tension: 0.3,
              borderWidth: 2,
              spanGaps: false
            },
            {
              label: '_connection',
              data: fullLine,
              borderColor: '#94a3b830',
              backgroundColor: 'transparent',
              pointRadius: 0,
              fill: false,
              tension: 0.3,
              borderWidth: 1,
              borderDash: [3, 3]
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: '#94a3b8', font: { family: 'DM Sans', size: 11 },
                filter: item => item.text !== '_connection' },
              position: 'bottom'
            },
            tooltip: {
              callbacks: {
                label: ctx => ctx.dataset.label === '_connection' ? null : ` ${ctx.dataset.label}: ${fmt$(ctx.raw)}`
              },
              filter: item => item.dataset.label !== '_connection'
            }
          },
          scales: {
            x: { ticks: { color:'#94a3b8' }, grid: { color:'rgba(255,255,255,0.05)' } },
            y: {
              ticks: { color:'#94a3b8', callback: v => fmt$(v) },
              grid: { color:'rgba(255,255,255,0.07)' },
              beginAtZero: true
            }
          }
        }
      });
    patchChartClick('regTrendsChart', null, null);
    }
    // Revenue trend legend
    const legendEl = document.getElementById('regTrendLegend');
    if (legendEl) {
      const totalKnown  = revVals.filter((v, i) => !revEsts[i]).reduce((a,b)=>a+b,0);
      const totalEst    = revVals.filter((v, i) => revEsts[i]).reduce((a,b)=>a+b,0);
      const bestYr      = yr[revVals.indexOf(Math.max(...revVals))];
      legendEl.innerHTML = `
        <span style="display:flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(16,185,129,0.1);border-radius:6px;border:1px solid rgba(16,185,129,0.3);">
          <span style="width:8px;height:8px;border-radius:50%;background:#10b981;flex-shrink:0;"></span>
          <strong style="color:#10b981;">Actual</strong>
          <span style="color:var(--text2);">Verified fee data</span>
        </span>
        <span style="display:flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(245,166,35,0.1);border-radius:6px;border:1px solid rgba(245,166,35,0.3);">
          <span style="width:8px;height:8px;border-radius:50%;background:#f5a623;flex-shrink:0;"></span>
          <strong style="color:#f5a623;">Estimated</strong>
          <span style="color:var(--text2);">Based on known fee structure</span>
        </span>
        <span style="display:flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(255,255,255,0.05);border-radius:6px;">
          <span style="color:var(--text2);">Peak year: <strong style="color:var(--text);">${bestYr} (${fmt$(Math.max(...revVals))})</strong></span>
        </span>
      `;
    }
  }
}

// RENDER: OVERVIEW
// ── League Highlights — auto-detects positive milestones ─────────────────
// ── Revenue detail popup with YoY history + early/late breakdown ──────────
const LATE_FEE_AMOUNTS = {
  Baseball: new Set([115, 175, 195]),
  Softball: new Set([115, 175, 195]),
  'T-Ball':  new Set([100])
};
const LATE_FEE = 25;

function showRevenueDetail(sport) {
  const isAll = sport === 'all';
  const title = isAll ? 'League Revenue History' : sport + ' Revenue History';
  const yrs = years().sort();
  const latestYr = yrs[yrs.length - 1];
  const sportColor = {Baseball:'#2563eb', Softball:'#ec4899', 'T-Ball':'#8b5cf6', all:'#10b981'};
  const col = sportColor[sport] || '#10b981';

  // Build year rows
  const rows = yrs.map(yr => {
    const rev = isAll ? revenueSmart(yr).value : revenueSmart(yr, sport).value;
    const isEst = isAll ? revenueSmart(yr).isEstimated : revenueSmart(yr, sport).isEstimated;
    const prev = yrs.indexOf(yr) > 0 ? (isAll ? revenueSmart(yrs[yrs.indexOf(yr)-1]).value : revenueSmart(yrs[yrs.indexOf(yr)-1], sport).value) : null;
    const chg = prev ? rev - prev : null;
    const chgPct = prev ? Math.round(chg / prev * 100) : null;
    const chgHtml = chg !== null
      ? (chg > 0 ? `<span style="color:#10b981;font-size:11px;">▲ ${fmt$(chg)} (+${chgPct}%)</span>`
                 : chg < 0 ? `<span style="color:#ef4444;font-size:11px;">▼ ${fmt$(Math.abs(chg))} (${chgPct}%)</span>`
                 : `<span style="color:var(--text2);font-size:11px;">→ flat</span>`)
      : '';
    const maxRev = Math.max(...yrs.map(y => isAll ? revenueSmart(y).value : revenueSmart(y, sport).value));
    const barW = Math.round(rev / maxRev * 100);
    const isLatest = yr === latestYr;

    // Early/late breakdown for this year (only if we have real data, not estimated)
    let earlyLateHtml = '';
    if (!isEst) {
      const sports = isAll ? ['Baseball','Softball','T-Ball'] : [sport];
      let earlyRev = 0, lateRev = 0, earlyCount = 0, lateCount = 0;
      players.filter(p => p.year === yr && sports.includes(p.sport) && (p.amount||0) > 0).forEach(p => {
        const lateSet = LATE_FEE_AMOUNTS[p.sport];
        if (lateSet && lateSet.has(Math.round(p.amount))) {
          lateRev += p.amount; lateCount++;
        } else {
          earlyRev += p.amount; earlyCount++;
        }
      });
      if (earlyCount + lateCount > 0) {
        earlyLateHtml = `<div style="font-size:10px;color:var(--text2);margin-top:3px;">
          <span style="color:#10b981;">✓ ${earlyCount} early bird ${fmt$(earlyRev)}</span>
          ${lateCount ? `<span style="margin-left:8px;color:#f5a623;">⏰ ${lateCount} late +${fmt$(lateCount*LATE_FEE)} late fees</span>` : ''}
        </div>`;
      }
    }

    return `<div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="min-width:36px;font-family:Bebas Neue;font-size:16px;color:${isLatest?col:'var(--text2)'};">${yr}</div>
        <div style="flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,0.07);">
          <div style="height:100%;width:${barW}%;background:${isLatest?col:'#475569'};border-radius:4px;"></div>
        </div>
        <div style="min-width:70px;text-align:right;font-family:Bebas Neue;font-size:18px;color:${isLatest?col:'var(--text)'};">${fmt$(rev)}</div>
        <div style="min-width:90px;text-align:right;">${chgHtml}</div>
        ${isEst ? `<span style="font-size:9px;background:rgba(245,166,35,0.2);color:var(--gold);border-radius:3px;padding:1px 5px;">est.</span>` : ''}
      </div>
      ${earlyLateHtml}
    </div>`;
  }).join('');

  // Summary stats for latest year with real data
  const latestRev = isAll ? revenueSmart(latestYr).value : revenueSmart(latestYr, sport).value;
  const allTimeMax = Math.max(...yrs.map(y => isAll ? revenueSmart(y).value : revenueSmart(y, sport).value));
  const allTimeMaxYr = yrs.find(y => (isAll ? revenueSmart(y).value : revenueSmart(y, sport).value) === allTimeMax);
  const isRecord = latestYr === allTimeMaxYr;

  openModal('statDetailModal');
  const _sdt = document.getElementById('statDetailTitle'); if (_sdt) _sdt.textContent = title;
  document.getElementById('statDetailContent').innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      <div class="stat-card" style="flex:1;min-width:90px;text-align:center;">
        <div style="font-family:Bebas Neue;font-size:26px;color:${col};">${fmt$(latestRev)}</div>
        <div style="font-size:10px;color:var(--text2);">${latestYr} revenue</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:90px;text-align:center;">
        <div style="font-family:Bebas Neue;font-size:26px;color:${isRecord?'var(--gold)':'var(--text)'};">${fmt$(allTimeMax)}</div>
        <div style="font-size:10px;color:var(--text2);">all-time peak (${allTimeMaxYr})${isRecord?' 🏆':''}</div>
      </div>
    </div>
    <div style="font-family:Bebas Neue;font-size:14px;letter-spacing:.5px;margin-bottom:8px;color:var(--text2);">
      YEAR-OVER-YEAR HISTORY <span style="font-family:'DM Sans';font-size:10px;font-weight:400;">· ✓ early bird · ⏰ late reg</span>
    </div>
    ${rows}`;
}


// ══════════════════════════════════════════════════════════════════════════
// TIMELINE TAB
// ══════════════════════════════════════════════════════════════════════════

const LYBS_CALENDAR = [
  // ── Pre-season ──────────────────────────────────────────────────────────
  { date:'2026-11-15', label:'Board Planning Meeting', cat:'admin', icon:'📋',
    note:'Set budget, fees, and board roles for coming season. Confirm field permits.' },
  { date:'2026-11-20', label:'Super Bowl Squares Fundraiser Announced', cat:'fundraiser', icon:'🏈',
    note:'Launch squares fundraiser. Last year raised ~$1,000+ toward dugout improvements.' },
  // ── Registration ────────────────────────────────────────────────────────
  { date:'2026-12-18', label:'Registration Preview Announced', cat:'registration', icon:'📣',
    note:'Post on Facebook — "Registration opens Jan 9." Drove 665 reach in 2025.' },
  { date:'2026-01-09', label:'Registration Opens', cat:'registration', icon:'🟢',
    note:'2026 registration open. Early bird pricing through March 1.' },
  { date:'2026-01-24', label:'T-Ball Clinic #1', cat:'clinic', icon:'⚾',
    note:'Turkey Hill Elementary Gym, 1:30–2:30pm. Free, no commitment.' },
  { date:'2026-02-08', label:'Softball Clinic #1', cat:'clinic', icon:'🥎',
    note:"Fielder's Choice, Fitchburg. 3:00–5:00pm. $10/session." },
  { date:'2026-02-09', label:'Baseball Clinic #1', cat:'clinic', icon:'⚾',
    note:"Fielder's Choice, Fitchburg. 5:00–8:00pm. $10/session." },
  { date:'2026-02-22', label:'Baseball & Softball Clinic #2', cat:'clinic', icon:'⚾',
    note:"Fielder's Choice. 3:00–7:00pm." },
  { date:'2026-03-01', label:'Early Bird Deadline', cat:'registration', icon:'⏰',
    note:'$25 late fee applied to all registrations after this date. Push hard on social in Feb.' },
  { date:'2026-03-08', label:'T-Ball Clinic #2 + Baseball/Softball Clinic #3', cat:'clinic', icon:'⚾',
    note:'T-Ball: Turkey Hill 12–1pm. Baseball/Softball: Fielders Choice 3–7pm.' },
  { date:'2026-03-15', label:'Baseball & Softball Clinic #4', cat:'clinic', icon:'⚾',
    note:"Fielder's Choice. 3:00–7:00pm. Last clinic before evaluations." },
  { date:'2026-03-20', label:'Registration Closes', cat:'registration', icon:'🔴',
    note:'Final day. No registrations accepted after this date. Send reminder posts.' },
  { date:'2026-03-22', label:'Evaluation Day + Team Placement', cat:'eval', icon:'📊',
    note:"Fielder's Choice 3–7pm. All non-T-Ball players evaluated. Coaches present. Teams assigned after." },
  // ── Season start ────────────────────────────────────────────────────────
  { date:'2026-04-11', label:'Field Cleanup Day', cat:'ops', icon:'🏟️',
    note:'Marshall Park 9am–7pm. Volunteers help prep fields. All hands welcome.' },
  { date:'2026-04-19', label:'Practices Begin', cat:'season', icon:'🏃',
    note:'First week of team practices. Coaches distribute uniforms.' },
  { date:'2026-05-17', label:'Opening Day — Parade, Hit-A-Thon, Pictures', cat:'season', icon:'🎉',
    note:'League-wide celebration. Player parade, Hit-A-Thon fundraiser, team photos, ice cream social.' },
  // ── Active season ────────────────────────────────────────────────────────
  { date:'2026-06-01', label:'Regular Season Peak', cat:'season', icon:'🏆',
    note:'Games in full swing. All-Star selections happen mid-June.' },
  { date:'2026-06-15', label:'All-Star Nominations', cat:'allstar', icon:'⭐',
    note:'Coaches submit all-star nominees. Check eligible players in the All-Stars tab.' },
  { date:'2026-06-28', label:'District Tournament Begins', cat:'season', icon:'🏆',
    note:'Minors, Majors, and Softball playoff/tournament play.' },
  { date:'2026-07-10', label:'Season Ends', cat:'season', icon:'✅',
    note:'Send season feedback survey. Begin planning for fall clinics and next year.' },
  // ── Off-season ────────────────────────────────────────────────────────
  { date:'2026-08-01', label:'⚠️ Post-Season Engagement Gap', cat:'warning', icon:'⚠️',
    note:'Aug–Sep historically zero posts. Consider: fall preview post, player highlight recaps, sponsor thank-yous.' },
  { date:'2026-10-21', label:'Annual Board Meeting', cat:'admin', icon:'📋',
    note:'Library, 7pm. Vote on new board positions. Set agenda for 2027 season planning.' },
  { date:'2026-11-01', label:'Begin 2027 Planning', cat:'admin', icon:'📅',
    note:'Review 2026 registrations, retention, revenue. Set fees and dates for next year.' },
];

const CAT_COLORS = {
  registration:'#f5a623', clinic:'#10b981', eval:'#2563eb', season:'#60a5fa',
  allstar:'#f5a623', fundraiser:'#a78bfa', ops:'#14b8a6', admin:'#475569', warning:'#ef4444'
};

function renderTimeline() {
  const el = document.getElementById('timelineContent');
  if (!el) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayStr = today.toISOString().slice(0,10);

  const events = [...LYBS_CALENDAR].sort((a,b) => a.date.localeCompare(b.date));
  const nextIdx = events.findIndex(e => e.date >= todayStr);

  // Group by month
  const byMonth = {};
  events.forEach((e,i) => {
    const m = e.date.slice(0,7);
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push({...e, idx:i});
  });

  // Upcoming in next 30 days
  const soon = events.filter(e => {
    const diff = (new Date(e.date+'T12:00:00') - today) / 86400000;
    return diff >= 0 && diff <= 30;
  });

  // ── PHASE CONFIG: color-coded season phases ──
  const PHASES = [
    { id:'offseason',    label:'Off-Season',    months:['2026-08','2026-09','2026-10','2026-11'], color:'#475569', bg:'rgba(71,85,105,0.12)',  icon:'🌙' },
    { id:'planning',     label:'Planning',       months:['2026-11','2026-12'],                     color:'#a78bfa', bg:'rgba(167,139,250,0.10)', icon:'📋' },
    { id:'registration', label:'Registration',   months:['2026-01','2026-02','2026-03'],            color:'#f5a623', bg:'rgba(245,166,35,0.10)',  icon:'📝' },
    { id:'preseason',    label:'Pre-Season',     months:['2026-04'],                               color:'#10b981', bg:'rgba(16,185,129,0.10)',  icon:'🌱' },
    { id:'season',       label:'Season',         months:['2026-05','2026-06','2026-07'],            color:'#60a5fa', bg:'rgba(96,165,250,0.10)',  icon:'⚾' },
  ];

  function phaseFor(monthStr) {
    return PHASES.find(p => p.months.includes(monthStr)) || PHASES[0];
  }

  // Month order: season-logical (Nov → Jul)
  const MONTH_ORDER = ['2026-11','2026-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10'];
  const sortedMonths = Object.keys(byMonth).sort((a,b) => {
    const ai = MONTH_ORDER.indexOf(a), bi = MONTH_ORDER.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  let html = '';

  // ════════════════════════════════════════════════════════
  // HERO — season progress arc
  // ════════════════════════════════════════════════════════
  const totalEvts   = events.length;
  const pastEvts    = events.filter(e => e.date < todayStr).length;
  const pct         = Math.round(pastEvts / totalEvts * 100);
  const nextEvt     = nextIdx >= 0 ? events[nextIdx] : null;
  const nextCol     = nextEvt ? (CAT_COLORS[nextEvt.cat] || '#60a5fa') : '#60a5fa';
  const nextDate    = nextEvt ? new Date(nextEvt.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
  const daysToNext  = nextEvt ? Math.round((new Date(nextEvt.date+'T12:00:00') - today) / 86400000) : 0;

  html += `
  <div class="tl-hero">
    <div class="tl-hero-left">
      <div class="tl-hero-label">2026 SEASON PROGRESS</div>
      <div class="tl-hero-pct">${pct}<span class="tl-hero-pct-sym">%</span></div>
      <div class="tl-hero-sub">${pastEvts} of ${totalEvts} milestones complete</div>
      <div class="tl-progress-bar">
        <div class="tl-progress-fill" style="width:${pct}%"></div>
        <div class="tl-progress-dot" style="left:${pct}%"></div>
      </div>
    </div>
    ${nextEvt ? `
    <div class="tl-hero-next" style="border-color:${nextCol}44;background:${nextCol}0d;">
      <div class="tl-hero-next-top">
        <span class="tl-next-badge" style="background:${nextCol}22;color:${nextCol};">NEXT UP</span>
        <span class="tl-next-date" style="color:${nextCol};">${nextDate}</span>
      </div>
      <div class="tl-hero-next-icon">${nextEvt.icon}</div>
      <div class="tl-hero-next-label">${nextEvt.label}</div>
      <div class="tl-hero-next-days" style="color:${nextCol};">
        ${daysToNext === 0 ? 'TODAY' : daysToNext === 1 ? 'Tomorrow' : daysToNext + ' days away'}
      </div>
    </div>` : ''}
  </div>`;

  // ════════════════════════════════════════════════════════
  // COMING UP STRIP (next 30 days)
  // ════════════════════════════════════════════════════════
  if (soon.length) {
    html += `<div class="tl-soon-strip">
      <div class="tl-soon-title">⚡ Next 30 Days</div>
      <div class="tl-soon-scroll">
        ${soon.map(e => {
          const diff = Math.round((new Date(e.date+'T12:00:00') - today) / 86400000);
          const col  = CAT_COLORS[e.cat] || '#60a5fa';
          const dl   = diff === 0 ? 'TODAY' : diff === 1 ? 'Tomorrow' : `In ${diff}d`;
          return `<div class="tl-soon-card" style="border-color:${col}44;background:${col}0d;">
            <div class="tl-soon-badge" style="color:${col};background:${col}1a;">${dl}</div>
            <div class="tl-soon-icon">${e.icon}</div>
            <div class="tl-soon-name">${e.label}</div>
            <div class="tl-soon-dt" style="color:${col};">${new Date(e.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // ════════════════════════════════════════════════════════
  // PHASE LEGEND
  // ════════════════════════════════════════════════════════
  html += `<div class="tl-phase-legend">
    ${PHASES.map(ph => `
      <div class="tl-phase-chip" style="background:${ph.bg};border-color:${ph.color}33;color:${ph.color};">
        ${ph.icon} ${ph.label}
      </div>`).join('')}
  </div>`;

  // ════════════════════════════════════════════════════════
  // MONTH CARDS
  // ════════════════════════════════════════════════════════
  html += `<div class="tl-month-grid">`;

  sortedMonths.forEach(month => {
    const evts      = byMonth[month];
    const phase     = phaseFor(month);
    const mDate     = new Date(month+'-01T12:00:00');
    const mLabel    = mDate.toLocaleString('en-US',{month:'long'});
    const mYear     = mDate.getFullYear();
    const allPast   = evts.every(e => e.date < todayStr);
    const allFuture = evts.every(e => e.date >= todayStr);
    const hasCurrent= evts.some(e => e.date === todayStr);
    const isActive  = !allPast && !allFuture || hasCurrent;
    const monthOpacity = allPast ? '0.55' : '1';

    html += `
    <div class="tl-month-card ${isActive ? 'tl-month-active' : ''}"
         style="opacity:${monthOpacity};border-top:3px solid ${phase.color};">
      <div class="tl-month-header">
        <div class="tl-month-phase-dot" style="background:${phase.color};box-shadow:0 0 6px ${phase.color}66;"></div>
        <div class="tl-month-name">${mLabel}</div>
        <div class="tl-month-year">${mYear}</div>
        ${isActive && !allPast ? `<div class="tl-month-now-pill" style="background:${phase.color}22;color:${phase.color};">NOW</div>` : ''}
        <div class="tl-month-count" style="color:${phase.color};">${evts.length} event${evts.length!==1?'s':''}</div>
      </div>
      <div class="tl-event-list">
        ${evts.map(e => {
          const isPast  = e.date < todayStr;
          const isToday = e.date === todayStr;
          const isNext  = e.idx === nextIdx;
          const col     = isPast ? 'rgba(255,255,255,0.2)' : CAT_COLORS[e.cat] || '#60a5fa';
          const textCol = isPast ? 'var(--text2)' : 'var(--text)';
          const dateFmt = new Date(e.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});

          // KEY events get a banner treatment
          const isKey = ['Opening Day — Parade, Hit-A-Thon, Pictures','Registration Opens','Evaluation Day + Team Placement','District Tournament Begins'].includes(e.label);

          if (isKey && !isPast) {
            return `<div class="tl-event-banner" style="background:${col}15;border-color:${col}44;">
              <div class="tl-event-banner-glow" style="background:${col};"></div>
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:20px;">${e.icon}</span>
                <div style="flex:1;min-width:0;">
                  <div class="tl-event-banner-label" style="color:${col};">${e.label}</div>
                  <div class="tl-event-banner-date" style="color:${col}88;">${dateFmt}</div>
                </div>
                ${isNext ? `<div class="tl-next-tag" style="background:var(--gold);color:var(--navy);">NEXT</div>` : ''}
              </div>
              <div class="tl-event-note">${e.note}</div>
            </div>`;
          }

          return `<div class="tl-event-row ${isNext ? 'tl-event-next' : ''}">
            <div class="tl-event-dot" style="background:${col};${!isPast?`box-shadow:0 0 4px ${col}66;`:''}"></div>
            <div style="flex:1;min-width:0;">
              <div class="tl-event-row-top">
                <span class="tl-event-icon">${e.icon}</span>
                <span class="tl-event-label" style="color:${textCol};">${e.label}</span>
                ${isNext ? `<span class="tl-next-tag" style="background:var(--gold);color:var(--navy);">NEXT</span>` : ''}
                ${isToday ? `<span class="tl-today-tag">TODAY</span>` : ''}
              </div>
              <div class="tl-event-meta">
                <span class="tl-event-date" style="color:${col};">${dateFmt}</span>
                <span class="tl-event-notebody">${e.note}</span>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  });

  html += `</div>`;
  el.innerHTML = html;
}


function renderLeagueHighlights() {
  const el = document.getElementById('leagueHighlights');
  if (!el) return;

  const yr = years();
  const latest = yr[yr.length - 1];
  if (!latest || yr.length < 2) { el.innerHTML = ''; return; }

  const prev = yr[yr.length - 2];
  const allYrs = yr.slice(); // oldest → newest

  // Helper: count for a given year + optional sport
  const c = (y, sport) => sport ? count(y, sport) : count(y);

  // Pre-compute all-time peaks
  const allTimeTotal = Math.max(...allYrs.map(y => c(y)));
  const allTimeBB    = Math.max(...allYrs.map(y => c(y, 'Baseball')));
  const allTimeSB    = Math.max(...allYrs.map(y => c(y, 'Softball')));
  const allTimeTB    = Math.max(...allYrs.map(y => c(y, 'T-Ball')));

  const cur = {
    total: c(latest), bb: c(latest,'Baseball'),
    sb: c(latest,'Softball'), tb: c(latest,'T-Ball')
  };
  const prv = {
    total: c(prev), bb: c(prev,'Baseball'),
    sb: c(prev,'Softball'), tb: c(prev,'T-Ball')
  };

  // Revenue
  const revLatest = revenueSmart(latest).value;
  const allTimeRev = Math.max(...allYrs.map(y => revenueSmart(y).value));

  // Multi-year streak: consecutive years of growth
  const growthStreak = (sport) => {
    let streak = 0;
    for (let i = allYrs.length - 1; i > 0; i--) {
      if (c(allYrs[i], sport) > c(allYrs[i-1], sport)) streak++;
      else break;
    }
    return streak;
  };

  // Find how many years back a sport was last this high
  const yearsSinceHigh = (sport, curVal) => {
    const prevYrs = allYrs.slice(0, -1); // exclude latest
    const higherYrs = prevYrs.filter(y => c(y, sport) >= curVal);
    if (!higherYrs.length) return null; // never been this high → all-time record
    const lastHigher = Math.max(...higherYrs);
    return latest - lastHigher;
  };

  const highlights = [];

  // ── Total registrations ────────────────────────────────────────────────
  if (cur.total >= allTimeTotal) {
    highlights.push({
      icon: '🏆', color: '#f5a623', bold: `All-time record: ${cur.total} players`,
      sub: `Most registrations in league history`
    });
  } else if (cur.total > prv.total) {
    const pct = Math.round((cur.total - prv.total) / prv.total * 100);
    highlights.push({
      icon: '📈', color: '#10b981', bold: `League grew ${pct}% year over year`,
      sub: `${cur.total} players in ${latest} vs ${prv.total} in ${prev}`
    });
  }

  // ── Baseball ──────────────────────────────────────────────────────────
  if (cur.bb >= allTimeBB) {
    highlights.push({
      icon: '⚾', color: '#2563eb', bold: `Record baseball registration: ${cur.bb} players`,
      sub: `Highest baseball enrollment in league history`
    });
  } else if (cur.bb > prv.bb) {
    const yrs = yearsSinceHigh('Baseball', cur.bb);
    const streak = growthStreak('Baseball');
    if (yrs && yrs > 1) {
      highlights.push({
        icon: '⚾', color: '#2563eb', bold: `Highest baseball registration since ${latest - yrs}`,
        sub: `${cur.bb} players — up ${cur.bb - prv.bb} from ${prev}`
      });
    } else if (streak >= 2) {
      highlights.push({
        icon: '⚾', color: '#2563eb', bold: `Baseball growing for ${streak} straight years`,
        sub: `${cur.bb} players in ${latest}, up from ${prv.bb} in ${prev}`
      });
    } else {
      highlights.push({
        icon: '⚾', color: '#2563eb', bold: `Baseball up ${cur.bb - prv.bb} players vs last year`,
        sub: `${cur.bb} players in ${latest}`
      });
    }
  }

  // ── T-Ball ────────────────────────────────────────────────────────────
  if (cur.tb >= allTimeTB) {
    highlights.push({
      icon: '🟡', color: '#8b5cf6', bold: `Record T-Ball season: ${cur.tb} players`,
      sub: `Most T-Ball registrations ever — pipeline is growing`
    });
  } else if (cur.tb > prv.tb) {
    const pct = Math.round((cur.tb - prv.tb) / prv.tb * 100);
    highlights.push({
      icon: '🟡', color: '#8b5cf6', bold: `T-Ball up ${pct}% — strongest pipeline in years`,
      sub: `${cur.tb} players in ${latest} vs ${prv.tb} in ${prev}`
    });
  }

  // ── Softball ──────────────────────────────────────────────────────────
  if (cur.sb >= allTimeSB) {
    highlights.push({
      icon: '🥎', color: '#ec4899', bold: `Record softball registration: ${cur.sb} players`,
      sub: `Highest softball enrollment in league history`
    });
  } else if (cur.sb > prv.sb) {
    highlights.push({
      icon: '🥎', color: '#ec4899', bold: `Softball up ${cur.sb - prv.sb} players`,
      sub: `${cur.sb} players in ${latest}`
    });
  }

  // ── Revenue ───────────────────────────────────────────────────────────
  if (revLatest >= allTimeRev && !revenueSmart(latest).isEstimated) {
    highlights.push({
      icon: '💰', color: '#10b981', bold: `Record revenue: ${fmt$(revLatest)}`,
      sub: `Strongest financial year in league history`
    });
  }

  // ── 2-year growth streak (overall) ───────────────────────────────────
  const totalStreak = growthStreak(null);
  if (totalStreak >= 2 && !highlights.some(h => h.icon === '📈')) {
    highlights.push({
      icon: '📈', color: '#10b981', bold: `${totalStreak} consecutive years of overall growth`,
      sub: `League has grown every year since ${latest - totalStreak}`
    });
  }

  // ── Returning player milestone ────────────────────────────────────────
  const returningCount = players.filter(p => p.year === latest && players.some(x =>
    x.year < latest && x.first === p.first && x.last[0] === p.last[0] && x.sport === p.sport
  )).length;
  if (returningCount > 0) {
    const retPct = Math.round(returningCount / cur.total * 100);
    if (retPct >= 50) {
      highlights.push({
        icon: '🔄', color: '#60a5fa', bold: `${retPct}% of ${latest} players are returning`,
        sub: `${returningCount} of ${cur.total} players have played before — strong retention`
      });
    }
  }

  if (!highlights.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(245,166,35,0.06) 0%,rgba(16,185,129,0.04) 100%);
        border:1px solid rgba(245,166,35,0.2);border-radius:14px;padding:14px 16px;margin-bottom:4px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span style="font-size:15px;">🌟</span>
        <span style="font-family:Bebas Neue;font-size:16px;letter-spacing:1px;color:var(--gold);">
          ${latest} Season Highlights
        </span>
        <span style="font-size:11px;color:var(--text2);margin-left:auto;">${highlights.length} milestone${highlights.length!==1?'s':''}</span>
      </div>
      <!-- Horizontal scroll strip of clickable cards -->
      <div class="highlights-scroll-strip"
           style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none;-webkit-overflow-scrolling:touch;">
        ${highlights.map((h, i) => `
          <div onclick="showHighlightDetail(${i})"
            style="flex:0 0 auto;width:200px;display:flex;flex-direction:column;gap:4px;
              padding:11px 13px;border-radius:10px;cursor:pointer;
              background:${h.color}10;border:1px solid ${h.color}30;
              transition:all .15s;-webkit-tap-highlight-color:transparent;"
            onmouseover="this.style.background='${h.color}20';this.style.transform='translateY(-2px)'"
            onmouseout="this.style.background='${h.color}10';this.style.transform=''">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:20px;line-height:1;">${h.icon}</span>
              <span style="font-size:9px;color:${h.color};opacity:0.6;letter-spacing:.3px;">tap ›</span>
            </div>
            <div style="font-size:12px;font-weight:700;color:${h.color};line-height:1.35;margin-top:2px;">${h.bold}</div>
            <div style="font-size:10px;color:var(--text2);line-height:1.4;">${h.sub}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:9px;color:var(--text3);margin-top:6px;letter-spacing:.3px;display:flex;align-items:center;gap:4px;">
        <span>←</span><span>scroll to see all ${highlights.length} milestone${highlights.length!==1?'s':''}</span>
      </div>
    </div>`;

  window._leagueHighlights = highlights;
  window._leagueHighlightsYear = latest;
}

function buildHighlightDetail(h, latest, prev, cur, prv, allYrs) {
  // Build a mini year-by-year table relevant to each highlight type
  const c = (y, sport) => sport ? count(y, sport) : count(y);
  if (h.icon === '🏆' || h.icon === '📈') {
    return allYrs.slice(-6).map(y => ({ year: y, val: c(y), label: 'Total Players' }));
  } else if (h.icon === '⚾') {
    return allYrs.slice(-6).map(y => ({ year: y, val: c(y,'Baseball'), label: 'Baseball' }));
  } else if (h.icon === '🥎') {
    return allYrs.slice(-6).map(y => ({ year: y, val: c(y,'Softball'), label: 'Softball' }));
  } else if (h.icon === '🟡') {
    return allYrs.slice(-6).map(y => ({ year: y, val: c(y,'T-Ball'), label: 'T-Ball' }));
  } else if (h.icon === '💰') {
    return allYrs.slice(-6).map(y => ({ year: y, val: revenueSmart(y).value, label: 'Revenue', currency: true }));
  } else if (h.icon === '🔄') {
    return null;
  }
  return null;
}

function showHighlightDetail(idx) {
  const h = (window._leagueHighlights || [])[idx];
  if (!h) return;
  const latest = window._leagueHighlightsYear;
  const yr = years();
  const prev = yr[yr.length - 2];
  const allYrs = yr.slice();

  const _sdt = document.getElementById('statDetailTitle');
  if (_sdt) _sdt.innerHTML = `<span style="font-size:20px;margin-right:8px;">${h.icon}</span>${h.bold}`;

  const rows = buildHighlightDetail(h, latest, prev,
    { total: count(latest), bb: count(latest,'Baseball'), sb: count(latest,'Softball'), tb: count(latest,'T-Ball') },
    { total: count(prev), bb: count(prev,'Baseball'), sb: count(prev,'Softball'), tb: count(prev,'T-Ball') },
    allYrs);

  let tableHtml = '';
  if (rows) {
    const isCurrency = rows[0]?.currency;
    tableHtml = `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;border-bottom:1px solid var(--border);">Year</th>
        <th style="text-align:right;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;border-bottom:1px solid var(--border);">${rows[0].label}</th>
        <th style="text-align:right;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;border-bottom:1px solid var(--border);">vs Prior</th>
      </tr></thead><tbody>`;
    rows.forEach((r, i) => {
      const isLatest = r.year === latest;
      const prev2 = i > 0 ? rows[i-1].val : null;
      let chg = '—';
      if (prev2 !== null) {
        const d = r.val - prev2, pct = prev2 ? Math.round(d/prev2*100) : 0;
        if (d > 0) chg = `<span style="color:var(--green);">▲ ${isCurrency?fmt$(d):d} (+${pct}%)</span>`;
        else if (d < 0) chg = `<span style="color:var(--red);">▼ ${isCurrency?fmt$(Math.abs(d)):Math.abs(d)} (${pct}%)</span>`;
        else chg = `<span style="color:var(--text3);">→</span>`;
      }
      tableHtml += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);${isLatest?'background:rgba(255,255,255,0.04);':''}">
        <td style="padding:8px 10px;font-weight:${isLatest?700:400};">${r.year}${isLatest?` <span style="font-size:9px;background:${h.color};color:#000;border-radius:4px;padding:1px 5px;margin-left:4px;font-weight:700;">NOW</span>`:''}</td>
        <td style="padding:8px 10px;text-align:right;font-family:Bebas Neue;font-size:20px;color:${h.color};">${isCurrency?fmt$(r.val):r.val}</td>
        <td style="padding:8px 10px;text-align:right;">${chg}</td>
      </tr>`;
    });
    tableHtml += '</tbody></table>';
  }

  const content = document.getElementById('statDetailContent');
  if (content) content.innerHTML = `
    <div style="padding:4px 0 12px;">
      <div style="font-size:12px;color:var(--text2);line-height:1.6;padding:10px 14px;border-radius:8px;
          background:${h.color}0c;border:1px solid ${h.color}25;margin-bottom:4px;">
        ${h.sub}
      </div>
      ${tableHtml}
    </div>`;

  // Clear the chart and table sections used by showStatDetail so they don't bleed through
  const chartWrap = document.querySelector('#statDetailModal .stat-detail-chart-wrap');
  if (chartWrap) chartWrap.style.display = 'none';
  const tbl = document.getElementById('statDetailTable');
  if (tbl) tbl.innerHTML = '';
  destroyChart('statDetailChart');

  openModal('statDetailModal');
}

function renderOverview() {
  const overviewEl = document.getElementById('overviewStats');
  const revenueEl  = document.getElementById('revenueStats');
  if (!overviewEl && !revenueEl) return; // not on this tab yet
  const yr = years();
  const latestYr = yr[yr.length-1]||2026;
  const prevYr = yr[yr.length-2]||2025;
  const total26 = count(latestYr); const total25 = count(prevYr);
  const bb26 = count(latestYr,'Baseball'); const bb25 = count(prevYr,'Baseball');
  const sb26 = count(latestYr,'Softball'); const sb25 = count(prevYr,'Softball');
  const tb26 = count(latestYr,'T-Ball'); const tb25 = count(prevYr,'T-Ball');
  const rev26Smart = revenueSmart(latestYr);
  const rev26 = rev26Smart.value;
  const rev26Est = rev26Smart.isEstimated;
  const prevRevSmart = revenueSmart(prevYr);
  const prevRevVal = prevRevSmart.value;

  if (overviewEl) overviewEl.innerHTML = `
    <div class="stat-card gold stat-clickable" onclick="showStatDetail('total','Total Players')" title="Click to see trend">
      <div class="stat-card-trend">📈</div>
      <div class="stat-label">Total ${latestYr}</div>
      <div class="stat-value gold">${total26}</div>
      <div class="stat-delta">${delta(total25,total26)} vs ${prevYr}</div>
    </div>
    <div class="stat-card blue stat-clickable" onclick="showStatDetail('baseball','Baseball')" title="Click to see trend">
      <div class="stat-card-trend">📈</div>
      <div class="stat-label">Baseball ${latestYr}</div>
      <div class="stat-value blue">${bb26}</div>
      <div class="stat-delta">${delta(bb25,bb26)} vs ${prevYr}</div>
    </div>
    <div class="stat-card pink stat-clickable" onclick="showStatDetail('softball','Softball')" title="Click to see trend">
      <div class="stat-card-trend">📈</div>
      <div class="stat-label">Softball ${latestYr}</div>
      <div class="stat-value pink">${sb26}</div>
      <div class="stat-delta">${delta(sb25,sb26)} vs ${prevYr}</div>
    </div>
    <div class="stat-card purple stat-clickable" onclick="showStatDetail('tball','T-Ball')" title="Click to see trend">
      <div class="stat-card-trend">📈</div>
      <div class="stat-label">T-Ball ${latestYr}</div>
      <div class="stat-value purple">${tb26}</div>
      <div class="stat-delta">${delta(tb25,tb26)} vs ${prevYr}</div>
    </div>
    <div class="stat-card green stat-clickable" onclick="showStatDetail('revenue','Revenue')" title="Click to see revenue trend">
      <div class="stat-card-trend">📈</div>
      <div class="stat-label">Revenue ${latestYr}${rev26Est?' <span style=\"font-size:10px;background:rgba(245,166,35,0.25);color:var(--gold);border-radius:4px;padding:1px 5px;vertical-align:middle;\">est.</span>':''}</div>
      <div class="stat-value green" style="font-size:30px">${fmt$(rev26)}</div>
      <div class="stat-delta">${deltaFmt$(prevRevVal, rev26)} vs ${prevYr}</div>
    </div>
  `;

  renderLeagueHighlights();

  mkChart('sportPieChart','doughnut',
    ['Baseball','Softball','T-Ball'],
    [{data:[bb26,sb26,tb26],backgroundColor:['#2563eb','#ec4899','#8b5cf6'],borderWidth:2,borderColor:'#0a1628'}],
    {plugins:{legend:{position:'right'}}}
  );
  const divLabels = ['Majors','Minors','Rookies','Senior','Farm','T-Ball'];
  const divSports = {Majors:'Baseball',Minors:'Baseball',Rookies:'Baseball',Senior:'Softball',Farm:'Softball','T-Ball':'T-Ball'};
  const divCounts = divLabels.map(d=>countDiv(latestYr,null,d));
  mkChart('divisionBarChart','bar',divLabels,
    [{data:divCounts,backgroundColor:divLabels.map(divColor),borderRadius:6,label:'Players'}],
    {onClick:(e,els)=>{ if(els[0]){ const d=divLabels[els[0].index]; showDivDetail(divSports[d],d); } },
     onHover:(e,els)=>{ e.native.target.style.cursor=els[0]?'pointer':'default'; }}
  );
  const bbDivs = ['Majors','Minors','Rookies'];
  mkChart('bbDivChart','bar',bbDivs,
    [{data:bbDivs.map(d=>countDiv(latestYr,'Baseball',d)),
      backgroundColor:['#f5a623','#10b981','#f97316'],borderRadius:6,label:'Baseball'}],
    {onClick:(e,els)=>{ if(els[0]) showDivDetail('Baseball',bbDivs[els[0].index]); },
     onHover:(e,els)=>{ e.native.target.style.cursor = els[0] ? 'pointer' : 'default'; }}
  );
  const sbDivs = ['Senior','Majors','Minors','Farm'];
  mkChart('sbDivChart','bar',sbDivs,
    [{data:sbDivs.map(d=>countDiv(latestYr,'Softball',d)),
      backgroundColor:['#ef4444','#a78bfa','#60a5fa','#14b8a6'],borderRadius:6,label:'Softball'}],
    {onClick:(e,els)=>{ if(els[0]) showDivDetail('Softball',sbDivs[els[0].index]); },
     onHover:(e,els)=>{ e.native.target.style.cursor = els[0] ? 'pointer' : 'default'; }}
  );
  const revBB = revenueSmart(latestYr,'Baseball');
  const revSB = revenueSmart(latestYr,'Softball');
  const revTB = revenueSmart(latestYr,'T-Ball');
  const estTag = `<span style="font-size:9px;background:rgba(245,166,35,0.25);color:var(--gold);border-radius:4px;padding:1px 5px;margin-left:4px;vertical-align:middle;">est.</span>`;
  if (revenueEl) revenueEl.innerHTML = `
    <div class="stat-card blue stat-clickable" style="cursor:pointer" onclick="showRevenueDetail('Baseball')">
      <div class="stat-card-trend">📈</div>
      <div class="stat-label">Baseball Revenue${revBB.isEstimated?estTag:''}</div>
      <div class="stat-value blue" style="font-size:26px">${fmt$(revBB.value)}</div>
      <div style="font-size:10px;color:var(--text2)">click for history</div>
    </div>
    <div class="stat-card pink stat-clickable" style="cursor:pointer" onclick="showRevenueDetail('Softball')">
      <div class="stat-card-trend">📈</div>
      <div class="stat-label">Softball Revenue${revSB.isEstimated?estTag:''}</div>
      <div class="stat-value pink" style="font-size:26px">${fmt$(revSB.value)}</div>
      <div style="font-size:10px;color:var(--text2)">click for history</div>
    </div>
    <div class="stat-card purple stat-clickable" style="cursor:pointer" onclick="showRevenueDetail('T-Ball')">
      <div class="stat-card-trend">📈</div>
      <div class="stat-label">T-Ball Revenue${revTB.isEstimated?estTag:''}</div>
      <div class="stat-value purple" style="font-size:26px">${fmt$(revTB.value)}</div>
      <div style="font-size:10px;color:var(--text2)">click for history</div>
    </div>
    <div class="stat-card green stat-clickable" style="cursor:pointer" onclick="showRevenueDetail('all')">
      <div class="stat-card-trend">💰</div>
      <div class="stat-label">League Total${rev26Est?estTag:''}</div>
      <div class="stat-value green" style="font-size:26px">${fmt$(rev26)}</div>
      <div style="font-size:10px;color:var(--text2)">click for history</div>
    </div>
  `;
  renderRegTrends();
}

// STAT DETAIL MODAL
function showStatDetail(metric, label) {
  const yr = years();
  let data, color, isCurrency = false, estimatedYears = [];
  switch(metric) {
    case 'total':    data = yr.map(y=>count(y)); color='#f5a623'; break;
    case 'baseball': data = yr.map(y=>count(y,'Baseball')); color='#2563eb'; break;
    case 'softball': data = yr.map(y=>count(y,'Softball')); color='#ec4899'; break;
    case 'tball':    data = yr.map(y=>count(y,'T-Ball')); color='#8b5cf6'; break;
    case 'revenue':  data = yr.map(y=>revenueSmart(y).value); estimatedYears = yr.map(y=>revenueSmart(y).isEstimated); color='#10b981'; isCurrency=true; break;
    default: return;
  }
  // Division config per sport
  const divConfig = {
    baseball: {sport:'Baseball', divs:['Majors','Minors','Rookies'], colors:['#f5a623','#10b981','#f97316']},
    softball: {sport:'Softball', divs:['Senior','Majors','Minors','Farm'], colors:['#ef4444','#a78bfa','#60a5fa','#14b8a6']},
    tball:    {sport:'T-Ball',   divs:['T-Ball'], colors:['#8b5cf6']},
  };
  document.getElementById('statDetailTitle').textContent = `${label} — Historical Trend`;
  document.getElementById('statDetailContent').innerHTML = '';
  let tableHtml = '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">';
  tableHtml += '<thead><tr><th style="text-align:left;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Year</th><th style="text-align:right;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Value</th><th style="text-align:right;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Change</th></tr></thead><tbody>';
  data.forEach((v, i) => {
    const prev = i > 0 ? data[i-1] : null;
    let changeHtml = '—';
    if (prev !== null) {
      const d = v - prev, pct = prev ? Math.round(d/prev*100) : 0;
      if (d > 0) changeHtml = `<span class="delta-up">▲ ${isCurrency?fmt$(d):d} (+${pct}%)</span>`;
      else if (d < 0) changeHtml = `<span class="delta-down">▼ ${isCurrency?fmt$(Math.abs(d)):Math.abs(d)} (${pct}%)</span>`;
      else changeHtml = `<span class="delta-same">→ No change</span>`;
    }
    const isLatest = i === data.length - 1;
    const isEst = estimatedYears[i] === true;
    tableHtml += `<tr style="border-bottom:1px solid var(--border);${isLatest?'background:rgba(255,255,255,0.04);':''}${isEst?'opacity:0.85;':''}">
      <td style="padding:8px 10px;font-weight:${isLatest?700:400};">${yr[i]}${isLatest?' <span style="font-size:10px;background:var(--gold);color:var(--navy);border-radius:4px;padding:1px 5px;margin-left:6px;">Latest</span>':''}${isEst?' <span style="font-size:10px;background:rgba(245,166,35,0.2);color:var(--gold);border-radius:4px;padding:1px 5px;margin-left:4px;">est.</span>':''}</td>
      <td style="padding:8px 10px;text-align:right;font-family:Bebas Neue;font-size:20px;color:${color};">${isCurrency?fmt$(v):v}</td>
      <td style="padding:8px 10px;text-align:right;">${changeHtml}</td>
    </tr>`;
  });
  tableHtml += '</tbody></table>';
  // Division breakdown section for sport cards
  let divBreakdownHtml = '';
  const divCfg = divConfig[metric];
  if (divCfg) {
    const latestYr = yr[yr.length-1]||2026;
    const prevYr = yr[yr.length-2]||2025;
    divBreakdownHtml = `<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="font-family:Bebas Neue;font-size:16px;letter-spacing:1px;margin-bottom:10px;color:var(--text2);">
        ${latestYr} Division Breakdown — click a division to drill in
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${divCfg.divs.map((d,i) => {
          const cur = countDiv(latestYr, divCfg.sport, d);
          const prev = countDiv(prevYr, divCfg.sport, d);
          const chg = cur - prev;
          const chgHtml = chg > 0 ? `<span class="delta-up">▲${chg}</span>` : chg < 0 ? `<span class="delta-down">▼${Math.abs(chg)}</span>` : `<span class="delta-same">→</span>`;
          const pct = (cur && (countDiv(latestYr, divCfg.sport) || cur)) ? Math.round(cur / count(latestYr, divCfg.sport) * 100) : 0;
          return `<div onclick="closeModal('statDetailModal');showDivDetail('${divCfg.sport}','${d}')"
            style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;background:var(--navy2);border:1px solid var(--border);cursor:pointer;transition:border-color .15s;"
            onmouseover="this.style.borderColor='${divCfg.colors[i]}'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="width:10px;height:10px;border-radius:50%;background:${divCfg.colors[i]};flex-shrink:0;"></div>
            <div style="font-weight:700;min-width:80px;">${d}</div>
            <div style="font-family:Bebas Neue;font-size:22px;color:${divCfg.colors[i]};min-width:40px;">${cur}</div>
            <div style="flex:1;background:rgba(255,255,255,0.06);border-radius:4px;height:6px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${divCfg.colors[i]};border-radius:4px;"></div>
            </div>
            <div style="font-size:12px;color:var(--text2);min-width:30px;text-align:right;">${pct}%</div>
            <div style="font-size:12px;min-width:32px;text-align:right;">${chgHtml}</div>
            <div style="font-size:11px;color:var(--text2);padding:3px 8px;background:rgba(255,255,255,0.07);border-radius:4px;white-space:nowrap;">View →</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }
  document.getElementById('statDetailTable').innerHTML = tableHtml + divBreakdownHtml;
  // Clear highlight-modal content and restore chart area
  const _sdc = document.getElementById('statDetailContent');
  if (_sdc) _sdc.innerHTML = '';
  const _chartWrap = document.querySelector('#statDetailModal .stat-detail-chart-wrap');
  if (_chartWrap) _chartWrap.style.display = '';
  openModal('statDetailModal');
  setTimeout(() => {
    destroyChart('statDetailChart');
    const canvas = document.getElementById('statDetailChart');
    if (canvas) {
      chartInstances['statDetailChart'] = new Chart(canvas, {
        type: 'line',
        data: {
          labels: yr.map(String),
          datasets: [{
            label, data,
            borderColor: color,
            backgroundColor: color + '22',
            pointBackgroundColor: color,
            pointRadius: 5,
            pointHoverRadius: 7,
            fill: true,
            tension: 0.3,
            borderWidth: 2.5
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${label}: ${isCurrency ? fmt$(ctx.raw) : ctx.raw}` } }
          },
          scales: {
            x: { ticks: { color:'#94a3b8' }, grid: { color:'rgba(255,255,255,0.05)' } },
            y: {
              ticks: { color:'#94a3b8', callback: v => isCurrency ? fmt$(v) : v },
              grid: { color:'rgba(255,255,255,0.07)' },
              beginAtZero: true
            }
          }
        }
      });
    patchChartClick('statDetailChart', null, null);
    }
  }, 100);
}

// RENDER: YoY
function setYoyMode(mode) {
  yoyMode = mode;
  document.querySelectorAll('.yoy-sub-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });
  renderYoY();
}

// ── REGISTRATION TIMING ─────────────────────────────────────────────────────
const TIMING_COLORS = {'2021':'#f97316','2022':'#4a9eff','2023':'#f5a623','2024':'#10b981','2025':'#9b7dff','2026':'#2dd4bf'};
const TIMING_D = {
  '2021':{total:209,labels:["Feb 19","Feb 20","Feb 21","Feb 22","Feb 23","Feb 24","Feb 25","Feb 26","Feb 27","Feb 28","Mar 1","Mar 2","Mar 3","Mar 4","Mar 5","Mar 7","Mar 8","Mar 9","Mar 10","Mar 11","Mar 13","Mar 14","Mar 15","Mar 16","Mar 17","Mar 18","Mar 19","Mar 20","Mar 21","Mar 22","Mar 23","Mar 24","Mar 25","Mar 26","Mar 27","Mar 28","Mar 29","Mar 30","Mar 31","Apr 1","Apr 2","Apr 4","Apr 5","Apr 6","Apr 7","Apr 14","Apr 17","Apr 19","Apr 22","Apr 27","Apr 28","May 5","May 7","May 13","May 29","Aug 4"],daily:[3,5,1,3,6,5,7,9,6,7,2,3,5,2,5,5,6,2,2,3,8,1,10,2,8,2,10,2,6,3,2,4,5,5,3,2,3,6,10,3,3,1,2,2,3,4,1,1,1,1,1,1,1,2,1,2],cumPct:[1.4,3.8,4.3,5.7,8.6,11.0,14.4,18.7,21.5,24.9,25.8,27.3,29.7,30.6,33.0,35.4,38.3,39.2,40.2,41.6,45.5,45.9,50.7,51.7,55.5,56.5,61.2,62.2,65.1,66.5,67.5,69.4,71.8,74.2,75.6,76.6,78.0,80.9,85.6,87.1,88.5,89.0,90.0,90.9,92.3,94.3,94.7,95.2,95.7,96.2,96.7,97.1,97.6,98.6,99.0,100.0]},
  '2022':{total:192,labels:["Jan 31","Feb 1","Feb 2","Feb 4","Feb 5","Feb 7","Feb 8","Feb 9","Feb 10","Feb 11","Feb 12","Feb 13","Feb 14","Feb 15","Feb 16","Feb 17","Feb 19","Feb 20","Feb 21","Feb 22","Feb 23","Feb 24","Feb 25","Feb 26","Feb 27","Feb 28","Mar 1","Mar 2","Mar 3","Mar 5","Mar 6","Mar 9","Mar 10","Mar 11","Mar 12","Mar 13","Mar 14","Mar 15","Mar 17","Mar 18","Mar 19","Mar 20","Mar 21","Mar 22","Mar 23","Mar 24","Mar 25","Mar 27","Mar 28","Mar 31","Apr 1","Apr 2","Apr 8","Apr 9","Apr 12","Apr 13","Apr 18","Apr 20","Apr 25","Apr 26","May 11"],daily:[3,4,2,3,7,2,3,2,3,1,5,1,2,3,4,3,4,1,6,4,3,3,2,4,1,8,9,2,5,3,6,4,5,1,2,13,13,2,3,3,1,4,1,2,2,3,1,1,2,3,3,1,1,3,1,2,1,1,2,1,1],cumPct:[1.6,3.6,4.7,6.2,9.9,10.9,12.5,13.5,15.1,15.6,18.2,18.8,19.8,21.4,23.4,25.0,27.1,27.6,30.7,32.8,34.4,35.9,37.0,39.1,39.6,43.8,48.4,49.5,52.1,53.6,56.8,58.9,61.5,62.0,63.0,69.8,76.6,77.6,79.2,80.7,81.2,83.3,83.9,84.9,85.9,87.5,88.0,88.5,89.6,91.1,92.7,93.2,93.8,95.3,95.8,96.9,97.4,97.9,99.0,99.5,100.0]},
  '2023':{total:175,labels:["Feb 7","Feb 8","Feb 9","Feb 10","Feb 11","Feb 12","Feb 13","Feb 14","Feb 15","Feb 17","Feb 18","Feb 20","Feb 21","Feb 23","Feb 24","Feb 25","Feb 26","Feb 27","Feb 28","Mar 1","Mar 2","Mar 3","Mar 4","Mar 5","Mar 6","Mar 7","Mar 8","Mar 9","Mar 10","Mar 11","Mar 12","Mar 13","Mar 14","Mar 15","Mar 16","Mar 17","Mar 18","Mar 19","Mar 20","Mar 24","Mar 25","Mar 26","Mar 28","Mar 30","Apr 1","Apr 3","Apr 4","Apr 5","Apr 7","Apr 8","Apr 11","Apr 12","Apr 15","Apr 16","Apr 26"],daily:[2,2,2,5,17,3,7,4,3,3,8,2,1,3,2,2,2,2,2,3,1,5,1,2,5,9,3,8,3,1,6,2,1,6,3,6,5,1,6,1,3,4,2,1,1,2,1,2,1,2,2,1,1,1,1],cumPct:[1.1,2.3,3.4,6.3,16.0,17.7,21.7,24.0,25.7,27.4,32.0,33.1,33.7,35.4,36.6,37.7,38.9,40.0,41.1,42.9,43.4,46.3,46.9,48.0,50.9,56.0,57.7,62.3,64.0,64.6,68.0,69.1,69.7,73.1,74.9,78.3,81.1,81.7,85.1,85.7,87.4,89.7,90.9,91.4,92.0,93.1,93.7,94.9,95.4,96.6,97.7,98.3,98.9,99.4,100.0]},
  '2024':{total:169,labels:["Jan 13","Jan 14","Jan 16","Jan 17","Jan 19","Jan 21","Jan 23","Jan 24","Jan 26","Jan 27","Jan 28","Jan 29","Jan 30","Jan 31","Feb 1","Feb 2","Feb 4","Feb 5","Feb 6","Feb 7","Feb 9","Feb 10","Feb 13","Feb 14","Feb 15","Feb 17","Feb 18","Feb 19","Feb 20","Feb 21","Feb 22","Feb 23","Feb 24","Feb 25","Feb 26","Feb 27","Feb 28","Feb 29","Mar 1","Mar 2","Mar 3","Mar 4","Mar 5","Mar 6","Mar 7","Mar 8","Mar 9","Mar 10","Mar 11","Mar 12","Mar 13","Mar 14","Mar 15","Mar 16","Mar 17","Mar 18","Mar 20","Mar 21","Mar 24","Apr 1","Apr 12","Apr 21"],daily:[7,3,3,2,1,2,1,2,1,4,4,4,2,2,2,2,2,2,1,2,1,5,2,3,2,1,1,1,4,1,2,1,3,6,1,2,2,3,10,5,1,8,7,2,1,1,2,7,4,2,4,5,4,2,7,1,1,1,1,1,1,1],cumPct:[4.1,5.9,7.7,8.9,9.5,10.7,11.2,12.4,13.0,15.4,17.8,20.1,21.3,22.5,23.7,24.9,26.0,27.2,27.8,29.0,29.6,32.5,33.7,35.5,36.7,37.3,37.9,38.5,40.8,41.4,42.6,43.2,45.0,48.5,49.1,50.3,51.5,53.3,59.2,62.1,62.7,67.5,71.6,72.8,73.4,74.0,75.1,79.3,81.7,82.8,85.2,88.2,90.5,91.7,95.9,96.4,97.0,97.6,98.2,98.8,99.4,100.0]},
  '2025':{total:208,labels:["Jan 10","Jan 11","Jan 13","Jan 14","Jan 15","Jan 16","Jan 17","Jan 18","Jan 19","Jan 21","Jan 22","Jan 23","Jan 24","Jan 25","Jan 26","Jan 27","Jan 28","Jan 30","Feb 1","Feb 2","Feb 3","Feb 4","Feb 5","Feb 6","Feb 7","Feb 8","Feb 9","Feb 10","Feb 11","Feb 14","Feb 15","Feb 18","Feb 19","Feb 20","Feb 22","Feb 24","Feb 25","Feb 26","Feb 27","Feb 28","Mar 1","Mar 2","Mar 3","Mar 4","Mar 5","Mar 6","Mar 7","Mar 9","Mar 10","Mar 11","Mar 12","Mar 13","Mar 14","Mar 15","Mar 16","Mar 17","Mar 18","Mar 20","Mar 21","Mar 22","Mar 23","Mar 24","Mar 26","Mar 27","Apr 2","Apr 9"],daily:[15,4,1,2,3,5,6,1,4,1,6,2,3,4,2,4,2,10,2,3,1,1,4,2,2,1,2,1,3,2,1,1,3,2,1,4,3,5,1,1,6,2,3,1,3,3,1,5,2,2,1,5,3,5,7,3,6,6,3,2,10,1,1,2,1,3],cumPct:[7.2,9.1,9.6,10.6,12.0,14.4,17.3,17.8,19.7,20.2,23.1,24.0,25.5,27.4,28.4,30.3,31.2,36.1,37.0,38.5,38.9,39.4,41.3,42.3,43.3,43.8,44.7,45.2,46.6,47.6,48.1,48.6,50.0,51.0,51.4,53.4,54.8,57.2,57.7,58.2,61.1,62.0,63.5,63.9,65.4,66.8,67.3,69.7,70.7,71.6,72.1,74.5,76.0,78.4,81.7,83.2,86.1,88.9,90.4,91.3,96.2,96.6,97.1,98.1,98.6,100.0]},
  '2026':{total:231,labels:["Dec 16","Dec 17","Jan 6","Jan 8","Jan 9","Jan 10","Jan 11","Jan 12","Jan 13","Jan 14","Jan 15","Jan 16","Jan 17","Jan 19","Jan 20","Jan 21","Jan 22","Jan 23","Jan 24","Jan 26","Jan 27","Jan 28","Jan 29","Jan 30","Jan 31","Feb 1","Feb 2","Feb 3","Feb 4","Feb 5","Feb 6","Feb 7","Feb 8","Feb 9","Feb 10","Feb 12","Feb 13","Feb 14","Feb 16","Feb 18","Feb 19","Feb 20","Feb 21","Feb 22","Feb 23","Feb 24","Feb 25","Feb 26","Feb 27","Feb 28","Mar 1","Mar 2","Mar 3","Mar 4","Mar 5","Mar 8","Mar 10","Mar 11","Mar 13","Mar 14","Mar 15","Mar 16","Mar 18","Mar 19"],daily:[2,2,1,3,16,11,9,3,3,4,2,6,3,2,2,4,6,1,3,4,3,3,4,1,1,3,1,4,3,3,7,2,2,1,5,2,2,2,4,2,6,2,2,2,5,4,6,10,5,11,4,3,1,1,1,5,1,3,1,2,2,2,4,6],cumPct:[0.9,1.7,2.2,3.5,10.4,15.2,19.0,20.3,21.6,23.4,24.2,26.8,28.1,29.0,29.9,31.6,34.2,34.6,35.9,37.7,39.0,40.3,42.0,42.4,42.9,44.2,44.6,46.3,47.6,48.9,51.9,52.8,53.7,54.1,56.3,57.1,58.0,58.9,60.6,61.5,64.1,64.9,65.8,66.7,68.8,70.6,73.2,77.5,79.7,84.4,86.1,87.4,87.9,88.3,88.7,90.9,91.3,92.6,93.1,93.9,94.8,95.7,97.4,100.0]}
};
const TIMING_HD = {
  '2021':[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  '2022':[0,0,0,0,0,0,1,6,7,15,17,10,13,17,15,11,9,13,14,15,17,9,3,0],
  '2023':[1,0,0,0,0,0,2,4,18,17,10,16,13,11,12,9,14,13,5,7,11,3,6,3],
  '2024':[0,0,0,0,0,0,5,9,11,16,14,8,14,13,8,12,8,7,12,10,7,4,5,2],
  '2025':[0,0,0,0,0,0,5,14,16,14,14,10,18,14,9,11,9,9,13,12,7,6,6,0],
  '2026':[0,0,0,0,0,5,10,10,14,21,23,20,13,10,15,17,11,13,17,9,14,4,3,0]
};
const TIMING_HL=['12a','1a','2a','3a','4a','5a','6a','7a','8a','9a','10a','11a','12p','1p','2p','3p','4p','5p','6p','7p','8p','9p','10p','11p'];

let _timingDC = null, _timingHC = null, _timingCumulDrawn = false;

function renderTiming() {
  // Always redraw cumul in case tab width changed; bar charts always fresh
  _drawTimingCumul();
  timingShowD('2026');
  timingShowH('2026');
}

function _timingSetupCanvas(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  // Use offsetHeight (CSS display height) — NOT canvas.height which is already DPR-scaled
  const W = canvas.parentElement.getBoundingClientRect().width || 600;
  const H = canvas.offsetHeight || parseInt(canvas.getAttribute('height')) || 300;
  // Reset canvas to correct physical pixels
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H };
}

function _timingHex2rgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function _drawTimingCumul() {
  const res = _timingSetupCanvas('timingCumulChart');
  if (!res) return;
  const {ctx, W, H} = res;
  const isMobile = W < 500;
  const pad = {l:isMobile?36:44, r:isMobile?8:16, t:44, b:isMobile?26:34};
  const iW = W-pad.l-pad.r, iH = H-pad.t-pad.b;
  ctx.clearRect(0,0,W,H);
  const mo = {Dec:-1,Jan:0,Feb:1,Mar:2,Apr:3,May:4,Aug:7};
  const mDays = [0,31,28,31,30,31,30,31];
  function lToDay(lbl){const[mn,d]=lbl.split(' ');const m=mo[mn];if(m===-1)return-(31-parseInt(d)+1);let day=0;for(let i=0;i<m;i++)day+=mDays[i]||31;return day+parseInt(d)-1;}
  const SD=-16,ED=105,TD=ED-SD;
  function xP(d){return pad.l+(d-SD)/TD*iW;}
  function yP(p){return pad.t+iH-(p/100)*iH;}
  const fs = isMobile?8:9;

  // Grid lines
  ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.lineWidth=1;
  [0,25,50,75,100].forEach(p=>{
    const y=yP(p);
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+iW,y);ctx.stroke();
    ctx.fillStyle='#4a5568';ctx.font=fs+'px monospace';ctx.textAlign='right';
    ctx.fillText(p+'%',pad.l-4,y+3);
  });

  // X axis ticks
  const xTicks = isMobile
    ? [{d:-16,l:'Dec'},{d:0,l:'Jan 1'},{d:9,l:'Jan 9'},{d:31,l:'Feb 1'},{d:59,l:'Mar 1'},{d:90,l:'Apr 1'}]
    : [{d:-16,l:'Dec 16'},{d:0,l:'Jan 1'},{d:9,l:'Jan 9'},{d:31,l:'Feb 1'},{d:44,l:'Feb 14'},{d:59,l:'Mar 1'},{d:74,l:'Mar 15'},{d:90,l:'Apr 1'}];
  ctx.font=fs+'px monospace';ctx.textAlign='center';
  xTicks.forEach(({d,l})=>{
    const x=xP(d);
    ctx.beginPath();ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1;
    ctx.moveTo(x,pad.t);ctx.lineTo(x,pad.t+iH+4);ctx.stroke();
    ctx.fillStyle='#4a5568';ctx.fillText(l,x,pad.t+iH+12);
  });

  // Draw lines — exclude 2019
  ['2021','2022','2023','2024','2025','2026'].forEach(yr=>{
    const d=TIMING_D[yr],col=TIMING_COLORS[yr];
    ctx.beginPath();ctx.strokeStyle=col;ctx.lineWidth=yr==='2026'?3:1.8;
    ctx.setLineDash(yr==='2023'?[4,3]:[]);
    d.labels.forEach((lbl,i)=>{
      const x=xP(lToDay(lbl)),y=yP(d.cumPct[i]);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.stroke();ctx.setLineDash([]);
    if(yr==='2026'){
      d.labels.forEach((lbl,i)=>{
        const x=xP(lToDay(lbl)),y=yP(d.cumPct[i]);
        ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();
      });
    }
  });

  // Social markers — two staggered rows so labels don't overlap
  const allMarkers = [
    {label:'📣 Open!',   day:8,  color:'#f5a623', row:0},
    {label:'🥎 Clinic',  day:24, color:'#10b981', row:1},
    {label:'🏈 SB Sq',   day:25, color:'#60a5fa', row:0},
    {label:'🎟 Clinic',  day:35, color:'#14b8a6', row:1},
    {label:'⏰ 2wks',    day:44, color:'#f97316', row:0},
    {label:'❄63Days',   day:53, color:'#9b7dff', row:1},
    {label:'⏰Last!',    day:58, color:'#ef4444', row:0},
  ];
  const markers = isMobile ? allMarkers.filter(m=>[8,35,44,58].includes(m.day)) : allMarkers;
  const d26=TIMING_D['2026'];
  const ROW_H=14;
  ctx.font='bold '+(isMobile?8:9)+'px sans-serif';

  markers.forEach(({label,day,color,row})=>{
    let bestIdx=0,bestDist=999;
    d26.labels.forEach((lbl,i)=>{const dist=Math.abs(lToDay(lbl)-day);if(dist<bestDist){bestDist=dist;bestIdx=i;}});
    const dataY=yP(d26.cumPct[bestIdx]);
    const labelY = 4 + row*ROW_H;
    const poleTopY = labelY + (isMobile?8:10);

    // Pole from data point up to below label
    ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([3,2]);
    ctx.beginPath();ctx.moveTo(xP(day),dataY);ctx.lineTo(xP(day),poleTopY);ctx.stroke();
    ctx.setLineDash([]);

    // Pill background + text — clamp so it stays within canvas
    const tw=ctx.measureText(label).width;
    const px=3,py=2,lfs=isMobile?8:9;
    const rawX=xP(day);
    const lx=Math.max(pad.l+tw/2+px+2, Math.min(W-pad.r-tw/2-px-2, rawX));
    ctx.fillStyle=color+'33';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(lx-tw/2-px, labelY-py, tw+px*2, lfs+py*2+1, 3);
    else ctx.rect(lx-tw/2-px, labelY-py, tw+px*2, lfs+py*2+1);
    ctx.fill();
    ctx.fillStyle=color;ctx.textAlign='center';
    ctx.fillText(label, lx, labelY+lfs);
  });
}

function _drawTimingBar(canvasId, labels, values, color, everyN) {
  const res = _timingSetupCanvas(canvasId);
  if (!res) return null;
  const {ctx, W, H} = res;
  const pad = {l:38,r:10,t:10,b:34};
  const iW=W-pad.l-pad.r, iH=H-pad.t-pad.b;
  ctx.clearRect(0,0,W,H);
  const maxV=Math.max(...values,1);
  const step=Math.ceil(maxV/4);
  const maxY=step*4;
  const bW=Math.max(2,(iW/labels.length)*0.75);
  function xP(i){return pad.l+(i/(labels.length))*iW;}
  function yP(v){return pad.t+iH-(v/maxY)*iH;}
  ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const v=i*step,y=yP(v);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+iW,y);ctx.stroke();ctx.fillStyle='#4a5568';ctx.font='9px monospace';ctx.textAlign='right';ctx.fillText(v,pad.l-4,y+3);}
  const mx=Math.max(...values);
  values.forEach((v,i)=>{
    const x=xP(i)+iW/(labels.length*2)-bW/2, y=yP(v), bH=iH-(y-pad.t);
    ctx.fillStyle=v===mx?color:_timingHex2rgba(color,0.55);
    const r=Math.min(3,bW/2);
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+bW-r,y);ctx.arcTo(x+bW,y,x+bW,y+r,r);ctx.lineTo(x+bW,y+bH);ctx.lineTo(x,y+bH);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();ctx.fill();
  });
  ctx.fillStyle='#4a5568';ctx.font='9px monospace';ctx.textAlign='center';
  labels.forEach((lbl,i)=>{if(i%everyN===0){ctx.fillText(lbl,xP(i)+iW/(labels.length*2),pad.t+iH+13);}});
  return {ctx,W,H,pad,iW,iH,labels,values};
}

function _timingSetActiveBtn(groupId, yr) {
  document.getElementById(groupId).querySelectorAll('button').forEach(b => {
    const isActive = b.textContent.trim().startsWith(yr.slice(-2) === '21' ? '2021' : yr.slice(-2) === '22' ? '2022' : yr.slice(-2) === '23' ? '2023' : yr.slice(-2) === '24' ? '2024' : yr.slice(-2) === '25' ? '2025' : '2026');
    if (isActive) {
      b.style.background = _timingHex2rgba(TIMING_COLORS[yr], 0.15);
      b.style.borderColor = TIMING_COLORS[yr];
      b.style.color = TIMING_COLORS[yr];
    } else {
      b.style.background = ''; b.style.borderColor = ''; b.style.color = '';
      b.className = 'btn btn-sm btn-ghost';
    }
  });
}

function timingShowD(yr) {
  _timingSetActiveBtn('timingDailyTabs', yr);
  const d=TIMING_D[yr], n=Math.max(1,Math.floor(d.labels.length/12));
  _drawTimingBar('timingDailyChart', d.labels, d.daily, TIMING_COLORS[yr], n);
}

function timingShowH(yr) {
  _timingSetActiveBtn('timingHourTabs', yr);
  const vals=TIMING_HD[yr];
  const hasData=vals.some(v=>v>0);
  const res=_timingSetupCanvas('timingHourChart');
  if (!res) return;
  if (!hasData) {
    const {ctx,W,H}=res;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#4a5568';ctx.font='13px sans-serif';ctx.textAlign='center';
    ctx.fillText('Hour data not available for 2021',W/2,H/2-8);
    ctx.font='11px sans-serif';ctx.fillText('(Date-only timestamps in this export)',W/2,H/2+12);
    return;
  }
  _drawTimingBar('timingHourChart', TIMING_HL, vals, TIMING_COLORS[yr], 3);
}

function renderYoY() {
  const yr = years();
  if (yr.length < 2) {
    const el = document.getElementById('yoyInsights');
    if (el) el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:12px 0;">Not enough years of data yet.</div>';
    return;
  }
  const sports = ['Baseball','Softball','T-Ball'];
  const colors = ['#2563eb','#ec4899','#8b5cf6'];

  if (yoyMode === 'yoy') {
    const latestYr = yr[yr.length-1]||2026;
    const prevYr = yr[yr.length-2]||2025;
    const yoyLabels = [String(prevYr), String(latestYr)];
    mkChart('yoyBarChart','bar', yoyLabels,
      sports.map((s,i) => ({
        label:s, data:[count(prevYr,s), count(latestYr,s)],
        backgroundColor:colors[i]+'99', borderColor:colors[i], borderWidth:2, borderRadius:6
      }))
    );
    const bbDivs = ['Majors','Minors','Rookies'];
    const bbColors = ['#f5a623','#10b981','#f97316'];
    const bbYoyDatasets = bbDivs.map((d,i)=>({ label:d, data:[countDiv(prevYr,'Baseball',d), countDiv(latestYr,'Baseball',d)],
        backgroundColor:bbColors[i]+'99', borderColor:bbColors[i], borderWidth:2, borderRadius:4, stack:'bb' }));
    const bbYoyUnassigned = [prevYr,latestYr].map(y=>Math.max(0,count(y,'Baseball')-bbDivs.reduce((s,d)=>s+countDiv(y,'Baseball',d),0)));
    const bbYoyLabels = [prevYr,latestYr].map(y => bbDivs.every(d=>countDiv(y,'Baseball',d)===0) ? y+' (?)' : String(y));
    if (bbYoyUnassigned.some(v=>v>0)) bbYoyDatasets.push({label:'No Division Data',data:bbYoyUnassigned,backgroundColor:'#2563eb44',borderColor:'#2563eb66',borderWidth:1,borderRadius:4,stack:'bb'});
    mkChart('bbYoyChart','bar', bbYoyLabels, bbYoyDatasets, {
      scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}},
      plugins:{tooltip:{callbacks:{label:ctx=>ctx.dataset.label==='No Division Data'?` ${ctx.raw} players — division breakdown not available`:` ${ctx.dataset.label}: ${ctx.raw}`}}}
    });
    const sbDivs = ['Senior','Majors','Minors','Farm'];
    const sbColors = ['#ef4444','#a78bfa','#60a5fa','#14b8a6'];
    const sbYoyDatasets = sbDivs.map((d,i)=>({ label:d, data:[countDiv(prevYr,'Softball',d), countDiv(latestYr,'Softball',d)],
        backgroundColor:sbColors[i]+'99', borderColor:sbColors[i], borderWidth:2, borderRadius:4, stack:'sb' }));
    const sbYoyUnassigned = [prevYr,latestYr].map(y=>Math.max(0,count(y,'Softball')-sbDivs.reduce((s,d)=>s+countDiv(y,'Softball',d),0)));
    const sbYoyLabels = [prevYr,latestYr].map(y => sbDivs.every(d=>countDiv(y,'Softball',d)===0) ? y+' (?)' : String(y));
    if (sbYoyUnassigned.some(v=>v>0)) sbYoyDatasets.push({label:'No Division Data',data:sbYoyUnassigned,backgroundColor:'#ec489944',borderColor:'#ec489966',borderWidth:1,borderRadius:4,stack:'sb'});
    mkChart('sbYoyChart','bar', sbYoyLabels, sbYoyDatasets, {
      scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}},
      plugins:{tooltip:{callbacks:{label:ctx=>ctx.dataset.label==='No Division Data'?` ${ctx.raw} players — division breakdown not available`:` ${ctx.dataset.label}: ${ctx.raw}`}}}
    });
    mkChart('tbYoyChart','bar', yoyLabels,
      [{label:'T-Ball', data:[count(prevYr,'T-Ball'), count(latestYr,'T-Ball')],
        backgroundColor:'#8b5cf699', borderColor:'#8b5cf6', borderWidth:2, borderRadius:6}]
    );
    const ins = sports.map(s => {
      const v1=count(prevYr,s), v2=count(latestYr,s);
      return {sport:s, v1, v2, chg:v2-v1, pct:v1?Math.round((v2-v1)/v1*100):0};
    });
    document.getElementById('yoyInsights').innerHTML = ins.map(i=>`
      <div>
        <div style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${i.sport} Trend</div>
        <div style="font-family:Bebas Neue;font-size:28px;color:${sportColor(i.sport)}">${i.v2} <span style="font-size:14px;color:${i.chg>=0?'var(--green)':'var(--red)'}"> ${i.chg>=0?'▲':'▼'} ${Math.abs(i.chg)} (${i.pct}%)</span></div>
        <div style="font-size:12px;color:var(--text2)">${prevYr}: ${i.v1} → ${latestYr}: ${i.v2}</div>
      </div>
    `).join('');
  } else {
    // All Time
    mkChart('yoyBarChart','bar',yr.map(String),
      sports.map((s,i)=>({
        label:s, data:yr.map(y=>count(y,s)),
        backgroundColor:colors[i]+'99', borderColor:colors[i], borderWidth:2, borderRadius:6
      }))
    );
    const bbDivs = ['Majors','Minors','Rookies'];
    const bbColors = ['#f5a623','#10b981','#f97316'];
    const bbUnassigned = yr.map(y => Math.max(0, count(y,'Baseball') - bbDivs.reduce((s,d)=>s+countDiv(y,'Baseball',d),0)));
    const bbAllUnknown = yr.map(y => bbDivs.every(d=>countDiv(y,'Baseball',d)===0));
    // Label: mark years with no division data with (?)
    const bbLabels = yr.map((y,i) => bbAllUnknown[i] ? y+' (?)' : String(y));
    const bbDatasets = bbDivs.map((d,i)=>({label:d,data:yr.map(y=>countDiv(y,'Baseball',d)),backgroundColor:bbColors[i]+'99',borderColor:bbColors[i],borderWidth:2,borderRadius:4,stack:'bb'}));
    // Unassigned uses baseball blue so the total height still looks right; clearly labeled
    if (bbUnassigned.some(v=>v>0)) bbDatasets.push({label:'No Division Data',data:bbUnassigned,backgroundColor:'#2563eb44',borderColor:'#2563eb66',borderWidth:1,borderDash:[4,4],borderRadius:4,stack:'bb'});
    mkChart('bbYoyChart','bar', bbLabels, bbDatasets, {
      scales:{ x:{stacked:true, ticks:{color:'#94a3b8'}}, y:{stacked:true,beginAtZero:true} },
      plugins:{ tooltip:{ callbacks:{ label: ctx => {
        if(ctx.dataset.label==='No Division Data') return ` ${ctx.raw} players — division breakdown not available for this year`;
        return ` ${ctx.dataset.label}: ${ctx.raw}`;
      }}}}
    });
    const sbDivs = ['Senior','Majors','Minors','Farm'];
    const sbColors = ['#ef4444','#a78bfa','#60a5fa','#14b8a6'];
    const sbUnassigned = yr.map(y => Math.max(0, count(y,'Softball') - sbDivs.reduce((s,d)=>s+countDiv(y,'Softball',d),0)));
    const sbAllUnknown = yr.map(y => sbDivs.every(d=>countDiv(y,'Softball',d)===0));
    const sbLabels = yr.map((y,i) => sbAllUnknown[i] ? y+' (?)' : String(y));
    const sbDatasets = sbDivs.map((d,i)=>({label:d,data:yr.map(y=>countDiv(y,'Softball',d)),backgroundColor:sbColors[i]+'99',borderColor:sbColors[i],borderWidth:2,borderRadius:4,stack:'sb'}));
    if (sbUnassigned.some(v=>v>0)) sbDatasets.push({label:'No Division Data',data:sbUnassigned,backgroundColor:'#ec489944',borderColor:'#ec489966',borderWidth:1,borderRadius:4,stack:'sb'});
    mkChart('sbYoyChart','bar', sbLabels, sbDatasets, {
      scales:{ x:{stacked:true, ticks:{color:'#94a3b8'}}, y:{stacked:true,beginAtZero:true} },
      plugins:{ tooltip:{ callbacks:{ label: ctx => {
        if(ctx.dataset.label==='No Division Data') return ` ${ctx.raw} players — division breakdown not available for this year`;
        return ` ${ctx.dataset.label}: ${ctx.raw}`;
      }}}}
    });
    mkChart('tbYoyChart','bar',yr.map(String),
      [{label:'T-Ball',data:yr.map(y=>count(y,'T-Ball')),backgroundColor:'#8b5cf699',borderColor:'#8b5cf6',borderWidth:2,borderRadius:6}]
    );
    const ins = [];
    sports.forEach(s=>{
      if(yr.length>=2) {
        const v1=count(yr[yr.length-2],s), v2=count(yr[yr.length-1],s);
        const chg = v2-v1, pct = v1?Math.round(chg/v1*100):0;
        ins.push({sport:s,v1,v2,chg,pct});
      }
    });
    document.getElementById('yoyInsights').innerHTML = ins.map(i=>`
      <div>
        <div style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${i.sport} Trend</div>
        <div style="font-family:Bebas Neue;font-size:28px;color:${sportColor(i.sport)}">${i.v2} <span style="font-size:14px;color:${i.chg>=0?'var(--green)':'var(--red)'}"> ${i.chg>=0?'▲':'▼'} ${Math.abs(i.chg)} (${i.pct}%)</span></div>
        <div style="font-size:12px;color:var(--text2)">${yr[yr.length-2]}: ${i.v1} → ${yr[yr.length-1]}: ${i.v2}</div>
      </div>
    `).join('');
  }
}


// ── HEALTH: DATA HELPERS ─────────────────────────────────────────────────

// Generic player key for year-to-year matching
function playerMatchKey(p) {
  return `${p.first}|${p.last}|${p.sport}`.toLowerCase();
}

// Division targets: [min, target_low, target_high, max_green]
const DIV_TARGETS = {
  Majors:  [15, 20, 30, 35], Minors: [15, 20, 30, 35], Rookies: [15, 20, 32, 38],
  Senior:  [8, 12, 24, 28],  '12U': [8, 12, 22, 26],   '10U': [10, 14, 24, 28],
  Farm:    [10, 14, 24, 28], 'T-Ball': [20, 28, 50, 60],
};

// Build division flow: for each player in (year, sport, div), what happened next year?
// Returns { [fromDiv]: { stayed, promoted, dropped, laterals, total, details:{toDiv:count} } }
function computeDivisionFlow(sport, fromYear) {
  const toYear = fromYear + 1;
  const byKey = {};
  players.filter(p => p.year === toYear).forEach(p => {
    byKey[playerMatchKey(p)] = p.division;
  });

  const divs = sport === 'Baseball'  ? ['Majors','Minors','Rookies','Unknown'] :
               sport === 'Softball'  ? ['Senior','Majors','Minors','Farm','Unknown'] : ['T-Ball'];
  const bbOrder = ['Majors','Minors','Rookies','Unknown'];
  const sbOrder = ['Senior','Majors','Minors','Farm','Unknown'];
  const order   = sport === 'Baseball' ? bbOrder : sbOrder;

  const result = {};
  players.filter(p => p.year === fromYear && p.sport === sport && p.division !== 'Unknown').forEach(p => {
    const fromDiv = p.division;
    const key = playerMatchKey(p);
    const toDiv = byKey[key] || null;
    if (!result[fromDiv]) result[fromDiv] = { total: 0, returned: 0, dropped: 0, toDiv: {} };
    result[fromDiv].total++;
    if (toDiv) {
      result[fromDiv].returned++;
      result[fromDiv].toDiv[toDiv] = (result[fromDiv].toDiv[toDiv] || 0) + 1;
    } else {
      result[fromDiv].dropped++;
    }
  });
  return result;
}

// Cohort survival: for players first seen in entryYear, what % are still active in each subsequent year
function computeCohortSurvival(sport) {
  const allYears = years();
  // Build first-seen year per player+sport
  const firstSeen = {};
  players.filter(p => p.sport === sport).forEach(p => {
    const k = playerMatchKey(p);
    if (!firstSeen[k] || p.year < firstSeen[k]) firstSeen[k] = p.year;
  });
  // Group by first-seen year
  const cohorts = {};
  Object.entries(firstSeen).forEach(([k, y]) => {
    if (!cohorts[y]) cohorts[y] = new Set();
    cohorts[y].add(k);
  });
  // For each cohort, compute survival at each year
  const result = {};
  Object.entries(cohorts).forEach(([entryYr, members]) => {
    const yr = parseInt(entryYr);
    result[yr] = { size: members.size, rates: {} };
    const byYear = {};
    players.filter(p => p.sport === sport).forEach(p => {
      const k = playerMatchKey(p);
      if (members.has(k)) {
        if (!byYear[p.year]) byYear[p.year] = 0;
        byYear[p.year]++;
      }
    });
    allYears.filter(y => y >= yr).forEach(y => {
      result[yr].rates[y] = Math.round(((byYear[y] || 0) / members.size) * 100);
    });
  });
  return result;
}

// T-Ball pipeline: year-by-year graduation to baseball/softball
function computeTballPipeline() {
  const allYrs = years();
  const result = [];
  for (let i = 0; i < allYrs.length - 1; i++) {
    const y1 = allYrs[i], y2 = allYrs[i + 1];
    const tbPlayers = players.filter(p => p.year === y1 && p.sport === 'T-Ball');
    const nextYrKeys = {};
    players.filter(p => p.year === y2).forEach(p => nextYrKeys[playerMatchKey(p)] = p.sport);
    let stayedTball = 0, movedBB = 0, movedSB = 0, dropped = 0;
    tbPlayers.forEach(p => {
      const k = playerMatchKey({ first: p.first, last: p.last, sport: p.sport });
      const nextKey = `${p.first}|${p.last}|baseball`.toLowerCase();
      const nextKeySB = `${p.first}|${p.last}|softball`.toLowerCase();
      const nextKeyTB = playerMatchKey(p);
      if (nextYrKeys[nextKey] === 'Baseball') movedBB++;
      else if (nextYrKeys[nextKeySB] === 'Softball') movedSB++;
      else if (nextYrKeys[nextKeyTB] === 'T-Ball') stayedTball++;
      else dropped++;
    });
    result.push({ year: y1, total: tbPlayers.length, stayedTball, movedBB, movedSB, dropped,
      gradRate: tbPlayers.length ? Math.round((movedBB + movedSB) / tbPlayers.length * 100) : 0 });
  }
  return result;
}

// At-risk: divisions with historically high churn in current roster
function computeAtRisk() {
  const latestYr = years()[years().length - 1] || 2026;
  const prevYr   = years()[years().length - 2] || 2025;
  const allYrs   = years();
  const alerts   = [];

  // Compute avg retention per division over all year pairs
  const highChurnDivs = [
    { sport: 'Baseball', div: 'Majors',  threshold: 55, reason: 'Kids aging out of youth baseball' },
    { sport: 'Softball', div: 'Senior',  threshold: 50, reason: 'Top division — players graduating high school' },
    { sport: 'Softball', div: 'Majors',  threshold: 50, reason: 'Transition to competitive softball (12U)' },
  ];

  highChurnDivs.forEach(({ sport, div, threshold, reason }) => {
    const current = players.filter(p => p.year === latestYr && p.sport === sport && p.division === div);
    if (!current.length) return;

    // Historical churn rates for this division
    const rates = [];
    for (let i = 0; i < allYrs.length - 1; i++) {
      const y1 = allYrs[i], y2 = allYrs[i + 1];
      const inDiv = players.filter(p => p.year === y1 && p.sport === sport && p.division === div);
      if (!inDiv.length) continue;
      const nextNameKeys = new Set(players.filter(p => p.year === y2).map(p => playerKey(p)));
      const ret = inDiv.filter(p => nextNameKeys.has(playerKey(p))).length;
      rates.push(Math.round(ret / inDiv.length * 100));
    }
    const avgRet = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;

    if (avgRet < threshold) {
      alerts.push({
        sport, div,
        currentCount: current.length,
        avgRetention: avgRet,
        projectedReturn: Math.round(current.length * avgRet / 100),
        reason,
        severity: avgRet < 40 ? 'high' : 'medium',
      });
    }
  });

  // One-and-done risk: flag if last year was first year for many players
  ['Baseball', 'Softball', 'T-Ball'].forEach(sport => {
    const curr = players.filter(p => p.year === latestYr && p.sport === sport);
    const firstTimers = curr.filter(p => {
      const k = playerMatchKey(p);
      return !players.some(x => x.year < latestYr && playerMatchKey(x) === k);
    });
    const pct = curr.length ? Math.round(firstTimers.length / curr.length * 100) : 0;
    if (pct > 45) {
      alerts.push({
        sport, div: 'League-wide',
        currentCount: firstTimers.length,
        avgRetention: 100 - pct,
        projectedReturn: null,
        reason: `${pct}% of current ${sport} players are first-timers — historically ~45% won't return`,
        severity: pct > 55 ? 'high' : 'medium',
      });
    }
  });

  return alerts;
}

// RENDER: HEALTH
let survSport = 'Baseball';
function setSurvSport(s) {
  survSport = s;
  ['Baseball','Softball','T-Ball'].forEach(x => {
    const btn = document.getElementById('survBtn-'+x);
    if(btn) btn.className = 'btn btn-sm ' + (x===s ? 'btn-gold' : 'btn-ghost');
  });
  renderSurvivalChart();
}

// ── League Intelligence — derived metrics from player data ─────────────────
function renderLeagueIntel() {
  const el = document.getElementById('leagueIntelCard');
  if (!el) return;

  const allYrs = years().sort((a,b)=>a-b);
  const latestYr = allYrs[allYrs.length-1] || 2026;
  const latestPlayers = players.filter(p => p.year === latestYr);
  if (!latestPlayers.length) { el.innerHTML=''; return; }

  // ── 1. Town Reach ─────────────────────────────────────────────────────
  const cityMap = {};
  latestPlayers.forEach(p => {
    const c = (p.city||'').replace(/[,\s]+$/,'').trim().split(/\s+/)[0] || 'Unknown';
    cityMap[c] = (cityMap[c]||0) + 1;
  });
  const topCities = Object.entries(cityMap).sort((a,b)=>b[1]-a[1]);
  const totalWithCity = Object.values(cityMap).reduce((s,v)=>s+v, 0);
  const homePct = Math.round((cityMap['Lunenburg']||0) / totalWithCity * 100);
  const cityCount = Object.keys(cityMap).length;

  // ── 2. Family Fingerprint ─────────────────────────────────────────────
  const famMap = {};
  latestPlayers.forEach(p => {
    const city = (p.city||'').replace(/[,\s]+$/,'').trim().split(/\s+/)[0] || '?';
    const key = (p.last||'?') + '|' + city;
    if (!famMap[key]) famMap[key] = new Set();
    famMap[key].add(p.first + '|' + p.sport);
  });
  const multiFamilies = Object.values(famMap).filter(s => s.size >= 2).length;
  const bigFamilies   = Object.values(famMap).filter(s => s.size >= 3).length;
  // Estimate unique players accounted for by multi-registrant families
  const famPlayerCount = Object.values(famMap)
    .filter(s => s.size >= 2)
    .reduce((s, set) => s + set.size, 0);

  // ── 3. Cross-sport players ────────────────────────────────────────────
  // Include city in the key to avoid false positives when two different families
  // share the same first name and last initial (e.g. two players with the same first name and initial from different cities)
  const bbPlayers = latestPlayers.filter(p=>p.sport==='Baseball');
  const sbPlayers = latestPlayers.filter(p=>p.sport==='Softball');
  const bbKeys = new Set(bbPlayers.map(p=>`${p.first}|${(p.last||'')[0]||''}|${(p.city||'').toLowerCase()}`));
  const sbKeys = new Set(sbPlayers.map(p=>`${p.first}|${(p.last||'')[0]||''}|${(p.city||'').toLowerCase()}`));
  const crossSport = [...bbKeys].filter(k => sbKeys.has(k));

  // ── 4. Player Lifetime Value ──────────────────────────────────────────
  const plvMap = {};
  players.filter(p=>p.amount>0).forEach(p => {
    const k = `${p.first}|${p.last}|${p.sport}`;
    if (!plvMap[k]) plvMap[k] = { fees:0, years:new Set() };
    plvMap[k].fees += p.amount;
    plvMap[k].years.add(p.year);
  });
  const loyal3 = Object.values(plvMap).filter(x => x.years.size >= 3);
  const loyal5 = Object.values(plvMap).filter(x => x.years.size >= 5);
  const avgLTV3 = loyal3.length ? Math.round(loyal3.reduce((s,x)=>s+x.fees,0)/loyal3.length) : 0;
  const maxLTV  = plvMap ? Math.round(Math.max(...Object.values(plvMap).map(x=>x.fees))) : 0;

  // ── 5. Geographic growth (2 most recent years) ───────────────────────
  let geoGrowth = '';
  if (allYrs.length >= 2) {
    const prevYr = allYrs[allYrs.length-2];
    const prevCityMap = {};
    players.filter(p=>p.year===prevYr).forEach(p => {
      const c = (p.city||'').replace(/[,\s]+$/,'').trim().split(/\s+/)[0];
      if (c) prevCityMap[c] = (prevCityMap[c]||0) + 1;
    });
    const cityGrowth = topCities.slice(0,6).map(([city, cur]) => {
      const prev = prevCityMap[city] || 0;
      const diff = cur - prev;
      return { city, cur, prev, diff };
    }).filter(x => x.city !== 'Unknown');
    geoGrowth = cityGrowth.map(({ city, cur, diff }) => {
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
      const col = diff > 0 ? '#10b981' : diff < 0 ? '#ef4444' : 'var(--text2)';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);">
        <span style="flex:1;font-size:12px;">${city}</span>
        <span style="font-size:11px;color:var(--text2);">${cur} players</span>
        <span style="font-size:11px;font-weight:700;color:${col};min-width:30px;text-align:right;">${arrow}${Math.abs(diff)||''}</span>
      </div>`;
    }).join('');
  }

  // ── Build card HTML ───────────────────────────────────────────────────
  const statCard = (icon, label, value, sub, col='var(--gold)') =>
    `<div class="stat-card" style="cursor:default;">
      <div class="stat-label">${icon} ${label}</div>
      <div class="stat-value" style="font-size:28px;color:${col};">${value}</div>
      ${sub?`<div class="stat-delta" style="color:var(--text2);">${sub}</div>`:''}
    </div>`;

  el.innerHTML = `
    <div class="card-title">🔬 League <span class="accent">Intelligence</span>
      <span style="font-size:11px;color:var(--text2);font-weight:400;margin-left:8px;">${latestYr} season · derived from ${latestPlayers.length} registrations</span>
    </div>
    <div class="stat-grid" style="margin-bottom:16px;">
      ${statCard('🏘️','Towns Served', cityCount, `${homePct}% from Lunenburg`, '#60a5fa')}
      ${statCard('👨‍👩‍👧', 'Families', multiFamilies+'+ households',
        bigFamilies ? `${bigFamilies} with 3+ registrations` : `${famPlayerCount} players in multi-reg families`, '#ec4899')}
      ${statCard('⚾🥎','Cross-Sport', crossSport.length, `play both baseball &amp; softball`, '#8b5cf6')}
      ${statCard('💰','Avg 3-Yr LTV', '$'+avgLTV3, `${loyal3.length} players · max $${maxLTV}`, '#10b981')}
    </div>
    ${geoGrowth ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">📍 Town Reach vs Last Year</div>
        ${geoGrowth}
      </div>
      <div>
        <div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">👨‍👩‍👧 Family Breakdown</div>
        ${Object.entries(famMap).filter(([,s])=>s.size>=2).sort((a,b)=>b[1].size-a[1].size).slice(0,6).map(([key,set])=>{
          const [last, city] = key.split('|');
          return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);">
            <span style="flex:1;font-size:12px;">${last} (${city})</span>
            <span style="font-size:11px;font-weight:700;color:#ec4899;">${set.size} players</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}`;
}


function renderHealth() {
  renderLeagueIntel();
  const ret       = computeRetention();
  const latestYr  = years()[years().length-1]||2026;
  const prevYr    = years()[years().length-2]||2025;
  const lg        = ret._league||{};

  // ── 1. Health Actions — compact action items + at-risk ───────────────
  const alerts = computeAtRisk();
  const actEl  = document.getElementById('healthActions');
  if (actEl) {
    const latestYr = years()[years().length-1]||2026;
    const prevYr   = years()[years().length-2]||2025;
    const overallRet = ret._league||{};
    const retPct  = overallRet.eligible ? Math.round(overallRet.retained/overallRet.eligible*100) : 0;
    const grade   = retPct>=80?{g:'A',col:'#10b981'}:retPct>=65?{g:'B',col:'var(--gold)'}:retPct>=50?{g:'C',col:'#f97316'}:{g:'D',col:'#ef4444'};

    // Action items
    const actionItems = [];
    alerts.forEach(a => {
      actionItems.push({
        icon: a.severity==='high'?'🔴':'⚠️',
        col: a.severity==='high'?'#ef4444':'#f5a623',
        text: a.sport + ' ' + a.div + ': ' + a.reason,
        sub: 'Avg retention ' + a.avgRetention + '%' + (a.projectedReturn!==null ? ' · projected ~' + a.projectedReturn + ' returning' : '')
      });
    });
    if (retPct < 65) {
      actionItems.push({icon:'📣',col:'#f5a623',text:'Overall retention is ' + retPct + '% — below healthy threshold',sub:'Focus on re-engagement emails and early registration reminders'});
    }
    const tenureMap = {};
    players.forEach(p => {
      const k = playerMatchKey ? playerMatchKey(p) : p.first+'|'+p.last[0];
      if(!tenureMap[k]) tenureMap[k] = new Set();
      tenureMap[k].add(p.year);
    });
    const oneAndDone = Object.values(tenureMap).filter(s=>s.size===1).length;
    const oneAndDonePct = Math.round(oneAndDone/Object.keys(tenureMap).length*100);
    if (oneAndDonePct > 30) {
      actionItems.push({icon:'💡',col:'#60a5fa',text:oneAndDonePct + '% of players only registered once',sub:'Consider follow-up emails or early-season outreach to first-year families'});
    }

    const summaryHtml = '<div style="display:flex;align-items:center;gap:16px;padding:12px 16px;' +
      'background:' + grade.col + '10;border-radius:10px;border:1px solid ' + grade.col + '30;margin-bottom:12px;">' +
      '<div style="text-align:center;flex-shrink:0;">' +
        '<div style="font-family:Bebas Neue;font-size:40px;line-height:1;color:' + grade.col + ';">' + grade.g + '</div>' +
        '<div style="font-size:10px;color:var(--text2);">Health Grade</div>' +
      '</div>' +
      '<div style="flex:1;">' +
        '<div style="font-size:13px;font-weight:700;margin-bottom:2px;">' +
          'Overall retention ' + retPct + '% — ' + overallRet.retained + ' of ' + overallRet.eligible + ' eligible players returned' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text2);">' + prevYr + ' → ' + latestYr + ' · aged-out players excluded from eligible count</div>' +
      '</div>' +
    '</div>';

    const actionsHtml = actionItems.length
      ? '<div style="display:flex;flex-direction:column;gap:7px;margin-bottom:4px;">' +
          actionItems.map(a =>
            '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border-radius:8px;' +
            'background:' + a.col + '0d;border:1px solid ' + a.col + '25;">' +
            '<span style="font-size:15px;flex-shrink:0;">' + a.icon + '</span>' +
            '<div><div style="font-size:12px;font-weight:700;color:' + a.col + ';">' + a.text + '</div>' +
            '<div style="font-size:11px;color:var(--text2);margin-top:1px;">' + a.sub + '</div></div>' +
            '</div>'
          ).join('') +
        '</div>'
      : '<div style="font-size:12px;color:#10b981;padding:8px 0;">✓ No critical issues detected</div>';

    actEl.innerHTML = '<div class="card" style="margin-bottom:14px;">' +
      '<div style="font-family:Bebas Neue;font-size:18px;letter-spacing:1px;margin-bottom:12px;">' +
      '⚡ League Health <span style="color:var(--gold);">Overview</span></div>' +
      summaryHtml + actionsHtml + '</div>';
  }

  // ── 2. Retention table ────────────────────────────────────────────────
  const sports  = ['Baseball','Softball'];
  const divMap  = {Baseball:['Majors','Minors','Rookies'],Softball:['Senior','Majors','Minors','Farm']};
  let html = `<div style="overflow-x:auto;"><table class="ret-table"><thead><tr>
    <th>Sport / Division</th><th>${prevYr} Total</th><th>Aged Out</th>
    <th>Eligible</th><th>Returning ${latestYr}</th><th>Retention</th><th>New ${latestYr}</th>
  </tr></thead><tbody>`;
  sports.forEach(s => {
    const ld = ret[s]?._league||{};
    const adjPct = ld.eligible ? Math.round(ld.retained/ld.eligible*100) : 0;
    html += `<tr style="background:rgba(255,255,255,0.04);">
      <td><strong>${s}</strong></td>
      <td><span class="ret-num">${ld.total25||0}</span></td>
      <td><span style="color:var(--gold);font-size:12px;">${ld.agedOut||0}</span></td>
      <td><span class="ret-num">${ld.eligible||0}</span></td>
      <td><span class="ret-num">${ld.retained||0}</span></td>
      <td>${bar(adjPct)}</td>
      <td>${count(latestYr,s)-(ld.retained||0)}</td>
    </tr>`;
    (divMap[s]||[]).forEach(d => {
      const dd = ret[s]?.[d]||{};
      const adjPctD = dd.eligible ? Math.round(dd.retained/dd.eligible*100) : 0;
      const new26d  = countDiv(latestYr,s,d);
      html += `<tr>
        <td style="padding-left:24px;color:var(--text2);">${d}</td>
        <td>${dd.total25||0}</td>
        <td style="color:var(--gold);font-size:12px;">${dd.agedOut||0}</td>
        <td>${dd.eligible||0}</td>
        <td>${dd.retained||0}</td>
        <td>${bar(adjPctD)}</td>
        <td>${new26d-(dd.retained||0)}</td>
      </tr>`;
    });
  });
  const tb = ret['T-Ball']?._league||{};
  const tbPct = tb.eligible ? Math.round(tb.retained/tb.eligible*100) : 0;
  html += `<tr style="background:rgba(255,255,255,0.04);">
    <td><strong>T-Ball</strong></td>
    <td><span class="ret-num">${tb.total25||0}</span></td>
    <td style="color:var(--gold);font-size:12px;">${tb.agedOut||0}</td>
    <td><span class="ret-num">${tb.eligible||0}</span></td>
    <td><span class="ret-num">${tb.retained||0}</span></td>
    <td>${bar(tbPct)}</td>
    <td>${count(latestYr,'T-Ball')-(tb.retained||0)}</td>
  </tr></tbody></table></div>`;
  const _rc = document.getElementById('retentionContent'); if (_rc) _rc.innerHTML = html;

  // ── 3. Division Capacity Health Bars (with target bands) ─────────────
  const allDivs = [
    {label:'BB Majors',sport:'Baseball',div:'Majors',color:'#f5a623'},
    {label:'BB Minors',sport:'Baseball',div:'Minors',color:'#10b981'},
    {label:'BB Rookies',sport:'Baseball',div:'Rookies',color:'#f97316'},
    {label:'SB Senior',sport:'Softball',div:'Senior',color:'#ef4444'},
    {label:'SB Majors',sport:'Softball',div:'Majors',color:'#a78bfa'},
    {label:'SB Minors',sport:'Softball',div:'Minors',color:'#60a5fa'},
    {label:'SB Farm',sport:'Softball',div:'Farm',color:'#14b8a6'},
    {label:'T-Ball',sport:'T-Ball',div:'T-Ball',color:'#8b5cf6'},
  ];
  let healthHtml = '';
  allDivs.forEach(item => {
    const n = countDiv(latestYr, item.sport, item.div);
    const tgt = DIV_TARGETS[item.div] || [10, 15, 30, 40];
    const [minT, lo, hi, maxG] = tgt;
    const scale = maxG * 1.1;
    const fillPct   = Math.min(100, Math.round(n / scale * 100));
    const loLinePct = Math.round(lo / scale * 100);
    const hiLinePct = Math.round(hi / scale * 100);
    const fillColor = n >= hi ? '#10b981' : n >= lo ? '#f5a623' : '#ef4444';
    const status    = n >= hi ? '✓ Healthy' : n >= lo ? '~ On target' : '↓ Low';
    const statusColor = n >= hi ? 'var(--green)' : n >= lo ? 'var(--gold)' : 'var(--red)';
    healthHtml += `<div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="font-size:13px;font-weight:700;min-width:90px;color:${item.color};">${item.label}</span>
        <span style="font-family:Bebas Neue;font-size:20px;min-width:32px;">${n}</span>
        <span style="font-size:11px;color:${statusColor};font-weight:700;">${status}</span>
        <span style="font-size:11px;color:var(--text2);margin-left:auto;">target ${lo}–${hi}</span>
      </div>
      <div style="position:relative;height:10px;background:rgba(255,255,255,0.07);border-radius:5px;overflow:visible;">
        <div style="height:100%;width:${fillPct}%;background:${fillColor};border-radius:5px;transition:width .4s;"></div>
        <!-- target zone overlay -->
        <div style="position:absolute;top:0;left:${loLinePct}%;width:${hiLinePct-loLinePct}%;height:100%;background:rgba(245,166,35,0.2);border-left:1px dashed rgba(245,166,35,0.6);border-right:1px dashed rgba(245,166,35,0.6);pointer-events:none;"></div>
      </div>
    </div>`;
  });
  const _hb = document.getElementById('healthBars'); if (_hb) _hb.innerHTML = healthHtml;

  // ── 4. New vs Returning chart ─────────────────────────────────────────
  const retCounts = [], newCounts = [];
  ['Baseball','Softball','T-Ball'].forEach(s => {
    const r = ret[s]?._league?.retained||0;
    retCounts.push(r); newCounts.push(count(latestYr,s)-r);
  });
  mkChart('newReturnChart','bar',['Baseball','Softball','T-Ball'],
    [{label:'Returning',data:retCounts,backgroundColor:'#10b98199',borderColor:'#10b981',borderWidth:2,borderRadius:4},
     {label:'New',data:newCounts,backgroundColor:'#2563eb99',borderColor:'#2563eb',borderWidth:2,borderRadius:4}]
  );

  // ── 5. Division Exit Funnel controls ─────────────────────────────────
  const funnelYearEl = document.getElementById('funnelYear');
  if (funnelYearEl) {
    const allYrs = years().filter(y => y < (years()[years().length-1]||2026));
    funnelYearEl.innerHTML = allYrs.reverse().map(y =>
      `<option value="${y}" ${y===allYrs[0]?'selected':''}>${y} → ${y+1}</option>`
    ).join('');
  }
  renderFunnel();

  // ── 6. Cohort survival chart ──────────────────────────────────────────
  renderSurvivalChart();

  // ── 7. T-Ball Pipeline chart ──────────────────────────────────────────
  renderTballPipeline();

  // ── 8. Health Summary ─────────────────────────────────────────────────
  const overallPct = lg.eligible ? Math.round(lg.retained/lg.eligible*100) : 0;
  const grade = overallPct>=80?'A 🟢':overallPct>=65?'B 🟡':overallPct>=50?'C 🟠':'D 🔴';

  // Tenure breakdown
  const tenureMap = {};
  players.forEach(p => {
    const k = playerMatchKey(p);
    if(!tenureMap[k]) tenureMap[k] = new Set();
    tenureMap[k].add(p.year);
  });
  const tenures = Object.values(tenureMap).map(s => s.size);
  const oneAndDone = tenures.filter(t=>t===1).length;
  const multiYear  = tenures.filter(t=>t>=3).length;
  const avgTenure  = (tenures.reduce((a,b)=>a+b,0)/tenures.length).toFixed(1);

  const _hsum = document.getElementById('healthSummary'); if (_hsum) _hsum.innerHTML = `
    <div class="info-row"><span class="ir-label">Total ${latestYr} Roster</span><span class="ir-val">${count(latestYr)}</span></div>
    <div class="info-row"><span class="ir-label">New Players ${latestYr}</span><span class="ir-val">${count(latestYr)-(lg.retained||0)} (${Math.round((count(latestYr)-(lg.retained||0))/count(latestYr)*100)}% of roster)</span></div>
    <div class="info-row"><span class="ir-label">One-and-Done Rate (all time)</span><span class="ir-val" style="color:var(--red)">${Math.round(oneAndDone/tenures.length*100)}% of ${tenures.length} unique players</span></div>
    <div class="info-row"><span class="ir-label">Multi-Year Players (3+ seasons)</span><span class="ir-val" style="color:var(--green)">${multiYear} players (${Math.round(multiYear/tenures.length*100)}%)</span></div>
    <div class="info-row" style="border-bottom:none;"><span class="ir-label">Avg Player Tenure</span><span class="ir-val">${avgTenure} seasons</span></div>
  `;
}

// ── Division Exit Funnel (SVG Sankey-lite) ────────────────────────────────

function renderFunnel() {
  const sport   = document.getElementById('funnelSport')?.value || 'Baseball';
  const fromYear = parseInt(document.getElementById('funnelYear')?.value || years()[years().length-2]);
  const toYear   = fromYear + 1;
  const flow     = computeDivisionFlow(sport, fromYear);
  const el       = document.getElementById('funnelChart');
  if (!el) return;

  const divOrder = sport === 'Baseball' ? ['Majors','Minors','Rookies'] : ['Senior','Majors','Minors','Farm'];
  const divColors = {
    Majors:'#f5a623',Minors:'#10b981',Rookies:'#f97316',
    Senior:'#ef4444',Majors:'#a78bfa',Minors:'#60a5fa',Farm:'#14b8a6'
  };

  const allDivs = [...divOrder, 'Dropped Out', 'Other Division'];
  const W = 760, H = 60 + divOrder.length * 80;
  const leftX = 30, rightX = W - 120;

  // Build rows
  let rows = divOrder.map(div => {
    const f = flow[div] || { total: 0, returned: 0, dropped: 0, toDiv: {} };
    return { div, ...f };
  }).filter(r => r.total > 0);

  if (!rows.length) {
    el.innerHTML = `<div style="color:var(--text2);padding:20px;font-size:13px;">No division data available for ${sport} ${fromYear} → ${toYear}.</div>`;
    return;
  }

  const maxTotal = Math.max(...rows.map(r => r.total));
  const barH = 28;
  const gap  = 18;
  const rowH = barH + gap;

  let svg = `<svg viewBox="0 0 ${W} ${rows.length * rowH + 60}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${W}px;font-family:'DM Sans',sans-serif;">`;

  // Column labels
  svg += `<text x="${leftX}" y="18" font-size="11" fill="#94a3b8" font-weight="700" text-anchor="start">${fromYear} DIVISION</text>`;
  svg += `<text x="${rightX + 60}" y="18" font-size="11" fill="#94a3b8" font-weight="700" text-anchor="middle">OUTCOME ${toYear}</text>`;

  rows.forEach((row, ri) => {
    const y      = 30 + ri * rowH;
    const color  = divColors[row.div] || '#94a3b8';
    const barW   = Math.max(8, Math.round((row.total / maxTotal) * (rightX - leftX - 80)));

    // From bar
    svg += `<rect x="${leftX}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" opacity="0.85"/>`;
    svg += `<text x="${leftX + barW + 6}" y="${y + barH/2 + 4}" font-size="12" fill="${color}" font-weight="700">${row.div}</text>`;
    svg += `<text x="${leftX + barW + 6}" y="${y + barH/2 + 17}" font-size="10" fill="#94a3b8">${row.total} players</text>`;

    // Flow arrows
    const flowX1 = rightX - 10;
    const outcomes = [];
    Object.entries(row.toDiv).forEach(([td, cnt]) => {
      outcomes.push({ label: td, count: cnt, color: divColors[td] || '#475569' });
    });
    if (row.dropped > 0) outcomes.push({ label: 'Dropped Out', count: row.dropped, color: '#ef4444' });
    outcomes.sort((a,b) => b.count - a.count);

    let outY = y;
    outcomes.forEach(out => {
      const flowH = Math.max(4, Math.round((out.count / row.total) * barH));
      const cx1 = leftX + barW, cy1 = y + barH/2;
      const cx2 = flowX1, cy2 = outY + flowH/2;

      // Bezier flow line
      const midX = (cx1 + cx2) / 2;
      svg += `<path d="M${cx1},${cy1} C${midX},${cy1} ${midX},${cy2} ${cx2},${cy2}"
        stroke="${out.color}" stroke-width="${Math.max(2,flowH*0.6)}" fill="none" opacity="0.55"/>`;

      // Outcome box
      svg += `<rect x="${flowX1}" y="${outY}" width="${W - flowX1 - 10}" height="${flowH}" rx="3" fill="${out.color}" opacity="0.8"/>`;
      if (flowH > 12) {
        svg += `<text x="${flowX1 + (W-flowX1-10)/2}" y="${outY + flowH/2 + 4}" font-size="9" fill="#fff" text-anchor="middle" font-weight="600">${out.label} (${out.count})</text>`;
      }
      outY += flowH + 2;
    });

    // Retention % label
    const retPct = row.total ? Math.round(row.returned/row.total*100) : 0;
    const retColor = retPct >= 70 ? '#10b981' : retPct >= 50 ? '#f5a623' : '#ef4444';
    svg += `<text x="${leftX + barW/2}" y="${y + barH + 14}" font-size="10" fill="${retColor}" text-anchor="middle" font-weight="700">${retPct}% returned</text>`;
  });

  svg += '</svg>';
  el.innerHTML = svg;
}

// ── Cohort Survival Chart ─────────────────────────────────────────────────

function renderSurvivalChart() {
  const sport    = survSport;
  const cohorts  = computeCohortSurvival(sport);
  const allYrs   = years();
  const latestYr = allYrs[allYrs.length - 1];
  const colors   = ['#f5a623','#2563eb','#10b981','#ef4444','#8b5cf6'];

  // Skip cohorts that only have 1 data point (just entered this year — nothing to show yet)
  const entryYears = Object.keys(cohorts).map(Number).sort()
    .filter(ey => Object.keys(cohorts[ey].rates).length > 1);

  const datasets = entryYears.map((ey, i) => {
    const c = cohorts[ey];
    const color = colors[i % colors.length];
    // Latest rate for the legend label
    const latestRate = c.rates[latestYr] ?? c.rates[Math.max(...Object.keys(c.rates).map(Number))];
    return {
      label: `${ey} cohort  n=${c.size}  →  ${latestRate}% today`,
      data: allYrs.map(y => y >= ey ? (c.rates[y] ?? null) : null),
      borderColor: color,
      backgroundColor: color + '18',
      pointBackgroundColor: allYrs.map(y => {
        const v = c.rates[y];
        if (v === undefined || v === null) return 'transparent';
        return v <= 30 ? '#ef4444' : v <= 55 ? '#f5a623' : color;
      }),
      pointRadius: allYrs.map(y => y >= ey && c.rates[y] != null ? 5 : 0),
      pointHoverRadius: 8,
      fill: false,
      tension: 0.25, borderWidth: 2.5,
      spanGaps: false,
    };
  });

  // 50% danger line
  datasets.push({
    label: '50% threshold',
    data: allYrs.map(() => 50),
    borderColor: 'rgba(239,68,68,0.3)',
    borderDash: [6, 4],
    borderWidth: 1,
    pointRadius: 0,
    fill: false,
  });

  destroyChart('survivalChart');
  const ctx = document.getElementById('survivalChart');
  if (!ctx) return;

  // Custom plugin: draw % labels on each point
  const labelPlugin = {
    id: 'survivalLabels',
    afterDatasetsDraw(chart) {
      const { ctx: c, data } = chart;
      data.datasets.forEach((ds, di) => {
        if (ds.label === '50% threshold') return;
        const meta = chart.getDatasetMeta(di);
        meta.data.forEach((pt, pi) => {
          const val = ds.data[pi];
          if (val === null || val === undefined) return;
          c.save();
          c.font = 'bold 10px DM Sans';
          c.fillStyle = '#e2e8f0';
          c.textAlign = 'center';
          c.fillText(val + '%', pt.x, pt.y - 9);
          c.restore();
        });
      });
    }
  };

  chartInstances['survivalChart'] = new Chart(ctx, {
    type: 'line',
    data: { labels: allYrs.map(String), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { family: 'DM Sans', size: 11 },
            filter: item => item.text !== '50% threshold' },
          position: 'bottom'
        },
        tooltip: { callbacks: {
          label: c => c.dataset.label === '50% threshold' ? null :
            ` ${c.dataset.label.split('  ')[0]}: ${c.raw}% of original cohort still active`
        }}
      },
      scales: {
        x: { ticks: { color:'#94a3b8' }, grid: { color:'rgba(255,255,255,0.05)' } },
        y: {
          min: 0, max: 100,
          ticks: { color:'#94a3b8', callback: v => v+'%', stepSize: 25 },
          grid: { color:'rgba(255,255,255,0.07)' }
        }
      }
    },
    plugins: [labelPlugin]
  });
    patchChartClick('survivalChart', null, null);
}

// ── T-Ball Pipeline Chart ─────────────────────────────────────────────────

function renderTballPipeline() {
  const data   = computeTballPipeline();
  // Labels show "2022→23" so it's clear what year they graduated to
  const labels = data.map(d => `${d.year}→${String(d.year+1).slice(2)}`);
  const totals = data.map(d => d.total);

  // Custom plugin: draw grad% above each bar stack
  const gradLabelPlugin = {
    id: 'tballGradLabels',
    afterDatasetsDraw(chart) {
      const { ctx: c } = chart;
      const meta0 = chart.getDatasetMeta(0); // first dataset (Baseball) — use for x positions
      chart.data.datasets[0].data.forEach((_, i) => {
        const total = totals[i];
        if (!total) return;
        const grad = data[i].movedBB + data[i].movedSB;
        const pct  = Math.round(grad / total * 100);
        // Find the top of the full stacked bar by summing all visible datasets
        const allMetas = chart.data.datasets.map((_, di) => chart.getDatasetMeta(di));
        const topY = Math.min(...allMetas
          .map(m => m.data[i])
          .filter(pt => pt)
          .map(pt => pt.y));
        const pt = meta0.data[i];
        if (!pt) return;
        // Grad rate badge
        const color = pct >= 50 ? '#10b981' : pct >= 30 ? '#f5a623' : '#ef4444';
        c.save();
        c.font = 'bold 11px DM Sans';
        c.fillStyle = color;
        c.textAlign = 'center';
        c.fillText(`${pct}% grad`, pt.x, topY - 6);
        c.restore();
      });
    }
  };

  destroyChart('tballPipelineChart');
  const ctx = document.getElementById('tballPipelineChart');
  if (!ctx) return;
  chartInstances['tballPipelineChart'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'→ Baseball',  data:data.map(d=>d.movedBB),     backgroundColor:'#2563eb99', borderColor:'#2563eb', borderWidth:2, borderRadius:4, stack:'s' },
        { label:'→ Softball',  data:data.map(d=>d.movedSB),     backgroundColor:'#ec489999', borderColor:'#ec4899', borderWidth:2, borderRadius:4, stack:'s' },
        { label:'Stayed T-Ball', data:data.map(d=>d.stayedTball), backgroundColor:'#8b5cf660', borderColor:'#8b5cf6', borderWidth:1, borderRadius:4, stack:'s' },
        { label:'Dropped Out', data:data.map(d=>d.dropped),     backgroundColor:'#ef444455', borderColor:'#ef4444', borderWidth:1, borderRadius:4, stack:'s' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      plugins: {
        legend: { labels: { color:'#94a3b8', font:{ family:'DM Sans', size:11 } }, position:'bottom' },
        tooltip: { callbacks: {
          title: items => {
            const i = items[0].dataIndex;
            return `T-Ball ${data[i].year} cohort (${totals[i]} players)`;
          },
          label: ctx => {
            const i = ctx.dataIndex;
            const n = ctx.raw;
            const pct = totals[i] ? Math.round(n/totals[i]*100) : 0;
            return ` ${ctx.dataset.label}: ${n} (${pct}%)`;
          },
          afterBody: items => {
            const i = items[0].dataIndex;
            const grad = data[i].movedBB + data[i].movedSB;
            const pct  = totals[i] ? Math.round(grad/totals[i]*100) : 0;
            return [`Graduation rate: ${pct}%`];
          }
        }}
      },
      scales: {
        x: { stacked:true, ticks:{ color:'#94a3b8' }, grid:{ color:'rgba(255,255,255,0.05)' } },
        y: { stacked:true, beginAtZero:true, ticks:{ color:'#94a3b8' }, grid:{ color:'rgba(255,255,255,0.07)' } }
      }
    },
    plugins: [gradLabelPlugin]
  });
    patchChartClick('tballPipelineChart', null, null);

  const statsEl = document.getElementById('tballGradStats');
  if (statsEl && data.length) {
    const latest  = data[data.length-1];
    const avgGrad = Math.round(data.reduce((a,d)=>a+d.gradRate,0)/data.length);
    const bestCohort = data.reduce((a,b) => b.gradRate > a.gradRate ? b : a);
    statsEl.innerHTML = `
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div class="stat-card" style="flex:1;min-width:110px;">
          <div class="stat-label">Latest Grad Rate</div>
          <div class="stat-value" style="font-size:28px;color:var(--green)">${latest.gradRate}%</div>
          <div style="font-size:11px;color:var(--text2);">${latest.year}→${latest.year+1} cohort</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:110px;">
          <div class="stat-label">Avg Grad Rate</div>
          <div class="stat-value" style="font-size:28px;color:var(--gold)">${avgGrad}%</div>
          <div style="font-size:11px;color:var(--text2);">all cohorts</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:110px;">
          <div class="stat-label">Best Cohort</div>
          <div class="stat-value" style="font-size:28px;color:var(--blue2)">${bestCohort.gradRate}%</div>
          <div style="font-size:11px;color:var(--text2);">${bestCohort.year}→${bestCohort.year+1}</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:110px;">
          <div class="stat-label">Latest Dropouts</div>
          <div class="stat-value" style="font-size:28px;color:var(--red)">${latest.dropped}</div>
          <div style="font-size:11px;color:var(--text2);">left entirely</div>
        </div>
      </div>`;
  }
}


function bar(pct) {
  const c = pct>=70?'var(--green)':pct>=40?'var(--gold)':'var(--red)';
  return `<div style="display:flex;align-items:center;gap:8px;"><div style="flex:1;background:rgba(255,255,255,0.08);border-radius:4px;height:6px;"><div style="width:${pct}%;background:${c};height:100%;border-radius:4px;"></div></div><span style="font-size:12px;font-weight:700;color:${c};min-width:36px">${pct}%</span></div>`;
}

// RENDER: ALL-STARS
function renderAllStars() {
  const latestYr = years()[years().length-1]||2026;
  const prevYr   = years()[years().length-2]||2025;
  const prevYrPlayers = players.filter(p=>p.year===prevYr);
  // prevKeys used for fast name-based lookup; isRetained() handles cross-sport progression
  const prevKeys = new Set(prevYrPlayers.map(retentionKey));
  const curYrPlayers = players.filter(p=>p.year===(typeof curYr!=='undefined'?curYr:prevYr+1));

  const yearEl = document.getElementById('allStarYear');
  if (yearEl) yearEl.textContent = latestYr;

  const brackets = ['8U','9U','10U','11U','12U'];
  // Bracket colour ramp — warm to cool
  const bracketColors = {
    '8U':  { card:'purple', value:'#8b5cf6' },
    '9U':  { card:'blue',   value:'#2563eb' },
    '10U': { card:'green',  value:'#10b981' },
    '11U': { card:'gold',   value:'#f5a623' },
    '12U': { card:'pink',   value:'#ec4899' },
  };

  const el = document.getElementById('allStarCards');
  if (!el) return;

  el.innerHTML = brackets.map(bracket => {
    const eligible  = players.filter(p => p.year===latestYr && p.sport==='Baseball' && p.allstar_division===bracket);
    const returning = eligible.filter(p => (prevKeys.has(retentionKey(p)) || (_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p))))).length;
    const isNew     = eligible.length - returning;
    const { card, value } = bracketColors[bracket];

    return `
    <div class="stat-card ${card} stat-clickable"
         onclick="showAllStarDetail('Baseball','${bracket}')"
         title="View ${bracket} eligible players">
      <div class="stat-card-trend">⭐</div>
      <div class="stat-label">${bracket} Baseball</div>
      <div class="stat-value ${card}">${eligible.length}</div>
      <div class="stat-delta" style="display:flex;flex-direction:column;gap:2px;align-items:flex-start;">
        <span style="color:var(--green);font-size:11px;">↩ ${returning} returning</span>
        <span style="color:var(--blue2);font-size:11px;">✦ ${isNew} new</span>
      </div>
    </div>`;
  }).join('');

  // Top performers section hidden — standouts shown inside bracket popups
}

// ALL-STAR DETAIL POPUP
function renderAllStarTopPerformers() {
  const el = document.getElementById('allStarTopPerformers');
  if (!el || typeof GC_STATS === 'undefined') return;
  if (typeof canShowStats === 'function' && !canShowStats()) { el.innerHTML = ''; return; }

  const latestYr   = years()[years().length-1] || 2026;
  const brackets   = ['8U','9U','10U','11U','12U'];
  const bracketColors = {'8U':'#8b5cf6','9U':'#2563eb','10U':'#10b981','11U':'#f5a623','12U':'#ec4899'};

  // Composite scores (same formula as before)
  function hitScore(r) {
    const b = r.batting;
    if ((b?.ab||0) < 4) return null;
    const ops = parseFloat(b.ops)||0, avg = parseFloat(b.avg)||0;
    const rbiRate = b.ab?(b.rbi||0)/b.ab:0, sbRate = b.ab?(b.sb||0)/b.ab:0;
    return (ops*0.40)+(avg*0.30)+(rbiRate*0.20)+(sbRate*0.10);
  }
  function pitScore(r) {
    const pi = r.pitching;
    if ((pi?.ip_dec||0) < 2) return null;
    const era=parseFloat(pi.era)||99, whip=parseFloat(pi.whip)||9;
    const kRate=pi.ip_dec>0?pi.so/pi.ip_dec:0, bbRate=pi.ip_dec>0?pi.bb/pi.ip_dec:9;
    return (1/(1+era/9)*0.35)+(1/(1+whip)*0.35)+(Math.min(kRate/4,1)*0.20)+(1/(1+bbRate/2)*0.10);
  }

  // For a bracket: find all 2026 registrants, then pull their GC records from last 2 seasons
  function getPool(bracket) {
    const reg = players.filter(p =>
      p.year===latestYr && p.sport==='Baseball' && p.allstar_division===bracket
    );
    const regKeys = new Set(reg.map(p => `${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`));
    if (!regKeys.size) return [];

    // Collect most recent GC record per player (from last 2 years)
    const byKey = {};
    GC_STATS.forEach(g => {
      if (g.sport==='Baseball' && g.year>=latestYr-2 && regKeys.has(g.key)) {
        if (!byKey[g.key] || g.year > byKey[g.key].year) byKey[g.key] = g;
      }
    });
    return Object.values(byKey);
  }

  let anyData = false;
  let html = '';

  brackets.forEach(bracket => {
    const bColor = bracketColors[bracket];
    const pool   = getPool(bracket);
    if (!pool.length) return;

    // Score each player
    const scored = pool.map(r => ({
      ...r,
      hs: hitScore(r),
      ps: pitScore(r),
    }));

    // Top hitter, top pitcher, top all-around
    const hitters  = scored.filter(r=>r.hs!==null).sort((a,b)=>b.hs-a.hs);
    const pitchers = scored.filter(r=>r.ps!==null).sort((a,b)=>b.ps-a.ps);

    // Build spotlight entries — deduplicate (a player can only win one spotlight)
    const used = new Set();
    const spots = [];

    // Top 3 hitters
    for (const r of hitters) {
      if (used.has(r.key)) continue;
      if (spots.filter(s=>s.type==='hit').length >= 3) break;
      spots.push({ r, type:'hit', label:'Top Hitter', icon:'⚾', color:'var(--blue2)' });
      used.add(r.key);
    }
    // Top 3 pitchers
    for (const r of pitchers) {
      if (used.has(r.key)) continue;
      if (spots.filter(s=>s.type==='pit').length >= 3) break;
      spots.push({ r, type:'pit', label:'Top Pitcher', icon:'🔥', color:'#f97316' });
      used.add(r.key);
    }

    if (!spots.length) return;
    anyData = true;

    // Group by type for two-column display
    const hitSpots = spots.filter(s=>s.type==='hit');
    const pitSpots = spots.filter(s=>s.type==='pit');

    function spotCard(s, rank) {
      const medals = ['🥇','🥈','🥉'];
      const medal  = medals[rank] || '';
      const yr     = s.r.year;
      const teamLabel = yr < latestYr ? `Based on ${yr} season` : 'Current season';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;
          border-radius:8px;background:rgba(255,255,255,0.04);margin-bottom:6px;cursor:pointer;"
          onclick="showPlayerStatsIfAvailable('${s.r.first}','${s.r.last}')"
          title="View player stats">
        <span style="font-size:20px;flex-shrink:0;">${medal}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${s.r.first} ${s.r.last}
          </div>
          <div style="font-size:10px;color:var(--text2);margin-top:1px;">${teamLabel}</div>
        </div>
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;
            background:${s.color}22;color:${s.color};white-space:nowrap;flex-shrink:0;">
          ${s.icon} ${s.label}
        </span>
      </div>`;
    }

    const reg26count = players.filter(p=>p.year===latestYr&&p.sport==='Baseball'&&p.allstar_division===bracket).length;

    html += `<div style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:4px;height:28px;border-radius:2px;background:${bColor};flex-shrink:0;"></div>
        <div>
          <div style="font-family:Bebas Neue;font-size:18px;letter-spacing:1px;color:#fff;">${bracket} Bracket</div>
          <div style="font-size:11px;color:var(--text2);">${reg26count} eligible · ${pool.length} with recent performance data</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
              color:var(--text2);margin-bottom:6px;">⚾ Standout Hitters</div>
          ${hitSpots.length ? hitSpots.map((s,i)=>spotCard(s,i)).join('') : '<div style="font-size:12px;color:var(--text2);font-style:italic;">No batting data</div>'}
        </div>
        <div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
              color:var(--text2);margin-bottom:6px;">🔥 Standout Pitchers</div>
          ${pitSpots.length ? pitSpots.map((s,i)=>spotCard(s,i)).join('') : '<div style="font-size:12px;color:var(--text2);font-style:italic;">No pitching data</div>'}
        </div>
      </div>
    </div>`;
  });

  if (!anyData) { el.style.display='none'; return; }

  el.style.display = '';
  el.innerHTML = `
    <div class="card" style="margin-top:14px;">
      <div class="card-title" style="margin-bottom:4px;">
        ⭐ All-Star <span class="accent">Standouts</span>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:18px;">
        Top performers from the last two seasons among this year's eligible players.
        Rankings based on composite hitting and pitching metrics. Click any name to view their stats.
      </div>
      ${html}
    </div>`;
}


// Returns {label, icon, color} if player is a standout in their bracket, else null
function gcGetStandout(first, last, bracket, sport) {
  if (typeof GC_STATS === 'undefined') return null;
  const latestYr = years()[years().length-1] || 2026;
  const key = `${first.toLowerCase()}|${last[0]?.toUpperCase()||''}`;

  // Get all 2026 registrants in this bracket
  const regKeys = new Set(
    players.filter(p => p.year===latestYr && p.sport===sport && p.allstar_division===bracket)
           .map(p => `${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`)
  );
  if (!regKeys.has(key)) return null;

  // Pool: GC records from last 2 years for this bracket's players
  const byKey = {};
  GC_STATS.forEach(g => {
    if (g.sport===sport && g.year>=latestYr-2 && regKeys.has(g.key)) {
      if (!byKey[g.key] || g.year > byKey[g.key].year) byKey[g.key] = g;
    }
  });
  const pool = Object.values(byKey);
  if (!pool.length) return null;

  function hScore(r) {
    const b = r.batting;
    if ((b?.ab||0) < 4) return null;
    const ops=parseFloat(b.ops)||0, avg=parseFloat(b.avg)||0;
    return (ops*0.40)+(avg*0.30)+((b.ab?(b.rbi||0)/b.ab:0)*0.20)+((b.ab?(b.sb||0)/b.ab:0)*0.10);
  }
  function pScore(r) {
    const pi = r.pitching;
    if ((pi?.ip_dec||0) < 2) return null;
    const era=parseFloat(pi.era)||99, whip=parseFloat(pi.whip)||9;
    const kRate=pi.ip_dec>0?pi.so/pi.ip_dec:0, bbRate=pi.ip_dec>0?pi.bb/pi.ip_dec:9;
    return (1/(1+era/9)*0.35)+(1/(1+whip)*0.35)+(Math.min(kRate/4,1)*0.20)+(1/(1+bbRate/2)*0.10);
  }

  const myRec = byKey[key];
  if (!myRec) return null;

  // Check if top 3 hitter
  const hitters = pool.map(r=>({key:r.key,s:hScore(r)})).filter(r=>r.s!==null).sort((a,b)=>b.s-a.s);
  const hitRank = hitters.findIndex(r=>r.key===key);
  if (hitRank >= 0 && hitRank < 3) {
    const medals = ['🥇','🥈','🥉'];
    return { label:'Top Hitter', icon: medals[hitRank], color:'var(--blue2)', rank:hitRank+1 };
  }

  // Check if top 3 pitcher
  const pitchers = pool.map(r=>({key:r.key,s:pScore(r)})).filter(r=>r.s!==null).sort((a,b)=>b.s-a.s);
  const pitRank = pitchers.findIndex(r=>r.key===key);
  if (pitRank >= 0 && pitRank < 3) {
    const medals = ['🥇','🥈','🥉'];
    return { label:'Top Pitcher', icon: medals[pitRank], color:'#f97316', rank:pitRank+1 };
  }

  return null;
}


function showAllStarDetail(sport, bracket) {
  const latestYr = years()[years().length-1]||2026;
  const prevYr   = years()[years().length-2]||2025;
  const eligible = players.filter(p => p.year===latestYr && p.sport===sport && p.allstar_division===bracket);
  const prevYrPlayers = players.filter(p=>p.year===prevYr);
  const prevKeys = new Set(prevYrPlayers.map(retentionKey));
  const curYrPlayers = players.filter(p=>p.year===(typeof curYr!=='undefined'?curYr:prevYr+1));

  // Nominees storage
  if (!USER_DATA.allStarNominees) USER_DATA.allStarNominees = {};

  document.getElementById('allStarDetailTitle').textContent = `⭐ ${bracket} ${sport} — All-Stars Eligible (${latestYr})`;
  const returning = eligible.filter(p=>(prevKeys.has(retentionKey(p)) || ((_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p))))));
  const newOnes   = eligible.filter(p=>!(prevKeys.has(retentionKey(p)) || ((_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p))))));
  const bracketDivMap = {'12U':'Majors','11U':'Majors','10U':'Minors','9U':'Rookies','8U':'Rookies'};
  const mappedDiv = bracketDivMap[bracket];
  const divLinkBtn = (sport==='Baseball' && mappedDiv)
    ? `<button class="btn btn-ghost btn-sm" onclick="closeModal('allStarDetailModal');showDivDetail('${sport}','${mappedDiv}')" style="margin-left:auto;">View ${mappedDiv} →</button>`
    : '';

  // Build GC stats lookup
  const _bracketRegKeys = new Set(eligible.map(p=>`${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`));
  const _gcByKey = {};
  if (typeof GC_STATS!=='undefined' && (typeof canShowStats!=='function'||canShowStats())) {
    GC_STATS.forEach(g => {
      if (g.sport===sport && g.year>=latestYr-2 && _bracketRegKeys.has(g.key)) {
        if (!_gcByKey[g.key] || g.year > _gcByKey[g.key].year) _gcByKey[g.key] = g;
      }
    });
  }
  const _pool = Object.values(_gcByKey);
  const _hitterKeys = new Set(
    _pool.filter(r=>(r.batting?.ab||0)>=4)
         .map(r=>({key:r.key, ops:parseFloat(r.batting?.ops)||0}))
         .sort((a,b)=>b.ops-a.ops).slice(0,5).map(r=>r.key)
  );
  const _hLeader = _pool.filter(r=>(r.batting?.ab||0)>=4).sort((a,b)=>(b.batting?.h||0)-(a.batting?.h||0))[0]?.key||null;
  function _pScore(r){ const pi=r.pitching; if((pi?.ip_dec||0)<2) return null; const era=parseFloat(pi.era)||99, whip=parseFloat(pi.whip)||9, kRate=pi.ip_dec>0?pi.so/pi.ip_dec:0; return 1/(1+era/9)*0.4+1/(1+whip)*0.4+Math.min(kRate/4,1)*0.2; }
  const _pitcherKeys = new Set(_pool.map(r=>({key:r.key,s:_pScore(r)})).filter(r=>r.s!==null).sort((a,b)=>b.s-a.s).slice(0,5).map(r=>r.key));
  const _pLeader = _pool.map(r=>({key:r.key,s:_pScore(r)})).filter(r=>r.s!==null).sort((a,b)=>b.s-a.s)[0]?.key||null;

  // Eval scores
  const _evalByKey = {};
  if (typeof draftGetEvalScore !== 'undefined') {
    eligible.forEach(p => {
      const res = draftGetEvalScore(p);
      if (res?.score) _evalByKey[`${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`] = res.score;
    });
  }

  // Sort helper — re-renders the table only
  window._asCurrentSort = window._asCurrentSort || 'alpha';
  window._asCurrentSport = sport; window._asCurrentBracket = bracket;

  function _sortedEligible(sortMode) {
    const list = [...eligible];
    const nomineeKey = (p) => `${sport}|${bracket}|${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`;
    if (sortMode === 'nominee') {
      list.sort((a,b) => {
        const na = !!(USER_DATA.allStarNominees[nomineeKey(a)]);
        const nb = !!(USER_DATA.allStarNominees[nomineeKey(b)]);
        if (na !== nb) return nb - na;
        return a.last.localeCompare(b.last)||a.first.localeCompare(b.first);
      });
    } else if (sortMode === 'eval') {
      list.sort((a,b) => {
        const ka=`${a.first.toLowerCase()}|${a.last[0]?.toUpperCase()||''}`;
        const kb=`${b.first.toLowerCase()}|${b.last[0]?.toUpperCase()||''}`;
        return (_evalByKey[kb]||0)-(_evalByKey[ka]||0)||a.last.localeCompare(b.last);
      });
    } else if (sortMode === 'stats') {
      list.sort((a,b) => {
        const ka=`${a.first.toLowerCase()}|${a.last[0]?.toUpperCase()||''}`;
        const kb=`${b.first.toLowerCase()}|${b.last[0]?.toUpperCase()||''}`;
        const opsA=parseFloat(_gcByKey[ka]?.batting?.ops)||0;
        const opsB=parseFloat(_gcByKey[kb]?.batting?.ops)||0;
        return opsB-opsA||a.last.localeCompare(b.last);
      });
    } else {
      list.sort((a,b)=>a.last.localeCompare(b.last)||a.first.localeCompare(b.first));
    }
    return list;
  }

  function _toggleNominee(pFirst, pLast) {
    if (!USER_DATA.allStarNominees) USER_DATA.allStarNominees = {};
    const k = `${sport}|${bracket}|${pFirst.toLowerCase()}|${pLast[0]?.toUpperCase()||''}`;
    USER_DATA.allStarNominees[k] = !USER_DATA.allStarNominees[k];
    if (typeof saveUserData !== 'undefined') saveUserData();
    _renderASTable(window._asCurrentSort);
  }
  window._toggleASNominee = _toggleNominee;
  window._setASSort = function(s) { window._asCurrentSort = s; _renderASTable(s); };

  function _renderASTable(sortMode) {
    const sorted = _sortedEligible(sortMode);
    const btns = ['alpha','nominee','eval','stats'].map(s => {
      const labels = {alpha:'A–Z', nominee:'⭐ Nominees', eval:'Eval Score', stats:'Stats (OPS)'};
      const active = sortMode===s;
      return `<button onclick="_setASSort('${s}')" style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${active?'var(--gold)':'var(--border)'};background:${active?'rgba(245,166,35,.15)':'rgba(255,255,255,.04)'};color:${active?'var(--gold)':'var(--text2)'};letter-spacing:.5px;">${labels[s]}</button>`;
    }).join('');

    const nominees = sorted.filter(p => {
      const k=`${sport}|${bracket}|${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`;
      return !!(USER_DATA.allStarNominees?.[k]);
    });
    const nomineeCount = nominees.length;

    let rows = '';
    sorted.forEach(p => {
      const pKey = `${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`;
      const nomKey = `${sport}|${bracket}|${pKey}`;
      const isNominee = !!(USER_DATA.allStarNominees?.[nomKey]);
      const hasStats = typeof GC_STATS!=='undefined' && GC_STATS.some(s=>s.key===pKey);
      const evalScore = _evalByKey[pKey]||0;
      const gcStats = _gcByKey[pKey];
      const badge = (prevKeys.has(retentionKey(p)) || ((_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p)))))
        ? `<span class="badge badge-returning">Returning</span>`
        : `<span class="badge badge-new">New</span>`;
      const emojis = [];
      if (_hLeader===pKey)             emojis.push(`<span title="Hits Leader" style="font-size:12px;">🏆</span>`);
      else if (_hitterKeys.has(pKey))  emojis.push(`<span title="Top 5 Hitter" style="font-size:11px;">⚾</span>`);
      if (_pLeader===pKey)             emojis.push(`<span title="Best Pitcher" style="font-size:12px;">🏆</span>`);
      else if (_pitcherKeys.has(pKey)) emojis.push(`<span title="Top 5 Pitcher" style="font-size:11px;">🔥</span>`);

      // Eval badge — only visible to admin or when evals are enabled
      const evalBadge = (evalScore && canShowEvalData())
        ? `<span style="font-family:'Bebas Neue';font-size:14px;padding:1px 6px;border-radius:4px;background:${evalScore>=75?'rgba(16,185,129,.15)':evalScore>=55?'rgba(96,165,250,.15)':'rgba(245,166,35,.12)'};color:${evalScore>=75?'#10b981':evalScore>=55?'#60a5fa':'#f5a623'};">${evalScore}</span>`
        : '';
      // Stats badge — hidden in draft mode
      const _showStats = typeof canShowStats === 'function' ? canShowStats() : true;
      const statsBadge = _showStats && gcStats?.batting?.ops
        ? `<span style="font-size:10px;color:var(--text2);">${parseFloat(gcStats.batting.ops).toFixed(3)} OPS</span>`
        : (_showStats && hasStats ? `<span style="font-size:9px;color:rgba(255,255,255,.25);">📊</span>` : '');
      // Performance emojis — hidden in draft mode
      const displayEmojis = _showStats ? emojis : [];

      // Star toggle button
      const starBtn = `<button onclick="event.stopPropagation();_toggleASNominee('${p.first.replace(/'/g,"\\'")}','${p.last.replace(/'/g,"\\'")}');this.closest('tr').style.background=''" style="background:none;border:none;cursor:pointer;font-size:${isNominee?'18px':'16px'};opacity:${isNominee?'1':'.3'};line-height:1;transition:all .15s;padding:2px 4px;" title="${isNominee?'Remove from nominees':'Add to nominees'}">${isNominee?'⭐':'☆'}</button>`;

      rows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);background:${isNominee?'rgba(245,166,35,.04)':''};">
        <td style="padding:7px 6px;width:32px;text-align:center;">${starBtn}</td>
        <td style="padding:7px 10px;font-weight:600;${_showStats?'cursor:pointer;':''}" ${_showStats?`onclick="showPlayerStatsIfAvailable('${p.first}','${p.last}')" title="View stats"`:''}>\
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="${_showStats?'border-bottom:1px dashed rgba(255,255,255,.2);':''}">${p.first} ${p.last}</span>
            ${displayEmojis.join('')}
          </div>
        </td>
        <td style="padding:7px 8px;">${evalBadge}</td>
        <td style="padding:7px 8px;">${statsBadge}</td>
        <td style="padding:7px 10px;color:var(--text2);font-size:12px;">${p.city||'—'}</td>
        <td style="padding:7px 10px;">${badge}</td>
      </tr>`;
    });

    const tableHtml = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--text2);letter-spacing:.5px;margin-right:4px;">SORT:</span>
        ${btns}
        ${nomineeCount ? `<span style="margin-left:auto;font-size:11px;font-weight:700;color:var(--gold);">⭐ ${nomineeCount} nominated</span>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="padding:8px 6px;width:32px;"></th>
          <th style="text-align:left;padding:8px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Name</th>
          <th style="text-align:left;padding:8px 8px;color:var(--text2);font-size:11px;text-transform:uppercase;">Eval</th>
          <th style="text-align:left;padding:8px 8px;color:var(--text2);font-size:11px;text-transform:uppercase;">Stats</th>
          <th style="text-align:left;padding:8px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">City</th>
          <th style="text-align:left;padding:8px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${_pool.length ? `<div style="padding:8px 4px 2px;font-size:10px;color:var(--text2);">🏆 Leader &nbsp;⚾ Top 5 Hitter &nbsp;🔥 Top 5 Pitcher</div>` : ''}
    `;
    const tableContainer = document.getElementById('as-detail-table');
    if (tableContainer) tableContainer.innerHTML = tableHtml;
  }

  // Build standout strip
  let standoutHtml = '';
  if (typeof gcGetStandout !== 'undefined' && (typeof canShowStats!=='function'||canShowStats())) {
    const standouts = eligible.map(p=>({p,sd:gcGetStandout(p.first,p.last,bracket,sport)})).filter(x=>x.sd!==null).sort((a,b)=>a.sd.rank-b.sd.rank);
    if (standouts.length) {
      standoutHtml = `<div style="margin-bottom:14px;padding:10px 14px;border-radius:10px;background:rgba(245,166,35,0.07);border:1px solid rgba(245,166,35,0.2);">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gold);margin-bottom:8px;">⭐ Top Performers (Last 2 Seasons)</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${standouts.map(({p,sd})=>`<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:7px;background:${sd.color}15;border:1px solid ${sd.color}44;cursor:pointer;" onclick="showPlayerStatsIfAvailable('${p.first}','${p.last}')" title="View stats"><span style="font-size:14px;">${sd.icon}</span><div><div style="font-weight:700;font-size:12px;">${p.first} ${p.last}</div><div style="font-size:10px;color:${sd.color};">${sd.label}</div></div></div>`).join('')}
        </div></div>`;
    }
  }

  let html = `<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-start;">
    <div class="stat-card" style="flex:1;min-width:110px;"><div class="stat-label">Total Eligible</div><div class="stat-value" style="font-size:36px;color:var(--gold);">${eligible.length}</div></div>
    <div class="stat-card" style="flex:1;min-width:110px;"><div class="stat-label">Returning</div><div class="stat-value" style="font-size:36px;color:var(--green);">${returning.length}</div></div>
    <div class="stat-card" style="flex:1;min-width:110px;"><div class="stat-label">New Players</div><div class="stat-value" style="font-size:36px;color:var(--blue2);">${newOnes.length}</div></div>
    ${divLinkBtn ? `<div style="display:flex;align-items:center;">${divLinkBtn}</div>` : ''}
  </div>
  ${standoutHtml}
  ${eligible.length===0 ? '<div class="empty">No eligible players found for this bracket.</div>' : '<div id="as-detail-table"></div>'}`;

  document.getElementById('allStarDetailContent').innerHTML = html;
  openModal('allStarDetailModal');
  if (eligible.length) {
    window._asCurrentSort = 'alpha';
    _renderASTable('alpha');
  }
}


// DIVISION DETAIL DRILL-DOWN
function showDivDetail(sport, division, filterMode) {
  // Open modal immediately so it always appears even if content build errors
  document.getElementById('divDetailTitle').innerHTML = `${division} — ${sport}`;
  document.getElementById('divDetailContent').innerHTML =
    '<div style="color:var(--text2);padding:20px 0;">Loading…</div>';
  openModal('divDetailModal');

  // filterMode: undefined = 'total', 'returning', 'new', 'yoy'
  const mode = filterMode || 'total';
  const latestYr = years()[years().length-1]||2026;
  const prevYr   = years()[years().length-2]||2025;
  const divPlayers  = players.filter(p => p.year===latestYr && p.sport===sport && p.division===division);
  const prevYrPlayers = players.filter(p => p.year===prevYr);
  const curYrPlayers  = players.filter(p => p.year===latestYr);
  // prevKeys used for fast name-based lookup; isRetained() handles cross-sport progression
  const prevKeys = new Set(prevYrPlayers.map(retentionKey));

  const returning = divPlayers.filter(p => (prevKeys.has(retentionKey(p)) || (_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p)))));
  const newOnes   = divPlayers.filter(p => !(prevKeys.has(retentionKey(p)) || (_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p)))));
  const color = divColor(division);
  const showAllStar = sport === 'Baseball';

  // Clickable stat cards at top
  function cardStyle(m) {
    const active = mode === m;
    if (m === 'total')     return `flex:1;min-width:90px;cursor:pointer;outline:${active?`2px solid ${color}`:'none'};outline-offset:2px;`;
    if (m === 'returning') return `flex:1;min-width:90px;cursor:pointer;outline:${active?'2px solid var(--green)':'none'};outline-offset:2px;`;
    if (m === 'new')       return `flex:1;min-width:90px;cursor:pointer;outline:${active?'2px solid var(--blue2)':'none'};outline-offset:2px;`;
  }

  let html = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
      <div class="stat-card" style="${cardStyle('total')}"
           onclick="showDivDetail('${sport}','${division}','total')" title="Show all players + YoY chart">
        <div class="stat-label">Total</div>
        <div class="stat-value" style="font-size:36px;color:${color};">${divPlayers.length}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px;">tap for YoY chart</div>
      </div>
      <div class="stat-card" style="${cardStyle('returning')}"
           onclick="showDivDetail('${sport}','${division}','returning')" title="Show returning players only">
        <div class="stat-label">Returning</div>
        <div class="stat-value" style="font-size:36px;color:var(--green);">${returning.length}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px;">tap to filter</div>
      </div>
      <div class="stat-card" style="${cardStyle('new')}"
           onclick="showDivDetail('${sport}','${division}','new')" title="Show new players only">
        <div class="stat-label">New</div>
        <div class="stat-value" style="font-size:36px;color:var(--blue2);">${newOnes.length}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px;">tap to filter</div>
      </div>
    </div>`;

  // ── MODE: total → YoY chart for this division ──────────────────────────
  if (mode === 'total') {
    const allYrs = years();
    const yrLabels = allYrs.map(String);
    const divCounts = allYrs.map(y => countDiv(y, sport, division));
    html += `
      <div style="font-family:Bebas Neue;font-size:14px;letter-spacing:.5px;color:var(--text2);margin-bottom:8px;">
        ${division} Registrations — All Years
      </div>
      <div class="chart-wrap" style="margin-bottom:20px;"><canvas id="divDetailYoyChart"></canvas></div>`;

    // City breakdown
    const cityGroups = {};
    divPlayers.forEach(p => { const c = p.city||'Unknown'; cityGroups[c] = (cityGroups[c]||0)+1; });
    const topCities = Object.entries(cityGroups).sort((a,b)=>b[1]-a[1]).slice(0,5);
    if (topCities.length > 1) {
      html += `<div style="margin-bottom:16px;">
        <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Top Cities (${latestYr})</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${topCities.map(([city,cnt]) => `<span class="badge" style="background:${color}22;color:${color};font-size:12px;">📍 ${city} (${cnt})</span>`).join('')}
        </div>
      </div>`;
    }

    // Full player list
    if (divPlayers.length > 0) {
      html += _divPlayerTable(divPlayers, prevKeys, prevYrPlayers, curYrPlayers, color, showAllStar, sport, division, 'all');
    }

    document.getElementById('divDetailTitle').innerHTML =
      `<span style="color:${color};">${division}</span> — ${sport}`;
    document.getElementById('divDetailContent').innerHTML = html;

    // Render chart after paint
    setTimeout(() => {
      destroyChart('divDetailYoyChart');
      const canvas = document.getElementById('divDetailYoyChart');
      if (!canvas) return;
      chartInstances['divDetailYoyChart'] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: yrLabels,
          datasets: [{
            label: division,
            data: divCounts,
            backgroundColor: color + '88',
            borderColor: color,
            borderWidth: 2,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${division}: ${ctx.raw} players` } }
          },
          scales: {
            x: { ticks: { color:'#94a3b8' }, grid: { color:'rgba(255,255,255,0.05)' } },
            y: { ticks: { color:'#94a3b8' }, grid: { color:'rgba(255,255,255,0.07)' }, beginAtZero: true }
          }
        }
      });
      canvas.style.cursor = 'pointer';
    }, 80);
    return;
  }

  // ── MODES: returning or new — filtered list ───────────────────────────
  const filtered = mode === 'returning' ? returning : newOnes;
  const modeColor = mode === 'returning' ? 'var(--green)' : 'var(--blue2)';
  const modeLabel = mode === 'returning' ? 'Returning' : 'New';

  html += `<div style="font-family:Bebas Neue;font-size:14px;letter-spacing:.5px;color:${modeColor};margin-bottom:10px;">
    ${filtered.length} ${modeLabel} Player${filtered.length!==1?'s':''} — ${latestYr}
  </div>`;

  if (filtered.length === 0) {
    html += `<div class="empty">No ${modeLabel.toLowerCase()} players in this division.</div>`;
  } else {
    html += _divPlayerTable(filtered, prevKeys, prevYrPlayers, curYrPlayers, color, showAllStar, sport, division, mode);
  }

  document.getElementById('divDetailTitle').innerHTML =
    `<span style="color:${color};">${division}</span> — ${sport} <span style="color:${modeColor};font-size:14px;font-family:'DM Sans';">(${modeLabel})</span>`;
  document.getElementById('divDetailContent').innerHTML = html;
}

function _divPlayerTable(playerList, prevKeys, prevYrPlayers, curYrPlayers, color, showAllStar, sport, division, mode) {
  let html = `<div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:8px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Name</th>
        <th style="text-align:left;padding:8px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">City</th>
        <th style="text-align:left;padding:8px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Team</th>
        ${showAllStar ? `<th style="text-align:left;padding:8px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">All-Star</th>` : ''}
        ${mode === 'all' ? `<th style="text-align:left;padding:8px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Status</th>` : ''}
      </tr></thead><tbody>`;

  playerList.forEach(p => {
    const badge = (prevKeys.has(retentionKey(p)) || (_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p))))
      ? `<span class="badge badge-returning">Returning</span>`
      : `<span class="badge badge-new">New</span>`;
    const allstarBadge = p.allstar_division
      ? `<span class="badge" style="background:rgba(245,166,35,0.15);color:var(--gold);font-weight:700;">⭐ ${p.allstar_division}</span>`
      : `<span style="color:var(--text2);font-size:12px;">—</span>`;
    const pIdx = players.indexOf(p);
    html += `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:8px 10px;font-weight:600;cursor:pointer;" onclick="closeModal('divDetailModal');showJourney(${pIdx})" title="View player journey">
        <span style="border-bottom:1px dashed rgba(255,255,255,0.2);">${p.first} ${p.last}</span>
        ${((typeof canShowStats!=='function'||canShowStats())&&typeof GC_STATS!=='undefined'&&GC_STATS.some(s=>s.key===p.first.toLowerCase()+'|'+p.last[0]?.toUpperCase()))?'<span style="font-size:10px;color:var(--gold);margin-left:4px;">📊</span>':''}
      </td>
      <td style="padding:8px 10px;color:var(--text2);">${p.city||'—'}</td>
      <td style="padding:8px 10px;color:var(--text2);">${(p.team&&p.team!=='nan')?p.team:'—'}</td>
      ${showAllStar ? `<td style="padding:8px 10px;">${allstarBadge}</td>` : ''}
      ${mode === 'all' ? `<td style="padding:8px 10px;">${badge}</td>` : ''}
    </tr>`;
  });
  html += '</tbody></table></div>';
  return html;
}


 function computeTeamRetention() {
   const allYrs = years();
   const result = [];
   for (let i = 0; i < allYrs.length - 1; i++) {
     const y1 = allYrs[i], y2 = allYrs[i+1];
     // Use name-only key — a player moving from T-Ball to Rookies is still in the program
     const nextNameKeys = new Set(players.filter(p => p.year===y2).map(p => playerKey(p)));
     const teamGroups = {};
     players.filter(p => p.year===y1).forEach(p => {
       const t = (p.team||'').trim();
       if (!t || t.toLowerCase()==='nan' || t.toLowerCase()==='unallocated') return;
       if (!teamGroups[t]) teamGroups[t] = [];
       teamGroups[t].push(p);
     });
     for (const [team, tp] of Object.entries(teamGroups)) {
       const returned = tp.filter(p => nextNameKeys.has(playerKey(p))).length;
       const pct = Math.round(returned/tp.length*100);
       const coach = coachForTeam(team, y1);
       const sportCount = {};
       tp.forEach(p => { sportCount[p.sport]=(sportCount[p.sport]||0)+1; });
       const sport = Object.entries(sportCount).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
       result.push({fromYear:y1,toYear:y2,team,coach,total:tp.length,returned,pct,sport});
     }
   }
   return result;
 }


// ── Player position override helpers ─────────────────────────────────
const _POS_COLORS = {P:'#34d399',SP:'#10b981',C:'#f59e0b','1B':'#f97316','2B':'#60a5fa','3B':'#a78bfa',SS:'#ec4899',OF:'#818cf8',IF:'#38bdf8'};

function togglePlayerPosition(pKey, posId) {
  if (typeof USER_DATA === 'undefined') return;
  if (!USER_DATA.playerPositions) USER_DATA.playerPositions = {};
  const gcBase = (typeof gcInferPositions !== 'undefined') ? (() => {
    // Rebuild from key
    const [first, lastInit, sport] = pKey.split('|');
    const match = (typeof players !== 'undefined') ? players.find(p =>
      p.first.toLowerCase() === first && p.last[0]?.toUpperCase() === lastInit?.toUpperCase()
    ) : null;
    return match ? gcInferPositions(match) : [];
  })() : [];
  const current = USER_DATA.playerPositions[pKey] || [...gcBase];
  const idx = current.indexOf(posId);
  if (idx >= 0) current.splice(idx, 1); else current.push(posId);
  USER_DATA.playerPositions[pKey] = current;
  if (typeof saveUserData === 'function') saveUserData();
  // Refresh the position card in place
  const cardId = 'posCard_' + pKey.replace(/[^a-z0-9]/g,'_');
  const card = document.getElementById(cardId);
  if (!card) return;
  const [first, lastInit, sport] = pKey.split('|');
  const p = (typeof players !== 'undefined') ? players.find(pl =>
    pl.first.toLowerCase() === first && pl.last[0]?.toUpperCase() === lastInit?.toUpperCase()
  ) : null;
  if (p) {
    // Re-render just the picker buttons
    const POS_LIST = [
      {id:'P',short:'P',label:'Pitcher',color:'#34d399'},{id:'SP',short:'SP',label:'Starting P.',color:'#10b981'},
      {id:'C',short:'C',label:'Catcher',color:'#f59e0b'},{id:'1B',short:'1B',label:'1st Base',color:'#f97316'},
      {id:'2B',short:'2B',label:'2nd Base',color:'#60a5fa'},{id:'3B',short:'3B',label:'3rd Base',color:'#a78bfa'},
      {id:'SS',short:'SS',label:'Shortstop',color:'#ec4899'},{id:'OF',short:'OF',label:'Outfield',color:'#818cf8'},
      {id:'IF',short:'IF',label:'Infield',color:'#38bdf8'},
    ];
    const active = USER_DATA.playerPositions[pKey] || [];
    const grid = card.querySelector('.pos-picker-grid');
    if (!grid) return;
    grid.innerHTML = POS_LIST.map(pos => {
      const on = active.includes(pos.id);
      return `<button onclick="togglePlayerPosition('${pKey}','${pos.id}')" title="${pos.label}"
        style="display:flex;flex-direction:column;align-items:center;gap:3px;
          padding:10px 14px;border-radius:10px;cursor:pointer;transition:all .15s;
          background:${on?pos.color+'22':'rgba(255,255,255,.04)'};
          border:2px solid ${on?pos.color:'var(--border)'};min-width:60px;">
        <div style="font-family:Bebas Neue;font-size:22px;line-height:1;color:${on?pos.color:'var(--text2)'};">${pos.short}</div>
        <div style="font-size:9px;color:${on?pos.color:'var(--text2)'};opacity:.9;text-align:center;">${pos.label}</div>
      </button>`;
    }).join('');
  }
}

function clearPlayerPositions(pKey) {
  if (typeof USER_DATA === 'undefined') return;
  if (USER_DATA.playerPositions) delete USER_DATA.playerPositions[pKey];
  saveUserData(); // persist + cloud push
  toast('Position reset to GameChanger data');
  // Re-open the journey modal to reflect the change
  const [first, lastInit] = pKey.split('|');
  const p = players.find(pl =>
    pl.first.toLowerCase() === first &&
    (pl.last[0]?.toUpperCase() || '') === (lastInit?.toUpperCase() || '')
  );
  if (p) showJourney(players.indexOf(p));
}

// ── Off-Season Activity Log ────────────────────────────────────────────────
// Activities are stored in USER_DATA.playerActivity[nameKey] (synced to cloud)
// nameKey = 'first|last' lowercase

// ── Off-Season Activity — checkbox-based ──────────────────────────────────
// Stored in USER_DATA.playerActivity[nameKey] as a flat object of checked keys
// e.g. { fall_ball:true, fall_ball_pitch:true, clinic_league_2:true, clinic_pitch_1:true }

const ACTIVITY_SEASONS = [
  { id:'fall_ball',    label:'Fall Ball',    icon:'🍂' },
  { id:'summer_ball',  label:'Summer Ball',  icon:'☀️' },
  { id:'winter_ball',  label:'Winter Ball',  icon:'❄️' },
  { id:'travel_ball',  label:'Travel Ball',  icon:'✈️' },
];

const ACTIVITY_LEAGUE_CLINICS  = 6;  // League offers 6 clinics per season
const ACTIVITY_PITCH_CLINICS   = 3;  // Pitching-specific clinics

function activityKey(p) {
  return `${p.first}|${p.last}`.toLowerCase();
}

function getPlayerActivity(p) {
  if (!USER_DATA.playerActivity) USER_DATA.playerActivity = {};
  return USER_DATA.playerActivity[activityKey(p)] || {};
}

function setActivityFlag(p, key, value) {
  if (!USER_DATA.playerActivity) USER_DATA.playerActivity = {};
  const k = activityKey(p);
  if (!USER_DATA.playerActivity[k]) USER_DATA.playerActivity[k] = {};
  if (value) USER_DATA.playerActivity[k][key] = true;
  else delete USER_DATA.playerActivity[k][key];
  saveUserData();
}

// 0–20 activity bonus
function computeActivityScore(p) {
  const act = getPlayerActivity(p);
  let pts = 0;
  // Each season played = 3 pts, pitching role = +1, catching role = +0.5
  ACTIVITY_SEASONS.forEach(s => {
    if (act[s.id]) {
      pts += 3;
      if (act[s.id + '_pitch']) pts += 1;
      if (act[s.id + '_catch']) pts += 0.5;
    }
  });
  // League clinics = 1 pt each
  for (let i = 1; i <= ACTIVITY_LEAGUE_CLINICS; i++) {
    if (act[`clinic_league_${i}`]) pts += 1;
  }
  // Pitching clinics = 1.5 pts each
  for (let i = 1; i <= ACTIVITY_PITCH_CLINICS; i++) {
    if (act[`clinic_pitch_${i}`]) pts += 1.5;
  }
  return Math.min(20, Math.round(pts));
}

function activityTotals(p) {
  const act = getPlayerActivity(p);
  const seasons  = ACTIVITY_SEASONS.filter(s => act[s.id]).length;
  const lgClinics = Array.from({length:ACTIVITY_LEAGUE_CLINICS},(_,i)=>act[`clinic_league_${i+1}`]).filter(Boolean).length;
  const ptClinics = Array.from({length:ACTIVITY_PITCH_CLINICS}, (_,i)=>act[`clinic_pitch_${i+1}`]).filter(Boolean).length;
  return { seasons, lgClinics, ptClinics, events: seasons + lgClinics + ptClinics,
           innings:0, hours:0, types:[] };
}

// Division difficulty ranking
const DIV_DIFFICULTY = {
  'T-Ball':0,'Farm':1,'Rookies':2,'10U':2,'Minors':3,'12U':3,'Majors':4,'Senior':4
};

function divAdjustedGrade(gradeLetter, fromDiv, toDiv) {
  const gradeScale = ['D','C','C+','B','B+','A','A+'];
  const drop = Math.max(0, (DIV_DIFFICULTY[toDiv]||0) - (DIV_DIFFICULTY[fromDiv]||0));
  if (!drop || !gradeLetter) return gradeLetter;
  const idx = gradeScale.indexOf(gradeLetter);
  return idx >= 0 ? (gradeScale[Math.max(0, idx - drop * 2)] || 'D') : gradeLetter;
}

// ── Activity section HTML (checkbox-based) ────────────────────────────────
function _activityLogHtml(playerIdx, p) {
  const act   = getPlayerActivity(p);
  const score = computeActivityScore(p);
  const tots  = activityTotals(p);
  const scoreColor = score>=12?'#10b981':score>=6?'#60a5fa':score>=2?'#f5a623':'var(--text2)';

  // Helper: checkbox toggle button
  const chk = (key, label, color='var(--text)') => {
    const on = !!act[key];
    return `<button onclick="setActivityFlag(players[${playerIdx}],'${key}',${!on});setTimeout(()=>_refreshActivitySection(${playerIdx}),30);"
      style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:6px;cursor:pointer;
             font-size:11px;font-family:'DM Sans';white-space:nowrap;transition:all .12s;
             background:${on?'rgba(16,185,129,0.15)':'rgba(255,255,255,0.04)'};
             border:1px solid ${on?'rgba(16,185,129,0.5)':'rgba(255,255,255,0.12)'};
             color:${on?'#10b981':color};">
      <span style="font-size:13px;">${on?'☑':'☐'}</span> ${label}
    </button>`;
  };

  // Sub-options (pitch/catch) shown only when season is checked
  const subChk = (key, label, icon) => {
    const on = !!act[key];
    return `<button onclick="setActivityFlag(players[${playerIdx}],'${key}',${!on});setTimeout(()=>_refreshActivitySection(${playerIdx}),30);"
      style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:5px;cursor:pointer;
             font-size:10px;font-family:'DM Sans';white-space:nowrap;transition:all .12s;margin-left:6px;
             background:${on?'rgba(96,165,250,0.15)':'rgba(255,255,255,0.03)'};
             border:1px solid ${on?'rgba(96,165,250,0.4)':'rgba(255,255,255,0.08)'};
             color:${on?'#60a5fa':'var(--text2)'};">
      ${icon} ${label}
    </button>`;
  };

  // Summary bar
  const summaryBadges = [
    tots.seasons  ? `<span style="padding:2px 8px;border-radius:5px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);font-size:10px;color:#10b981;">🏟️ ${tots.seasons} season${tots.seasons!==1?'s':''}</span>` : '',
    tots.lgClinics? `<span style="padding:2px 8px;border-radius:5px;background:rgba(96,165,250,0.12);border:1px solid rgba(96,165,250,0.3);font-size:10px;color:#60a5fa;">📋 ${tots.lgClinics}/${ACTIVITY_LEAGUE_CLINICS} clinics</span>` : '',
    tots.ptClinics? `<span style="padding:2px 8px;border-radius:5px;background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.3);font-size:10px;color:#a78bfa;">🎯 ${tots.ptClinics}/${ACTIVITY_PITCH_CLINICS} pitch clinics</span>` : '',
  ].filter(Boolean).join('');

  return `<div class="card" style="margin-top:14px;" id="activityCard_${playerIdx}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <div class="card-title" style="margin-bottom:0;">🗓️ Off-Season <span class="accent">Activity</span></div>
      ${score>0 ? `<div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
        ${summaryBadges}
        <span style="font-family:'Bebas Neue';font-size:20px;color:${scoreColor};margin-left:4px;">+${score} pts</span>
      </div>` : ''}
    </div>

    <!-- Seasons -->
    <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">Seasons Played</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
      ${ACTIVITY_SEASONS.map(s => `
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
          ${chk(s.id, s.icon+' '+s.label)}
          ${act[s.id] ? subChk(s.id+'_pitch','Pitching','⚾') + subChk(s.id+'_catch','Catching','🎯') : ''}
        </div>`).join('')}
    </div>

    <!-- League Clinics -->
    <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">
      League Clinics
      <span style="font-size:9px;font-weight:400;color:var(--text2);text-transform:none;letter-spacing:0;margin-left:4px;">
        (${Array.from({length:ACTIVITY_LEAGUE_CLINICS},(_,i)=>act[`clinic_league_${i+1}`]).filter(Boolean).length}/${ACTIVITY_LEAGUE_CLINICS} attended)
      </span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
      ${Array.from({length:ACTIVITY_LEAGUE_CLINICS},(_,i) =>
        chk(`clinic_league_${i+1}`, `Clinic ${i+1}`)
      ).join('')}
    </div>

    <!-- Pitching Clinics -->
    <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">
      Pitching Clinics
      <span style="font-size:9px;font-weight:400;color:var(--text2);text-transform:none;letter-spacing:0;margin-left:4px;">
        (${Array.from({length:ACTIVITY_PITCH_CLINICS},(_,i)=>act[`clinic_pitch_${i+1}`]).filter(Boolean).length}/${ACTIVITY_PITCH_CLINICS} attended)
      </span>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${Array.from({length:ACTIVITY_PITCH_CLINICS},(_,i) =>
        chk(`clinic_pitch_${i+1}`, `Pitching Clinic ${i+1}`, 'var(--text)')
      ).join('')}
    </div>
  </div>`;
}

function _refreshActivitySection(playerIdx) {
  const el = document.getElementById(`activityCard_${playerIdx}`);
  const p = players[playerIdx];
  if (el && p) el.outerHTML = _activityLogHtml(playerIdx, p);
}

//
// If a JSONBin API key is configured (Settings → Cloud Sync),
// accounts are stored in the cloud and work on any device.
// Without a key it falls back to localStorage-only (same device).
//
// Cloud structure (all under one JSONBin account):
//   Master bin  → { users: { username: { id, pwHash, binId } } }
//   Per-user bin → { data: { ...all lll_username_ keys } }
// ═══════════════════════════════════════════════════════════

const AUTH_SESSION_KEY = 'lll_session';
const AUTH_LOCAL_KEY   = 'lll_users';         // fallback local users
const JSONBIN_KEY_KEY  = 'lll_jsonbin_key';   // stored API key
const JSONBIN_DIR_KEY  = 'lll_jsonbin_dir';   // master bin ID

// ── JSONBin helpers ───────────────────────────────────────
function jbApiKey()  { return localStorage.getItem(JSONBIN_KEY_KEY) || ''; }
function jbDirBin()  { return localStorage.getItem(JSONBIN_DIR_KEY) || ''; }
function jbEnabled() { return !!(jbApiKey() && jbDirBin()); }

async function jbGet(binId) {
  const r = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    headers: { 'X-Master-Key': jbApiKey() }
  });
  if (!r.ok) throw new Error('fetch failed ' + r.status);
  const j = await r.json();
  return j.record;
}

async function jbSet(binId, data) {
  const r = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': jbApiKey() },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error('put failed ' + r.status);
  return (await r.json()).record;
}

async function jbCreate(name, data) {
  const r = await fetch('https://api.jsonbin.io/v3/b', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': jbApiKey(),
      'X-Bin-Name': name,
      'X-Bin-Private': 'true'
    },
    body: JSON.stringify(data)
  });
  if (!r.ok) {
    if (r.status === 403) throw new Error('create failed 403 — Check your JSONBin API key in Settings. You need a Master Key (starts with $2b$), not an Access Key. Or your free-tier bin limit (100) may be reached.');
    throw new Error('create failed ' + r.status);
  }
  return (await r.json()).metadata.id;
}

// Create or retrieve the master directory bin
async function jbGetDir() {
  const stored = jbDirBin();
  if (stored) {
    try { return await jbGet(stored); }
    catch { /* bin may have been deleted or this is the wrong bin */ }
  }
  // Try to find the existing lybs-users directory via the JSONBin collections API
  try {
    const r = await fetch('https://api.jsonbin.io/v3/c', {
      headers: { 'X-Master-Key': jbApiKey() }
    });
    if (r.ok) {
      const j = await r.json();
      const bins = j.result || [];
      // Find the master directory bin (named 'lybs-users')
      const dirBin = bins.find(b => b.snippetMeta?.name === 'lybs-users' || b.name === 'lybs-users');
      if (dirBin) {
        const id = dirBin.id || dirBin._id;
        localStorage.setItem(JSONBIN_DIR_KEY, id);
        try { return await jbGet(id); } catch { }
      }
    }
  } catch { }
  // Last resort: create a fresh master bin (first-time setup only)
  const id = await jbCreate('lybs-users', { users: {} });
  localStorage.setItem(JSONBIN_DIR_KEY, id);
  return { users: {} };
}

// ── Tiny hash ─────────────────────────────────────────────
function _simpleHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// ── Local fallback helpers ────────────────────────────────
function _localGetUsers() {
  try { return JSON.parse(localStorage.getItem(AUTH_LOCAL_KEY) || '[]'); }
  catch { return []; }
}
function _localSaveUsers(arr) { localStorage.setItem(AUTH_LOCAL_KEY, JSON.stringify(arr)); }
// Aliases used elsewhere in the codebase
function authGetUsers()      { return _localGetUsers(); }
function authSaveUsers(arr)  { _localSaveUsers(arr); }

// ── Session ───────────────────────────────────────────────
function authCurrentUser() {
  try { return JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY)); }
  catch { return null; }
}
function authIsLoggedIn() { return !!authCurrentUser(); }
function authLogout() { sessionStorage.removeItem(AUTH_SESSION_KEY); location.reload(); }

// ── Per-user storage namespace ────────────────────────────
function userKey(base) {
  const u = authCurrentUser();
  return u ? `lll_${u.username}_${base}` : `lll_${base}`;
}

// ── USER_DATA persistence ─────────────────────────────────────────────────
// USER_DATA lives in memory and is mirrored to localStorage so _collectUserData
// picks it up and authCloudPush syncs it across devices.
function saveUserData() {
  try {
    localStorage.setItem(userKey('user_data'), JSON.stringify(USER_DATA));
  } catch(e) { console.warn('saveUserData failed', e); }
  setTimeout(authCloudPush, 600);
}

function loadUserData() {
  try {
    const stored = localStorage.getItem(userKey('user_data'));
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge into USER_DATA without wiping keys set by other systems
      Object.assign(USER_DATA, parsed);
    }
  } catch(e) {}
}
function _collectUserData(username) {
  const prefix = `lll_${username}_`;
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      try { data[k] = JSON.parse(localStorage.getItem(k)); }
      catch { data[k] = localStorage.getItem(k); }
    }
  }
  // Also include global feature flags so they sync across devices
  try {
    const flags = localStorage.getItem(FEATURE_FLAGS_KEY);
    if (flags) data['__feature_flags__'] = JSON.parse(flags);
  } catch(e) {}
  return data;
}

// ── Restore local data for a user ────────────────────────
function _restoreUserData(data) {
  if (!data) return;
  // Restore feature flags before iterating keys
  if (data['__feature_flags__']) {
    try {
      localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(data['__feature_flags__']));
    } catch(e) {}
  }
  Object.entries(data).forEach(([k, v]) => {
    if (k === '__feature_flags__') return; // already handled above
    // Local state wins for these keys — never overwrite local edits with stale cloud data.
    // Cloud data only applies on a fresh device (no local key at all).
    if (k.endsWith('_evals') && localStorage.getItem(k) !== null) return;
    if (k.endsWith('_user_data') && localStorage.getItem(k) !== null) return;
    if (k.endsWith('_saved_drafts') && localStorage.getItem(k) !== null) return;
    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  });
  // Also immediately apply player overrides from the restored data
  // so the in-memory `players` array reflects cloud state right away
  const overrideKey = Object.keys(data).find(k => k.endsWith('_players_override'));
  if (overrideKey) {
    try {
      const restored = typeof data[overrideKey] === 'string'
        ? JSON.parse(data[overrideKey]) : data[overrideKey];
      if (Array.isArray(restored) && restored.length > 0) {
        players = restored;
        // Nuke the generic stale key so loadPlayerOverrides can't revert to old data
        localStorage.removeItem('lll_players_override');
      }
    } catch(e) {}
  }
}

// ── Cloud push: save current user data to their bin ──────
async function authCloudPush() {
  if (!jbEnabled()) return;
  const u = authCurrentUser();
  if (!u) return;
  try {
    const dir = await jbGetDir();
    const entry = dir.users?.[u.username.toLowerCase()];
    if (!entry?.binId) return;
    const data = _collectUserData(u.username);
    await jbSet(entry.binId, { username: u.username, data, dirBinId: jbDirBin() });
  } catch(e) { console.warn('cloud push failed', e); }
}


// ── Force push local state to cloud (overwrites cloud with what's on screen) ──
async function forcePushToCloud() {
  const btn = document.getElementById('forcePushBtn');
  if (btn) { btn.textContent = '⬆ Pushing…'; btn.disabled = true; }
  if (!authCurrentUser()) { toast('Sign in first', 'error'); return; }
  if (!jbEnabled()) { toast('Cloud not configured', 'error'); return; }
  try {
    if (typeof saveDraftState === 'function') saveDraftState(); // flush current DRAFT state
    saveUserData();     // flush USER_DATA to localStorage
    await authCloudPush();
    toast('✓ Pushed to cloud — other devices will get this on next Sync');
    if (btn) { btn.textContent = '⬆ Pushed ✓'; setTimeout(() => { btn.textContent = '⬆ Force Push to Cloud'; btn.disabled = false; }, 2500); }
  } catch(e) {
    toast('Push failed: ' + e.message, 'error');
    if (btn) { btn.textContent = '⬆ Force Push to Cloud'; btn.disabled = false; }
  }
}

// ── Manual "Sync Now" button — pull-first bidirectional sync ──────────────
// IMPORTANT: Always pull from cloud FIRST so we never overwrite another device's
// changes with stale local data. After applying the cloud state, push local-only
// additions (coaches, evals, etc.) back up so both directions are merged.
async function manualCloudSync() {
  const btn  = document.getElementById('cloudSyncBtn');
  const btnM = document.getElementById('cloudSyncBtnMobile');

  function _syncBtnState(state) {
    const configs = {
      loading: { text: '☁️ Syncing…', color: '#60a5fa', border: 'rgba(96,165,250,.4)', disabled: true },
      done:    { text: '☁️ Synced ✓', color: '#10b981', border: 'rgba(16,185,129,.5)',  disabled: false },
      idle:    { text: '☁️ Sync',     color: '#60a5fa', border: 'rgba(96,165,250,.4)',  disabled: false },
    };
    const c = configs[state] || configs.idle;
    [btn, btnM].forEach(b => {
      if (!b) return;
      b.textContent = state === 'loading' ? c.text : (b === btnM ? c.text + ' to Cloud' : c.text);
      b.style.color = c.color;
      b.style.borderColor = c.border;
      b.disabled = c.disabled;
    });
  }

  if (!authCurrentUser()) { toast('Sign in first to sync to cloud', 'error'); return; }
  if (!jbEnabled()) { toast('Cloud not configured — check Settings → Cloud Sync', 'error'); return; }

  _syncBtnState('loading');
  try {
    const u   = authCurrentUser();
    const dir = await jbGetDir();
    let entry = dir.users?.[u.username.toLowerCase()];

    if (!entry?.binId) {
      // Account not in cloud directory — auto-register this local account
      // This happens when the account was created before cloud was set up,
      // or the sync link was opened on a new device for the first time.
      toast('☁️ Registering account in cloud…', 'info');
      try {
        // Create a personal bin for this user and add them to the directory
        const binId = await jbCreate('lybs-user-' + u.username,
          { username: u.username, data: _collectUserData(u.username), dirBinId: jbDirBin() });
        dir.users = dir.users || {};
        dir.users[u.username.toLowerCase()] = {
          id: Date.now(), username: u.username,
          pwHash: (_localGetUsers().find(x => x.username.toLowerCase() === u.username.toLowerCase())?.pwHash || ''),
          binId
        };
        await jbSet(jbDirBin(), dir);
        entry = dir.users[u.username.toLowerCase()];
        toast('✓ Account registered in cloud — syncing now…');
      } catch(regErr) {
        toast('Could not register account: ' + (regErr.message || regErr), 'error');
        _syncBtnState('idle'); return;
      }
    }

    // ── Step 1: Pull latest cloud state first ──────────────────────────────
    const rec = await jbGet(entry.binId);
    if (rec?.data) {
      _restoreUserData(rec.data);
      loadUserData();
      loadPlayerOverrides();
      // Apply draft pre-assignments and pick history to the live DRAFT object
      if (typeof loadDraftState === 'function') loadDraftState();
      if (typeof applyFeatureFlags === 'function') applyFeatureFlags();
      refreshAll();
      if (typeof renderDraftSavedList === 'function') setTimeout(renderDraftSavedList, 200);
    }

    // ── Step 2: Flush local state and push merged result back to cloud ──────
    localStorage.setItem(userKey('players_override'), JSON.stringify(players));
    saveUserData();
    // Always ensure evals + coaches keys exist (even if empty) so deletions sync correctly
    try { if (!localStorage.getItem(userKey('evals'))) localStorage.setItem(userKey('evals'), '[]'); } catch(e) {}
    try { if (!localStorage.getItem(userKey('coaches'))) localStorage.setItem(userKey('coaches'), '[]'); } catch(e) {}
    // Push current feature flags alongside user data
    try {
      const flags = localStorage.getItem(FEATURE_FLAGS_KEY);
      if (!flags) localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify({}));
    } catch(e) {}
    await authCloudPush();

    toast('✓ Synced — up to date with all devices!');
    _syncBtnState('done');
    setTimeout(() => _syncBtnState('idle'), 3000);
  } catch(e) {
    const msg = e.message || '';
    if (msg.includes('403')) {
      toast('Sync failed: API key issue — go to Settings and re-enter your JSONBin Master Key', 'error');
    } else {
      toast('Sync failed — check your connection', 'error');
    }
    _syncBtnState('idle');
  }
}
// ── Register ──────────────────────────────────────────────
async function authRegister(username, password) {
  const user = username.trim();
  const pass = password.trim();
  if (!user || !pass) return { ok: false, msg: 'Username and password required' };
  if (pass.length < 4) return { ok: false, msg: 'Password must be at least 4 characters' };
  const pwHash = _simpleHash(pass);

  if (jbEnabled()) {
    try {
      const dir = await jbGetDir();
      dir.users = dir.users || {};
      if (dir.users[user.toLowerCase()]) return { ok: false, msg: 'Username already taken' };

      // Create per-user bin
      const binId = await jbCreate(`lybs-user-${user}`, { username: user, data: {} });

      // Register in directory
      dir.users[user.toLowerCase()] = { id: Date.now(), username: user, pwHash, binId };
      await jbSet(jbDirBin(), dir);

      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: user }));
      return { ok: true };
    } catch(e) {
      return { ok: false, msg: 'Cloud error: ' + e.message };
    }
  }

  // Local fallback
  const users = _localGetUsers();
  if (users.some(u => u.username.toLowerCase() === user.toLowerCase())) {
    return { ok: false, msg: 'Username already taken' };
  }
  users.push({ id: Date.now(), username: user, pwHash });
  _localSaveUsers(users);
  sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: user }));
  return { ok: true };
}

// ── Login ─────────────────────────────────────────────────
async function authLogin(username, password) {
  const user = username.trim();
  const pwHash = _simpleHash(password.trim());

  if (jbEnabled()) {
    try {
      const dir = await jbGetDir();
      let entry = dir.users?.[user.toLowerCase()];

      // Not in cloud — check if they exist locally and auto-migrate
      if (!entry) {
        const localUsers = _localGetUsers();
        const localUser  = localUsers.find(u => u.username.toLowerCase() === user.toLowerCase());
        if (!localUser) return { ok: false, msg: 'Username not found' };
        if (localUser.pwHash !== pwHash) return { ok: false, msg: 'Incorrect password' };

        // Migrate: push user + their data up to the cloud
        const binId = await jbCreate('lybs-user-' + localUser.username,
          { username: localUser.username, data: _collectUserData(localUser.username) });
        dir.users = dir.users || {};
        dir.users[user.toLowerCase()] = { id: localUser.id, username: localUser.username,
          pwHash: localUser.pwHash, binId };
        // Ensure coach profile entry
        dir.coaches = dir.coaches || {};
        if (!dir.coaches[user.toLowerCase()]) {
          dir.coaches[user.toLowerCase()] = {
            username: localUser.username,
            displayName: localUser.username.replace(/_/g, ' '),
            teams: [], joinedAt: new Date().toISOString(),
            sharing: { evals: false, drafts: false }
          };
        }
        await jbSet(jbDirBin(), dir);
        entry = dir.users[user.toLowerCase()];
        toast('Account migrated to cloud — works on all devices now');
      }

      if (entry.pwHash !== pwHash) return { ok: false, msg: 'Incorrect password' };

      // Restore user data from their bin
      if (entry.binId) {
        try {
          const rec = await jbGet(entry.binId);
          // Store the dir bin ID so Sync works without needing the setup URL again
          if (rec.dirBinId && !jbDirBin()) localStorage.setItem(JSONBIN_DIR_KEY, rec.dirBinId);
          _restoreUserData(rec.data);
          loadUserData();          // merge USER_DATA (positions etc) from restored localStorage
          loadPlayerOverrides();   // apply any player edits synced from another device
          if (typeof loadDraftState === 'function') loadDraftState(); // apply draft pre-assignments
          if (typeof applyFeatureFlags === 'function') applyFeatureFlags();
        } catch(e) { console.warn('data restore failed', e); }
      }

      // Ensure coach profile exists in shared directory (backfills pre-existing accounts)
      dir.coaches = dir.coaches || {};
      if (!dir.coaches[entry.username.toLowerCase()]) {
        dir.coaches[entry.username.toLowerCase()] = {
          username: entry.username,
          displayName: entry.username.replace(/_/g, ' '),
          teams: [],
          joinedAt: new Date().toISOString(),
          sharing: { evals: false, drafts: false }
        };
        await jbSet(jbDirBin(), dir);
      }

      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: entry.username }));
      // Cache credentials locally so offline login works when cloud is unreachable
      try { sessionStorage.setItem('lll_last_user', JSON.stringify({ username: entry.username, pwHash })); } catch(ex) {}
      const _lu = _localGetUsers(); if (!_lu.some(u=>u.username.toLowerCase()===entry.username.toLowerCase())) { _lu.push({id:entry.id||Date.now(),username:entry.username,pwHash}); _localSaveUsers(_lu); }
      return { ok: true };
    } catch(e) {
      console.error('cloud login error', e);
      // ── Cloud is down — try local credentials as offline fallback ────────
      // This lets coaches sign in during JSONBin outages or network issues.
      // Data will sync next time cloud is reachable.
      const localUsers = _localGetUsers();
      const localUser  = localUsers.find(u => u.username.toLowerCase() === user.toLowerCase());
      if (localUser && localUser.pwHash === pwHash) {
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: localUser.username }));
        toast('⚠️ Signed in offline — cloud unavailable, data will sync when reconnected', 'error');
        return { ok: true, offline: true };
      }
      // If no local record either, check sessionStorage cached username as last resort
      const cached = (() => { try { return JSON.parse(sessionStorage.getItem('lll_last_user')||'null'); } catch { return null; }})();
      if (cached && cached.username.toLowerCase() === user.toLowerCase() && cached.pwHash === pwHash) {
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: cached.username }));
        toast('⚠️ Signed in from cache — offline mode', 'error');
        return { ok: true, offline: true };
      }
      return { ok: false, msg: 'Cloud unreachable and no local account found. Check connection or use offline bypass.' };
    }
  }

  // Local fallback
  const users = _localGetUsers();
  const u = users.find(u => u.username.toLowerCase() === user.toLowerCase());
  if (!u) return { ok: false, msg: 'Username not found' };
  if (u.pwHash !== pwHash) return { ok: false, msg: 'Incorrect password' };
  sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: u.username }));
  return { ok: true };
}

// ── Test API key + bootstrap directory bin ────────────────
async function authTestAndSaveKey(apiKey) {
  if (!apiKey.trim()) {
    localStorage.removeItem(JSONBIN_KEY_KEY);
    localStorage.removeItem(JSONBIN_DIR_KEY);
    toast('Cloud sync disabled');
    return { ok: true };
  }
  localStorage.setItem(JSONBIN_KEY_KEY, apiKey.trim());
  localStorage.removeItem(JSONBIN_DIR_KEY); // force fresh lookup
  try {
    await jbGetDir(); // creates master bin if needed
    toast('✓ Cloud sync enabled — all logins will sync across devices');
    return { ok: true };
  } catch(e) {
    localStorage.removeItem(JSONBIN_KEY_KEY);
    return { ok: false, msg: 'Invalid API key or connection error' };
  }
}

// ── Export/import (manual fallback) ──────────────────────
function authExportAccount() {
  const u = authCurrentUser();
  if (!u) return;
  const localUsers = _localGetUsers();
  const me = localUsers.find(x => x.username === u.username) ||
             { username: u.username, pwHash: '' };
  const blob = new Blob([JSON.stringify({ _lybs:1, user: me,
    data: _collectUserData(u.username) }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `LYBS_${u.username}.json`; a.click();
  URL.revokeObjectURL(url);
  toast('Exported');
}

function authImportAccount(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const payload = JSON.parse(e.target.result);
      const user = payload.user;
      if (!user?.username || !user?.pwHash) { alert('Invalid file.'); return; }
      const users = _localGetUsers();
      const idx = users.findIndex(x => x.username.toLowerCase() === user.username.toLowerCase());
      if (idx >= 0) users[idx] = user; else users.push(user);
      _localSaveUsers(users);
      _restoreUserData(payload.data);
      loadUserData();
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: user.username }));
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appRoot').style.display = '';
      initApp();
    } catch(err) { alert('Could not read file: ' + err.message); }
  };
  reader.readAsText(file);
}

// ── Feature Flags (Admin-controlled, globally visible) ────────────────────
// Stored under a fixed key (not user-scoped) so the admin sets once and all
// users see the same state. Only Coach_Steele / configured admin can change.
const FEATURE_FLAGS_KEY = 'lll_feature_flags';
const FEATURE_FLAGS_DEFAULTS = {
  showEvals:    false,  // Evals tab visible to all users
  showCompare:  false,  // Compare player button in stats modal
  showRankings: false,  // League rankings section in stats modal
  showActivity: false,  // Off-season activity, box scores, Add Stats, pitch history
  showPlayerStats: false, // Show player stats (off by default) — hides ALL player stats, rankings, positions for everyone including admin
};

function featureFlagsGet() {
  try {
    const stored = JSON.parse(localStorage.getItem(FEATURE_FLAGS_KEY) || '{}');
    return { ...FEATURE_FLAGS_DEFAULTS, ...stored };
  } catch { return { ...FEATURE_FLAGS_DEFAULTS }; }
}

function featureFlagsSet(key, val) {
  if (!isAdmin()) return; // Guard: only admin can change
  const flags = featureFlagsGet();
  flags[key] = val;
  localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(flags));
  applyFeatureFlags();
}

// ── Admin Preview Mode ────────────────────────────────────────────────────
// Stored in sessionStorage so it only affects the current tab and never persists.
// When active, all gate functions behave as if the user is NOT admin, letting
// the admin see exactly what regular users see.
const PREVIEW_MODE_KEY = 'lll_admin_preview_mode';

function isPreviewMode() {
  return sessionStorage.getItem(PREVIEW_MODE_KEY) === 'true';
}

function previewModeToggle() {
  if (!isAdmin()) return;
  const on = !isPreviewMode();
  if (on) {
    sessionStorage.setItem(PREVIEW_MODE_KEY, 'true');
  } else {
    sessionStorage.removeItem(PREVIEW_MODE_KEY);
  }
  _applyPreviewBanner();
  applyFeatureFlags();
  updateHeader();
  // Re-render everything so the view switches immediately
  renderOverview();
  renderRoster();
  renderManage();
  // Re-render draft if open
  if (typeof renderAvailablePlayers === 'function' &&
      typeof DRAFT !== 'undefined' && DRAFT.allPlayers?.length) {
    renderAvailablePlayers();
  }
  toast(on
    ? '👁 Preview Mode ON — seeing app as a regular user'
    : '✅ Back to admin view',
    on ? 'warning' : 'success'
  );
}

function _applyPreviewBanner() {
  const preview = isPreviewMode();

  // ── Header button: only visible to real admins, glows orange when active ──
  ['previewModeHeaderBtn', 'previewModeHeaderBtnMobile'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    // Only show to real admin (isAdmin() still returns true regardless of preview)
    btn.style.display = isAdmin() ? '' : 'none';
    if (preview) {
      btn.style.background = 'rgba(249,115,22,0.18)';
      btn.style.borderColor = '#f97316';
      btn.title = 'Exit Preview Mode';
    } else {
      btn.style.background = 'transparent';
      btn.style.borderColor = 'rgba(249,115,22,0.4)';
      btn.title = 'Preview as regular user';
    }
  });

  // ── Bottom banner ──────────────────────────────────────────────────────
  let banner = document.getElementById('adminPreviewBanner');
  if (preview) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'adminPreviewBanner';
      banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9000;' +
        'background:linear-gradient(90deg,#f97316,#f5a623);color:#000;' +
        'padding:8px 16px;display:flex;align-items:center;gap:10px;' +
        'font-family:"DM Sans",sans-serif;font-size:13px;font-weight:700;' +
        'box-shadow:0 -2px 12px rgba(249,115,22,0.5);';
      banner.innerHTML =
        '<span>👁 Preview Mode — you\'re seeing the app as a regular user</span>' +
        '<button onclick="previewModeToggle()" style="margin-left:auto;padding:5px 16px;' +
        'border-radius:20px;border:2px solid rgba(0,0,0,0.3);background:rgba(0,0,0,0.15);' +
        'font-weight:800;font-size:12px;cursor:pointer;font-family:\'DM Sans\';color:#000;">' +
        '✕ Exit Preview</button>';
      document.body.appendChild(banner);
    }
  } else {
    if (banner) banner.remove();
  }
}

// Returns true if player stats, rankings, and position history are visible.
// draftMode suppresses ALL of these for EVERYONE including admin.
function canShowStats() {
  return !!featureFlagsGet().showPlayerStats;
}

function applyFeatureFlags() {
  const flags  = featureFlagsGet();
  const admin  = isAdmin() && !isPreviewMode();
  const draft  = !flags.showPlayerStats;

  // ── Draft Mode body class (CSS hides stat elements everywhere) ─────────
  document.body.classList.toggle('draft-mode', draft);

  // ── Evals tab ──────────────────────────────────────────────────────────
  const evalsTab = document.querySelector('[data-tab="evals"]');
  if (evalsTab) {
    evalsTab.style.display = (admin || flags.showEvals) ? '' : 'none';
  }

  // ── Compare button in stats modal ──────────────────────────────────────
  const compareBtn = document.getElementById('statsCompareBtn');
  if (compareBtn) {
    compareBtn.style.display = (flags.showPlayerStats && (admin || flags.showCompare)) ? '' : 'none';
  }

  // ── Eval scores on draft board cards — handled inline via canShowEvalData() ──
  if (typeof renderAvailablePlayers === 'function' &&
      typeof DRAFT !== 'undefined' && DRAFT.allPlayers?.length) {
    renderAvailablePlayers();
  }

  // GC Stats import button — only visible to admin when stats are enabled
  const gcBtn = document.getElementById('gcStatsBtn');
  const gcBtnOvf = document.getElementById('gcStatsBtnOverflow');
  const showGC = admin && flags.showPlayerStats;
  if (gcBtn) gcBtn.style.display = showGC ? '' : 'none';
  if (gcBtnOvf) gcBtnOvf.style.display = showGC ? '' : 'none';

  // Re-render roster to update stat badges
  if (typeof renderRoster === 'function') renderRoster();
}

// Returns true if the current viewer is allowed to see eval scores/grades/rankings
function canShowEvalData() {
  if (isAdmin() && !isPreviewMode()) return true;
  return featureFlagsGet().showEvals;
}

// Returns true if compare feature is enabled
function canShowCompare() {
  if (isAdmin() && !isPreviewMode()) return true;
  return featureFlagsGet().showCompare;
}

// Returns true if rankings are enabled
function canShowRankings() {
  if (isAdmin() && !isPreviewMode()) return true;
  return featureFlagsGet().showRankings;
}

// Returns true if off-season activity / box scores / add stats are visible
function canShowActivity() {
  if (isAdmin() && !isPreviewMode()) return true;
  return featureFlagsGet().showActivity;
}

// Toggle a flag (admin only) and re-sync the UI
function featureFlagsToggle(key) {
  if (!isAdmin()) return;
  const flags = featureFlagsGet();
  featureFlagsSet(key, !flags[key]);
  _renderFeatureFlagToggles();
  // Show toast confirmation
  const labels = { showEvals: 'Evaluations Tab', showCompare: 'Player Compare', showRankings: 'League Rankings', showActivity: 'Off-Season Activity', showPlayerStats: 'Player Stats' };
  const state = featureFlagsGet()[key] ? 'ON' : 'OFF';
  const col   = key === 'draftMode'
    ? (featureFlagsGet()[key] ? '#ef4444' : '#94a3b8')
    : (featureFlagsGet()[key] ? '#10b981' : '#94a3b8');
  const msg   = key === 'draftMode' && featureFlagsGet()[key]
    ? `🏆 <strong style="color:#ef4444;">Draft Mode ON</strong> — stats &amp; positions hidden`
    : `${labels[key] || key}: <strong style="color:${col};">${state}</strong>`;
  toast(msg);
}

// Sync the visual state of all toggle switches in the admin panel
function _renderFeatureFlagToggles() {
  const flags = featureFlagsGet();
  ['showEvals', 'showCompare', 'showRankings', 'showActivity'].forEach(key => {
    const el = document.getElementById('flagToggle_' + key);
    if (!el) return;
    const on = !!flags[key];
    el.style.background = on ? 'var(--green)' : 'rgba(255,255,255,0.12)';
    const dot = el.querySelector('div');
    if (dot) dot.style.left = on ? '21px' : '3px';
  });
  // Sync draft mode toggle (red when active)
  const draftEl = document.getElementById('flagToggle_showPlayerStats');
  if (draftEl) {
    const on = !!flags.showPlayerStats;
    draftEl.style.background = on ? 'var(--green)' : 'rgba(255,255,255,0.12)';
    const dot = draftEl.querySelector('div');
    if (dot) dot.style.left = on ? '21px' : '3px';
  }
  // Sync preview mode toggle (orange when active)
  const prevEl = document.getElementById('flagToggle_previewMode');
  if (prevEl) {
    const on = isPreviewMode();
    prevEl.style.background = on ? 'var(--orange)' : 'rgba(255,255,255,0.12)';
    const dot = prevEl.querySelector('div');
    if (dot) dot.style.left = on ? '21px' : '3px';
  }
}

// ── Settings ──────────────────────────────────────────────
const SETTINGS_DEFAULTS = {
  showDraftIcons:     false,   // ⚾🎯⭐ icons on draft cards
  showLeaderBadges:   false,   // league leader text badges
  showTop3Banner:     false,   // "Best Available" top 3 strip
  showGradeBadge:     true,    // A+/B letter grade on draft cards
  showPositions:      true,    // positions line on draft cards
  showScores:         false,   // show eval/grade numbers on cards (password protected)
};

function settingsGet() {
  try {
    const stored = JSON.parse(localStorage.getItem(userKey('settings')) || '{}');
    return { ...SETTINGS_DEFAULTS, ...stored };
  } catch { return { ...SETTINGS_DEFAULTS }; }
}

function settingsSave(obj) {
  localStorage.setItem(userKey('settings'), JSON.stringify(obj));
}

function settingsSet(key, val) {
  const s = settingsGet();
  s[key] = val;
  settingsSave(s);
  applySettings();
}

function applySettings() {
  const s = settingsGet();
  // Top3 banner
  const t3 = document.getElementById('draftTop3');
  if (t3 && !s.showTop3Banner) t3.style.display = 'none';
  // Re-render available players if draft is active
  if (typeof DRAFT !== 'undefined' && DRAFT.allPlayers?.length) {
    if (typeof renderAvailablePlayers === 'function') renderAvailablePlayers();
    if (s.showTop3Banner && typeof renderTop3Available === 'function') renderTop3Available();
  }
}

// ── Settings Modal ────────────────────────────────────────
function toggleHeaderOverflow() {
  const menu = document.getElementById('headerOverflowMenu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'flex';
  // Close when clicking outside
  if (!isOpen) {
    const close = (e) => {
      if (!menu.contains(e.target) && !e.target.closest('.header-overflow-btn')) {
        menu.style.display = 'none';
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }
}

function openSettings() {
  const s = settingsGet();
  const u = authCurrentUser();
  const el = document.getElementById('settingsModal');
  if (!el) return;

  document.getElementById('settingsContent').innerHTML = `
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
          color:var(--text2);margin-bottom:8px;">Account</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="font-size:16px;font-weight:700;">${u?.username || '—'}</div>
        <button class="btn btn-ghost btn-sm" onclick="authLogout()" style="margin-left:auto;font-size:11px;">Sign Out</button>
      </div>
      ${jbEnabled() ? `
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Sharing</div>
        <div style="font-size:11px;color:var(--text2);line-height:1.5;">
          Use the <strong style="color:var(--text);">↑ Share</strong> button on any saved evaluation or draft to choose exactly which coaches receive it.
          Nothing is shared automatically unless you send it.
        </div>
      </div>` : ''}
      ${(u?.username?.toLowerCase() === 'coach_steele') ? `
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;padding:10px 12px;" id="cloudSyncBox">
        <div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:4px;">☁️ Cloud Sync</div>
        ${jbEnabled()
          ? `<div style="font-size:11px;color:var(--green);margin-bottom:6px;">✓ Active — accounts sync across all devices automatically</div>`
          : `<div style="font-size:11px;color:var(--text2);margin-bottom:6px;">Not configured. Set up a free JSONBin API key, then share the Setup URL with all coaches.</div>`
        }
        <div style="margin-bottom:6px;">
          <input id="jbKeyInput" type="password" placeholder="JSONBin Master API key"
            value="${jbApiKey()}"
            style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;
                   padding:6px 10px;color:var(--text);font-size:12px;box-sizing:border-box;margin-bottom:6px;">
          <div style="display:flex;gap:6px;margin-bottom:8px;">
            <button class="btn btn-gold btn-sm" style="font-size:11px;flex:1;"
              onclick="authSaveCloudKey()">Save Key</button>
            <a href="https://jsonbin.io" target="_blank"
              style="font-size:10px;color:var(--text2);text-decoration:underline;align-self:center;">
              Get free key ↗
            </a>
          </div>
          ${jbEnabled() ? `
          <div style="border-top:1px solid var(--border);padding-top:8px;">
            <div style="font-size:11px;font-weight:700;margin-bottom:3px;">📎 Setup URL</div>
            <div style="font-size:10px;color:var(--text2);margin-bottom:5px;">
              Share this with coaches — opening it on any browser automatically configures cloud sync so they can create an account and log in.
            </div>
            <button class="btn btn-ghost btn-sm" style="font-size:11px;" onclick="authCopySetupUrl(this)">
              Copy Setup URL
            </button>
          </div>` : ''}
        </div>
        <div style="font-size:10px;color:var(--text2);">
          Free tier at jsonbin.io • ~2 min to set up • No credit card needed
        </div>
        ${(jbEnabled() && authCurrentUser()) ? '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);"><div style="font-size:11px;font-weight:700;margin-bottom:3px;">&#11014; Force Push</div><div style="font-size:10px;color:var(--text2);margin-bottom:6px;">Override the cloud with what\u2019s on this device \u2014 use after making changes you want to keep.</div><button id=\"forcePushBtn\" class=\"btn btn-ghost btn-sm\" style=\"font-size:11px;color:#f59e0b;border-color:rgba(245,158,11,.35);\" onclick=\"forcePushToCloud()\">&#11014; Force Push to Cloud</button></div>' : ''}
      </div>

      <!-- League PIN (admin only) -->
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:4px;">🔑 League PIN</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">
          Coaches must enter this PIN to create an account. Leave blank to disable.
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="leaguePinInput" type="text" placeholder="Set a PIN (e.g. LYBS2026)"
            value="${leaguePinGet()}"
            style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:6px;
                   padding:6px 10px;color:var(--text);font-size:13px;font-weight:700;letter-spacing:2px;">
          <button class="btn btn-gold btn-sm" style="font-size:11px;" onclick="
            const pin = document.getElementById('leaguePinInput').value;
            leaguePinSave(pin).then(() => toast(pin ? '✓ PIN saved' : 'PIN removed'));
          ">Save PIN</button>
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:10px;">
        <div style="font-size:11px;font-weight:700;color:var(--gold);margin-bottom:4px;">👤 Admin Account</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">
          Username with full admin access — Manage tab, PIN settings, Setup URL. Stored on this device.
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="adminUsernameInput" type="text" placeholder="e.g. coach_steele"
            value="${localStorage.getItem('lll_admin_username') || u?.username || ''}"
            style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:6px;
                   padding:6px 10px;color:var(--text);font-size:13px;">
          <button class="btn btn-gold btn-sm" style="font-size:11px;" onclick="
            const v = document.getElementById('adminUsernameInput').value.trim().toLowerCase();
            if(v){ localStorage.setItem('lll_admin_username', v); toast('✓ Admin username saved'); updateHeader(); }
          ">Save</button>
        </div>
      </div>
      ` : ''}
    </div>

    <!-- Facebook Integration -->
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
          color:var(--text2);margin-bottom:8px;">📘 Facebook Integration</div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:10px;line-height:1.5;">
          Connect your LYBS Facebook page to see post history, engagement trends, and how posts correlate with registration spikes.
          <a href="https://developers.facebook.com/tools/explorer/" target="_blank"
            style="color:var(--gold);text-decoration:none;display:block;margin-top:4px;">
            → Get a Page Access Token from Meta Graph Explorer ↗
          </a>
        </div>
        <div style="margin-bottom:8px;">
          <label style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">
            Page ID or username
          </label>
          <input id="fbPageIdInput" type="text"
            value="${typeof fbPageIdGet !== 'undefined' ? fbPageIdGet() : 'LunenburgYouthBaseballSoftball'}"
            placeholder="e.g. LunenburgYouthBaseballSoftball"
            style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;
                   padding:6px 10px;color:var(--text);font-size:12px;box-sizing:border-box;margin-bottom:8px;">
          <label style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">
            Page Access Token
          </label>
          <input id="fbTokenInput" type="password"
            value="${typeof fbTokenGet !== 'undefined' ? fbTokenGet() : ''}"
            placeholder="Paste your Page Access Token here"
            style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;
                   padding:6px 10px;color:var(--text);font-size:12px;box-sizing:border-box;margin-bottom:8px;">
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-gold btn-sm" style="font-size:11px;" onclick="
            const tok = document.getElementById('fbTokenInput').value.trim();
            const pid = document.getElementById('fbPageIdInput').value.trim();
            if (tok) { fbTokenSet(tok); if(pid) fbPageIdSet(pid); localStorage.removeItem('lll_fb_posts_cache');
              toast('✓ Facebook token saved — refreshing…');
              closeSettings(); renderSocialSection(); }
            else { fbTokenSet(''); toast('Token cleared'); closeSettings(); renderSocialSection(); }
          ">Save & Connect</button>
          ${typeof fbTokenGet !== 'undefined' && fbTokenGet() ? `
          <span style="font-size:10px;color:var(--green);">✓ Token configured</span>
          <button class="btn btn-ghost btn-sm" style="font-size:11px;margin-left:auto;" onclick="
            fbTokenSet(''); localStorage.removeItem('lll_fb_posts_cache');
            toast('Facebook disconnected'); closeSettings(); renderSocialSection();
          ">Disconnect</button>` : '<span style="font-size:10px;color:var(--text2);">Not connected</span>'}
        </div>
        <div style="font-size:10px;color:var(--text2);margin-top:8px;line-height:1.4;">
          Token is stored only in your browser's local storage. It needs <code>pages_read_engagement</code> permission.
          Tokens expire after ~60 days — you'll be prompted to refresh when needed.
        </div>
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
        color:var(--text2);margin-bottom:12px;">Draft Card Display</div>

    ${[
      { key:'showDraftIcons',   label:'⚾ Performance Icons',   desc:'Pitching, catching, all-star, ninja SB badges' },
      { key:'showLeaderBadges', label:'🏆 Leader Badges',       desc:'ERA Leader, K Leader, AVG Leader etc.' },
      { key:'showTop3Banner',   label:'📋 Best Available Banner', desc:'Top 3 picks shown in draft header' },
      { key:'showGradeBadge',   label:'📊 Grade Badge',         desc:'A+/B/C letter grade on draft cards' },
      { key:'showPositions',    label:'🎯 Positions',           desc:'Preferred positions line on cards' },
    ].map(row => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;">${row.label}</div>
          <div style="font-size:11px;color:var(--text2);">${row.desc}</div>
        </div>
        <div onclick="settingsToggle('${row.key}')" style="
            width:40px;height:22px;border-radius:11px;cursor:pointer;flex-shrink:0;
            background:${s[row.key]?'var(--green)':'rgba(255,255,255,0.12)'};
            position:relative;transition:background .2s;">
          <div style="position:absolute;top:3px;left:${s[row.key]?'21':'3'}px;
              width:16px;height:16px;border-radius:50%;background:#fff;transition:left .2s;"></div>
        </div>
      </div>`).join('')}
    <div style="margin-top:16px;padding:12px;border-radius:10px;border:1px solid rgba(245,166,35,${s.showScores?'0.4':'0.15'});background:rgba(245,166,35,${s.showScores?'0.08':'0.03'});">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div>
          <div style="font-size:13px;font-weight:700;">🔒 Show Eval Scores</div>
          <div style="font-size:11px;color:var(--text2);">Numbers hidden — enter code to reveal on cards</div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${s.showScores?'#10b981':'var(--text2)'}">${s.showScores?'ON':'OFF'}</span>
      </div>
      ${s.showScores
        ? `<button class="btn btn-ghost btn-sm" style="font-size:11px;" onclick="scoresLock()">Lock scores</button>`
        : `<div style="display:flex;gap:6px;"><input id="scoresPwInput" type="password" placeholder="Enter code…" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;" onkeydown="if(event.key==='Enter')scoresUnlockTry()"><button class="btn btn-gold btn-sm" onclick="scoresUnlockTry()">Unlock</button></div>`
      }
    </div>
  `;
  el.style.display = 'flex';
}

function settingsToggle(key) {
  const s = settingsGet();
  s[key] = !s[key];
  settingsSave(s);
  openSettings(); // re-render toggles
  applySettings();
}

function scoresUnlockTry() {
  const input = document.getElementById('scoresPwInput');
  if (!input) return;
  const code = input.value.trim().toUpperCase();
  // Password is LYBS + current year
  const expected = 'LYBS' + new Date().getFullYear();
  if (code === expected || code === 'SCORES' || code === 'DRAFT') {
    settingsSet('showScores', true);
    toast('✓ Scores unlocked');
    openSettings();
    if (typeof renderAvailablePlayers === 'function') renderAvailablePlayers();
  } else {
    input.value = '';
    input.placeholder = 'Wrong code — try again';
    input.style.borderColor = '#ef4444';
    setTimeout(() => { if(input){ input.placeholder = 'Enter code to unlock...'; input.style.borderColor = ''; }}, 1500);
  }
}

function scoresLock() {
  settingsSet('showScores', false);
  openSettings();
  if (typeof renderAvailablePlayers === 'function') renderAvailablePlayers();
  toast('Scores hidden');
}

function closeSettings() {
  const el = document.getElementById('settingsModal');
  if (el) el.style.display = 'none';
}

// ── League PIN ────────────────────────────────────────────────────────────
const LEAGUE_PIN_KEY = 'lll_league_pin';

function leaguePinGet() {
  return localStorage.getItem(LEAGUE_PIN_KEY) || '';
}
function leaguePinSet(pin) {
  if (pin) localStorage.setItem(LEAGUE_PIN_KEY, pin.trim());
  else localStorage.removeItem(LEAGUE_PIN_KEY);
}
async function leaguePinSync() {
  if (!jbEnabled()) return;
  try {
    const dir = await jbGetDir();
    if (dir.leaguePin) localStorage.setItem(LEAGUE_PIN_KEY, dir.leaguePin);
  } catch {}
}
async function leaguePinSave(pin) {
  leaguePinSet(pin);
  if (jbEnabled()) {
    try {
      const dir = await jbGetDir();
      dir.leaguePin = pin.trim();
      await jbSet(jbDirBin(), dir);
    } catch(e) { console.warn('PIN save failed', e); }
  }
}

// ── Auth screen ───────────────────────────────────────────
function renderAuthScreen() {
  const el = document.getElementById('authScreen');
  if (!el) return;
  el.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
        background:var(--navy);padding:20px;">
      <div style="width:100%;max-width:380px;">
        <div style="text-align:center;margin-bottom:32px;">
          <img src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz48c3ZnIGlkPSJiIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5MzAuNDkgMzg2LjQ2Ij48ZGVmcz48c3R5bGU+LmR7ZmlsbDojYjRiYmJmO30uZCwuZSwuZiwuZywuaCwuaSwuaiwuaywubCwubSwubiwubywucCwucXtzdHJva2Utd2lkdGg6MHB4O30uZXtmaWxsOiMwMzAzMDM7fS5mLC5rLC5we2ZpbGw6bm9uZTt9Lmd7ZmlsbDojMzYzOTNhO30uaHtmaWxsOiMyZTUyZTg7fS5pe2ZpbGw6IzdlODI4NDt9Lmp7ZmlsbDojMDIwMjAyO30ua3tzdHJva2U6IzAzMDMwMzt9LmssLnB7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO30ubHtmaWxsOiMwMDA7fS5te2ZpbGw6IzMwMzMzNTt9Lm57ZmlsbDojZmVmZWZlO30ub3tmaWxsOiMxYTJjYmQ7fS5we3N0cm9rZTojZmZmO30ucXtmaWxsOiNmZmY7fTwvc3R5bGU+PC9kZWZzPjxnIGlkPSJjIj48cGF0aCBjbGFzcz0iaiIgZD0iTTc2Ni44NCwzMTguNDdjLTUuMzEsMy45Mi0xMC42Miw3Ljg0LTE1LjkyLDExLjc2LTEuMTcuODctMi4zMSwxLjc4LTMuNDgsMi42NC0zLjgsMi43Ny03LjgyLDQuMTYtMTIuNzYsNC4wNC02Mi4zNi0xLjYtMTI0Ljc0LTEuNjItMTg3LjEyLTEuMzYtMTkuMDIuMDgtMzguMDQuNjYtNTcuMDUsMS40MS0xMy43LjU0LTI3LjM4LDEuNTYtNDEuMDQsMi42Ny0xNC4yMiwxLjE2LTI4LjQ0LDIuMjktNDIuNjcsMy4zOC0xMC42My44Mi0yMS4yMSwyLjE2LTMxLjgyLDMuMi03LjcuNzYtMTUuNDIsMS4zMy0yMy4xMiwyLjE0LTkuMjUuOTgtMTguNDYsMi4yNi0yNy43MiwzLjE2LTcuNTYuNzMtMTUuMDYsMS45My0yMi45LDIuOTMsMS4wNC00LjA1LDIuOTctNy40MSw0LjUyLTEwLjksNS44My0xMy4xLDExLjcyLTI2LjE3LDE4LjE2LTM4Ljk5LjczLTEuNDUsMS4wNi0yLjg2LDEuMDUtNC40Ny0uMDEtNTMuMDQsMC0xMDYuMDcuMDUtMTU5LjExLDAtMS44NS0uMzktMy40NC0xLjI3LTUuMDgtOC4wNS0xNC45OC0xNS41OS0zMC4yLTIxLjcxLTQ2LjA5LS4xOS0uNDgtLjY5LS45My0uMTUtMS45LDIxLjcyLDAsNDMuNjgsMCw2NS42MywwLDY3LjY3LS4wMiwxMzUuMzUtLjA5LDIwMy4wMi0uMDUsNTUuMjkuMDMsMTEwLjU4LjE5LDE2NS44Ny4yNCwyLjQ3LDAsNC41Mi43LDYuNTUsMi4wNSw3LjM2LDQuOTMsMTQuNDUsMTAuMjEsMjEuNTQsMTUuNTEuOTguNzMsMS45OCwxLjQ0LDMuMTgsMi4zMSw2LjY4LTUuMzEsMTMuNDUtMTAuNDcsMTkuOTYtMTUuOTQsMy4yOC0yLjc2LDYuNjYtMy45OSwxMS0zLjk2LDMwLjg1LjE1LDYxLjcxLjEsOTIuNTYuMDQsMi4xNiwwLDMuOS41NCw1LjUyLDEuODcsMTAuNjksOC43OCwyMS4xMiwxNy44NiwzMS4zNiwyNy4xNiwxLjgzLDEuNjcsMi40MywzLjM5LDIuNDIsNS44Mi0uMDYsNjIuMTYtLjA2LDEyNC4zMiwwLDE4Ni40NywwLDIuMjYtLjUzLDMuOTctMi4wNyw1LjcxLTkuNTEsMTAuNzYtMjAuMjUsMjAuMDYtMzIuMDIsMjguMjYtMy4wMiwyLjEtNi4wOCwyLjQ0LTkuNSwyLjA2LTEwLjA1LTEuMS0yMC4xMi0xLjkzLTMwLjIxLTIuNTgtNy43NC0uNS0xNS40Ni0xLjE5LTIzLjE5LTEuODEtNC4xNS0uMzMtOC4zMS0uMzktMTIuNDYtLjc0LTguNC0uNy0xNi44My0xLjAyLTI1LjI1LTEuNDktMi41NC0uMTQtNC44Mi0uOTctNi44LTIuNTctNS45My00LjgtMTEuODUtOS42My0xNy43OC0xNC40My0xLjM5LTEuMTItMi44MS0yLjE5LTQuMzYtMy4zOVpNNTcwLjYyLDMxNy4xNmMtNS43Ni05LjQyLTExLjExLTE4LjI3LTE2LjYxLTI3LjAzLS45Ni0xLjUyLTEuMzQtMi45Ni0xLjMyLTQuNjkuMjUtMTkuMTQuNDgtMzguMjguNjYtNTcuNDIuMDEtMS40Mi40Ny0yLjYxLDEuMDctMy44MiwxNC4wNy0yOC40LDI4LjA5LTU2LjgyLDQyLjI1LTg1LjE3LDIuODktNS43OCw2LjM0LTExLjI5LDkuNTktMTcuMDMsMi41Nyw0LjExLDQuODksNy45Miw3LjM0LDExLjY0Ljc4LDEuMTksMS4xNSwyLjMzLDEuMTUsMy43NCwwLDQ5LjMyLjAzLDk4LjY0LjA5LDE0Ny45NiwwLDEuNTQtLjQ1LDIuNzYtMS4yMSw0LjA3LTQuODksOC4zOS0xMC40NSwxNi4zNi0xNS41LDI0LjY1LS41NC44OS0xLjQ5LDEuNjUtMS4yOCwzLjI2LDE2LjkzLDAsMzMuODEtLjIxLDUwLjY4LjA1LDI4LjkzLjQ0LDU3Ljg2LDEuMjEsODYuOCwxLjI0LDEuOTEsMCwzLjQtLjUxLDQuOTItMS42NSw2LjkxLTUuMTcsMTMuODUtMTAuMzEsMjAuODktMTUuMjksMS41OS0xLjEzLDIuMDgtMi4yNiwyLjA4LTQuMTItLjA4LTI0LjU1LS4xLTQ5LjEtLjA2LTczLjY0LDAtMS44NC0uNTQtMy4wNi0xLjg5LTQuMzUtMy43LTMuNTQtNy44NS02LjU4LTExLjc0LTEwLjA3LDMuOTgtMy4zNyw3LjY5LTYuNjQsMTEuNTYtOS43MiwxLjQzLTEuMTQsMi4xNC0yLjIsMi4xMy00LjE0LS4xLTIyLjYzLS4xMS00NS4yNy0uMDYtNjcuOSwwLTEuOC0uNjEtMi44MS0yLjAxLTMuODQtNi43OC00Ljk3LTEzLjU4LTkuOTMtMjAuMTYtMTUuMTctMi45Ny0yLjM2LTUuOTktMy4zOS05LjgtMy40LTEwMC44OS0uNDItMjAxLjc5LS4yNS0zMDIuNjgtLjI1LS43OSwwLTEuNzQtLjQtMi40OS41LDMuNDcsNSw2Ljk5LDkuOTEsMTAuMzQsMTQuOTMsNC44Myw3LjI1LDEwLjc0LDEzLjgyLDE0LjU2LDIxLjcsMTMuNzEsMjguMjYsMjYuOTEsNTYuNzUsNDEuMjUsODQuNy42LDEuMTcuNjYsMi4zMi42NiwzLjU3LS4wNywxNy45LS4xNSwzNS44MS0uMTQsNTMuNzEsMCwyLjIxLS40OSw0LjEyLTEuNTEsNi4wNS00LjIsNy45OC04LjM0LDE1Ljk5LTEyLjQ1LDI0LjAxLS43MSwxLjM5LTEuNjQsMi43NS0xLjgzLDQuNjYsMzEuNDktMS4wOSw2Mi43Ni0yLjE5LDk0LjcyLTEuNzVaTTc3Mi41OCwyMzYuNjVjLS4xMS43Mi0uMjMsMS4xNi0uMjMsMS41OS4wMywxOS41OS4wOSwzOS4xOS4xLDU4Ljc4LDAsMS4yNS40NSwyLjA1LDEuMzcsMi44NSw3LjA5LDYuMjUsMTQuMjQsMTIuNDQsMjEuMTMsMTguODksMi4wMSwxLjg4LDQuMDUsMi40Niw2LjYxLDIuNTQsNS4xNy4xNywxMC4zMy40OCwxNS40OS44NCw3Ljg0LjU2LDE1LjY4LDEuMjMsMjMuNTIsMS44Myw2Ljk1LjUzLDEzLjksMS4wMSwyMC44NSwxLjU1LDguODQuNjksMTcuNjgsMS40MSwyNi41MiwyLjE2Ljc3LjA2LDEuMjgtLjIxLDEuODItLjY1LDguMjgtNi43NCwxNi43NC0xMy4yNiwyNC4zNS0yMC43OS45NS0uOTQsMS4yNi0xLjksMS4yNS0zLjI1LS4xLTI3LjM2LS4xOC01NC43Mi0uMTQtODIuMDksMC0xLjk1LS43Ni0yLjc3LTIuMy0zLjUzLTkuMTMtNC41MS0xOC4yMy05LjA5LTI3LjM1LTEzLjYzLTE2LjQxLTguMTctMzIuODEtMTYuMzUtNDkuMjUtMjQuNDctMS45My0uOTUtMi43Ni0yLjA3LTIuNzEtNC4zNS4xMS00LjUtLjI0LTktLjMyLTEzLjUtLjAzLTEuNjQtLjM5LTMuMzIuMjUtNC45aDIyLjQ0YzAsNS43NC4xNCwxMS4zNS0uMDcsMTYuOTQtLjA5LDIuMjcuNDMsMy4yNCwyLjcxLDQsMTEuNDksMy44MSwyMy4wOCw3LjMzLDM0LjY4LDEwLjc4LDYuNjYsMS45OCwxMy4yOSw0LjA2LDIwLjIyLDUuNjQsMC0yMi4xOC0uMDItNDQuMTMuMDUtNjYuMDksMC0xLjY1LS44OS0yLjQyLTEuODktMy4zLTYuMzUtNS41NS0xMi43OC0xMS4wMi0xOS4wMy0xNi42OC0xLjg5LTEuNzEtMy44Mi0yLjMtNi4zMi0yLjMtMjguOTQuMDQtNTcuODguMDEtODYuODItLjEtMi4wNCwwLTMuNDEuODQtNC44MSwxLjk3LTYuMTMsNC45NS0xMS43NSwxMC40OC0xNy43NCwxNS41OS0yLjgxLDIuMzktMy44NSw1LjAzLTMuODQsOC43MS4wNywyNC42Ni0uMDcsNDkuMzItLjE0LDczLjk4LDAsLjY0LS4yLDEuMzQuMzEsMS45OSwxLjcxLjkyLDMuNDUsMS45MSw1LjI0LDIuODEsMjQuOCwxMi41Niw0OS41OSwyNS4xNCw3NC40MywzNy42MSwxLjkzLjk3LDIuNTMsMi4wMiwyLjUsNC4wNy0uMTEsNS45Ny4wMSwxMS45NC0uMDEsMTcuOSwwLC44NC40MSwxLjgtLjYzLDIuNzMtNy43NC0uNTItMTUuNjctMS4wNi0yMy42My0xLjU5LS43Ni03LjA0LS44MS0xMy44Ny0uNzctMjAuNTUtMTkuMzgtNC42OS0zOC40MS05LjMxLTU3Ljg2LTE0LjAxWk00MDUuMzgsMjcxLjExYzAtMSwwLTEuNzgsMC0yLjU1LDAtNDAuOTguMTUtODEuOTctLjEtMTIyLjk1LS4wNC03LjI5LDEuMTMtMTMuNzYsNC45OS0yMC4wMSwzLjUxLTUuNjYsNi4yOS0xMS43OCw5LjM0LTE3LjcyLjQzLS44NCwxLjM0LTEuNTYsMS4xLTIuNDRoLTkyLjU4YzUuNTEsOC45Nyw5LjczLDE4LjE3LDE0LjQ1LDI3LjEuNzgsMS40OCwxLjM2LDIuOTcsMS4zNiw0Ljc0LS4wNyw1My44Mi0uMSwxMDcuNjQtLjEyLDE2MS40NiwwLDEuNzMtLjM4LDMuMjQtMS4xOSw0Ljc4LTMuMSw1LjkyLTYuMDgsMTEuOS05LjExLDE3Ljg2LTEuOTgsMy44OS0zLjk2LDcuNzctNi4wNywxMS45Miw0OS4yNS02LjQ3LDk4LjI4LTEwLjQ3LDE0Ny40Ni0xNC40OXYtNzEuODNjLTE0LjYyLDYuMjItMjkuMTUsMTIuMS00My40MiwxOC41Ni04LjI5LDMuNzUtMTYuNjQsNi4yNS0yNi4xMyw1LjU3Wk00MjIuMywyNDkuMzZjMTcuMzctNS44NSwzNC40My0xMS42LDUxLjY0LTE3LjM5LS42Ni0xLjIyLTEuMDUtMS44OS0xLjM5LTIuNTgtMTIuODktMjYuMTItMjUuODMtNTIuMjEtMzguNjQtNzguMzctMi43LTUuNTEtNi4wNy0xMC41NC05LjYzLTE1Ljk4LTEuMjIsMi4xNy0yLjA0LDMuODctMi4wNCw2LjE0LjA4LDM0LjguMDUsNjkuNTkuMDUsMTA0LjM5djMuNzlaTTU5Ni42NiwxNzUuNTdjLTguMzUsMTcuNTctMTYuMjgsMzQuNDItMjQuMzksNTEuMTgtMS41NiwzLjIyLTIuNCw2LjQxLTIuMzYsOS45Ni4xNiwxNS4xOS4yNSwzMC4zNy4zNiw0NS41NiwwLC43OCwwLDEuNTIuNDUsMi4yNiw0LjAyLDYuNjQsOCwxMy4zLDEyLjIyLDIwLjMxLDQuNjQtNy42Miw5LjExLTE0Ljk0LDEzLjU0LTIyLjI4LjI3LS40NS4yOS0xLjA4LjMyLTEuNjQuMjEtMy4xNC41NS02LjI3LjUzLTkuNDMtLjA1LTEzLjUtLjA1LTI3LS4wMS00MC41LjA1LTE4LjIyLS4xLTM2LjQzLS42Ni01NS40M1oiLz48cGF0aCBjbGFzcz0ibiIgZD0iTTU3MC42MiwzMTcuMTZjLTMxLjk2LS40NC02My4yMy42Ni05NC43MiwxLjc1LjE5LTEuOTEsMS4xMi0zLjI2LDEuODMtNC42Niw0LjExLTguMDMsOC4yNC0xNi4wNCwxMi40NS0yNC4wMSwxLjAyLTEuOTMsMS41MS0zLjg0LDEuNTEtNi4wNS0uMDEtMTcuOS4wNy0zNS44MS4xNC01My43MSwwLTEuMjUtLjA2LTIuNC0uNjYtMy41Ny0xNC4zNC0yNy45NS0yNy41NS01Ni40NC00MS4yNS04NC43LTMuODItNy44OC05LjczLTE0LjQ1LTE0LjU2LTIxLjctMy4zNC01LjAyLTYuODYtOS45Mi0xMC4zNC0xNC45My43Ni0uOSwxLjctLjUsMi40OS0uNSwxMDAuODksMCwyMDEuNzktLjE3LDMwMi42OC4yNSwzLjgyLjAyLDYuODMsMS4wNCw5LjgsMy40LDYuNTgsNS4yMywxMy4zOCwxMC4yLDIwLjE2LDE1LjE3LDEuNCwxLjAzLDIuMDEsMi4wNCwyLjAxLDMuODQtLjA1LDIyLjYzLS4wNCw0NS4yNy4wNiw2Ny45LDAsMS45My0uNywzLTIuMTMsNC4xNC0zLjg3LDMuMDctNy41OCw2LjM1LTExLjU2LDkuNzIsMy44OSwzLjQ5LDguMDQsNi41MiwxMS43NCwxMC4wNywxLjM1LDEuMjksMS44OSwyLjUxLDEuODksNC4zNS0uMDMsMjQuNTUtLjAxLDQ5LjEuMDYsNzMuNjQsMCwxLjg2LS40OCwyLjk5LTIuMDgsNC4xMi03LjA1LDQuOTgtMTMuOTksMTAuMTEtMjAuODksMTUuMjktMS41MiwxLjE0LTMuMDEsMS42NS00LjkyLDEuNjUtMjguOTQtLjAzLTU3Ljg3LS44LTg2LjgtMS4yNC0xNi44Ny0uMjUtMzMuNzYtLjA1LTUwLjY4LS4wNS0uMjEtMS42MS43NC0yLjM3LDEuMjgtMy4yNiw1LjA1LTguMjksMTAuNjEtMTYuMjUsMTUuNS0yNC42NS43Ni0xLjMsMS4yMS0yLjUzLDEuMjEtNC4wNy0uMDYtNDkuMzItLjA4LTk4LjY0LS4wOS0xNDcuOTYsMC0xLjQxLS4zNi0yLjU2LTEuMTUtMy43NC0yLjQ1LTMuNzItNC43Ny03LjU0LTcuMzQtMTEuNjQtMy4yNSw1Ljc0LTYuNywxMS4yNC05LjU5LDE3LjAzLTE0LjE2LDI4LjM1LTI4LjE4LDU2Ljc4LTQyLjI1LDg1LjE3LS42LDEuMjEtMS4wNiwyLjQtMS4wNywzLjgyLS4xOCwxOS4xNC0uNDEsMzguMjgtLjY2LDU3LjQyLS4wMiwxLjczLjM2LDMuMTcsMS4zMiw0LjY5LDUuNSw4Ljc2LDEwLjg1LDE3LjYyLDE2LjYxLDI3LjAzWk02MTMuODEsMzA3LjM1YzEwLjUxLDAsMjAuMy0uMDksMzAuMDkuMDIsMjkuMTUuMzIsNTguMzEuNyw4Ny40NiwxLjExLDEuNjkuMDIsMi45OS0uNDUsNC4zMi0xLjQ0LDMuOTctMi45NCw3Ljg3LTYuMDEsMTIuMDktOC41NiwzLjUxLTIuMTIsNC42NS00LjM3LDQuNTUtOC43OC0uMzktMTcuODktLjU5LTM1LjguMTctNTMuNjkuMTQtMy4yNS44OC02LjgzLS4xOS05LjY5LTEuMDMtMi43NS00LjU2LTQuMTQtNi45Mi02LjIxLTQuMDMtMy41My04LjM5LTYuNjgtMTIuMi0xMC41Miw1Ljg3LTUuMjYsMTEuNTUtMTAuMzgsMTcuMjktMTUuNDUsMS4yMS0xLjA3LDEuNTctMi4yNiwxLjU2LTMuODQtLjA0LTE2LjQ0LDAtMzIuODgsMC00OS4zMSwwLTMuMDQtLjEzLTYuMDctLjQ0LTkuMS0uMTEtMS4xLS40NS0xLjg3LTEuMzEtMi41NS01LjE5LTQuMTMtMTAuMzgtOC4yNi0xNS41Mi0xMi40Ni0xLjU1LTEuMjctMy4xNi0xLjg2LTUuMjMtMS43OC03Ljg3LjMxLTE1Ljc1LjYxLTIzLjYzLjYzLTI5LjYxLjA4LTU5LjIyLjA2LTg4LjgzLjA3LTEuMDcsMC0yLjE0LDAtMy42NiwwLDMuMjcsNC44Niw2LjIzLDkuMzMsOS4yNiwxMy43NCwxLjE3LDEuNzEsMS43OSwzLjQyLDEuNzcsNS41Ny0uMDcsOC40NC4wNiwxNi44OS4wOSwyNS4zMy4xOCw0MS44OC4yMiw4My43Ni4wNCwxMjUuNjUtLjAxLDIuOTMtLjYzLDUuNDMtMi4yOSw3Ljg3LTIuODIsNC4xNC01LjM5LDguNDYtOC41LDEzLjM4Wk00NDMuNzksMTE1Ljk1Yy45OCwxLjI5LDEuNzUsMi4yMiwyLjQyLDMuMjEsMy45LDUuNzUsOC45MiwxMC43MiwxMS45OSwxNy4wNCw2LjA2LDEyLjQ2LDEyLjQsMjQuNzgsMTguMzgsMzcuMjksNy45NiwxNi42NiwxNi4yMSwzMy4xNywyNC4zOCw0OS43My43MSwxLjQ1LDEuMDksMi44NCwxLjA4LDQuNDYtLjA0LDIwLjI2LS4wMyw0MC41MywwLDYwLjc5LDAsMS41MS0uMjcsMi44Mi0xLjAyLDQuMTUtMi44NSw1LjA0LTUuNjEsMTAuMTMtOC40OSwxNS4zNCwxOS45MSwwLDM5LjYxLS43NSw1OS43LTEuMzUtMi45OS01LjA3LTUuNzMtOS43OS04LjU2LTE0LjQ1LS43OS0xLjMtMS4xNC0yLjU3LTEuMTQtNC4xLjA1LTE5LjgxLjA1LTM5LjYzLjAyLTU5LjQ0LDAtMS41LjMtMi44MS45Ny00LjE3LDExLjQ1LTIzLjI5LDIyLjg4LTQ2LjU5LDM0LjI1LTY5LjkyLDUuNTMtMTEuMzYsMTAuNTktMjIuOTYsMTcuNjYtMzMuNTEsMS4wNC0xLjU1LDIuMTMtMy4wNywyLjc5LTUuMDdoLTYyLjkyYzIuNzEsNC41NCw1LjE5LDguOTksNy45NywxMy4yNCwxLjY2LDIuNTUsMS45Myw0LjY4LjY0LDcuNjItNi45OCwxNS45NC0xMy42OSwzMi0yMC41MSw0OC4wNS0uNDEtLjIzLS43MS0uMjktLjc4LS40NS0zLjQzLTcuNzUtNi43OC0xNS41NC0xMC4yNS0yMy4yOC0zLjctOC4yNC02Ljk0LTE2LjctMTAuNzYtMjQuODktLjg5LTEuOTEtLjg4LTMuMzguMy01LjIyLDMuMTEtNC44Nyw1Ljk3LTkuOSw5LjA2LTE1LjA5aC02Ny4yWk01MjIuNDEsMTE0LjQxYy0zLjE1LDYuMDItNi4wMSwxMS43Ni05LjE1LDE3LjM1LTEuMDYsMS44OC0xLjE1LDMuMzMtLjI5LDUuMjcsMy4zNyw3LjYsNi45MiwxNS4xNCw5Ljg5LDIzLjYsMy43MS04Ljc5LDcuMTctMTcuMDQsMTAuNzEtMjUuMjcuNTEtMS4xOS0uMTctMS45LS42NS0yLjc0LTMuMzktNS44OC02Ljc4LTExLjc1LTEwLjUxLTE4LjJaIi8+PHBhdGggY2xhc3M9Im4iIGQ9Ik03NzIuNTgsMjM2LjY1YzE5LjQ0LDQuNzEsMzguNDgsOS4zMiw1Ny44NiwxNC4wMS0uMDQsNi42OC4wMiwxMy41MS43NywyMC41NSw3Ljk2LjU0LDE1Ljg5LDEuMDcsMjMuNjMsMS41OSwxLjAzLS45My42Mi0xLjg5LjYzLTIuNzMuMDItNS45Ny0uMS0xMS45NC4wMS0xNy45LjA0LTIuMDUtLjU3LTMuMS0yLjUtNC4wNy0yNC44NS0xMi40Ni00OS42NC0yNS4wNC03NC40My0zNy42MS0xLjc5LS45LTMuNTMtMS44OS01LjI0LTIuODEtLjUtLjY1LS4zMS0xLjM1LS4zMS0xLjk5LjA2LTI0LjY2LjIxLTQ5LjMyLjE0LTczLjk4LS4wMS0zLjY5LDEuMDMtNi4zMiwzLjg0LTguNzEsNS45OS01LjExLDExLjYtMTAuNjQsMTcuNzQtMTUuNTksMS40LTEuMTMsMi43Ny0xLjk4LDQuODEtMS45NywyOC45NC4xMSw1Ny44OC4xNCw4Ni44Mi4xLDIuNSwwLDQuNDIuNTgsNi4zMiwyLjMsNi4yNiw1LjY1LDEyLjY4LDExLjEyLDE5LjAzLDE2LjY4LDEsLjg3LDEuODksMS42NCwxLjg5LDMuMy0uMDcsMjEuOTUtLjA1LDQzLjkxLS4wNSw2Ni4wOS02LjkzLTEuNTctMTMuNTYtMy42Ni0yMC4yMi01LjY0LTExLjYxLTMuNDQtMjMuMTktNi45Ny0zNC42OC0xMC43OC0yLjI4LS43Ni0yLjgtMS43My0yLjcxLTQsLjIxLTUuNTkuMDctMTEuMi4wNy0xNi45NGgtMjIuNDRjLS42NCwxLjU3LS4yOCwzLjI2LS4yNSw0LjkuMDgsNC41LjQzLDkuMDEuMzIsMTMuNS0uMDYsMi4yOC43OCwzLjQsMi43MSw0LjM1LDE2LjQ0LDguMTEsMzIuODQsMTYuMyw0OS4yNSwyNC40Nyw5LjEyLDQuNTQsMTguMjIsOS4xMiwyNy4zNSwxMy42MywxLjU0Ljc2LDIuMywxLjU3LDIuMywzLjUzLS4wNCwyNy4zNi4wMyw1NC43Mi4xNCw4Mi4wOSwwLDEuMzUtLjMsMi4zMS0xLjI1LDMuMjUtNy42MSw3LjUzLTE2LjA3LDE0LjA1LTI0LjM1LDIwLjc5LS41NC40NC0xLjA1LjcxLTEuODIuNjUtOC44NC0uNzUtMTcuNjgtMS40Ny0yNi41Mi0yLjE2LTYuOTUtLjU0LTEzLjktMS4wMi0yMC44NS0xLjU1LTcuODQtLjYtMTUuNjgtMS4yNy0yMy41Mi0xLjgzLTUuMTYtLjM3LTEwLjMyLS42Ny0xNS40OS0uODQtMi41Ni0uMDgtNC42LS42Ni02LjYxLTIuNTQtNi45LTYuNDYtMTQuMDQtMTIuNjUtMjEuMTMtMTguODktLjkyLS44MS0xLjM3LTEuNi0xLjM3LTIuODUsMC0xOS41OS0uMDYtMzkuMTktLjEtNTguNzgsMC0uNDQuMTItLjg3LjIzLTEuNTlaTTc4My4wOSwyNDguODJjMCwxNS4zMy4wMSwzMC4zLS4wMyw0NS4yNiwwLDEuMi42MiwxLjgsMS40LDIuNDgsNS4xLDQuNDIsMTAuMTksOC44NSwxNS4yNiwxMy4zMi43OS43LDEuNiwxLjIxLDIuNjcsMS4yNCw2Ljg2LjE3LDEzLjY5LjkxLDIwLjUzLDEuNDEsMTAuNTIuNzYsMjEuMDUsMS40LDMxLjU3LDIuMjEsOS42NC43NCwxOS4yNiwxLjYxLDI4Ljg5LDIuNSwxLjgzLjE3LDMuMjEtLjM1LDQuNTUtMS41Niw0Ljg0LTQuMzgsOS42OC04Ljc2LDE0LjY1LTEyLjk5LDEuNTktMS4zNSwyLjI4LTIuNjcsMi4yOC00LjgyLS4wOS0yMy4zMS0uMS00Ni42Mi4wMi02OS45My4wMS0yLjMxLS44LTMuMjgtMi43My00LjI2LTI2LjM0LTEzLjI4LTUyLjYzLTI2LjY2LTc5LjAzLTQwLjA2di0zNy4wMWg0Mi42M2MuNTYsNy43My4zMywxNS40OC41MywyMy4xOSwxMi4zOCwzLjc4LDI0LjUyLDcuNSwzNi42NCwxMS4yLjIzLS42LjM3LS44MS4zNy0xLjAyLjAzLTE2LjEuMDQtMzIuMjEuMTEtNDguMzEsMC0xLjMtLjUxLTIuMDYtMS40My0yLjgxLTQuOTYtNC4wNi05LjktOC4xNS0xNC44MS0xMi4yNi0xLS44My0xLjk2LTEuMi0zLjM0LTEuMTctMjYuNjguNjgtNTMuMzcuNDMtODAuMDUuMTUtMS41OS0uMDItMi43MS4zOC0zLjkxLDEuMzUtNS40LDQuMzItMTAuMTUsOS4zNS0xNS4zNiwxMy44OC0xLjE0LDEtMS40NCwyLjA5LTEuNDMsMy41My4wNCwyMS43My4wNSw0My40Ny0uMDMsNjUuMiwwLDEuODguNjUsMi43MSwyLjI1LDMuNTMsMTYuNjMsOC41MSwzMy4yMywxNy4wOSw0OS44MSwyNS43LDEwLjAyLDUuMiwyMC4yMiwxMC4wNSwzMC4xNiwxNC44NnYzOS43NWMtMTQuODktLjE1LTI5LjQyLTEuNjgtNDQuMjItMi4xOS0uMDgtNy40Mi0uMDgtMTQuNjktLjctMjEuOTYtMTIuMzYtMy40Ni0yNC41Ni02Ljg3LTM3LjI0LTEwLjQyWiIvPjxwYXRoIGNsYXNzPSJuIiBkPSJNNDA1LjM4LDI3MS4xMWM5LjQ5LjY4LDE3Ljg0LTEuODIsMjYuMTMtNS41NywxNC4yNy02LjQ2LDI4Ljc5LTEyLjM1LDQzLjQyLTE4LjU2djcxLjgzYy00OS4xOCw0LjAyLTk4LjIxLDguMDItMTQ3LjQ2LDE0LjQ5LDIuMTEtNC4xNSw0LjA5LTguMDMsNi4wNy0xMS45MiwzLjAzLTUuOTYsNi0xMS45NCw5LjExLTE3Ljg2LjgxLTEuNTQsMS4xOS0zLjA2LDEuMTktNC43OC4wMS01My44Mi4wNC0xMDcuNjQuMTItMTYxLjQ2LDAtMS43OC0uNTgtMy4yNy0xLjM2LTQuNzQtNC43Mi04LjkzLTguOTQtMTguMTMtMTQuNDUtMjcuMWg5Mi41OGMuMjQuODctLjY3LDEuNi0xLjEsMi40NC0zLjA0LDUuOTUtNS44MywxMi4wNi05LjM0LDE3LjcyLTMuODYsNi4yNC01LjA0LDEyLjcyLTQuOTksMjAuMDEuMjQsNDAuOTguMSw4MS45Ny4xLDEyMi45NSwwLC43OCwwLDEuNTUsMCwyLjU1Wk00NjQuNzcsMzA5LjQ2di00Ny4xN2MtNy44MywzLjM0LTE1LjM5LDYuNjItMjMsOS44LTkuNjQsNC4wMy0xOC44Nyw5LjUtMjkuODksOC45MS0uMTEsMC0uMjIuMDctLjMzLjA4LTUuNDcuMjQtMTAuOSwxLjIzLTE2LjMzLjk4LS42LS45OS0uMzEtMS45MS0uMzItMi43OS0uNTEtNDcuMjgtLjExLTk0LjU2LS4yNy0xNDEuODMsMC0yLjIxLjQ1LTQuMTEsMS41Mi02LjA0LDIuOC01LjAzLDUuNDEtMTAuMTcsOC4yMy0xNS41MmgtNTkuMzVjMi43LDQuOTIsNS4yMyw5LjYyLDcuODQsMTQuMjcuNzMsMS4zLDEuMTgsMi41NSwxLjE3LDQuMDktLjE0LDU1LjYxLS4yNCwxMTEuMjItLjMzLDE2Ni44MiwwLDEuODQtLjMyLDMuNTQtMS4xOSw1LjE3LTIuNSw0LjY3LTQuMzksOS42NC03LjQ2LDE0LjQyLDQwLjEzLTQuNDMsNzkuOTctNy43MSwxMTkuNzEtMTEuMloiLz48cGF0aCBjbGFzcz0ibyIgZD0iTTYxMy44MSwzMDcuMzVjMy4xLTQuOTIsNS42OC05LjIzLDguNS0xMy4zOCwxLjY2LTIuNDQsMi4yOC00Ljk0LDIuMjktNy44Ny4xOC00MS44OC4xNC04My43Ni0uMDQtMTI1LjY1LS4wNC04LjQ0LS4xNi0xNi44OS0uMDktMjUuMzMuMDItMi4xNC0uNi0zLjg2LTEuNzctNS41Ny0zLjA0LTQuNDEtNS45OS04Ljg4LTkuMjYtMTMuNzQsMS41MiwwLDIuNTksMCwzLjY2LDAsMjkuNjEtLjAyLDU5LjIyLjAxLDg4LjgzLS4wNyw3Ljg4LS4wMiwxNS43Ni0uMzIsMjMuNjMtLjYzLDIuMDYtLjA4LDMuNjcuNTEsNS4yMywxLjc4LDUuMTQsNC4xOSwxMC4zMiw4LjMzLDE1LjUyLDEyLjQ2Ljg2LjY4LDEuMiwxLjQ1LDEuMzEsMi41NS4zMSwzLjAzLjQ0LDYuMDYuNDQsOS4xLDAsMTYuNDQtLjA0LDMyLjg4LDAsNDkuMzEsMCwxLjU4LS4zNiwyLjc3LTEuNTYsMy44NC01LjczLDUuMDYtMTEuNDIsMTAuMTktMTcuMjksMTUuNDUsMy44MSwzLjg1LDguMTcsNywxMi4yLDEwLjUyLDIuMzYsMi4wNyw1LjksMy40Niw2LjkyLDYuMjEsMS4wNywyLjg2LjMyLDYuNDMuMTksOS42OS0uNzYsMTcuOS0uNTcsMzUuOC0uMTcsNTMuNjkuMSw0LjQxLTEuMDQsNi42NS00LjU1LDguNzgtNC4yMiwyLjU1LTguMTIsNS42Mi0xMi4wOSw4LjU2LTEuMzMuOTgtMi42NCwxLjQ2LTQuMzIsMS40NC0yOS4xNS0uNDEtNTguMzEtLjc5LTg3LjQ2LTEuMTEtOS43OS0uMTEtMTkuNTgtLjAyLTMwLjA5LS4wMlpNNjY1LjA4LDIyNS4yNXY1My42NGMxLjA4LjYsMi4xMS4zNSwzLjA5LjM1LDkuNzkuMDQsMTkuNTktLjI1LDI5LjM2LjIsNS4zOS4yNSw5LjUyLTEuMDMsMTIuODYtNS4zMiwxLjA4LTEuMzksMS44NS0yLjUyLDEuODMtNC4zOC0uMTEtMTAuMDEtLjA2LTIwLjAzLS4wNy0zMC4wNHEwLTcuNjYtNS40OC0xMy4wMmMtLjk0LS45My0xLjg3LTEuNDUtMy4yMy0xLjQ0LTEyLjcuMDQtMjUuNC4wMi0zOC4zNi4wMlpNNjY1LjA3LDE5NC45M2MuOTcuNjUsMS44OS4zNSwyLjc2LjM1LDkuOCwwLDE5LjYtLjM0LDI5LjM4LjA0LDUuMzguMjEsOS41MS0xLjA1LDEyLjkzLTUuMjksMS4yOC0xLjU4LDIuMDYtMi45LDIuMDUtNC45OC0uMDYtOC43OC0uMTktMTcuNTguMjUtMjYuMzQuMjMtNC42MS0uNTMtOC4yLTQuNDEtMTEuMDgtMS42MS0xLjItMi45NC0yLjAyLTUuMDMtMi4wMS0xMS44Mi4wOS0yMy42NC4wMi0zNS40Ny4wNC0uODQsMC0xLjgxLS4zOS0yLjQ1LjM1djQ4LjkyWiIvPjxwYXRoIGNsYXNzPSJvIiBkPSJNNDQzLjc5LDExNS45NWg2Ny4yYy0zLjA5LDUuMTktNS45NCwxMC4yMi05LjA2LDE1LjA5LTEuMTgsMS44NS0xLjIsMy4zMi0uMyw1LjIyLDMuODIsOC4xOSw3LjA2LDE2LjY1LDEwLjc2LDI0Ljg5LDMuNDcsNy43NCw2LjgyLDE1LjUyLDEwLjI1LDIzLjI4LjA3LjE2LjM2LjIyLjc4LjQ1LDYuODItMTYuMDUsMTMuNTItMzIuMTEsMjAuNTEtNDguMDUsMS4yOS0yLjk1LDEuMDMtNS4wNy0uNjQtNy42Mi0yLjc4LTQuMjUtNS4yNi04LjctNy45Ny0xMy4yNGg2Mi45MmMtLjY2LDItMS43NiwzLjUyLTIuNzksNS4wNy03LjA3LDEwLjU0LTEyLjEzLDIyLjE1LTE3LjY2LDMzLjUxLTExLjM3LDIzLjMzLTIyLjgsNDYuNjMtMzQuMjUsNjkuOTItLjY3LDEuMzYtLjk3LDIuNjctLjk3LDQuMTcuMDMsMTkuODEuMDMsMzkuNjMtLjAyLDU5LjQ0LDAsMS41My4zNSwyLjgsMS4xNCw0LjEsMi44Myw0LjY2LDUuNTcsOS4zOCw4LjU2LDE0LjQ1LTIwLjA5LjU5LTM5Ljc5LDEuMzUtNTkuNywxLjM1LDIuODgtNS4yMSw1LjY0LTEwLjMsOC40OS0xNS4zNC43NS0xLjMyLDEuMDItMi42NCwxLjAyLTQuMTUtLjA0LTIwLjI2LS4wNC00MC41MywwLTYwLjc5LDAtMS42Mi0uMzctMy4wMi0xLjA4LTQuNDYtOC4xNy0xNi41NS0xNi40Mi0zMy4wNy0yNC4zOC00OS43My01Ljk4LTEyLjUtMTIuMzItMjQuODMtMTguMzgtMzcuMjktMy4wNy02LjMyLTguMDktMTEuMjktMTEuOTktMTcuMDQtLjY4LS45OS0xLjQ1LTEuOTItMi40Mi0zLjIxWiIvPjxwYXRoIGNsYXNzPSJqIiBkPSJNNTIyLjQxLDExNC40MWMzLjczLDYuNDUsNy4xMiwxMi4zMiwxMC41MSwxOC4yLjQ4Ljg0LDEuMTcsMS41NS42NSwyLjc0LTMuNTMsOC4yMy02Ljk5LDE2LjQ4LTEwLjcxLDI1LjI3LTIuOTctOC40Ni02LjUyLTE1Ljk5LTkuODktMjMuNi0uODYtMS45NS0uNzctMy4zOS4yOS01LjI3LDMuMTUtNS41OCw2LjAxLTExLjMzLDkuMTUtMTcuMzVaIi8+PHBhdGggY2xhc3M9Im8iIGQ9Ik03ODMuMDksMjQ4LjgyYzEyLjY4LDMuNTUsMjQuODgsNi45NiwzNy4yNCwxMC40Mi42Miw3LjI2LjYyLDE0LjU0LjcsMjEuOTYsMTQuOC41MSwyOS4zMywyLjA0LDQ0LjIyLDIuMTl2LTM5Ljc1Yy05Ljk0LTQuODEtMjAuMTMtOS42Ni0zMC4xNi0xNC44Ni0xNi41OC04LjYxLTMzLjE4LTE3LjE5LTQ5LjgxLTI1LjctMS42LS44Mi0yLjI2LTEuNjQtMi4yNS0zLjUzLjA4LTIxLjczLjA2LTQzLjQ3LjAzLTY1LjIsMC0xLjQ0LjI5LTIuNTQsMS40My0zLjUzLDUuMjEtNC41Myw5Ljk2LTkuNTYsMTUuMzYtMTMuODgsMS4yMS0uOTcsMi4zMi0xLjM3LDMuOTEtMS4zNSwyNi42OC4yOCw1My4zNy41Myw4MC4wNS0uMTUsMS4zOC0uMDMsMi4zNC4zNCwzLjM0LDEuMTcsNC45MSw0LjExLDkuODUsOC4yLDE0LjgxLDEyLjI2LjkyLjc1LDEuNDQsMS41MSwxLjQzLDIuODEtLjA4LDE2LjEtLjA4LDMyLjIxLS4xMSw0OC4zMSwwLC4yMS0uMTUuNDItLjM3LDEuMDItMTIuMTItMy43MS0yNC4yNy03LjQyLTM2LjY0LTExLjItLjItNy43MS4wMi0xNS40Ni0uNTMtMjMuMTloLTQyLjYzdjM3LjAxYzI2LjQsMTMuNCw1Mi42OSwyNi43Nyw3OS4wMyw0MC4wNiwxLjkzLjk4LDIuNzQsMS45NSwyLjczLDQuMjYtLjExLDIzLjMxLS4xLDQ2LjYyLS4wMiw2OS45MywwLDIuMTQtLjY5LDMuNDctMi4yOCw0LjgyLTQuOTcsNC4yMy05LjgyLDguNi0xNC42NSwxMi45OS0xLjM0LDEuMjEtMi43MSwxLjczLTQuNTUsMS41Ni05LjYyLS44OS0xOS4yNS0xLjc2LTI4Ljg5LTIuNS0xMC41Mi0uODEtMjEuMDUtMS40NC0zMS41Ny0yLjIxLTYuODQtLjUtMTMuNjYtMS4yNC0yMC41My0xLjQxLTEuMDgtLjAzLTEuODgtLjU0LTIuNjctMS4yNC01LjA2LTQuNDYtMTAuMTYtOC44OS0xNS4yNi0xMy4zMi0uNzgtLjY3LTEuNC0xLjI4LTEuNC0yLjQ4LjA0LTE0Ljk3LjAzLTI5LjkzLjAzLTQ1LjI2WiIvPjxwYXRoIGNsYXNzPSJvIiBkPSJNNDY0Ljc3LDMwOS40NmMtMzkuNzQsMy40OS03OS41OCw2Ljc3LTExOS43MSwxMS4yLDMuMDgtNC43OCw0Ljk3LTkuNzUsNy40Ni0xNC40Mi44OC0xLjY0LDEuMTktMy4zNCwxLjE5LTUuMTcuMDktNTUuNjEuMTktMTExLjIyLjMzLTE2Ni44MiwwLTEuNTQtLjQ0LTIuNzktMS4xNy00LjA5LTIuNjEtNC42NS01LjE0LTkuMzQtNy44NC0xNC4yN2g1OS4zNWMtMi44Miw1LjM1LTUuNDMsMTAuNDktOC4yMywxNS41Mi0xLjA4LDEuOTMtMS41MywzLjgzLTEuNTIsNi4wNC4xNyw0Ny4yOC0uMjMsOTQuNTYuMjcsMTQxLjgzLDAsLjg3LS4yOCwxLjc5LjMyLDIuNzksNS40Mi4yNSwxMC44Ni0uNzQsMTYuMzMtLjk4LjExLDAsLjIyLS4wOC4zMy0uMDgsMTEuMDIuNTksMjAuMjUtNC44OCwyOS44OS04LjkxLDcuNjEtMy4xOCwxNS4xNy02LjQ2LDIzLTkuOHY0Ny4xN1oiLz48cGF0aCBjbGFzcz0ibiIgZD0iTTY2NS4wOCwyMjUuMjVjMTIuOTYsMCwyNS42Ni4wMSwzOC4zNi0uMDIsMS4zNiwwLDIuMjguNTEsMy4yMywxLjQ0cTUuNDYsNS4zOCw1LjQ4LDEzLjAyYzAsMTAuMDEtLjA0LDIwLjAzLjA3LDMwLjA0LjAyLDEuODYtLjc1LDIuOTktMS44Myw0LjM4LTMuMzMsNC4zLTcuNDYsNS41Ny0xMi44Niw1LjMyLTkuNzctLjQ1LTE5LjU3LS4xNS0yOS4zNi0uMi0uOTgsMC0yLjAxLjI1LTMuMDktLjM1di01My42NFpNNjc1LjQ0LDIzNS40NnYzMy43OWM4LjEsMCwxNS45NS4wNSwyMy43OS0uMDMsMi4xMS0uMDIsMy4xLTEuMzQsMy4wNy0zLjUzLS4xMi04Ljk5LS4xNi0xNy45OC0uMjYtMjYuOTctLjAzLTMuMDktLjY4LTMuNzQtMy43OC0zLjc1LTYuNjMtLjAyLTEzLjI2LS4wMS0xOS44OS4wMy0uOTgsMC0yLjA0LS4yNS0yLjk0LjQ2WiIvPjxwYXRoIGNsYXNzPSJuIiBkPSJNNjY1LjA3LDE5NC45M3YtNDguOTJjLjY0LS43NCwxLjYxLS4zNSwyLjQ1LS4zNSwxMS44Mi0uMDIsMjMuNjQuMDUsMzUuNDctLjA0LDIuMDktLjAyLDMuNDIuODEsNS4wMywyLjAxLDMuODgsMi44OCw0LjY1LDYuNDcsNC40MSwxMS4wOC0uNDQsOC43Ni0uMywxNy41Ni0uMjUsMjYuMzQuMDEsMi4wOS0uNzcsMy40LTIuMDUsNC45OC0zLjQyLDQuMjQtNy41NSw1LjUtMTIuOTMsNS4yOS05Ljc4LS4zOS0xOS41OS0uMDUtMjkuMzgtLjA0LS44NiwwLTEuNzkuMjktMi43Ni0uMzVaTTY3NS40OCwxODQuODZjOC4wNiwwLDE1Ljc5LjAyLDIzLjUxLS4wMSwyLjI0LDAsMy4xMi0xLjI4LDMuMDgtMy40Ny0uMDctMy45My0uMDItNy44Ni0uMDItMTEuNzksMC00LjM0LDAtOC42OCwwLTEzLjA2aC0yNi41N3YyOC4zM1oiLz48cGF0aCBjbGFzcz0iaiIgZD0iTTY3NS40NCwyMzUuNDZjLjktLjcyLDEuOTYtLjQ2LDIuOTQtLjQ2LDYuNjMtLjA0LDEzLjI2LS4wNSwxOS44OS0uMDMsMy4wOS4wMSwzLjc0LjY3LDMuNzgsMy43NS4xLDguOTkuMTQsMTcuOTguMjYsMjYuOTcuMDMsMi4xOS0uOTYsMy41LTMuMDcsMy41My03Ljg1LjA5LTE1LjcuMDMtMjMuNzkuMDN2LTMzLjc5WiIvPjxwYXRoIGNsYXNzPSJqIiBkPSJNNjc1LjQ4LDE4NC44NnYtMjguMzNoMjYuNTdjMCw0LjM3LDAsOC43MSwwLDEzLjA2LDAsMy45My0uMDUsNy44Ni4wMiwxMS43OS4wNCwyLjE5LS44NSwzLjQ2LTMuMDgsMy40Ny03LjcyLjAzLTE1LjQ0LjAxLTIzLjUxLjAxWiIvPjxwYXRoIGNsYXNzPSJsIiBkPSJNMzUzLjc0LDI2NS42OWwtNy4xMi01LjVjLS4zMS0xLjg3LTEuMDUtMy42NC0yLjE2LTUuMTlsNC4xNy01LjM3YzMuNjEtNC42NCwzLjUyLTExLjA2LS4yMi0xNS42bC01Ljc5LTcuMDMsMS41OS04Ljc3LDkuNTUtMTYuMzdjMS4xMy0xLjk0LDEuNzItNC4xNSwxLjctNi40bC0uMzItMzcuMzNjLS4wOS0xMC40My01Ljc4LTIwLjA1LTE0LjgxLTI1LjE4LTQuNjItMTAuNTktMTEuMTMtMjAuMTItMTkuMzgtMjguMzUtMS4xNS0xLjE1LTIuMzUtMi4yOC0zLjY1LTMuNDVsLS40OS0uNDRjLTEuMjktMS4xNC0yLjYyLTIuMjUtMy45OC0zLjMybC0uNzMtLjU3Yy0uNzMtLjU2LTEuNDYtMS4xMS0yLjItMS42NS0uMjQtLjE3LS40OC0uMzQtLjY5LS40OWwtLjQ2LS4zM2MtLjI5LS4yMS0uNTktLjQyLS44OS0uNjItLjI5LS4yLS41OC0uMzktLjg2LS41OGwtLjIzLS4xNWMtLjUyLS4zNS0xLjA1LS42OS0xLjYtMS4wNGwtLjc3LS40OGMtLjE3LS4xMS0uMzUtLjIxLS41MS0uMzFsLS4xOC0uMTFjLS41MS0uMzEtMS4wMy0uNjItMS41OC0uOTRsLS4zNC0uMmMtLjYyLS4zNS0xLjI0LS42OS0xLjgyLTEuMDFsLS4xOC0uMWMtLjE5LS4xLS4zNy0uMjEtLjU2LS4zMWwtLjU2LS4yOWMtLjc1LS4zOS0xLjUxLS43OC0yLjI0LTEuMTQsNC45My0xNC41LDQuODMtMjguNzYtLjMzLTQxLjQ2LTQuNzUtMTEuNjgtMTMuNDQtMjEuNDYtMjUuODMtMjkuMDgtMTEuNTMtNy4xLTI2Ljc0LTEyLjQ1LTQ1LjE5LTE1LjkzbC0uNTktLjExYy0uMzctLjA3LS43NC0uMTItMS4xMi0uMTZsLS41Ny0uMDVjLS43MS0uMDctMy4zNS0uMjktNy41LS4yOS03LjUzLDAtMjIuNzUuODItNDAuMSw2LjM2bC0uODQuMjdjLS4zMi4xLS42NC4yMS0uOTQuMzFsLS4xLjAzYy0uNDIuMTQtLjg0LjI4LTEuMjYuNDMtLjI4LjEtLjU1LjItLjguMjlsLS44Mi4zYy0uNjEuMjItMS4yMy40NC0xLjg1LjY4bC0uMDYuMDJjLTEuMi40Ni0yLjQ4Ljk3LTMuOTEsMS41OGwtLjIzLjFjLTEuMTMuNDgtMi4zNywxLjAzLTMuNzEsMS42NS0uMTIuMDUtLjI1LjExLS4zNi4xN2wtLjE1LjA3Yy02LjgsMy4xOC0xMy4yMiw2Ljk1LTE5LjA5LDExLjIyLTE2LjI0LDExLjc5LTI4Ljg5LDE4LjczLTM5LjgyLDIxLjg1bC0uNzcuMjFjLS42Ny4xOC0xLjM0LjM1LTIuMDMuNWwtLjUxLjEyYy0uMjcuMDYtLjUzLjEyLS44Mi4xOC0zLjE4LjY1LTYuMi45Ny05LjE0Ljk4aC0uNjhjLS40OC0uMDItLjk2LS4wMy0xLjQ0LS4wNS0uMzctLjAyLS43NS0uMDQtMS4wNy0uMDZsLS40OS0uMDRjLTMuMDgtLjI1LTYuMTItLjgxLTkuMjgtMS43M2wtMjkuNjItOC41OGMtNC44Mi0xLjM5LTkuOTguMjUtMTMuMTUsNC4xNy0zLjE3LDMuOTEtMy42Nyw5LjMyLTEuMjgsMTMuNzhsMTQuNTMsMjcuMTFjLjc0LDEuMzgsMy4xLDUuNDgsNy41NCwxMC42Ni0xMi42MSwzLjk3LTI0LjQyLDExLjM3LTMzLjY4LDIxLjE4LS4xLjEtLjE5LjItLjI3LjI4LS4xLjEtLjE5LjIxLS4yNS4yNy0uOTMsMS0xLjczLDEuOTEtMi40MiwyLjczbC0uMTQuMTdjLS4xMy4xNS0uMjUuMy0uMzkuNDgtLjMzLjQxLS42NS44Mi0uOTQsMS4xOGwtLjI4LjM1Yy0uMjYuMzMtLjUyLjY1LS43My45My0uMDkuMTItLjE4LjIzLS4yMi4yOC0uMS4xNC0uMi4yOC0uMjYuMzUtLjEzLjE3LS4yNS4zNC0uMzMuNDdsLS4xMi4xN2MtLjU0Ljc0LTEuMDcsMS40OC0xLjUzLDIuMTdsLS4wOS4xNGMtLjA3LjExLS4xNC4yMi0uMjEuMzMtMS40NiwyLjIyLTIuNzgsNC40OS0zLjkzLDYuNzUtOS4wNSwxNy44NC05LjY2LDM4LjExLTEuNzEsNTcuMDlsOC4xOCwxOS41NC4wOC4yYzEuNjgsMy45OSw1LjM4LDYuODcsOS42Niw3LjUxLDQuMjguNjUsOC42Ni0xLjAzLDExLjQ0LTQuMzVsMTMuNDYtMTYuMTZjLjgyLS45LDkuNTctMTAuMjcsMTkuOTgtMTMuMDhsMzEuOTYsOS4xMWMxLjQ3LjQyLDkuMzUsMi41MiwxOS44MywyLjUyLDEyLjM5LDAsMjMuOTMtMi45MiwzMy44Mi04LjUxbC0uMDksMTAuODRjLS4wMiwyLjI5LjU5LDQuNTQsMS43Niw2LjVsNi45OCwxMS43MmMuMTgsMS45NC4zNSwzLjczLjUyLDUuMzguMTcsMS43My4zNSwzLjM2LjUxLDQuODlsLTYuNjgsNi4xNWMtNC43NSw0LjM3LTUuNCwxMS41NS0xLjUxLDE2LjcxbDcuMDQsOS4zM3MuMjcuMzYuNzQuOThjLS42LDEuMzItLjk2LDIuNzQtMS4wOCw0LjE4bC0xMi4yMywxMS4xMWMtNC4zNiwzLjk2LTUuMzcsMTAuMjktMi40NiwxNS40MWw1LjEzLDkuMDNjLjc0LDEuMzEsMTguNjgsMzIuNDQsNTguNDcsNjIuOTgsMTAuMDYsNy43MiwyMC44MSwxNC44NiwzMS45MywyMS4yMmw2LjUsMy43MmMxLjg4LDEuMDgsNC4wMywxLjY0LDYuMTksMS42NHM0LjM4LS41OSw2LjI4LTEuN2w2LjQ3LTMuNzZjLjczLS40MiwxOC4wNS0xMC41NSwzNi45NS0yNi4yMiwyNy4yNi0yMi41OSw0NC4yMS00NS4yOCw1MC40LTY3LjQ1bDIuMzUtOC40MmMxLjM3LTQuOTItLjM1LTEwLjExLTQuMzktMTMuMjNaTTE2Ni4wMSwyNzQuNzFsOS45NS05LjA0LTEuMzYtMy4zNCw0LjM5LTUuMjJjLTMuNjctNC42Ni02LjMxLTguMTUtNi40OC04LjM3bC0yLjg0LTMuNzdoMHMtNC4yNS01LjYzLTQuMjUtNS42M2w4LjY3LTcuOTcsMi43Mi0yLjVjLS4zNi0yLjcxLS43OC02LjI3LTEuMjUtMTAuOTktLjI0LTIuMzktLjUtNS4wNi0uNzctOC4wOWwtNi41OC0xMS4wNC0xLjc2LTIuOTUtLjEtLjE3LjAzLTMuNjMuMjgtMzMuNjJjMC0xLC4xMS0xLjk5LjI5LTIuOTRoMHMwLDAsMCwwYy0uNjYuODUtMS4zMywxLjcxLTIsMi41OS0uNzMuOTQtMS40NiwxLjktMi4yLDIuODctMTIuNDYsMTYuMzktMjkuODQsMTkuOTMtNDIuNTIsMTkuOTMtOS4xNSwwLTE1Ljg2LTEuODQtMTYuNS0yLjAzbC0zNC44OS05Ljk1Yy05LjQxLDEuNS0xNy42OCw2Ljg3LTIzLjE0LDExLjMyLS42MS40OS0xLjE4Ljk4LTEuNzEsMS40NC0uNTQuNDYtMS4wMy45MS0xLjQ5LDEuMzNzLS44OC44Mi0xLjI2LDEuMTljLS4zOC4zNy0uNzIuNy0xLjAxLDEtLjI5LjMtLjU0LjU2LS43NS43Ny0uMzEuMzItLjUxLjU1LS42LjY1LS4wMy4wMy0uMDUuMDUtLjA1LjA2bC0xLjA3LDEuMjZoMHMxLjA3LTEuMjYsMS4wNy0xLjI2bC0xLjA3LDEuMjctMTIuNDQsMTQuOTMtLjA3LS4xNi0uMS4xMS04LjE4LTE5LjUyYy0yLjg1LTYuOC00LjM2LTEzLjgtNC41NS0yMC43NC0uMDYtMi4yMy4wMi00LjQ1LjI0LTYuNjYuNjUtNi42MywyLjUzLTEzLjEyLDUuNjQtMTkuMjUsMC0uMDIuMDItLjAzLjAzLS4wNSwwLC4wMi0uMDIuMDMtLjAzLjA1LjAxLS4wMi4wMi0uMDQuMDMtLjA2LjUxLTEsMS4wNS0xLjk5LDEuNjItMi45NiwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLS4wMS4wMi0uMDMuMDMtLjA0LDAsMCwwLC4wMS0uMDEuMDIsMCwwLDAtLjAxLjAxLS4wMiwwLDAsLjAxLS4wMi4wMi0uMDMuNTctLjk3LDEuMTctMS45MiwxLjc5LTIuODZoMHMwLDAsMCwwYy40NC0uNjcuOTItMS4zMSwxLjM5LTEuOTYuMTQtLjE5LjI3LS4zOS40MS0uNTguMDMtLjA0LjA2LS4wOS4wOS0uMTMuMDUtLjA3LjExLS4xNC4xNi0uMi4yNy0uMzYuNTYtLjcuODQtMS4wNi4zLS4zOS42LS43Ny45MS0xLjE1LjA4LS4xLjE2LS4yLjI0LS4zLDAsMCwwLDAsMCwwLC4wMi0uMDIuMDQtLjA1LjA2LS4wNywwLDAsMCwwLDAsMCwuNjktLjgzLDEuNDItMS42MywyLjE1LTIuNDItLjAxLjAxLS4wMy4wMy0uMDQuMDQuMDEtLjAxLjAzLS4wMy4wNC0uMDQuMDQtLjA1LjA5LS4xLjEzLS4xNC4wNS0uMDUuMS0uMS4xNS0uMTUsOC42Ny05LjIyLDIwLjE5LTE2LjEzLDMyLjU2LTE5LjA5LDYuNzUtMS42MiwxMi4zNy0zLjQ3LDE2Ljk4LTUuMzMtMS41My0xLjAzLTIuOTctMi4wNi00LjMyLTMuMS0xLjAyLS43OC0xLjk4LTEuNTctMi45LTIuMzQtLjkyLS43OC0xLjc4LTEuNTUtMi42LTIuMzEtNS40MS01LjAzLTguNzEtOS41OS0xMC4zNy0xMi4xOS0uMTctLjI2LS4zMi0uNS0uNDUtLjcyLS4xNC0uMjMtLjI3LS40NC0uMzctLjYzLS4xOC0uMy0uMzEtLjU0LS4zOS0uNjlsLTE0LjU1LTI3LjE1LjA1LjAyaDBzLS4wNC0uMDctLjA0LS4wN2wyOS42Miw4LjU3YzMuOTcsMS4xNSw3Ljg1LDEuODcsMTEuNzUsMi4xOC4xOS4wMi4zOS4wMy41OC4wNS40OC4wMy45Ny4wNiwxLjQ1LjA4LjYzLjAzLDEuMjUuMDQsMS44OC4wNS4xNywwLC4zNSwwLC41MiwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwaDBjMy45OCwwLDcuOTQtLjQzLDExLjg4LTEuMjMuNTQtLjExLDEuMDktLjI0LDEuNjMtLjM3LjgxLS4xOCwxLjYyLS4zOSwyLjQyLS42LjMtLjA4LjU5LS4xNS44OS0uMjQuMDIsMCwuMDQtLjAxLjA2LS4wMiwxMi41Ni0zLjU4LDI2LjQ5LTExLjIxLDQzLjc4LTIzLjc2LDUuNjEtNC4wNywxMS4zNi03LjM1LDE3LjA1LTEwLjAxLjA3LS4wMy4xNS0uMDcuMjItLjEuMDQtLjAyLjA4LS4wMy4xMS0uMDUsMS4xNi0uNTQsMi4zMS0xLjA2LDMuNDYtMS41NC4wNS0uMDIuMS0uMDQuMTUtLjA2LDEuMi0uNTEsMi40LS45OSwzLjU4LTEuNDUsMCwwLDAsMCwwLDAsMCwwLC4wMSwwLC4wMiwwLC43LS4yNywxLjQtLjUxLDIuMS0uNzYuMzUtLjEzLjcxLS4yNywxLjA3LS4zOWgwYy40LS4xNC43OS0uMjcsMS4xOS0uNGgwYy4zNi0uMTIuNzItLjI0LDEuMDgtLjM1LjU3LS4xOSwxLjE0LS4zOCwxLjcxLS41NiwxLjU2LS40OCwzLjExLS45Myw0LjYzLTEuMzMsMi40My0uNjQsNC43OS0xLjE5LDcuMDgtMS42NSwxLjE2LS4yNCwyLjMtLjQ1LDMuNDItLjY0LjIzLS4wNC40Ny0uMDguNy0uMTIsMS4xNi0uMTksMi4yOS0uMzcsMy4zOS0uNTIuMTgtLjAyLjM1LS4wNS41My0uMDcsMS4xMy0uMTUsMi4yNC0uMjgsMy4zLS40LjEyLS4wMS4yNS0uMDMuMzctLjA0LjYtLjA2LDEuMTgtLjEyLDEuNzUtLjE3LDEuMTgtLjExLDIuMy0uMTksMy4zOC0uMjUsMi41OS0uMTYsNC44Ny0uMjEsNi43Ny0uMjEsMi40NSwwLDQuMjYuMDksNS4zLjE2LjMyLjAyLjU3LjA0Ljc0LjA2LjEsMCwuMTguMDIuMjIuMDJsMS4xNy4xNmMyNy4xOSw1LjEyLDQ2LjAyLDE0LjQsNTYuMTcsMjcuNjYuMzkuNTEuNzcsMS4wMywxLjEzLDEuNTUuNTEuNzMuOTgsMS40NywxLjQ0LDIuMjIuNTMuODYsMS4wMywxLjc0LDEuNDksMi42My41OCwxLjExLDEuMSwyLjI1LDEuNTcsMy40MS4zMy44Mi42NCwxLjY0LjkxLDIuNDcuMjcuODEuNTEsMS42Mi43MywyLjQ0LDEuNTIsNS43NSwxLjc4LDExLjg1LjgzLDE4LjE0LS4wOC41Mi0uMTcsMS4wNC0uMjYsMS41Ny0uMjQsMS4zMy0uNTQsMi42Ny0uODksNC4wMi0uMzksMS41MS0uODUsMy4wMi0xLjM4LDQuNTQtLjM1LDEuMDEtLjczLDIuMDMtMS4xNCwzLjA0LS41OCwxLjQzLTEuMiwyLjg2LTEuODksNC4zLS4wNC4wOC0uMDcuMTUtLjEuMjMtLjQ2Ljk1LS45NSwxLjkxLTEuNDcsMi44NiwyLjgxLjg4LDUuNTUsMS45Myw4LjIzLDMuMTMuMDIuMDEuMDQuMDIuMDcuMDMtLjAyLDAtLjA0LS4wMi0uMDctLjAzLjc1LjMzLDEuNS42NywyLjI0LDEuMDMuMDEsMCwuMDMuMDEuMDQuMDIuMDMuMDIuMDcuMDMuMS4wNS4wNS4wMy4xMS4wNi4xNi4wOC42OS4zNCwxLjM4LjY4LDIuMDYsMS4wNC4xNy4wOS4zMy4xNy41LjI2LjIuMTEuNC4yMi42LjMzLjU0LjI5LDEuMDcuNTgsMS42Ljg4LDAsMCwwLDAsMCwwLC4xLjA2LjIuMTIuMzEuMTgsMCwwLDAsMCwwLDAsLjQ4LjI4Ljk0LjU2LDEuNDEuODUuMTYuMS4zMi4xOS40Ny4yOC4yNC4xNS40OC4zLjcyLjQ1LjQ2LjI5LjkyLjU5LDEuMzcuODkuMi4xMy40MS4yNi42MS40LjExLjA4LjIyLjE2LjM0LjI0LDAsMCwwLDAsMCwwLC4zMS4yMS42Mi40NC45My42Ni4yOC4yLjU1LjM5LjgzLjU4LjY0LjQ2LDEuMjcuOTQsMS45LDEuNDIsMCwwLDAsMCwwLDAsLjExLjA4LjIxLjE2LjMyLjI0LjM4LjI5Ljc3LjU4LDEuMTQuODguNTkuNDcsMS4xNy45NSwxLjc0LDEuNDQuMy4yNi41OC41My44OC44LDAsMCwwLDAsMCwwLC4wOS4wOC4xOC4xNi4yNi4yNC4wNS4wNC4xLjA5LjE1LjEzLjY5LjYyLDEuMzksMS4yMiwyLjA2LDEuODYuNTQuNTIsMS4wOCwxLjA1LDEuNjEsMS41OC44LjgsMS41NywxLjYyLDIuMzMsMi40NiwxLjE0LDEuMjUsMi4yNCwyLjU0LDMuMzEsMy44NywxLjA2LDEuMzIsMi4wOCwyLjY4LDMuMDYsNC4wOC40OS42OS45NiwxLjQsMS40MywyLjEuMzMuNS42NCwxLC45NSwxLjUxLjE0LjIyLjI4LjQzLjQxLjY1LjQxLjY3LjgxLDEuMzYsMS4yMSwyLjA1LjAzLjA1LjA2LjEuMDkuMTUsMCwwLDAsLjAxLjAxLjAyLjQuNzEuOCwxLjQzLDEuMTgsMi4xNS4wMS4wMi4wMi4wNC4wNC4wNy4xMy4yNS4yNi41MS4zOS43Ni4xNC4yNy4yNy41NC40MS44MS4xMi4yMy4yNC40Ny4zNi43LjM4Ljc5Ljc1LDEuNTgsMS4xMSwyLjM4LjY5LDEuNTQsMS4zMywzLjExLDEuOTIsNC43LDAsMCwwLS4wMiwwLS4wMiwwLC4wMS4wMS4wMy4wMi4wNGgwYy43MS4yMiwxLjM5LjUxLDIuMDYuODIsMCwwLDAsMCwwLDAsLjMuMTMuNTkuMjcuODguNDIsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsLjAyLDAsLjA0LjAyLjA2LjAzLjQ4LjI1Ljk1LjUxLDEuNC44LS40NS0uMjktLjkyLS41NS0xLjQtLjgsMCwwLDAsMCwwLDAsNS4yLDIuODMsOC43Nyw4LjMxLDguODIsMTQuNjFsLjI5LDMzLjc2LjAzLDMuNTctMS44LDMuMDgtOC44NiwxNS4xOS0uNTcsMy4xMy0yLjQ1LDEzLjUsMi44NywzLjQ5LDYuNiw4LjAyLTEuNDgsMS45MWgwcy00Ljg5LDYuMjktNC44OSw2LjI5Yy0uMTEuMTQtMS42NSwyLjExLTQuMjYsNS4yOWwuNzYuODMsNS40MSw1Ljk2LTEuMjYsMy4yMiwxLjMsMS4wMWgwczQuODQsMy43NCw0Ljg0LDMuNzRsNi45MSw1LjM0LTIuMzUsOC40MmMtNS40OSwxOS42Ny0yMS4wOCw0MC4yNi00Ni4zNCw2MS4xOS0xOC4wOSwxNC45OS0zNC41NywyNC42My0zNS4yNiwyNS4wNGwtNi40NywzLjc3LTYuNS0zLjcyYy0xMS40MS02LjUyLTIxLjU2LTEzLjQxLTMwLjUzLTIwLjI5LDAsMCwwLDAsMCwwLTM3LjY3LTI4LjkxLTU0LjM2LTU3Ljc1LTU1LjIxLTU5LjI0bC01LjEzLTkuMDQsNy42OS02Ljk5WiIvPjxwYXRoIGNsYXNzPSJwIiBkPSJNMjguMDYsMTIyLjc0cy0uMDMuMDMtLjA0LjA0Ii8+PHBhdGggY2xhc3M9InAiIGQ9Ik0yODguMzYsOTcuMXMtLjA0LS4wMi0uMDctLjAzIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0zNS4zOSwxNTkuOTZzLS4wMS4wNy0uMDIuMTFjLS4wMi4wOS0uMDQuMTgtLjA1LjI1LjAyLS4wOC4wMy0uMTYuMDUtLjI1LDAtLjA0LjAyLS4wOC4wMi0uMTFaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0zNS43MSwxNTguN2MtLjAzLjEyLS4wNi4yMi0uMDkuMzMtLjA1LjE5LS4wOS4zNi0uMTQuNTMuMDQtLjE3LjA5LS4zNC4xNC0uNTMuMDMtLjExLjA2LS4yMS4wOS0uMzNaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0zNS4yNCwxNjAuNzNjMCwuMDYtLjAyLjA5LS4wMi4xNCwwLC4wNC0uMDEuMDktLjAyLjEzLDAtLjA0LjAxLS4wOS4wMi0uMTMsMC0uMDUuMDEtLjA5LjAyLS4xNFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE4NS42OCwxNjMuMDZoMHMxLjE2LjQzLDIuMDQsMS4zNGMtLjg4LS45MS0yLjA0LTEuMzQtMi4wNC0xLjM0WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMTg5LjUyLDE5Ni43NmMtLjAxLTEuMDQtLjAxLTIuMDMtLjAxLTIuOTYsMCwuOTQsMCwxLjkzLjAxLDIuOTdoMFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTQ4Ljg2LDEzOS4yNGMuMi0uMTcuNC0uMzUuNjEtLjUyLjM4LS4zMi43Ny0uNjUsMS4xNy0uOTcuMjItLjE4LjQ0LS4zNi42Ny0uNTMuMzEtLjI0LjYzLS40OC45NS0uNzItLjMyLjI0LS42NC40OC0uOTUuNzItLjIzLjE4LS40NS4zNi0uNjcuNTMtLjQuMzItLjc5LjY1LTEuMTcuOTctLjIuMTctLjQxLjM1LS42MS41Mi0uMzkuMzQtLjc3LjY5LTEuMTQsMS4wMy0uMTYuMTUtLjMzLjMtLjQ5LjQ1LjE2LS4xNS4zMi0uMy40OS0uNDUuMzctLjM0Ljc1LS42OSwxLjE0LTEuMDNaIi8+PHBvbHlnb24gY2xhc3M9InEiIHBvaW50cz0iMjI2LjY0IDE4OC45OCAyMzEuMSAxOTAuMzYgMjI2LjY0IDE4OC45OCAyMTIuNjggMTg0LjYzIDIxMi42OCAxODQuNjMgMjI2LjY0IDE4OC45OCIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMzkuMiwxNTAuNzJjLjE4LS4zMS4zNy0uNjIuNTctLjk0LjA5LS4xNC4xOC0uMjkuMjgtLjQ0LjE5LS4zLjM5LS42MS42LS45MS4wNS0uMDcuMS0uMTQuMTUtLjIxLS4wNS4wNy0uMS4xNC0uMTUuMjEtLjIxLjMxLS40MS42MS0uNi45MS0uMDkuMTUtLjE5LjI5LS4yOC40NC0uMi4zMi0uMzguNjMtLjU3Ljk0LS4wNy4xMi0uMTUuMjQtLjIxLjM2LS4xMi4yMi0uMjQuNDMtLjM1LjY0LjEyLS4yMS4yMy0uNDIuMzUtLjY0LjA3LS4xMi4xNC0uMjQuMjEtLjM2WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjE3Ljc2LDEyMS4xNWMyLjUxLTEuNzEsNS4yMi0zLjI0LDguMTEtNC41MS0yLjksMS4yOC01LjYsMi44LTguMTEsNC41MVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTM2LjM3LDE1Ni42N2MuMDctLjE5LjE0LS4zOC4yMi0uNTgtLjA4LjItLjE1LjM5LS4yMi41OC0uMDUuMTMtLjA5LjI2LS4xNC4zOS0uMDMuMDktLjA2LjE3LS4wOS4yNS4wMy0uMDguMDYtLjE3LjA5LS4yNS4wNC0uMTMuMDktLjI1LjE0LS4zOVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTM1LjkxLDE1OC4wM2MtLjAzLjExLS4wNy4yMi0uMS4zMy0uMDMuMTEtLjA3LjIzLS4xLjM0LjAzLS4xMS4wNy0uMjIuMS0uMzQuMDMtLjExLjA2LS4yMi4xLS4zM1oiLz48cGF0aCBjbGFzcz0icSIgZD0iTTU0Ljc0LDEzNC43MmMuMjItLjE1LjQzLS4zLjY2LS40NS0uMjMuMTUtLjQ0LjMtLjY2LjQ1LS40OS4zNC0uOTguNjctMS40NSwxLjAxLS4xMi4wOS0uMjQuMTctLjM2LjI2LjEyLS4wOS4yMy0uMTcuMzYtLjI2LjQ3LS4zNC45Ni0uNjcsMS40NS0xLjAxWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMzguMywxNTIuMzJzLjAyLS4wNC4wMy0uMDVjLS4wMS4wMi0uMDIuMDQtLjAzLjA1LS4yMi40MS0uNDIuODEtLjYxLDEuMi0uMDQuMDktLjA4LjE4LS4xMy4yNy4wNC0uMDkuMDgtLjE4LjEzLS4yNy4xOS0uMzkuMzktLjc5LjYxLTEuMloiLz48cGF0aCBjbGFzcz0icSIgZD0iTTM3LjAyLDE1NS4wMmMuMDUtLjEyLjEtLjI0LjE2LS4zNy4xMi0uMjguMjUtLjU2LjM5LS44NS0uMTQuMjktLjI3LjU3LS4zOS44NS0uMDYuMTMtLjExLjI1LS4xNi4zNy0uMS4yMy0uMTkuNDUtLjI4LjY3LS4wNS4xNC0uMTEuMjctLjE2LjQuMDUtLjEzLjEtLjI2LjE2LS40LjA5LS4yMi4xOC0uNDQuMjgtLjY3WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjkyLjQsMTg4LjcxYy4xNS0uMDguMy0uMTcuNDQtLjI1LjAzLS4wMi4wNi0uMDQuMS0uMDUtLjAzLjAyLS4wNy4wNC0uMS4wNS0uMTQuMDgtLjI5LjE3LS40NC4yNVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI5MS4xNiwxODkuMzhjLjA2LS4wMy4xMS0uMDYuMTctLjA4LjE2LS4wOC4zMS0uMTYuNDYtLjI0LS4xNS4wOC0uMy4xNi0uNDYuMjQtLjA1LjAzLS4xMS4wNi0uMTcuMDhaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yODQuMjUsMTkyLjQ1Yy0uMzkuMTUtLjc2LjMxLTEuMTguNDctLjAxLDAtLjAzLjAxLS4wNC4wMi4wMSwwLC4wMy0uMDEuMDQtLjAyLjQxLS4xNi43OS0uMzEsMS4xOC0uNDcuMTktLjA4LjQtLjE2LjU5LS4yNC4yNi0uMTEuNS0uMi43NC0uMzEtLjI1LjEtLjQ4LjItLjc0LjMxLS4xOS4wOC0uNC4xNi0uNTkuMjRaIi8+PHBvbHlnb24gY2xhc3M9InEiIHBvaW50cz0iMjU0LjQ0IDE5Ny41IDI5Ni4wNiAxODUuNTggMjU0LjQ0IDE5Ny41IDI1NC4yMSAxOTcuNTYgMjQ3LjYyIDE5NS41MSAyNTQuMjEgMTk3LjU2IDI1NC40NCAxOTcuNSIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjg1LjUyLDE3MS4zN2MtMy42Ny0xLjM2LTcuMjQtMi44OS0xMC41OC00LjQzLDMuMzQsMS41NSw2LjkxLDMuMDcsMTAuNTgsNC40M2gwWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjk1LjM2LDE4Ni43MXMtLjA4LjA3LS4xMS4xYy0uMDIuMDItLjA0LjA0LS4wNy4wNi4wMi0uMDIuMDQtLjA0LjA3LS4wNi4wNC0uMDMuMDgtLjA3LjExLS4xLjA0LS4wNC4wOC0uMDguMTItLjEyLjAyLS4wMi4wMy0uMDMuMDUtLjA1LS4wMi4wMi0uMDMuMDMtLjA1LjA1LS4wNC4wNC0uMDcuMDgtLjEyLjEyWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjk2LjA3LDE4NS42MnMwLS4wMywwLS4wM2MwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwuMDEsMCwuMDNaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yODEuMTIsMTkzLjY2cy4wMSwwLC4wMiwwYy4xNS0uMDYuMjktLjExLjQ0LS4xNy0uMTUuMDYtLjI4LjExLS40NC4xNywwLDAtLjAxLDAtLjAyLDBaIi8+PHBvbHlnb24gY2xhc3M9InEiIHBvaW50cz0iMjc3LjEzIDI3Mi45NiAyNjEuMzggMjgzLjUgMjc3LjEzIDI3Mi45NiAyNzcuMTMgMjcyLjk2Ii8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yOTQuNDIsMTg3LjQ2Yy0uMjMuMTYtLjQ4LjM0LS43OC41Mi4yOS0uMTkuNTUtLjM2Ljc4LS41MloiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI1NC40MSwyMDIuM2MuNzgtLjIzLDEuNTMtLjQ1LDIuMjktLjY3LS43NS4yMi0xLjUxLjQ0LTIuMjkuNjdoMFoiLz48cG9seWdvbiBjbGFzcz0icSIgcG9pbnRzPSIyNzUuOTcgMjc0LjI4IDI3NS45NyAyNzQuMjggMjc1Ljk3IDI3NC4yOCAyNzUuOTcgMjc0LjI4Ii8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNTMuMTcsMjkyLjY3cy4wOS4wNS4xMy4wN2MuMTguMS4zNC4xOS40OC4yNy0uMTMtLjA3LS4yOS0uMTYtLjQ4LS4yNy0uMDQtLjAyLS4wOS0uMDUtLjEzLS4wN1oiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIzMy43OCwyNzkuNDVjLjA4LjA2LjE1LjEyLjIzLjE4Ljc1LjU3LDEuNDcsMS4xMSwyLjE4LDEuNjUtLjcxLS41My0xLjQzLTEuMDctMi4xOC0xLjY1LS4wNy0uMDYtLjE1LS4xMi0uMjMtLjE4WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjM3LjkyLDI4Mi41NmMxLjE2Ljg1LDIuMjYsMS42NCwzLjMxLDIuMzguMTcuMTIuMzMuMjMuNDkuMzQtLjE2LS4xMS0uMzItLjIyLS40OS0uMzQtMS4wNS0uNzQtMi4xNS0xLjUzLTMuMzEtMi4zOFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTQxLjk5LDE0Ni41NmMuMjUtLjM0LjUyLS42Ny44LTEuMDEuMTEtLjE0LjIyLS4yOC4zMy0uNDIuMzUtLjQyLjcxLS44NCwxLjA5LTEuMjcuMDUtLjA2LjEtLjEyLjE1LS4xOC40NC0uNS45MS0uOTksMS4zOS0xLjUuMDctLjA3LjE1LS4xNS4yMi0uMjItLjA3LjA3LS4xNS4xNS0uMjIuMjItLjQ5LjUtLjk1LDEtMS4zOSwxLjUtLjA1LjA2LS4xLjEyLS4xNS4xOC0uMzguNDMtLjc0Ljg1LTEuMDksMS4yNy0uMTIuMTQtLjIyLjI4LS4zMy40Mi0uMjcuMzQtLjU0LjY4LS44LDEuMDEtLjEyLjE2LS4yMy4zMS0uMzQuNDYtLjExLjE0LS4yLjI4LS4zMS40My4xLS4xNC4yLS4yOC4zMS0uNDMuMTEtLjE1LjIzLS4zMS4zNC0uNDZaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNjguNDMsMTEyLjU4aDBzLjA4LjAyLjIyLjA1Yy0uMTQtLjAzLS4yMi0uMDUtLjIyLS4wNVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI2OC43NiwxMTIuNjZjLjE3LjA0LjQuMS43LjE3LS4zLS4wOC0uNTMtLjEzLS43LS4xN1oiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI4Ny42LDE4MC4zMWgwYy44OS0uMSwxLjc2LS4yMiwyLjYxLS4zNC0uODUuMTMtMS43Mi4yNC0yLjYxLjM0WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjk3LjIsMjU2Ljk4Yy0uMTEuMTUtLjIxLjI3LS4yOC4zNy0uMTMuMTgtLjIxLjI4LS4yMS4yOCwwLDAsLjA2LS4wOC4xNy0uMjIuMDgtLjEuMi0uMjYuMzMtLjQzWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNOTcuNTgsMTE2Ljg0YzEuNTYtLjczLDMuMDQtMS41LDQuNS0yLjI3LTEuNDUuNzctMi45NCwxLjUzLTQuNSwyLjI3WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNNDIuOTksMTU0LjM2Yy0uNi41Ny0xLjE1LDEuMTEtMS42NywxLjY0LjUxLS41MiwxLjA3LTEuMDcsMS42Ny0xLjY0WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjkzLjI1LDEyNC4wOGMuOTguNzIsMS45NSwxLjQ3LDIuOTEsMi4yNy0uOTYtLjgtMS45NC0xLjU1LTIuOTEtMi4yN1oiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI5Ny4zNiwyNTYuNzZzLjA4LS4xMS4xMi0uMTZjLS4wNy4wOS0uMTUuMTktLjIxLjI3LjAzLS4wMy4wNS0uMDYuMDctLjA5LDAsMCwwLS4wMS4wMi0uMDJaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0zMDIuMjksMjg0LjYyaDBzMS4yNC0xLjU2LDIuNjctNC4xOGMtMS40MywyLjYyLTIuNjcsNC4xOC0yLjY3LDQuMThaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0zMTkuOTksMjk0Ljg1Yy0xLjU3LDIuMzUtMy4zNiw0Ljc3LTUuMjksNi44NSwxLjkzLTIuMDgsMy43Mi00LjQ5LDUuMjktNi44NVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTMyMi4xNiwyOTEuNDJjLS42NiwxLjA5LTEuMzgsMi4yNS0yLjE2LDMuNDMuNzgtMS4xOCwxLjUxLTIuMzQsMi4xNi0zLjQzWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMzEzLjY1LDIwNi44Yy4wNywwLC4xNC4wNS4yLjEyLS4wNi0uMDctLjEzLS4xMi0uMi0uMTJaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0zMDcuMDgsMjQzYy4xOS0uMzUuMzMtLjY1LjQxLS44OS0uMDguMjMtLjIyLjUzLS40MS44OVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTMxMS45OSwyMzguNTljMS4wNywxLjA1LDIuMTksMi4xLDIuNjMsMi4zNi0uNDUtLjI2LTEuNTctMS4zMi0yLjYzLTIuMzZaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0xMDEuNCw4Ni4xOWgwYzMuNjctLjYyLDcuMzYtMS42OCwxMS4wOS0zLjA2LTMuNzIsMS4zOC03LjQxLDIuNDQtMTEuMDksMy4wNloiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIzNS44OCw0MS4yNGMxLjU5LjM1LDMuMDkuNzQsNC41MSwxLjE2LTEuNDItLjQzLTIuOTMtLjgyLTQuNTEtMS4xNi0uMTQtLjAzLS4yOC0uMDYtLjQyLS4wOS0xLjU5LS4zNC0zLjI2LS42NC01LjAyLS44OSwxLjc2LjI1LDMuNDMuNTUsNS4wMi44OS4xNC4wMy4yOC4wNi40Mi4wOVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIyNy41NSwzOS44OGMtLjc5LS4wOS0xLjYtLjE3LTIuNDMtLjI1LS4xLDAtLjE5LS4wMi0uMjktLjAzLjEsMCwuMTkuMDIuMjkuMDMuODMuMDcsMS42NC4xNiwyLjQzLjI1WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjI0LjgzLDM5LjZjLTEuODUtLjE1LTMuNzctLjI4LTUuNzktLjM0LS43NS0uMDItMS40OS0uMDQtMi4yNC0uMDQuNzQsMCwxLjQ5LjAyLDIuMjQuMDQsMi4wMi4wNywzLjk0LjE5LDUuNzkuMzRaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMzAuMjMsNDAuMjJjLjA3LjAxLjEzLjAzLjIxLjA0LS4wNy0uMDEtLjEzLS4wMy0uMjEtLjA0LS4xMS0uMDItLjI0LS4wMi0uMzUtLjA0LS43Ny0uMTEtMS41NC0uMjEtMi4zMy0uMy43OS4wOSwxLjU3LjE5LDIuMzMuMy4xMS4wMi4yNC4wMi4zNS4wNFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTc2LjI3LDEyNC41NmMuMi0uMDYuNDEtLjEzLjYxLS4xOS0uMi4wNi0uNDEuMTMtLjYxLjE5LS4zOC4xMi0uNzQuMjUtMS4xMS4zNy0uNTcuMTktMS4xNC4zOS0xLjcuNTguNTYtLjIsMS4xMi0uMzksMS43LS41OC4zNy0uMTIuNzMtLjI1LDEuMTEtLjM3WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNNjMuNjksMTI5LjU3Yy41OS0uMjksMS4xOC0uNTcsMS43OS0uODUtLjYxLjI4LTEuMi41Ni0xLjc5Ljg1LS4zMy4xNi0uNjYuMzItLjk4LjQ4LS4zMy4xNi0uNjMuMzMtLjk1LjUuMzItLjE3LjYyLS4zMy45NS0uNS4zMi0uMTYuNjYtLjMyLjk4LS40OFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTYwLjQ2LDEzMS4yNGMtLjEyLjA2LS4yMy4xMi0uMzUuMTktLjg0LjQ3LTEuNjYuOTQtMi40NCwxLjQxLjc5LS40OCwxLjYtLjk1LDIuNDQtMS40MS4xMS0uMDYuMjMtLjEyLjM1LS4xOVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTY5LjY2LDEyNi45M2MtLjQxLjE2LS44MS4zMy0xLjIxLjUtLjYyLjI2LTEuMjQuNTItMS44NC43OS42LS4yNywxLjIxLS41MywxLjg0LS43OS40LS4xNy44LS4zMywxLjIxLS41WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjU1LjYyLDg5LjQyYy42Ny0yLjQ4LDEuMTItNSwxLjM0LTcuNDQtLjIxLDIuNDQtLjY2LDQuOTYtMS4zNCw3LjQ0aDBaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMjYuODYsNjMuNDVjLjM3LjExLjc1LjIzLDEuMTMuMzUuNDYuMTUuOS4zLDEuMzQuNDUtLjQ0LS4xNi0uODgtLjMxLTEuMzQtLjQ1LS4zOC0uMTItLjc2LS4yMy0xLjEzLS4zNVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI1NC4yMSw4OS40OWMuNDItLjA1Ljg1LS4wOCwxLjMtLjA4LjAyLDAsLjAzLDAsLjA1LDAtLjAyLDAtLjAzLDAtLjA1LDAtLjQ1LDAtLjg4LjA0LTEuMy4wOFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI0MC43LDQyLjQ5YzEuNDQuNDQsMi44LjkyLDQuMDcsMS40My0xLjI3LS41MS0yLjYzLS45OS00LjA3LTEuNDNaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNjMuNDYsNzUuNzFjMS4zNC0xMC45OS0xLjE3LTI0LjYzLTE4LjUzLTMxLjcyLDE3LjM2LDcuMDksMTkuODcsMjAuNzQsMTguNTMsMzEuNzJaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNjIuNDgsODEuMTRjLjAyLS4wOS4wNC0uMTguMDYtLjI3LjA1LS4yMS4wOS0uNDIuMTQtLjY0LS4wNS4yMS0uMDkuNDMtLjE0LjY0LS4wMi4wOS0uMDQuMTgtLjA2LjI3WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjYxLjM1LDg1LjE5Yy4wNi0uMTkuMTItLjM4LjE4LS41OC4wNi0uMTkuMTItLjM3LjE3LS41Ni0uMDYuMTktLjExLjM4LS4xNy41Ni0uMDYuMi0uMTIuMzktLjE4LjU4WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjYwLjc5LDg2Ljg0Yy4wOC0uMjQuMTctLjQ5LjI1LS43NC4wMy0uMS4wNy0uMi4xLS4zLS4wMy4xLS4wNy4yLS4xLjMtLjA5LjI1LS4xNy41LS4yNS43NFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI3My44OSwyOTcuNDdjLjI1LS4xNS41LS4yOS43NS0uNDQtLjI1LjE1LS41LjI5LS43NS40NC0uMTUuMDktLjMuMTctLjQ0LjI2LS40LjIzLS44MS40Ny0xLjIxLjcuNC0uMjMuODEtLjQ3LDEuMjEtLjcuMTUtLjA5LjMtLjE3LjQ0LS4yNloiLz48cG9seWdvbiBjbGFzcz0icSIgcG9pbnRzPSIxOTYuODYgMjM3LjE4IDE5Mi4yMyAyNDEuMDEgMTk2Ljg2IDIzNy4xOCAxOTYuODYgMjM3LjE4Ii8+PHBhdGggY2xhc3M9InEiIGQ9Ik0xOTYuMzMsMjMzLjFjLjAxLjEuMDMuMjEuMDQuMzEsMCwuMDUuMDEuMDkuMDIuMTQsMC0uMDUtLjAxLS4wOS0uMDItLjE0LS4wMS0uMS0uMDMtLjIxLS4wNC0uMzFaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNTMuMzUsMzE1LjA1Yy0uMjYtLjExLS41Ny0uMjQtLjkyLS4zOS4zNi4xNS42Ni4yOC45Mi4zOVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE5Ni4xMiwyMzEuNDJjLjAzLjI0LjA2LjQ4LjA5LjcxLDAsLjA4LjAyLjE1LjAzLjIyLDAtLjA3LS4wMi0uMTQtLjAzLS4yMi0uMDMtLjIzLS4wNi0uNDYtLjA5LS43MVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE5Ni4zOSwyNjguNDljLjEuMjkuMjIuNTcuMzMuODYtLjExLS4yOS0uMjItLjU3LS4zMy0uODZoMFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIzMS4wMiwyOTIuMDVoMGMtLjMxLS4xMy0xLjA0LS40NC0xLjk4LS44NS45NC40MSwxLjY3LjcyLDEuOTguODVaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMDIuMzIsMTcwLjI1Yy4xOS4xMS4zOC4yMy41Ni4zMy40Mi4yNC44Mi40NSwxLjIxLjY3LS40LS4yMS0uNzktLjQzLTEuMjEtLjY3LS4xOC0uMTEtLjM4LS4yMi0uNTYtLjMzWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjE5LjcxLDI4Mi40OGMuNTIuNDgsMS4wNS45NiwxLjYsMS40NS0uNTYtLjQ5LTEuMDgtLjk3LTEuNi0xLjQ1WiIvPjxwb2x5Z29uIGNsYXNzPSJxIiBwb2ludHM9IjE5Ni4zOSAyNjguNDkgMTk2LjM5IDI2OC40OSAxOTkuNzQgMjYwLjk4IDE5Ni4zOSAyNjguNDkiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE4OS4zMSwxNjYuMzVzLjA0LjA1LjA3LjA4Yy4yNS4yOC41My41OC44NS44OCwwLDAsLjAyLjAyLjAzLjAzLjMuMjkuNjMuNTguOTkuODguMDMuMDMuMDcuMDYuMS4wOS4xOS4xNi4zOS4zMi42LjQ3LS4yMS0uMTYtLjQxLS4zMi0uNi0uNDctLjAzLS4wMy0uMDctLjA2LS4xLS4wOS0uMzYtLjMtLjY5LS41OS0uOTktLjg4LS4wMSwwLS4wMi0uMDItLjAzLS4wMy0uMzEtLjMtLjU5LS42LS44NS0uODgtLjAyLS4wMy0uMDQtLjA1LS4wNy0uMDgtLjIyLS4yNC0uNDEtLjQ4LS41OS0uNy0uMDQtLjA1LS4wOS0uMTEtLjEzLS4xNi4wNC4wNS4wOS4xMS4xMy4xNi4xOC4yMy4zOC40Ni41OS43WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMTk0LjIzLDE3MC4yOWMuNTUuMzIsMS4xNC42NCwxLjc4Ljk1LDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLS42NS0uMzEtMS4yMy0uNjMtMS43OC0uOTUtLjA0LS4wMi0uMDctLjA0LS4xMS0uMDYtLjU1LS4zMi0xLjA1LS42NC0xLjUxLS45Ni40Ni4zMi45Ni42NCwxLjUxLjk2LjA0LjAyLjA3LjA0LjExLjA2WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMTk5LjM4LDE3Mi42NWMtLjQxLS4xNS0uOC0uMy0xLjE4LS40NS0uNjQtLjI1LTEuMjMtLjUyLTEuNzktLjc4LjU2LjI2LDEuMTUuNTIsMS43OS43OC4zOC4xNS43Ny4zLDEuMTguNDVaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNTUuMjgsMzA4LjA2Yy40Mi0uMjMuOTctLjU0LDEuNjMtLjkxLS42Ni4zNy0xLjIxLjY4LTEuNjMuOTFaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMDUuNDIsMTcxLjk1Yy4xNy4wOS4zNC4xOC41LjI2LDAsMCwuMDIuMDEuMDMuMDItLjAxLDAtLjAyLS4wMS0uMDMtLjAyLS4xNi0uMDgtLjMzLS4xNy0uNS0uMjZaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0xODUuNTYsMTY3LjE1YzAtLjE3LDAtLjM0LjAxLS41MSwwLC4xNywwLC4zNC0uMDEuNTEtLjAxLjYzLS4wMywxLjI2LS4wNCwxLjg2LDAsMCwwLC4wMSwwLC4wMiwwLDAsMC0uMDEsMC0uMDIuMDEtLjYuMDItMS4yMy4wNC0xLjg2WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMTg2LjI2LDE4OS4xNXMwLC4wMywwLC4wNGMuMDQuMjkuMDguNTcuMTIuODQtLjA0LS4yNy0uMDgtLjU1LS4xMi0uODQsMC0uMDEsMC0uMDMsMC0uMDRaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0xODUuNDksMTcyLjI5YzAsLjIxLDAsLjQyLDAsLjYzLDAsLjQsMCwuNzksMCwxLjE4LDAtLjM5LDAtLjc4LDAtMS4xOCwwLS4yMSwwLS40MiwwLS42M1oiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE4OS41MSwxOTMuOGMwLS42NiwwLTEuMy4wMS0xLjkxLDAsLjYxLS4wMSwxLjI1LS4wMSwxLjkxaDBaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0xOTQuMjIsMjE0Ljc0Yy4wNi42Mi4xMywxLjI0LjE5LDEuODQuMDYuNTMuMTEsMS4wNS4xNywxLjU2LS4wNS0uNTEtLjExLTEuMDMtLjE3LTEuNTYtLjA2LS42LS4xMy0xLjIyLS4xOS0xLjg0WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjE2LjY2LDI3OS42N2MtLjkxLS44Ni0xLjgzLTEuNzMtMi42Ni0yLjU1LS43My0uNzItMS40NC0xLjQzLTIuMTEtMi4xMi42OC42OSwxLjM4LDEuNCwyLjExLDIuMTIuODQuODIsMS43NSwxLjY5LDIuNjYsMi41NVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIwOS45NCwyNzIuOTljLTEuMjQtMS4zLTIuMzctMi41My0zLjM4LTMuNjYtLjktMS4wMS0xLjcxLTEuOTQtMi40My0yLjc5LjcyLjg1LDEuNTMsMS43OCwyLjQzLDIuNzksMS4wMSwxLjEzLDIuMTQsMi4zNiwzLjM4LDMuNjZaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMDcuNDEsMjg1LjQycy4wNi4wNy4wOS4xYy4wMi4wMi4wMy4wNC4wNS4wNS0uMDItLjAyLS4wMy0uMDQtLjA1LS4wNS0uMDMtLjAzLS4wNi0uMDctLjA5LS4xWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjkxLjI2LDI4Ni4yM3MwLDAsMCwwaDBzMCwwLDAsMGMtLjA0LjA4LS4xMi4xNy0uMjIuMjgtLjA0LjA0LS4xLjEtLjE1LjE0LjA1LS4wNS4xMS0uMS4xNS0uMTQuMS0uMTEuMTctLjIuMjItLjI4WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjIzLjIxLDI4NS41OGMtLjI5LS4yNS0uNTktLjUtLjg3LS43NS0uMzQtLjMtLjY5LS42LTEuMDItLjg5LjMzLjMuNjguNiwxLjAyLjg5LjI5LjI1LjU4LjUuODcuNzVaIi8+PHBvbHlnb24gY2xhc3M9InEiIHBvaW50cz0iMjg5Ljg3IDI4OC4wNyAyODkuODcgMjg4LjA3IDI4OS44NyAyODguMDcgMjg5Ljg3IDI4OC4wNyAyODkuODcgMjg4LjA3Ii8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMTQuMzEsMjkxLjkxYy4zLjI2LjYuNTIuOTEuNzcuMDQuMDQuMDkuMDcuMTMuMTEtLjA0LS4wNC0uMDktLjA3LS4xMy0uMTEtLjMxLS4yNS0uNi0uNTEtLjkxLS43N1oiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIxNS40MiwyOTIuODNjMS40MiwxLjE3LDIuODcsMi4zLDQuMzQsMy4zOC0uNTctLjQyLTEuMTMtLjg4LTEuNjktMS4zMi0uODktLjY4LTEuNzgtMS4zNS0yLjY1LTIuMDZaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMzEuMjEsMjkyLjEzaDBjLTEuNTgtMS4yMi0zLjA4LTIuNDMtNC41My0zLjYzLS4yNi0uMjEtLjUxLS40Mi0uNzYtLjYzLjI1LjIxLjUuNDIuNzYuNjMsMS40NSwxLjIsMi45NSwyLjQsNC41MywzLjYyWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjY0LjQzLDMwMi45MmMuMTUtLjA5LjMxLS4xOC40Ny0uMjYtLjE2LjA5LS4zMS4xOC0uNDcuMjYtLjMzLjE5LS42NS4zNy0uOTcuNTUtLjE2LjA5LS4zMi4xOC0uNDguMjcuMTYtLjA5LjMyLS4xOC40OC0uMjcuMzItLjE4LjY0LS4zNi45Ny0uNTVaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yODMuMiwyOTEuOTFjLjIzLS4xNC40Ni0uMjguNjgtLjQyLjIzLS4xNC40Ni0uMjguNjgtLjQyLS4yMi4xNC0uNDUuMjgtLjY4LjQyLS4yMy4xNC0uNDUuMjgtLjY4LjQyLS4yMy4xNC0uNDYuMjgtLjY5LjQyLS4yNC4xNS0uNDguMy0uNzMuNDUuMjUtLjE1LjQ5LS4zLjczLS40NS4yMy0uMTQuNDYtLjI4LjY5LS40MloiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI4Ny43NywyODguOTljLS4wOS4wNi0uMTguMTItLjI3LjE4LS4xNy4xMS0uMzQuMjItLjUxLjM0LjE3LS4xMS4zNS0uMjMuNTEtLjM0LjA5LS4wNi4xOC0uMTIuMjctLjE4WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjg4LjcsMjg4LjM2Yy0uMDcuMDUtLjEzLjA5LS4yLjE0LS4wNi4wNC0uMTIuMDgtLjE4LjEyLjA2LS4wNC4xMi0uMDguMTgtLjEyLjA3LS4wNS4xMy0uMDkuMi0uMTRaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNTQuNjEsMzA4LjQzYy0uMTcuMS0uMjcuMTUtLjI3LjE1LDAsMC0uMDIsMC0uMDMtLjAxLDAsMCwuMDIsMCwuMDMuMDEsMCwwLC4xLS4wNi4yNy0uMTVaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMjcuNDEsMjkzLjM2Yy4wNS4wNC4xMS4wOC4xNy4xMS0uMDYtLjA0LS4xMS0uMDgtLjE3LS4xMS0uNS0uMzUtLjk3LS42OC0xLjQxLTEtMy4yMS0yLjM0LTQuOTMtMy45My01LjY3LTQuNjguNzUuNzUsMi40NywyLjM0LDUuNjcsNC42OC40NC4zMi45MS42NiwxLjQxLDFaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNDUuOTUsMzA0LjM3Yy45Ni41LDEuOTMsMS4wMSwyLjk2LDEuNTMtMS4wMy0uNTItMi0xLjAzLTIuOTYtMS41My0uNzEtLjM3LTEuNDEtLjc0LTIuMDgtMS4xLTEuNTUtLjgzLTMtMS42My00LjM2LTIuNCwxLjM2Ljc3LDIuODIsMS41Nyw0LjM2LDIuNC42OC4zNiwxLjM4LjczLDIuMDgsMS4xWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjIwLjA0LDI4Ny4zN2MtLjEyLS4xMy0uMTctLjE5LS4xNy0uMTksMCwwLDAsMCwwLDAsMCwwLC4wNi4wNy4xNy4xOVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIwOC43OCwxNzQuMjFsLS4wOS44M2MtMS45My0uMzQtMy42NC0uNzMtNS4yMi0xLjE0LDEuNTguNDEsMy4yOS44LDUuMjIsMS4xNGwuMDktLjgzWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjUyLjEzLDE1Mi4zNmMuNDItLjI5Ljc5LS41NCwxLjA4LS43NSwwLDAsLjAxLS4wMS4wMi0uMDIsMCwwLS4wMSwwLS4wMi4wMi0uMy4yMS0uNjYuNDYtMS4wOC43NVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIxNC4zOSwxNzEuNjhjLS4wNywwLS4xMSwwLS4xMSwwLDAsMCwwLDAsMCwwLDAsMCwuMDQsMCwuMTEsMFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIxOS44OCwxNjkuOTdjLjMyLS4xMS42NC0uMjMuOTYtLjM1LjEyLS4wNS4yNS0uMS4zNy0uMTUtLjEyLjA1LS4yNS4xLS4zNy4xNS0uMzIuMTItLjY0LjIzLS45Ni4zNVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI1MS40NywxNTIuODFjLjIxLS4xNC40MS0uMjguNTktLjQuMDItLjAyLjA0LS4wMy4wNi0uMDQtLjAyLjAyLS4wNC4wMy0uMDYuMDQtLjE5LjEzLS4zOS4yNi0uNTkuNFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIzNS4yNiwxMTMuNmMtLjE4LjA0LS4zNy4wNy0uNTUuMTEtMS44OS40My0zLjcyLjk2LTUuNDgsMS41OSwxLjc2LS42MywzLjU5LTEuMTYsNS40OC0xLjU5LjE4LS4wNC4zNy0uMDcuNTUtLjExWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjQzLjU1LDExNy4xM2MtLjE1LS4yNS0uMy0uNDktLjQ0LS43Mi0uMTMtLjIxLS4yNi0uNDEtLjM4LS42LjEyLjE5LjI1LjQuMzguNi4xNC4yMy4yOS40Ny40NC43MloiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI0OS4xLDEzMS4xMWMtLjItMi4wMi0uODItNC4xNi0xLjY0LTYuMjQuODIsMi4wOCwxLjQ0LDQuMjIsMS42NCw2LjI0aDBaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yNDYuMDEsMTAxLjQxczAsMCwwLDBjLjYyLS42NywxLjI5LTEuMzMsMi4wMi0xLjk0LDAsMCwwLDAsMCwwLC4yMi0uMTkuNDUtLjM3LjY4LS41NS0uMjMuMTgtLjQ2LjM2LS42OC41NSwwLDAsMCwwLDAsMC0uNzMuNjItMS40LDEuMjgtMi4wMiwxLjk0dDAsMHMwLDAsMCwwYy0uODMuODktMS41NSwxLjc4LTIuMTYsMi42LjYxLS44MiwxLjM0LTEuNzEsMi4xNi0yLjYsMCwwLDAsMCwwLDBaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMzEuNzUsMTY3LjY2Yy4yMy0uMDguNDctLjE3LjctLjI2LS4yMy4wOS0uNDcuMTgtLjcuMjYtLjA3LjAzLS4xNC4wNS0uMjIuMDgtLjYyLjIyLTEuMjIuNDItMS44Mi42Mi42LS4yLDEuMi0uMzksMS44Mi0uNjIuMDctLjAzLjE0LS4wNS4yMi0uMDhaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMzQuOTEsMTY2LjQ1Yy0uMDYuMDItLjEyLjA1LS4xNy4wNy0uMjQuMS0uNDcuMTgtLjcuMjguMjMtLjA5LjQ3LS4xOC43LS4yOC4wNi0uMDIuMTItLjA1LjE3LS4wN1oiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE5Ni41LDE2Ni4xOXMuMDIuMDIuMDMuMDNjLjAyLjAyLjA1LjA0LjA3LjA2LS4wMi0uMDItLjA1LS4wNC0uMDctLjA2LDAsMC0uMDItLjAyLS4wMy0uMDNaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMjMuNDQsMTcwLjE2Yy0uMDkuMDItLjE4LjA0LS4yOC4wNi0uMzYuMDktLjcyLjE3LTEuMDcuMjUuMzUtLjA4LjctLjE2LDEuMDctLjI1LjA5LS4wMi4xOC0uMDQuMjgtLjA2WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjI1Ljk3LDE2OS41Yy0uMS4wMy0uMi4wNS0uMy4wOC0uNzcuMjEtMS41Mi40LTIuMjIuNTcuNzEtLjE3LDEuNDUtLjM2LDIuMjItLjU3LjEtLjAzLjItLjA1LjMtLjA4WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjQ5LjYyLDE1OC42OGMtLjE4LjExLS4zNS4yMi0uNTMuMzQtMS4wOS43LTIuMTcsMS4zNy0zLjI0LDIuMDEsMS4wNy0uNjMsMi4xNi0xLjMsMy4yNC0yLjAxLjE4LS4xMS4zNS0uMjIuNTMtLjM0WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjQxLjQyLDE2My40NmMuMS0uMDUuMTktLjEuMjktLjE0LDEuMDQtLjUzLDIuMDktMS4xMSwzLjE1LTEuNzEtMS4wNi42LTIuMTEsMS4xOC0zLjE1LDEuNzEtLjEuMDUtLjE5LjEtLjI5LjE0LTEuMDguNTUtMi4xNCwxLjA3LTMuMTksMS41NS0uMDMuMDEtLjA1LjAyLS4wOC4wNC4wMy0uMDEuMDUtLjAyLjA4LS4wNCwxLjA1LS40OCwyLjExLTEsMy4xOS0xLjU1WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjAyLjc2LDEzNi4wNnMuMDQtLjA1LjA1LS4wN2MtLjAyLjAyLS4wNC4wNS0uMDUuMDctLjUuNzEtLjk5LDEuNDItMS40NSwyLjEzLS4wNS4wOC0uMS4xNS0uMTUuMjMuMDUtLjA4LjEtLjE1LjE1LS4yMy40Ni0uNzEuOTUtMS40MiwxLjQ1LTIuMTNaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMTYuMzcsMTIyLjE2Yy0uMzMuMjQtLjY2LjQ3LS45OC43MS0uMDIuMDItLjA1LjA0LS4wNy4wNS4wMi0uMDIuMDUtLjA0LjA3LS4wNS4zMi0uMjQuNjUtLjQ3Ljk4LS43MVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE5Ni41MiwxNDYuOTZjLS4wOS4yMS0uMi40My0uMjkuNjQtLjA1LjExLS4xLjIzLS4xNC4zNC4wNS0uMTEuMS0uMjMuMTQtLjM0LjA5LS4yMS4yLS40My4yOS0uNjRaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0yMjkuMjEsMTE1LjNzMCwwLDAsMGMwLDAsMCwwLDAsMC0uMTMuMDQtLjI1LjEtLjM3LjE1LTEuMDEuMzctMiwuNzctMi45NiwxLjE5Ljk3LS40MywxLjk1LS44MiwyLjk2LTEuMTkuMTMtLjA1LjI0LS4xLjM3LS4xNVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTIwNC42NiwxMzMuNTJjLjQtLjUxLjgzLTEuMDIsMS4yNS0xLjUyLS40Mi41MS0uODUsMS4wMS0xLjI1LDEuNTIsMCwwLDAsMCwwLC4wMS0uMS4xMy0uMi4yNy0uMy40LjEtLjEzLjItLjI3LjMtLjQsMCwwLDAsMCwwLS4wMVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE5My40OCwxNTUuOTRjLS4wMi4xLS4wNC4yLS4wNi4zLS4wMy4xNi0uMDUuMy0uMDguNDYuMDMtLjE1LjA1LS4zLjA4LS40Ni4wMi0uMS4wNC0uMi4wNi0uM1oiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE5NS4yLDE1MC4xNWMuMDUtLjE0LjExLS4yOS4xNy0uNDQuMTctLjQ2LjM3LS45Mi41Ni0xLjM5LS4xOS40Ny0uMzkuOTMtLjU2LDEuMzktLjA2LjE1LS4xMS4yOS0uMTcuNDQtLjIyLjU4LS40MSwxLjE1LS42LDEuNywwLC4wMy0uMDIuMDYtLjAzLjA5LjAxLS4wMy4wMi0uMDYuMDMtLjA5LjE4LS41Ni4zOC0xLjEyLjYtMS43WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjEwLjkxLDEyNi42NnMuMDYtLjA1LjA5LS4wOGMtLjAzLjAzLS4wNi4wNS0uMDkuMDgtLjA3LjA3LS4xNS4xNC0uMjIuMi0uNTEuNDktMSwuOTktMS40OSwxLjQ5LjQ5LS41Ljk4LTEsMS40OS0xLjQ5LjA3LS4wNy4xNS0uMTQuMjItLjJaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0xOTMuMTEsMTU4LjRjLS4wMi4xNi0uMDMuMzItLjA1LjQ3LS4wMS4xNi0uMDIuMzMtLjAzLjQ4aDBjMC0uMTYuMDItLjMyLjAzLS40OC4wMS0uMTUuMDMtLjMxLjA1LS40N1oiLz48cG9seWdvbiBjbGFzcz0icSIgcG9pbnRzPSIyMDguNyAxMjguODUgMjA4LjcgMTI4Ljg2IDIwOC42OSAxMjguODYgMjA4LjcgMTI4Ljg2IDIwOC43IDEyOC44NSIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjE4LjY2LDM0OS45N3MwLDAsMCwwYzguOTcsNi44OCwxOS4xMSwxMy43NiwzMC41MywyMC4yOWw2LjUsMy43Miw2LjQ3LTMuNzdjLjY5LS40LDE3LjE3LTEwLjA1LDM1LjI2LTI1LjA0LDI1LjI2LTIwLjk0LDQwLjg1LTQxLjUyLDQ2LjM0LTYxLjE5bDIuMzUtOC40Mi02LjkxLTUuMzQtNC44NC0zLjc0aDBzLTEuMy0xLjAxLTEuMy0xLjAxbDEuMjYtMy4yMi01LjQxLTUuOTYtLjc2LS44M2MyLjYyLTMuMTgsNC4xNi01LjE1LDQuMjYtNS4yOWw0Ljg5LTYuMjloMHMxLjQ4LTEuOTEsMS40OC0xLjkxbC02LjYtOC4wMi0yLjg3LTMuNDksMi40NS0xMy41LjU3LTMuMTMsOC44Ni0xNS4xOSwxLjgtMy4wOC0uMDMtMy41Ny0uMjktMzMuNzZjLS4wNS02LjMtMy42My0xMS43OC04LjgyLTE0LjYxLS4wMiwwLS4wMy0uMDItLjA1LS4wMywwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMC0uMjktLjE1LS41OC0uMjktLjg4LS40MiwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMC0uNjctLjMxLTEuMzUtLjYtMi4wNi0uODJoMGMtLjA3LS4wMi0uMTQtLjA1LS4yMS0uMDctMy45OS0xMC44LTEwLjI4LTIwLjY0LTE4LjUtMjguODQtMS4wMy0xLjAzLTIuMDktMi4wMi0zLjE3LTIuOTktLjA1LS4wNC0uMS0uMDktLjE1LS4xMy0uMDktLjA4LS4xNy0uMTYtLjI2LS4yNCwwLDAsMCwwLDAsMC0xLjEyLS45OS0yLjI4LTEuOTUtMy40NS0yLjg3LS4xLS4wOC0uMjEtLjE2LS4zMS0uMjQtLjExLS4wOC0uMjEtLjE2LS4zMi0uMjQsMCwwLDAsMCwwLDAtLjYzLS40OC0xLjI2LS45Ni0xLjktMS40Mi0uMjctLjItLjU1LS4zOS0uODMtLjU4LS4zMS0uMjItLjYyLS40NC0uOTMtLjY2LDAsMCwwLDAsMCwwLS4yNC0uMTYtLjQ4LS4zMi0uNzItLjQ4LS4wOC0uMDUtLjE2LS4xLS4yMy0uMTYtLjQ1LS4zLS45MS0uNi0xLjM3LS44OS0uMjQtLjE1LS40OC0uMy0uNzItLjQ1LS4xNi0uMS0uMzItLjE5LS40Ny0uMjgtLjQ3LS4yOS0uOTQtLjU3LTEuNDEtLjg1LDAsMCwwLDAsMCwwLS4xLS4wNi0uMi0uMTItLjMxLS4xOCwwLDAsMCwwLDAsMC0uNTMtLjMtMS4wNy0uNTktMS42LS44OC0uMi0uMTEtLjQtLjIyLS42LS4zMy0uMTctLjA5LS4zMy0uMTctLjUtLjI2LS42OC0uMzYtMS4zNy0uNy0yLjA2LTEuMDQtLjA5LS4wNC0uMTctLjA4LS4yNi0uMTMtLjAxLDAtLjAzLS4wMS0uMDQtLjAyLS43NC0uMzYtMS40OS0uNy0yLjI0LTEuMDMtMi42OC0xLjE5LTUuNDItMi4yNC04LjIzLTMuMTMtLjA2LS4wMi0uMTMtLjA0LS4xOS0uMDYsNi4wOS0xMS4zNSwxMS4yMy0yNy40Miw0LjY3LTQzLjU1LTMuNzItOS4xNi0xMC43Mi0xNi45NS0yMC44LTIzLjE1LTEwLjIzLTYuMjktMjQuMDEtMTEuMS00MC45NS0xNC4yOWwtLjU4LS4xMS0uNTktLjA2Yy0uNDEtLjA0LTIuNjUtLjIzLTYuMy0uMjMsMCwwLDAsMCwwLDAtNi45NywwLTIwLjY2Ljc4LTM2LjI1LDUuNzUtLjIuMDctLjQxLjEzLS42Mi4yLS4zNi4xMi0uNzIuMjMtMS4wOC4zNWgwYy0uMzkuMTMtLjc5LjI3LTEuMTkuNGgwYy0uMzUuMTItLjcxLjI2LTEuMDcuMzktLjcuMjUtMS4zOS41LTIuMS43NiwwLDAtLjAxLDAtLjAyLDAsMCwwLDAsMCwwLDAtMS4xOS40NS0yLjM4Ljk0LTMuNTgsMS40NSwwLDAsMCwwLS4wMSwwLS4wNC4wMi0uMDkuMDQtLjEzLjA2LDAsMCwwLDAsMCwwLTEuMTUuNDktMi4zLDEuMDEtMy40NiwxLjU0LS4wNC4wMi0uMDguMDMtLjExLjA1LS4wNy4wMy0uMTUuMDctLjIyLjEtNS42OSwyLjY2LTExLjQ0LDUuOTQtMTcuMDUsMTAuMDEtMTcuMjksMTIuNTUtMzEuMjIsMjAuMTgtNDMuNzgsMjMuNzYtLjAyLDAtLjA0LjAxLS4wNi4wMi0uMy4wOC0uNTkuMTYtLjg5LjI0LS44MS4yMS0xLjYxLjQyLTIuNDIuNi0uNTQuMTItMS4wOS4yNi0xLjYzLjM3LTQuMDMuODMtNy45NCwxLjIzLTExLjgsMS4yMy0uMDMsMC0uMDUsMC0uMDgsMGgwYy0uMTcsMC0uMzUsMC0uNTIsMC0uNjMsMC0xLjI1LS4wMi0xLjg4LS4wNS0uNDgtLjAyLS45Ny0uMDUtMS40NS0uMDgtLjE5LS4wMS0uMzktLjAzLS41OC0uMDUtMy45LS4zMS03Ljc3LTEuMDMtMTEuNzUtMi4xOGwtMjkuNjItOC41Ny4wNC4wN2gwczE0LjUzLDI3LjExLDE0LjUzLDI3LjExYy44OCwxLjY0LDYuOTgsMTIuMzMsMjEuNDEsMjEuOTktLjAxLDAtLjAzLjAxLS4wNC4wMi00LjYxLDEuODYtMTAuMjMsMy43MS0xNi45OCw1LjMzLTEyLjM3LDIuOTYtMjMuODksOS44Ny0zMi41NiwxOS4wOS0uMDUuMDUtLjEuMS0uMTUuMTUtLjA0LjA1LS4wOS4xLS4xMy4xNC0uNzQuNzktMS40NiwxLjYtMi4xNSwyLjQyLDAsMCwwLDAsMCwwLS4wMi4wMi0uMDQuMDUtLjA2LjA3LDAsMCwwLDAsMCwwLS4wOC4xLS4xNi4yLS4yNC4zLS4zMS4zOC0uNjEuNzYtLjkxLDEuMTUtLjI4LjM1LS41Ny43LS44NCwxLjA2LDAsMCwwLDAsMCwwLS4wNS4wNy0uMTEuMTMtLjE2LjIsMCwwLDAsMCwwLDAtLjAzLjA0LS4wNi4wOS0uMDkuMTMtLjE0LjE5LS4yNy4zOS0uNDEuNTgtLjQ3LjY1LS45NSwxLjMtMS4zOSwxLjk2LDAsMCwwLDAsMCwwaDBjLS4wMy4wNS0uMDYuMS0uMS4xNS0xLjIxLDEuODQtMi4zMiwzLjczLTMuMzEsNS42Ny03LjM3LDE0LjUyLTcuODQsMzEuMDgtMS4zMyw0Ni42Mmw4LjE5LDE5LjU2LjA3LjE2LDEyLjQ0LTE0LjkzaDBzMCwwLDAsMGwxLjE2LTEuMzljLjU1LS42MiwxMy40Ni0xNS4xNCwyOS44OC0xNy43N2wzNC45Myw5Ljk2Yy43My4yMSw3LjQsMi4wNCwxNi40LDIuMDQsMTcuNjksMCwzMi44MS03LjA4LDQyLjU4LTE5LjkzLDEuNDUtMS45LDIuODctMy43Niw0LjI4LTUuNTYtLjAxLjA3LS4wMi4xNS0uMDMuMjIsMCwwLDAsMCwwLDBoMGMtLjE4Ljk2LS4yOCwxLjk0LS4yOSwyLjk0bC0uMjgsMzMuNjItLjAzLDMuNjMuMS4xNywxLjc2LDIuOTUsNi41OCwxMS4wNGMuMjcsMy4wMi41Myw1LjcuNzcsOC4wOS40OCw0LjcyLjg5LDguMjksMS4yNSwxMC45OWwtMi43MiwyLjUtOC42Nyw3Ljk3LDQuMjUsNS42M2gwczIuODQsMy43NywyLjg0LDMuNzdjLjE3LjIyLDIuOCwzLjcxLDYuNDgsOC4zN2wtNC4zOSw1LjIyLDEuMzYsMy4zNC05Ljk1LDkuMDQtNy42OSw2Ljk5LDUuMTMsOS4wNGMuODUsMS40OSwxNy41NCwzMC4zMyw1NS4yMSw1OS4yNFpNMjc1LjcxLDM0NS42Yy0yLjE2LDEuNTgtNC4yMiwzLjAzLTYuMTMsNC4zNmgwYy04LjI3LDUuNzItMTMuOTUsOS4wMy0xMy45NSw5LjAzLTUuNjMtMy4yMi0xMC45Mi02LjUzLTE1LjkyLTkuODgtLjcxLS40OC0xLjQxLS45NS0yLjEtMS40My0xLjMtLjg5LTIuNTktMS43OS0zLjg1LTIuNjksMCwwLDAsMCwwLDAtNi42My00LjczLTEyLjYzLTkuNS0xOC4wNy0xNC4xOGwuMTMtLjE3Yy0zLjk1LTMuMy03Ljc0LTYuNjctMTEuMzYtMTAuMTEsMCwwLDAsMCwwLDAtMTkuNTktMTkuMTItMjguODYtMzQuNzItMjkuNjYtMzYuMWwxLjM2LTEuNGgwczE1LjI0LTEzLjg1LDE1LjI0LTEzLjg1bC0xLjgzLTQuNDksNi4yMy03LjRjLTYuNzEtOC4xNC0xMi45My0xNi4zOC0xMi45My0xNi4zOGw3Ljk4LTcuMzRjLTEuMTMtMy4wMi0yLjc2LTIwLjYtMy40LTI3LjlsLTguMDktMTMuNTguMjgtMzMuNjJjLjAyLTIuMTcsMS43OS0zLjkxLDMuOTUtMy45MS4wNCwwLC4wOCwwLC4xMiwwbDQuMDYuMTJjNS43Ny0yMS44LDIzLjM1LTM5LjQ3LDQ0LjgtNDcuMiwxLjQyLTIuMjUsMy41OS01LjQzLDYuMjEtOC40OC0zOS42OS0yNS40Mi02MC45OSw0Ny42OS02MS40NSw0Ny42OCwwLDAtNS41Ny02LjQ5LTcuNzUtMTUuMjgtNS43Nyw2Ljc4LTExLjUzLDE0LjA0LTE3LjIsMjEuNTEtOS4yNSwxMi4xNy0yMi41LDE0LjgxLTMyLjI0LDE0LjgxLTcuNDUsMC0xMi44NC0xLjU0LTEyLjg0LTEuNTQsNi4zMS0uMzksMTIuMTgtNi44LDEyLjYyLTcuMjgtLjM5LjQtMi40NywyLjEyLTkuNDcsMi4xMi01LjI5LDAtMTMuMzktLjk4LTI1LjY4LTQuMjYtMy43NS0xLTcuNDEtMS40NC0xMC45NS0xLjQ0LTI1LjUsMC00NC43NywyMi43NC00NC43NywyMi43NC0xMi43LTMwLjMyLDEwLjU0LTU2LjI1LDM0Ljg5LTYyLjA4LDMwLjQ5LTcuMyw0MS4yMi0xOS4zMiw0MS4yMi0xOS4zMi0yNy40NS04LjYtMzcuMTgtMjYuNzctMzcuMTgtMjYuNzcsNi44LDEuOTcsMTMuNCwyLjg4LDE5Ljg4LDIuODgsMjMuMiwwLDQ0LjgzLTExLjcyLDY4LjIxLTI4LjY5LDIyLjk3LTE2LjY4LDQ4LjYxLTE4LjYxLDU5LjI2LTE4LjYxLDMuMjIsMCw1LjA3LjE4LDUuMDcuMTgsNzQuMzMsMTMuOTksNTQuMDgsNTQuNCw0My40Niw2OS41MS4wNy4wNy4xMy4xNS4yLjIyLjgyLjg1LDEuNTksMS43NSwyLjMyLDIuNjcuMTcuMjIuMzUuNDQuNTEuNjUsMCwwLDAsMCwwLDAsLjA2LjA4LjEzLjE3LjE5LjI1LDAsMCwwLDAsMCwwLDEuNTUsMi4wNiwyLjg2LDQuMTYsMy44Nyw1Ljk2LDIuMTQuNDgsNC4yNCwxLjA3LDYuMjksMS43Ni4wNi4wMi4xMi4wNC4xOC4wNi42Ni4yMiwxLjMxLjQ1LDEuOTYuNy44OC4zMywxLjc1LjY4LDIuNjEsMS4wNC4xNy4wNy4zMy4xNS40OS4yMi43OC4zNCwxLjU1LjY4LDIuMzEsMS4wNS4wNC4wMi4wOS4wNC4xMy4wNi44Ny40MiwxLjc0Ljg3LDIuNTksMS4zMywwLDAsMCwwLDAsMCwuMTQuMDcuMjcuMTUuNDEuMjIuNjcuMzcsMS4zNC43NSwyLDEuMTUuMDIuMDEuMDQuMDIuMDYuMDMuNjYuNCwxLjMyLjgsMS45NiwxLjIyLjM4LjI0Ljc2LjQ4LDEuMTMuNzMsMCwwLDAsMCwwLDAsLjAyLjAxLjA0LjAzLjA2LjA0Ljg1LjU4LDEuNjksMS4xOCwyLjUyLDEuNzkuMDkuMDcuMTguMTMuMjYuMi42OS41MiwxLjM2LDEuMDYsMi4wMywxLjYuMjUuMi41LjQxLjc1LjYyLjE1LjEzLjMuMjcuNDYuNC40Ni4zOS45MS43OCwxLjM1LDEuMTguMTUuMTMuMy4yNi40NS40LjA0LjA0LjA4LjA4LjEyLjEyLDEuNDYsMS4zNCwyLjg2LDIuNzQsNC4yLDQuMiwwLC4wMS4wMi4wMi4wMy4wMy42NS43MiwxLjI5LDEuNDQsMS45MSwyLjE5aDBzMCwwLDAsMGMuMjUuMy41LjYyLjc1LjkzLjI4LjM0LjU1LjY5LjgyLDEuMDQuMTIuMTYuMjQuMzEuMzYuNDcsNS41Miw3LjMxLDkuNTgsMTUuOCwxMS43NCwyNS4wM2w0LjkxLS4xNXMuMDgsMCwuMTIsMGMuMjMsMCwuNDUuMDMuNjcuMDdoMHMuMS4wMi4xNS4wM2MwLDAsMCwwLDAsMCwuMTEuMDMuMjIuMDcuMzMuMSwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwuMTMuMDQuMjUuMS4zNy4xNS4xLjA1LjIuMDkuMy4xNSwwLDAsMCwwLDAsMCwwLDAsMCwwLC4wMSwwLC40MS4yMy43OC41MywxLjA5Ljg5LS4wNS0uMDUtLjEtLjA4LS4xNS0uMTMtLjA5LS4xLS4xOS0uMi0uMjktLjI5LjEuMDkuMi4xOS4yOS4yOS4wNS4wNC4xLjA4LjE1LjEzaDBjLjU0LjY1Ljg4LDEuNDcuODgsMi4zOGwuMjksMzMuNzYtMTAuMDEsMTcuMTYtNC41MSwyNC44LDYuMTEsNy40MnMtLjA2LDAtLjA5LS4wMWgwcy42NS43OS42NS43OWMtLjQuNTItNC43LDYuMDEtMTEuMjQsMTMuNDlsLjMyLjM1cy0uMDMuMDMtLjA0LjA1Yy0uMDEuMDEtLjAyLjAyLS4wMy4wNGw4LjEyLDguOTUtMS44Myw0LjY3LDExLjY1LDkuMDFoMHMyLjE4LDEuNjksMi4xOCwxLjY5Yy0uMDcuMjUtLjE1LjUtLjIzLjc2LTEsMy4zOC0yLjM0LDYuNzMtMy45NywxMC4wMy0xMC44NCwyMS45NC0zNC4yNiw0MS44NS01MS4zNCw1NC4zMmgwWiIvPjxwYXRoIGNsYXNzPSJlIiBkPSJNMzI3LjA1LDI5MS4yOGMxLjYzLTMuMywyLjk4LTYuNjUsMy45Ny0xMC4wMy4wNy0uMjUuMTYtLjUuMjMtLjc2bC0yLjE4LTEuNjloMHMtMTEuNjUtOS4wMS0xMS42NS05LjAxbDEuODMtNC42Ny04LjEyLTguOTVzLjAyLS4wMi4wMy0uMDRjLjAxLS4wMi4wMy0uMDMuMDQtLjA1bC0uMzItLjM1YzYuNTQtNy40OCwxMC44NC0xMi45NywxMS4yNC0xMy40OWwtLjY1LS43OWgwcy4wNiwwLC4wOS4wMWwtNi4xMS03LjQyLDQuNTEtMjQuOCwxMC4wMS0xNy4xNi0uMjktMzMuNzZjMC0uOTEtLjM1LTEuNzMtLjg4LTIuMzhoMHMtLjEtLjA4LS4xNS0uMTNjLS4wOS0uMS0uMTktLjItLjI5LS4yOS0uMi0uMTgtLjQyLS4zNC0uNjUtLjQ4LDAsMCwwLDAtLjAxLDAsMCwwLDAsMCwwLDAtLjEtLjA2LS4yLS4xLS4zLS4xNS0uMTItLjA1LS4yNC0uMTEtLjM3LS4xNWgwczAsMCwwLDBjMCwwLDAsMCwwLDAtLjExLS4wNC0uMjItLjA4LS4zMy0uMSwwLDAsMCwwLDAsMC0uMDUtLjAxLS4xLS4wMi0uMTUtLjAzaDBjLS4yMi0uMDQtLjQ0LS4wNy0uNjctLjA3LS4wNCwwLS4wOCwwLS4xMiwwbC00LjkxLjE1Yy0yLjE2LTkuMjMtNi4yMi0xNy43Mi0xMS43NC0yNS4wMy0uMTItLjE2LS4yNC0uMzEtLjM2LS40Ny0uMjctLjM1LS41NS0uNjktLjgyLTEuMDQtLjI1LS4zMS0uNDktLjYyLS43NS0uOTMsMCwwLDAsMCwwLDBoMHMwLDAsMCwwYy0uNjItLjc0LTEuMjUtMS40Ny0xLjktMi4xOCwwLS4wMS0uMDItLjAyLS4wMy0uMDMtLjAyLS4wMi0uMDUtLjA1LS4wNy0uMDctLjY5LS43NS0xLjM5LTEuNDgtMi4xMS0yLjItLjY2LS42Ni0xLjMzLTEuMy0yLjAyLTEuOTMtLjE5LS4xNy0uMzgtLjM0LS41Ny0uNTItLjA4LS4wNy0uMTYtLjE0LS4yMy0uMjEtLjM3LS4zMy0uNzQtLjY1LTEuMTItLjk3LS40LS4zNC0uOC0uNjktMS4yMS0xLjAyLS42Ny0uNTQtMS4zNC0xLjA4LTIuMDMtMS42LS4wOS0uMDctLjE4LS4xMy0uMjYtLjItLjAzLS4wMy0uMDctLjA1LS4xLS4wNy0uNzktLjU5LTEuNTktMS4xNi0yLjQxLTEuNzItLjAyLS4wMS0uMDQtLjAzLS4wNi0uMDQsMCwwLDAsMCwwLDAtLjM3LS4yNS0uNzUtLjQ5LTEuMTMtLjczLS42NS0uNDItMS4zLS44My0xLjk2LTEuMjItLjAyLS4wMS0uMDQtLjAyLS4wNi0uMDMtLjY2LS4zOS0xLjMzLS43OC0yLTEuMTUtLjE0LS4wNy0uMjctLjE1LS40MS0uMjIsMCwwLDAsMCwwLDAtLjg1LS40Ni0xLjcyLS45LTIuNTktMS4zMy0uMDQtLjAyLS4wOS0uMDQtLjEzLS4wNi0uNzYtLjM3LTEuNTMtLjcxLTIuMzEtMS4wNS0uMTYtLjA3LS4zMy0uMTUtLjQ5LS4yMi0uODYtLjM3LTEuNzQtLjcxLTIuNjEtMS4wNC0uNjUtLjI0LTEuMy0uNDctMS45Ni0uNy0uMDYtLjAyLS4xMi0uMDQtLjE4LS4wNi0yLjA1LS42OS00LjE1LTEuMjgtNi4yOS0xLjc2LTEuMDEtMS43OS0yLjMyLTMuODktMy44Ny01Ljk2LDAsMCwwLDAsMCwwLS4wNi0uMDgtLjEyLS4xNy0uMTktLjI1LDAsMCwwLDAsMCwwLS4xNy0uMjItLjM0LS40NC0uNTEtLjY1LS4zNi0uNDUtLjczLS45LTEuMTItMS4zMy0uMzktLjQ1LS44LS44OS0xLjIyLTEuMzIsMCwwLDAtLjAxLjAxLS4wMi0uMDctLjA3LS4xMy0uMTUtLjItLjIyLDEwLjYyLTE1LjExLDMwLjg3LTU1LjUyLTQzLjQ2LTY5LjUxLDAsMC0xLjg1LS4xOC01LjA3LS4xOC0xMC42NSwwLTM2LjI5LDEuOTMtNTkuMjYsMTguNjEtMjMuMzgsMTYuOTctNDUuMDEsMjguNjktNjguMjEsMjguNjktNi40OCwwLTEzLjA4LS45MS0xOS44OC0yLjg4LDAsMCw5LjczLDE4LjE3LDM3LjE4LDI2Ljc3LDAsMC0xMC43MywxMi4wMi00MS4yMiwxOS4zMi0yNC4zNSw1LjgzLTQ3LjU5LDMxLjc2LTM0Ljg5LDYyLjA4LDAsMCwxOS4yNy0yMi43NCw0NC43Ny0yMi43NCwzLjU0LDAsNy4yLjQ0LDEwLjk1LDEuNDQsMTIuMywzLjI4LDIwLjQsNC4yNiwyNS42OCw0LjI2LDYuOTksMCw5LjA4LTEuNzIsOS40Ny0yLjEyLS40NC40OC02LjMxLDYuODktMTIuNjIsNy4yOCwwLDAsNS40LDEuNTQsMTIuODQsMS41NCw5Ljc0LDAsMjIuOTktMi42NCwzMi4yNC0xNC44MSw1LjY4LTcuNDcsMTEuNDQtMTQuNzMsMTcuMi0yMS41MSwyLjE4LDguNzksNy43NSwxNS4yOCw3Ljc1LDE1LjI4LjQ2LjAxLDIxLjc2LTczLjEsNjEuNDUtNDcuNjgtMi42MiwzLjA1LTQuNzksNi4yMy02LjIxLDguNDgtMjEuNDUsNy43My0zOS4wMiwyNS40MS00NC44LDQ3LjJsLTQuMDYtLjEycy0uMDgsMC0uMTIsMGMtMi4xNiwwLTMuOTMsMS43NC0zLjk1LDMuOTFsLS4yOCwzMy42Miw4LjA5LDEzLjU4Yy42NCw3LjMsMi4yNiwyNC44OCwzLjQsMjcuOWwtNy45OCw3LjM0czYuMjEsOC4yNCwxMi45MywxNi4zOGwtNi4yMyw3LjQsMS44Myw0LjQ5LTE1LjI0LDEzLjg1aDBzLTEuMzYsMS40LTEuMzYsMS40Yy44MSwxLjM5LDEwLjA3LDE2Ljk4LDI5LjY2LDM2LjEsMCwwLDAsMCwwLDAsMy42MiwzLjQ0LDcuNDEsNi44MSwxMS4zNiwxMC4xMWwtLjEzLjE3YzUuNDQsNC42OCwxMS40NCw5LjQ1LDE4LjA3LDE0LjE4LDAsMCwwLDAsMCwwLDEuMjYuOSwyLjU0LDEuNzksMy44NSwyLjY5LjcuNDgsMS4zOS45NSwyLjEsMS40Myw0Ljk5LDMuMzUsMTAuMjksNi42NiwxNS45Miw5Ljg4LDAsMCw1LjY3LTMuMywxMy45NS05LjAzaDBjMS45Mi0xLjMzLDMuOTgtMi43OCw2LjEzLTQuMzZoMGMxNy4wOC0xMi40Nyw0MC41LTMyLjM4LDUxLjM0LTU0LjMyWk0zMTEuMDQsMjY2Ljcxcy4wNS4wNy4wNy4xMWMuMDQuMDYuMDguMTMuMTIuMTkuMy40Ni41OS45NC44NywxLjQ0Ljc2LDEuMzcsMS4zNiwyLjgzLDEuMzYsNC4wMywwLDAsNC4zNCwzLjE1LDcuODksNi4zNSwxLjY4LDEuNTEsMy4xOSwzLjA0LDMuOTksNC4yNC4zNS41NC41NiwxLjAxLjU4LDEuMzksMCwwLS4yOC41OS0uNzgsMS41Ny0uMTEuMjEtLjIzLjQ0LS4zNi42OS0uMjYuNDktLjU2LDEuMDUtLjg5LDEuNjYtLjUuOTEtMS4wOSwxLjk0LTEuNzQsMy4wNC0uNjYsMS4wOS0xLjM4LDIuMjUtMi4xNiwzLjQzLTEuNTcsMi4zNS0zLjM2LDQuNzctNS4yOSw2Ljg1LS4zMi4zNS0uNjUuNjgtLjk3LDEuMDEtLjIyLjIyLS40NC40My0uNjYuNjQtMS4zMiwxLjI0LTIuNjksMi4yOC00LjA3LDMuMDF2LTEuNDRzMS4xOS0xLjQ1LDIuNzktMy42NWMuNTgtLjgsMS4yMi0xLjcsMS44Ny0yLjY2LjY1LS45NiwxLjMyLTEuOTksMS45Ny0zLjA1LjMyLS41My42NC0xLjA3Ljk1LTEuNjEuNTQtLjk0LDEuMDUtMS44OSwxLjUtMi44My45OC0yLjAzLDEuNzEtNCwxLjk0LTUuNjlsLTcuNTEtNy44M3MtNy42Nyw2LjcxLTEwLjIyLDcuMDNoMHMxLjI0LTEuNTYsMi42Ny00LjE4Yy4xMy0uMjQuMjYtLjQ4LjM5LS43My4xNS0uMjkuMy0uNTguNDQtLjg5LjktMS44NCwxLjc5LTQuMDUsMi40My02LjQ5LjA0LS4xNS4wOC0uMzEuMTItLjQ3LjU5LTIuMzguOTMtNC45OC44Mi03LjY5LDAsMCwuMTEuMTIuMjguMzUsMCwuMDEuMDIuMDMuMDMuMDQuMjUuMzIuNjQuODIsMS4wNywxLjQzLjE2LjIzLjMzLjQ3LjUuNzJaTTMxMS42NiwyNDQuMTZjLS4xOS4xOS0uMzguMzgtLjU4LjU4LS4yLjItLjQuNC0uNjEuNjEtLjQyLjQxLS44Ni44NS0xLjMxLDEuMjktLjIzLjIyLS40Ni40NS0uNjkuNjgtMy45NywzLjg4LTguODksOC40NS0xMS43NywxMC4zMSwwLDAsLjA4LS4xLjIxLS4yOC4wNy0uMS4xNy0uMjMuMjgtLjM3LjAyLS4wMy4wNC0uMDUuMDYtLjA4LDAsMCwuMDEtLjAyLjAyLS4wMi4wNi0uMDguMTQtLjE4LjIxLS4yNy4wNy0uMS4xNS0uMi4yMy0uMzEuMDgtLjExLjE2LS4yMS4yNS0uMzIuMTUtLjIuMzItLjQyLjUtLjY2LjA5LS4xMi4xOC0uMjQuMjctLjM2LjEyLS4xNi4yNC0uMzIuMzctLjQ5LjEtLjE0LjIxLS4yOC4zMi0uNDIuMi0uMjcuNDEtLjU0LjYyLS44My4xMS0uMTUuMjMtLjMxLjM0LS40Ni4xNC0uMTkuMjgtLjM4LjQyLS41Ny4xMi0uMTYuMjQtLjMyLjM2LS40OS4wMi0uMDMuMDQtLjA2LjA3LS4wOS4wMi0uMDMuMDUtLjA2LjA3LS4wOS40NC0uNi44OS0xLjIyLDEuMzQtMS44NC4wMi0uMDMuMDQtLjA2LjA2LS4wOSwwLS4wMS4wMi0uMDMuMDMtLjA0LjM1LS40OS43LS45NywxLjA0LTEuNDUuNDItLjU5LjgxLTEuMTcsMS4xOS0xLjcyLjItLjMuNC0uNTkuNTgtLjg3LjA4LS4xMi4xNS0uMjMuMjItLjM0LjMyLS40OS42LS45NC44NS0xLjM1LjE4LS4yOS4zMy0uNTYuNDctLjgxLjE5LS4zNS4zMy0uNjUuNDEtLjg5LjAzLS4wNy4wNC0uMTQuMDYtLjE5LDAtLjA0LjAyLS4wOC4wMy0uMTEsMC0uMDcsMC0uMTItLjAxLS4xNmwtMy42Ny0yLjU2Yy4yNi0uMzIuNjktMS40NiwxLjI0LTMuMTMuMDUtLjE0LjA5LS4yOS4xNC0uNDMuMTctLjU0LjM1LTEuMTEuNTQtMS43My4xMS0uMzUuMjItLjcyLjMzLTEuMS4yMi0uNzUuNDYtMS41NS42OS0yLjM4LjI0LS44My40OC0xLjY5LjczLTIuNTguMTItLjQ0LjI1LS44OS4zNy0xLjM0LjI4LTEuMDIuNTctMi4wNi44NS0zLjEuMjItLjc5LjQzLTEuNTguNjQtMi4zNi40OS0xLjgxLjk2LTMuNTcsMS4zOS01LjE5LjIyLS44MS40Mi0xLjU5LjYyLTIuMzEuNTgtMi4xOCwxLjA2LTMuOTQsMS4zNC00LjkzLjA5LS4zMy4xNy0uNTguMjItLjczLjI1LS43NS40Ny0xLC42NS0uOTkuMDcsMCwuMTQuMDUuMi4xMi4wOS4xMS4xNy4yOC4yMy40NS4wNC4xMi4wOC4yNC4xMS4zNS4wMy4xMS4wNS4yMS4wNy4yNy4wMS4wNy4wMi4xMS4wMi4xMSwwLDAtLjAxLjEtLjAzLjI4LS4xMSwxLS41Miw0LjU5LTEuMDgsOC44OC0uMiwxLjUxLS40MSwzLjEyLS42NCw0LjcyLS4wNy40Ny0uMTMuOTMtLjIsMS40LS4xMi44My0uMjUsMS42NS0uMzcsMi40Ni0uMTMuODEtLjI1LDEuNi0uMzgsMi4zNi0uMTksMS4xNS0uMzksMi4yMy0uNTksMy4yMi0uMi45OS0uMzksMS44Ny0uNTksMi42Mi0uMjYsMS0uNTEsMS43NS0uNzUsMi4xNywwLDAsLjE2LjE2LjQyLjQzLjE0LjE0LjMxLjMyLjUuNTEuMjkuMjkuNjIuNjMuOTguOTguMTUuMTUuMy4zLjQ1LjQ1LDEuMDcsMS4wNSwyLjE5LDIuMSwyLjYzLDIuMzYuMDUuMDMuMDkuMDUuMTMuMDYsMCwwLTEuMjMsMS4yOC0zLjA5LDMuMTVaTTMyMC4xOCwxNjMuMjJoMi4wOGMuMDIsMS43My4wMywzLjM3LjA0LDQuOTMsMCwuNiwwLDEuMTksMCwxLjc2LDAsMS45Mi0uMDMsMy43MS0uMDcsNS4zOCwwLC4wOSwwLC4xNywwLC4yNi0uMzYsMTUuNzQtMS45NSwyMC4zNy0zLDIxLjctLjAzLjA0LS4wNy4wOC0uMS4xMiwwLDAsMCwwLDAsMC0uMDguMDktLjE2LjE2LS4yMy4yMSwwLDAtLjAxLDAtLjAyLjAxLS4wNC4wMy0uMDkuMDYtLjEyLjA4LDAsMC0uMDIsMC0uMDIuMDEtLjAxLDAtLjAzLjAxLS4wNC4wMiwwLDAsMCwwLDAsMC0uMDIsMC0uMDQuMDItLjA2LjAyLDAsMC0uMDEsMC0uMDIsMC0uMDEsMC0uMDMsMC0uMDQuMDEsMCwwLDAsMC0uMDEsMC0uMDEsMC0uMDMsMC0uMDQsMC0uMDEsMC0uMDIsMC0uMDMsMCwwLDAsMCwwLS4wMSwwLS4wMSwwLS4wMiwwLS4wNCwwLDAsMCwwLDAsMCwwLDAsMC0uMDIsMC0uMDMsMCwwLDAsMCwwLS4wMSwwLDAsMCwwLDAtLjAxLDAsMCwwLS4wMSwwLS4wMiwwLDAsMCwwLDAsMCwwLDAsMC0uMDIsMC0uMDMsMC0uMDIsMC0uMDQtLjAxLS4wNS0uMDJoMGMuMDQtLjE0LjEtMi4xNS4xNi00Ljk5LDAtLjMxLjAxLS42NC4wMi0uOTcuMDMtMS4zMy4wNS0yLjguMDgtNC4zMS4xMi02LjgxLjIyLTE0LjQ5LjIyLTE0LjQ5LS4yMi4yNS0uNDcuNS0uNzIuNzQtMS4wMi45Ni0yLjI4LDEuODEtMy42OSwyLjU2LS43MS4zOC0xLjQ1LjczLTIuMjMsMS4wNS00LjI3LDEuOC05LjQzLDIuOTEtMTMuODgsMy41OC0uNC4wNi0uOC4xMi0xLjE5LjE3LS43OC4xMS0xLjU0LjItMi4yNS4yOS0xLjQzLjE3LTIuNzEuMjgtMy43NS4zNy0uNTIuMDQtLjk5LjA3LTEuMzkuMS0uOTkuMDYtMS41Ny4wOC0xLjU3LjA4bC0uNDgtMS42aDBjLjg5LS4xLDEuNzYtLjIyLDIuNjEtLjM0czEuNjctLjI3LDIuNDgtLjQyYy41NC0uMSwxLjA2LS4yMSwxLjU4LS4zMiwzLjQ1LS43NSw2LjQ4LTEuNzEsOS4xMy0yLjgsMS41OS0uNjUsMy4wNS0xLjM1LDQuMzgtMi4wNi44OS0uNDgsMS43Mi0uOTcsMi40OS0xLjQ2LDIuMzMtMS40OCw0LjE4LTIuOTksNS42MS00LjM2LDMuMTEtMi45OCw0LjMtNS4zMyw0LjMtNS4zM1pNMjY4LjQzLDExMi41OHMuMDguMDIuMjIuMDVjLjAzLDAsLjA3LjAyLjExLjAyLjE3LjA0LjQuMS43LjE3LjA2LjAyLjEyLjAzLjE4LjA1LjIyLjA2LjQ1LjEyLjcyLjE5LjU5LjE2LDEuMzEuMzcsMi4xMi42My40Mi4xMy44Ny4yOCwxLjM0LjQ0LjMzLjExLjY4LjIzLDEuMDMuMzYuMzUuMTIuNzIuMjYsMS4xLjQuNS4xOCwxLjAxLjM4LDEuNTQuNTksMS44Ny43NCwzLjkzLDEuNjQsNi4xLDIuNzMuOTMuNDcsMS44OC45NywyLjg0LDEuNS45Ni41NCwxLjkzLDEuMTEsMi45MSwxLjcyLjY1LjQxLDEuMzEuODMsMS45NiwxLjI3LjY1LjQ0LDEuMzEuOSwxLjk2LDEuMzguOTguNzIsMS45NSwxLjQ3LDIuOTEsMi4yN3MxLjkxLDEuNjQsMi44NCwyLjUyYy4zMS4zLjYyLjU5LjkyLjksNi4xMiw2LjEsMTEuMjksMTQuMTksMTMuMzgsMjQuODIsMCwwLC4zOCwyLjc5LjM5LDQuODUsMCwxLjI0LS4xMiwyLjIyLS41NCwyLjE4LTEuNTktLjE0LTguMy0yOC4xLTM1LjExLTQzLjIxLS40Ni0uMjYtLjkzLS41Mi0xLjQtLjc3LTIuMzctMS4yNi00Ljg5LTIuNDMtNy41OC0zLjQ2bC0uNjQtMS42aDBaTTE2Ny40LDkzLjQ2Yy0yLjA1LDIuNDctNC4yNSw1LjA4LTYuNjcsNy44LS4wOC4wOS0uMTUuMTctLjIzLjI2LTYuMTQsNi44Ni0xMy43NSwxNC40Mi0yNC4yOCwyMi4yNC00LjIzLDMuMTQtOC43MSw1LjU0LTEzLjQyLDcuMzUtLjUyLjItMS4wNS40LTEuNTguNTgtMS4wNi4zNy0yLjEzLjcyLTMuMjEsMS4wNC00Ljg2LDEuNDQtOS45NSwyLjM1LTE1LjI1LDIuOS0xLjE4LjEyLTIuMzYuMjMtMy41Ni4zMS01LjM5LjQtMTAuOTguNDctMTYuNzcuMzgtMS4yOS0uMDItMi41Ni4wMy0zLjgyLjEzLTEyLjcxLDEuMDUtMjQuMDMsOC4wNy0zMS42NSwxNC4zOS0xLjA3Ljg5LTIuMDcsMS43Ni0yLjk4LDIuNi0uMzEuMjgtLjYuNTYtLjg5LjgzLS4wMy4wMy0uMDYuMDYtLjA5LjA5LS42LjU3LTEuMTUsMS4xMS0xLjY3LDEuNjQtLjI2LjI3LS41MS41Mi0uNzUuNzgtLjQ4LjUtLjkxLjk4LTEuMywxLjQyLS4xOS4yMi0uMzguNDMtLjU1LjYzLTUuNDYsNi40My0zLjU0LDIuMjUtMy41NCwyLjI1LDAsMCwwLS4wMy4wMS0uMDcsMC0uMDQuMDEtLjA5LjAyLS4xMywwLS4wNS4wMS0uMDkuMDItLjE0LDAtLjAyLDAtLjAzLjAxLS4wNiwwLS4wNC4wMi0uMDkuMDMtLjEzLjAxLS4wNy4wMy0uMTQuMDQtLjIycy4wMy0uMTYuMDUtLjI1YzAtLjA0LjAyLS4wOC4wMi0uMTEsMC0uMDIsMC0uMDUuMDItLjA4LjAyLS4xLjA1LS4yMS4wOC0uMzIuMDQtLjE3LjA5LS4zNC4xNC0uNTMuMDMtLjExLjA2LS4yMS4wOS0uMzMuMDMtLjExLjA3LS4yMi4xLS4zNC4wMy0uMTEuMDYtLjIyLjEtLjMzLjAxLS4wNC4wMi0uMDcuMDMtLjExLjA0LS4xMi4wOC0uMjQuMTItLjM2LjAzLS4wOC4wNi0uMTcuMDgtLjI1LjAzLS4wOC4wNi0uMTcuMDktLjI1LjA0LS4xMy4wOS0uMjUuMTQtLjM5LjA3LS4xOS4xNC0uMzguMjItLjU4LjA1LS4xMy4xLS4yNi4xNi0uNC4wOS0uMjIuMTgtLjQ0LjI4LS42Ny4wNS0uMTIuMS0uMjQuMTYtLjM3LjEyLS4yOC4yNS0uNTYuMzktLjg1LjA0LS4wOS4wOC0uMTguMTMtLjI3LjE5LS4zOS4zOS0uNzkuNjEtMS4yLDAtLjAyLjAyLS4wNC4wMy0uMDUsMCwwLDAtLjAyLjAxLS4wMi4wOS0uMTcuMTktLjM1LjI5LS41Mi4xMi0uMjEuMjMtLjQyLjM1LS42NC4wNy0uMTIuMTQtLjI0LjIxLS4zNi4xOC0uMzEuMzctLjYyLjU3LS45NC4wOS0uMTQuMTgtLjI5LjI4LS40NC4xOS0uMy4zOS0uNjEuNi0uOTEuMDUtLjA3LjEtLjE0LjE1LS4yMS4wNi0uMDkuMTItLjE3LjE4LS4yNi4xMi0uMTcuMjQtLjM0LjM3LS41MS4xLS4xNC4yLS4yOC4zMS0uNDMuMTEtLjE1LjIzLS4zMS4zNC0uNDYuMjUtLjM0LjUyLS42Ny44LTEuMDEuMTEtLjE0LjIyLS4yOC4zMy0uNDIuMzUtLjQyLjcxLS44NCwxLjA5LTEuMjcuMDUtLjA2LjEtLjEyLjE1LS4xOC40NC0uNS45MS0uOTksMS4zOS0xLjUuMDctLjA3LjE1LS4xNS4yMi0uMjIuNDEtLjQxLjgzLS44MywxLjI3LTEuMjUuMTYtLjE1LjMyLS4zLjQ5LS40NS4zNy0uMzQuNzUtLjY5LDEuMTQtMS4wMy4yLS4xNy40LS4zNS42MS0uNTIuMzgtLjMyLjc3LS42NSwxLjE3LS45Ny4yMi0uMTguNDQtLjM2LjY3LS41My4zMS0uMjQuNjMtLjQ4Ljk1LS43Mi4xMS0uMDguMjEtLjE2LjMyLS4yNC4xMi0uMDkuMjQtLjE3LjM2LS4yNi4xMi0uMDkuMjMtLjE3LjM2LS4yNi40Ny0uMzQuOTYtLjY3LDEuNDUtMS4wMS4yMi0uMTUuNDMtLjMuNjYtLjQ1LjY2LS40NCwxLjM0LS44NywyLjA1LTEuMy4wNy0uMDUuMTQtLjA5LjIyLS4xNC43OS0uNDgsMS42LS45NSwyLjQ0LTEuNDEuMTEtLjA2LjIzLS4xMi4zNS0uMTkuMTItLjA2LjIzLS4xMi4zNS0uMTkuMzEtLjE3LjYzLS4zMy45NS0uNS4zMi0uMTcuNjItLjMzLjk1LS41LjMyLS4xNi42Ni0uMzIuOTgtLjQ4LjU5LS4yOSwxLjE4LS41NywxLjc5LS44NS4zNy0uMTcuNzUtLjM0LDEuMTMtLjUxLjYtLjI3LDEuMjEtLjUzLDEuODQtLjc5LjQtLjE3LjgtLjMzLDEuMjEtLjUuNjUtLjI2LDEuMzEtLjUxLDEuOTgtLjc2LjQxLS4xNS44Mi0uMzEsMS4yNC0uNDYuMTktLjA3LjM5LS4xMy41OC0uMi41Ni0uMiwxLjEyLS4zOSwxLjctLjU4LjM3LS4xMi43My0uMjUsMS4xMS0uMzcuMi0uMDYuNDEtLjEzLjYxLS4xOS43Mi0uMjMsMS40NS0uNDUsMi4xOS0uNjYuMjYtLjA4LjUyLS4xNi43OS0uMjMsMS4zMS0uMzcsMi41OS0uNzYsMy44NC0xLjE2LDIuMTctLjcsNC4yNC0xLjQ0LDYuMjYtMi4yMiwxLjQ5LS41NywyLjk1LTEuMTYsNC4zNi0xLjc3LDEuMTEtLjQ4LDIuMTktLjk3LDMuMjUtMS40NywxLjU2LS43MywzLjA0LTEuNSw0LjUtMi4yNywyLjUxLTEuMzMsNC44OC0yLjcsNy4wOS00LjEsMy4xMS0xLjk3LDUuOTItMy45OSw4LjQ3LTYsMS4wMy0uODEsMi4wMy0xLjYyLDIuOTgtMi40MiwxLjMxLTEuMTIsMi41NC0yLjIyLDMuNjgtMy4zLDEuMTQtMS4wOCwyLjIxLTIuMTQsMy4xOS0zLjE2LjQ5LS41MS45Ni0xLjAxLDEuNDItMS41MS45MS0uOTksMS43My0xLjkzLDIuNDktMi44MiwxLjEzLTEuMzQsMi4wOS0yLjU3LDIuODktMy42NC4yNy0uMzYuNTEtLjcuNzUtMS4wMi40Ni0uNjUuODUtMS4yMiwxLjE4LTEuNzEuODEtMS4yMiwxLjE5LTEuOTIsMS4xOS0xLjkyLTEuOTksMS4zMy00LjUsMi4yNy03LjI2LDIuOTItMS44NC40NC0zLjguNzUtNS43OS45Ni0uNS4wNS0xLC4xLTEuNS4xNC0xMC41Mi44Ni0yMS40NS0uOC0yMS40NS0uOGgwczAsMCwwLDBjMy42Ny0uNjIsNy4zNi0xLjY4LDExLjA5LTMuMDYuNTMtLjIsMS4wNi0uNCwxLjYtLjYxLjI1LS4xLjUtLjIuNzQtLjMsMS4yNi0uNTEsMi41Mi0xLjA1LDMuNzgtMS42Mi4xMy0uMDYuMjYtLjEyLjM5LS4xOCwzLjY0LTEuNjcsNy4zMi0zLjU5LDExLjA1LTUuNjcsMi4yNy0xLjI2LDQuNTUtMi41OSw2Ljg1LTMuOTUuNDItLjI1Ljg1LS41LDEuMjctLjc1LjkzLS41NSwxLjg2LTEuMTEsMi43OS0xLjY3LjU3LS4zNCwxLjE1LS42OSwxLjczLTEuMDQuNzktLjQ4LDEuNTktLjk2LDIuMzktMS40NC45NC0uNTcsMS44OS0xLjE0LDIuODQtMS43MSwxLjE3LS43LDIuMzUtMS40MSwzLjU0LTIuMTIsNy45Ny00Ljc0LDE2LjIyLTkuNDMsMjQuODctMTMuMzEuNzItLjMyLDEuNDQtLjY0LDIuMTctLjk1LDQuMzUtMS44Nyw4LjgxLTMuNTMsMTMuMzctNC44OC45OC0uMjksMS45Ni0uNTYsMi45NS0uODIsNy4wNS0xLjg1LDE0LjM2LTIuOTMsMjEuOTgtMi44OS43NCwwLDEuNDkuMDIsMi4yNC4wNCwyLjAyLjA3LDMuOTQuMTksNS43OS4zNC4xLDAsLjE5LjAyLjI5LjAzLjgzLjA3LDEuNjQuMTYsMi40My4yNS43OS4wOSwxLjU3LjE5LDIuMzMuMy4xMS4wMi4yNC4wMi4zNS4wNC4wNy4wMS4xMy4wMy4yMS4wNCwxLjc2LjI1LDMuNDMuNTUsNS4wMi44OS4xNC4wMy4yOC4wNi40Mi4wOSwxLjU5LjM1LDMuMDkuNzQsNC41MSwxLjE2LjEuMDMuMi4wNi4zLjA5LDEuNDQuNDQsMi44LjkyLDQuMDcsMS40My4wNS4wMi4xMS4wNC4xNi4wNywxNy4zNiw3LjA5LDE5Ljg4LDIwLjczLDE4LjUzLDMxLjcyLDAsLjAyLDAsLjA1LDAsLjA3LDAsLjAzLDAsLjA2LS4wMS4wOS0uMDcuNTMtLjE0LDEuMDUtLjIzLDEuNTctLjAyLjExLS4wMy4yMS0uMDUuMzItLjA4LjQ4LS4xNy45NS0uMjYsMS40MS0uMDEuMDYtLjAyLjExLS4wMy4xNy0uMDIuMDgtLjAzLjE3LS4wNS4yNS0uMDQuMjItLjA5LjQyLS4xNC42NC0uMDUuMjEtLjA5LjQzLS4xNC42NC0uMDIuMDktLjA0LjE4LS4wNi4yNy0uMDIuMDctLjAzLjE1LS4wNS4yMi0uMDkuMzktLjE5Ljc2LS4yOSwxLjE0LS4wMy4xMS0uMDYuMjEtLjA5LjMxLS4wMi4wOC0uMDQuMTUtLjA2LjIzLS4xLjM0LS4xOS42OC0uMjksMS4wMS0uMDYuMTktLjExLjM4LS4xNy41Ni0uMDYuMi0uMTIuMzktLjE4LjU4LS4wMy4xLS4wNi4yLS4xLjMtLjAzLjEtLjA3LjItLjEuMy0uMDMuMS0uMDcuMi0uMS4zLS4wOS4yNS0uMTcuNS0uMjUuNzQtLjA4LjIxLS4xNS40MS0uMjIuNjEtLjAxLjAzLS4wMi4wNS0uMDMuMDgtLjA3LjE4LS4xMy4zNy0uMi41NC0uMDcuMTctLjEzLjMzLS4xOS41LS4wMi4wNi0uMDQuMTEtLjA3LjE3LS4wNi4xNC0uMTEuMjktLjE3LjQyLS4xNC4zNC0uMjcuNjYtLjQuOTYtLjUtLjE4LTEtLjM2LTEuNTYtLjQ2LDUuMzktMTkuNzMtNi42LTI0Ljg5LTYuNi0yNC44OS43Ni40MywxLjQzLjk4LDIuMDMsMS42My45Ljk3LDEuNjMsMi4xOCwyLjIsMy41NS4xMy4zMi4yNS42NC4zNi45Ny40NSwxLjMzLjc3LDIuOC45NSw0LjM2LjA1LjM5LjA4Ljc5LjEyLDEuMTkuMDgsMSwuMSwyLjA0LjA4LDMuMS0uMDIuNzktLjA2LDEuNi0uMTMsMi40Mi0uMjEsMi40NC0uNjYsNC45Ni0xLjM0LDcuNDRoMHMtLjA0LDAtLjA3LDBjLS4wMiwwLS4wMywwLS4wNSwwLS40NSwwLS44OC4wMy0xLjMuMDgtLjMyLjA0LS42NC4wOC0uOTYuMTQtMS4yNy02LjA5LTYuNjctMTguNzMtMjIuNjMtMjQuOS0uNDItLjE2LS44Ni0uMzMtMS4yOS0uNDhzLS44OC0uMzEtMS4zNC0uNDVjLS4zOC0uMTItLjc2LS4yMy0xLjEzLS4zNS0uMzItLjEtLjY0LS4xOS0uOTYtLjI5LS43Ny0uMjItMS41Mi0uNDMtMi4yNi0uNjMtLjI2LS4wNy0uNTItLjE0LS43OC0uMi0uODgtLjIyLTEuNzQtLjQzLTIuNTctLjYxLTEuOS0uNDEtMy42Ny0uNzMtNS4zMi0uOTYtLjQxLS4wNi0uODEtLjExLTEuMjEtLjE2LTEuMTgtLjE0LTIuMjktLjI0LTMuMzMtLjMxLTEuNzItLjExLTMuMjMtLjEzLTQuNTMtLjEtLjUyLjAxLTEsLjA0LTEuNDQuMDYtLjQ1LjAzLS44Ni4wNi0xLjIzLjEtLjE5LjAyLS4zNy4wNC0uNTMuMDYtLjM0LjA0LS42NC4wOC0uOTEuMTItLjkzLjE0LTEuNC4yNi0xLjQuMjYsMy4xOSwwLDYuMTkuMiw5LjAxLjU2LDEuODguMjQsMy42OC41Niw1LjQxLjk0LDMuNDUuNzYsNi42LDEuNzgsOS40NiwyLjk4LDQuMywxLjgsNy45Niw0LjAzLDExLjA3LDYuNDIuNTIuNCwxLjAyLjgsMS41MSwxLjIxLDMuNDIsMi44NSw2LjEsNS44OCw4LjE3LDguNzEuNTkuODEsMS4xMywxLjU5LDEuNjMsMi4zNiwxLjI0LDEuOTEsMi4xOSwzLjY1LDIuODksNS4wOC4yOC41Ny41MiwxLjEuNzMsMS41Ny0uMjEuMTEtLjQuMjQtLjYuMzYtNS4xNS01LjA5LTI0LjYtMjEtNDEuMTQtMjEuNTItMTQuNTEtLjQ1LTIyLjU0LDMuODctMjkuOTgsMTEuMjQsMCwwLDAsMCwwLDAtLjgxLjgtMS42LDEuNjMtMi40LDIuNS0uMDQuMDUtLjA5LjEtLjEzLjE0LTEuMDMsMS4xMi0yLjA2LDIuMy0zLjExLDMuNTMtLjY0Ljc1LTEuMjksMS41My0xLjk1LDIuMzItLjc2LjkxLTEuNTMsMS44NS0yLjMzLDIuOC0uNC40OC0uOC45Ny0xLjIxLDEuNDZaTTE5My4yMiwyNDIuMDZjLS4zMy0uMzUtLjY1LS42OS0uOTgtMS4wNWgwczAsMCwwLDBsNC42My0zLjgzczAtLjAzLDAtLjAzYzAtLjAyLDAtLjA2LS4wMi0uMTQsMC0uMDYtLjAyLS4xMy0uMDMtLjI1LS4wMi0uMTItLjA0LS4yNy0uMDYtLjQ0LS4wMS0uMDktLjAyLS4xNi0uMDMtLjI2LDAtLjAyLDAtLjA0LDAtLjA3LS4wMS0uMS0uMDMtLjIyLS4wNC0uMzMtLjAzLS4yMy0uMDYtLjQ3LS4xLS43NC0uMDMtLjIxLS4wNi0uNDQtLjA5LS42Ny0uMDMtLjIyLS4wNi0uNDYtLjA5LS43LDAtLjA1LS4wMS0uMDktLjAyLS4xNC0uMDEtLjEtLjAzLS4yMS0uMDQtLjMxLS4wMy0uMjQtLjA2LS40OS0uMDktLjc1LDAtLjA3LS4wMi0uMTQtLjAzLS4yMi0uMDMtLjIzLS4wNi0uNDYtLjA5LS43MS0uMDMtLjItLjA1LS40LS4wOC0uNjItLjA1LS40MS0uMS0uODUtLjE2LTEuMy0uMDQtLjM0LS4wOC0uNjktLjEzLTEuMDUtLjA2LS40OS0uMTItLjk2LS4xOC0xLjQ5LS4wOS0uNzUtLjE4LTEuNTQtLjI4LTIuMzctLjA2LS41Mi0uMTItMS4wNy0uMTgtMS42MS0uMDYtLjUxLS4xMi0xLjA0LS4xOC0xLjU3LS4wNi0uNTgtLjEzLTEuMTYtLjItMS43Ny0uMDUtLjQ5LS4xMS0uOTktLjE2LTEuNS0uMDUtLjUxLS4xMS0xLjAzLS4xNy0xLjU2LS4wNi0uNi0uMTMtMS4yMi0uMTktMS44NC0uMDctLjY5LS4xNC0xLjM5LS4yMi0yLjExLDAtLjA2LS4wMS0uMTItLjAyLS4xOC0uMDYtLjU5LS4xMi0xLjE4LS4xOC0xLjc5LS4wNi0uNjEtLjEyLTEuMjQtLjE5LTEuODctLjA2LS42My0uMTItMS4yNy0uMTktMS45MiwwLDAsMCwwLDAsMC0uMi0yLjA5LS40LTQuMjctLjYxLTYuNTMtLjA0LS4zOS0uMDctLjgxLS4xMS0xLjIxLS4xNi0xLjc4LS4zMS0zLjYxLS40Ny01LjQ4LS4wNi0uNjktLjExLTEuMzgtLjE3LTIuMDktLjE0LTEuNzItLjI4LTMuNDgtLjQyLTUuMjgtLjA2LS43My0uMTEtMS40NC0uMTctMi4xOS0uMTYtMi4xMi0uMzEtNC4zLS40Ni02LjVoMGMtLjAzLS4zOC0uMDUtLjc0LS4wOC0xLjEzaDBzMCwwLDAsMGMwLDAsMCwuMDItLjAyLjA1LS4wMS4wMy0uMDMuMDgtLjA1LjE0LDAsMCwwLDAsMCwuMDEtLjAzLjEtLjA3LjI1LS4xMi40MywwLC4wMi0uMDEuMDUtLjAyLjA4LS4wMi4wNy0uMDQuMTMtLjA2LjIyLS4wNS4xOS0uMS40My0uMTUuNjksMCwuMDUtLjAyLjA5LS4wMy4xNC0uMDEuMDctLjAzLjE2LS4wNC4yNC0uMDMuMTYtLjA2LjMxLS4wOS40OS0uMzEsMS44OC0uNjUsNS4wMS0uOCwxMC4wNC0uMDEuMzYtLjAyLjczLS4wMywxLjExLS4wMS41Ny0uMDIsMS4xNi0uMDMsMS43NywwLC42MS0uMDEsMS4yNS0uMDEsMS45MWgwYzAsLjk0LDAsMS45My4wMSwyLjk3aDBzLS4wMSwwLS4wMy4wMWMwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMC0uMDUuMDItLjEzLjA0LS4yNS4wM2gwczAsMCwwLDBjLS4wNiwwLS4xMy0uMDItLjItLjA1LDAsMCwwLDAsMCwwLS4xNS0uMDUtLjMzLS4xNi0uNTMtLjM2LDAsMCwwLDAsMCwwLS4yLS4yLS40MS0uNDktLjYzLS45MSwwLDAsMCwwLDAsMC0uMzYtLjY5LS43My0xLjc1LTEuMDctMy4zLS4wNS0uMjEtLjA5LS40My0uMTQtLjY1LS4wOS0uNDUtLjE3LS45NS0uMjYtMS40OC0uMDQtLjI3LS4wOC0uNTUtLjEyLS44NCwwLS4wMSwwLS4wMywwLS4wNCwwLS4wMiwwLS4wMywwLS4wNS0uMTctMS4zMS0uMzMtMi44NC0uNDUtNC42MiwwLS4wNiwwLS4xMS0uMDEtLjE3LS4wNi0uOS0uMTItMS44Ni0uMTYtMi45LS4wNS0xLjE2LS4wOS0yLjQxLS4xMS0zLjc1LDAtLjQ2LS4wMi0uOTMtLjAyLTEuNDEsMC0uMjgsMC0uNTUsMC0uODQsMC0uNDMsMC0uODcsMC0xLjMxaDBjMC0uNCwwLS43OSwwLTEuMTksMC0uMjEsMC0uNDIsMC0uNjMsMC0uMjEsMC0uNDIsMC0uNjMsMC0uNDgsMC0uOTcuMDItMS40NiwwLS4zOS4wMS0uNzcuMDItMS4xNywwLDAsMC0uMDEsMC0uMDIuMDEtLjYuMDMtMS4yMy4wNC0xLjg2LDAtLjE3LDAtLjM0LjAxLS41MSwwLS4xNywwLS4zMy4wMS0uNTEuMDEtLjUxLjAzLTEuMDQuMDUtMS41Ny4wMi0uNS4wMy0xLC4wNS0xLjUxaDBzMS4xNi40MywyLjA0LDEuMzRjLjEzLjEzLjI1LjI3LjM2LjQyLjE1LjIxLjMzLjQzLjUxLjY3LjA0LjA1LjA5LjExLjEzLjE2LjE4LjIzLjM4LjQ2LjU5LjcuMDIuMDMuMDQuMDUuMDcuMDguMjUuMjguNTMuNTguODUuODgsMCwwLC4wMi4wMi4wMy4wMy4zLjI5LjYzLjU4Ljk5Ljg4LjAzLjAzLjA3LjA2LjEuMDkuMTkuMTYuMzkuMzIuNi40Ny4yMS4xNi40My4zMi42Ni40OC40Ni4zMi45Ni42NCwxLjUxLjk2LjA0LjAyLjA3LjA0LjExLjA2LjU1LjMyLDEuMTQuNjQsMS43OC45NSwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwuMTIuMDYuMjYuMTIuMzkuMTguNTYuMjYsMS4xNS41MiwxLjc5Ljc4LjM4LjE1Ljc3LjMsMS4xOC40NSwxLjIzLjQ0LDIuNTkuODYsNC4wOSwxLjI1LDEuNTguNDEsMy4yOS44LDUuMjIsMS4xNGwuMDktLjgzLjA3LS42MXMtLjA0LS4wMi0uMDktLjA0Yy0uMTktLjA4LS43NC0uMzMtMS41Ni0uNzItLjAzLS4wMS0uMDYtLjAzLS4wOS0uMDQtLjMtLjE0LS42My0uMzEtLjk4LS40OC0uMDQtLjAyLS4wNy0uMDQtLjExLS4wNiwwLDAsMCwwLDAsMC0uMDIsMC0uMDQtLjAyLS4wNi0uMDMtLjAxLDAtLjAyLS4wMS0uMDMtLjAyLS4xNi0uMDgtLjMzLS4xNy0uNS0uMjYtLjIyLS4xMS0uNDMtLjIyLS42Ny0uMzUtLjEtLjA1LS4yLS4xLS4zLS4xNi0uMTEtLjA2LS4yNC0uMTMtLjM1LS4xOS0uNC0uMjEtLjc5LS40My0xLjIxLS42Ny0uMTgtLjExLS4zOC0uMjItLjU2LS4zMy0uMzEtLjE4LS42MS0uMzUtLjkyLS41NC0uMTUtLjA5LS4yOS0uMTktLjQ0LS4yOC0uMzUtLjIyLS43LS40NC0xLjA1LS42Ny0uMTgtLjEyLS4zNi0uMjQtLjU0LS4zNy0uMzEtLjIxLS42Mi0uNDMtLjkyLS42NS0uMTktLjE0LS4zOC0uMjgtLjU2LS40Mi0uMjgtLjIxLS41NS0uNDMtLjgxLS42NC0uMTYtLjEzLS4zMS0uMjYtLjQ3LS40LS4wMi0uMDItLjA1LS4wNC0uMDctLjA2LDAsMC0uMDItLjAyLS4wMy0uMDMtLjI0LS4yMS0uNDctLjQyLS42OS0uNjQtLjE2LS4xNS0uMzItLjMxLS40Ny0uNDYtLjIyLS4yMy0uNDItLjQ3LS42Mi0uNy0uMTItLjE1LS4yNS0uMy0uMzctLjQ1LS4xOS0uMjYtLjM1LS41Mi0uNS0uNzgtLjA3LS4xMy0uMTctLjI1LS4yMy0uMzgtLjE5LS4zOS0uMzUtLjc3LS40My0xLjE2LS4wNy0uMzEtLjExLS42Ni0uMTQtMS4wNCwwLS4xMiwwLS4yNS0uMDEtLjM4LDAtLjI3LS4wMS0uNTUsMC0uODVoMGMwLS4xNi4wMi0uMzIuMDMtLjQ4LjAxLS4xNS4wMy0uMzEuMDUtLjQ3LjAyLS4xNi4wMy0uMzEuMDUtLjQ3LjAyLS4xNy4wNC0uMzQuMDctLjUxLjAzLS4yMy4wOC0uNDcuMTItLjcxLjAzLS4xNS4wNS0uMy4wOC0uNDYuMDItLjEuMDQtLjIuMDYtLjMsMC0uMDQuMDEtLjA4LjAyLS4xMi4yNC0xLjE0LjU3LTIuMzcuOTktMy42Ny4wMi0uMDcuMDUtLjE0LjA3LS4yMi4wMS0uMDMuMDItLjA2LjAzLS4wOS4xOC0uNTYuMzgtMS4xMi42LTEuNy4wNS0uMTQuMTEtLjI5LjE3LS40NC4xNy0uNDYuMzctLjkyLjU2LTEuMzkuMDUtLjExLjA5LS4yMi4xMy0uMzMsMC0uMDIuMDItLjA0LjAzLS4wNi4wNS0uMTEuMS0uMjMuMTQtLjM0LjA5LS4yMS4yLS40My4yOS0uNjQuMjEtLjQ2LjQxLS45My42NC0xLjQuMDItLjA0LjA0LS4wOC4wNS0uMTEuMzItLjY2LjY2LTEuMzIsMS4wMS0xLjk5Ljg3LTEuNjYsMS44NS0zLjM0LDIuOTQtNS4wMy4wNS0uMDguMS0uMTUuMTUtLjIzLjQ2LS43MS45NS0xLjQyLDEuNDUtMi4xMy4wMi0uMDIuMDQtLjA1LjA1LS4wNy4wNC0uMDYuMDgtLjEyLjEzLS4xOC40NS0uNjMuOTMtMS4yNiwxLjQxLTEuODguMS0uMTMuMi0uMjcuMy0uNCwwLDAsMCwwLDAtLjAxLjQtLjUxLjgzLTEuMDIsMS4yNS0xLjUyLjg5LTEuMDYsMS44LTIuMTEsMi43OC0zLjE0LDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwaDBjLjE2LS4xNy4zMy0uMzMuNS0uNS40OS0uNS45OC0xLDEuNDktMS40OS4wNy0uMDcuMTUtLjE0LjIyLS4yLjAzLS4wMy4wNi0uMDUuMDktLjA4LjYtLjU2LDEuMjEtMS4xMiwxLjg0LTEuNjYuMDYtLjA1LjEzLS4xMS4xOS0uMTYuMDMtLjAyLjA1LS4wNS4wOC0uMDcuMTYtLjEzLjMzLS4yNi40OS0uMzkuNTItLjQzLDEuMDMtLjg2LDEuNTctMS4yNy4wNS0uMDQuMS0uMDcuMTQtLjExLjAyLS4wMi4wNS0uMDQuMDctLjA1LjMyLS4yNC42NS0uNDcuOTgtLjcxLjQ0LS4zMi44Ny0uNjUsMS4zMi0uOTYuMDItLjAyLjA1LS4wMy4wNy0uMDUsMi41MS0xLjcxLDUuMjItMy4yNCw4LjExLTQuNTEuOTctLjQzLDEuOTUtLjgyLDIuOTYtMS4xOS4xMy0uMDUuMjQtLjEuMzctLjE1LDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDEuNzYtLjYzLDMuNTktMS4xNiw1LjQ4LTEuNTkuMTgtLjA0LjM3LS4wNy41NS0uMTEuMDEsMCwuMDIsMCwuMDQsMCwuNzYtLjE2LDEuNTItLjMyLDIuMy0uNDUuMDctLjAxLjE1LS4wMi4yMi0uMDMuOTItLjE1LDEuODYtLjI3LDIuODItLjM3LDAsMCwuMTUuMi40MS41Ny4xOC4yNS40LjU3LjY2Ljk1LjEuMTQuMi4zLjMxLjQ2LjIyLjMyLjQ1LjY4LjcsMS4wNy4xMi4xOS4yNS40LjM4LjYuMTQuMjMuMjkuNDcuNDQuNzIuNDUuNzUuOTMsMS41NiwxLjQsMi40My41Mi45NiwxLjA0LDEuOTgsMS41MywzLjAzLjE4LjM5LjM2Ljc5LjUzLDEuMTkuMTYuMzYuMy43My40NSwxLjEuODIsMi4wOCwxLjQ0LDQuMjIsMS42NCw2LjI0LDAsMCwwLDAsMCwwLDAsMC0uMDYtMS4wMy0uMjQtMi42NmgwYy0uMS0uOTEtLjI0LTIuMDEtLjQzLTMuMjMtLjA3LS40OC0uMTUtLjk3LS4yNS0xLjQ5LS42OC0zLjg3LTEuODYtOC41Ni0zLjgtMTIuMjktLjI1LS40OS0uNTItLjk2LS44LTEuNDEtLjU3LS45MS0xLjE5LTEuNzQtMS44OC0yLjQ1LS4wNC0uMDQtLjA3LS4wOC0uMS0uMTIsMCwwLDAsMCwuMDEtLjAyLDAsMCwwLS4wMi4wMS0uMDIuMDUtLjA5LjQtLjc0LDEuMDItMS42OS4xOS0uMjkuNC0uNjEuNjQtLjk0LjE4LS4yNS4zNy0uNTIuNTctLjc5LjYxLS44MiwxLjM0LTEuNzEsMi4xNi0yLjYsMCwwLDAsMCwwLDB0MCwwYy42Mi0uNjcsMS4yOS0xLjMzLDIuMDItMS45NCwwLDAsMCwwLDAsMCwuMjItLjE5LjQ1LS4zNy42OC0uNTUsMS42Mi0xLjI0LDMuNDctMi4yNCw1LjQ5LTIuNjJoMHYxMS40NmgwdjQzLjE3aDBzLS4wMi4wMi0uMDYuMDRjLS4wMy4wMi0uMDcuMDUtLjEuMDcsMCwwLS4wMi4wMS0uMDIuMDItLjE2LjExLS4zOS4yNy0uNzYuNTMsMCwwLS4wMi4wMS0uMDMuMDIsMCwwLS4wMSwwLS4wMi4wMi0uMy4yMS0uNjYuNDYtMS4wOC43NS0uMDIuMDItLjA0LjAzLS4wNi4wNC0uMTkuMTMtLjM5LjI2LS41OS40LS4xMi4wOC0uMjUuMTctLjM3LjI1LS4xNy4xMi0uMzUuMjMtLjUzLjM2LDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwaDBzMCwwLDAsMGMtLjk4LjY1LTIuMTIsMS40MS0zLjQsMi4yMy0uMjQuMTYtLjQ5LjMxLS43NC40OC0uMDMuMDItLjA3LjA0LS4xMS4wNy0uMTMuMDgtLjI2LjE3LS4zOS4yNS0uNDguMy0uOTguNjItMS40OS45NC0uMTMuMDgtLjI2LjE2LS4zOS4yNS0uMDguMDUtLjE1LjEtLjIzLjE0LS4xNy4xMS0uMzQuMjEtLjUyLjMyLS42NC4zOS0xLjI5Ljc5LTEuOTYsMS4xOS0uMjUuMTUtLjUuMy0uNzUuNDUtMS44MywxLjA5LTMuNzYsMi4yLTUuNzcsMy4yOS0uMzEuMTctLjYyLjMzLS45My41LS41OC4zMS0xLjE2LjYyLTEuNzQuOTItLjEyLjA2LS4yNC4xMy0uMzYuMTktLjM3LjE5LS43NC4zOC0xLjExLjU3LS41Mi4yNi0xLjA1LjUyLTEuNTcuNzgtLjE4LjA5LS4zNS4xOC0uNTMuMjYtLjI1LjEyLS41LjI1LS43NS4zNy0uMS4wNS0uMi4wOS0uMy4xMy0xLjA0LjQ5LTIuMDguOTctMy4xMSwxLjQyLS4wMy4wMS0uMDUuMDItLjA4LjAzLTEuMDQuNDUtMi4wNy44Ny0zLjA5LDEuMjYtLjEyLjA1LS4yNS4xLS4zNy4xNS0uMzIuMTItLjY0LjIzLS45Ni4zNS0uNjIuMjItMS4yMy40My0xLjg0LjYzLS4xOC4wNi0uMzcuMTMtLjU1LjE5LTEuMDkuMzQtMi4xNi42NC0zLjIuODloMHMuMDQsMCwuMTEsMGMuMDgsMCwuMTktLjAxLjMzLS4wMy4wMSwwLC4wMywwLC4wNSwwLDAsMCwwLDAsMCwwLC4yMS0uMDIuNDctLjA0LjgtLjA4LjQxLS4wNC45LS4xLDEuNDgtLjE5czEuMjQtLjE4LDEuOTgtLjMxYy4yOS0uMDUuNi0uMTEuOTItLjE3LjM2LS4wNy43NC0uMTQsMS4xNC0uMjIuMzMtLjA3LjY2LS4xNCwxLjAxLS4yMi4zNS0uMDguNy0uMTYsMS4wNy0uMjUuMDktLjAyLjE4LS4wNC4yOC0uMDYuNzEtLjE3LDEuNDUtLjM2LDIuMjItLjU3LjEtLjAzLjItLjA1LjMtLjA4LjAxLDAsLjAzLDAsLjA0LS4wMS4wOS0uMDIuMTgtLjA1LjI3LS4wOC41NS0uMTUsMS4xMS0uMzIsMS42OS0uNS4xNy0uMDUuMzQtLjEuNTItLjE2LjEtLjAzLjItLjA2LjMtLjA5LjMtLjEuNjItLjIxLjkzLS4zMS42LS4yLDEuMi0uMzksMS44Mi0uNjIuMDctLjAzLjE0LS4wNS4yMi0uMDguMjMtLjA4LjQ3LS4xNy43LS4yNi41Mi0uMTksMS4wNC0uMzksMS41OC0uNi4yMy0uMDkuNDctLjE4LjctLjI4LjA2LS4wMi4xMi0uMDUuMTctLjA3LjI2LS4xLjUyLS4yMi43OC0uMzMuNzgtLjMzLDEuNTYtLjY2LDIuMzYtMS4wMy4wNC0uMDIuMDgtLjAzLjExLS4wNS4wMy0uMDEuMDUtLjAyLjA4LS4wNCwxLjA1LS40OCwyLjExLTEsMy4xOS0xLjU1LjEtLjA1LjE5LS4xLjI5LS4xNCwxLjA0LS41MywyLjA5LTEuMTEsMy4xNS0xLjcxLjEtLjA1LjE5LS4xLjI4LS4xNS4wMSwwLC4wMy0uMDIuMDQtLjAzLjA0LS4wMi4wOC0uMDUuMTEtLjA3LjE4LS4xMS4zNy0uMjIuNTYtLjMzLDEuMDctLjYzLDIuMTYtMS4zLDMuMjQtMi4wMS4xOC0uMTEuMzUtLjIyLjUzLS4zNC4wNC0uMDIuMDctLjA1LjExLS4wNy4yOS0uMTkuNTgtLjQuODctLjYuNjctLjQ1LDEuMzMtLjkyLDItMS40LjQ4LS4zNS45Ni0uNjksMS40NC0xLjA1LDAsMCw2Ljk1LDQuNTMsMTYuNzQsOS4zOS44OS40NCwxLjguODksMi43NCwxLjMzLjQ3LjIyLjk0LjQ0LDEuNDIuNjYsMy4zNCwxLjU1LDYuOTEsMy4wNywxMC41OCw0LjQzaDBzLS4wMywwLS4wOS4wMmMtLjA2LjAxLS4xNi4wMi0uMjkuMDMsMCwwLDAsMCwwLDAtLjM0LjAzLS45MS4wNS0xLjgyLS4wNC0uMDMsMC0uMDYsMC0uMDktLjAxLS4zLS4wMy0uNjItLjA3LS45OS0uMTItLjAyLDAtLjA1LDAtLjA4LS4wMS0xLjYtLjI0LTMuODctLjc0LTctMS43MywwLDAtLjAxLDAtLjAyLDAtNC43Ny0xLjUxLTExLjUyLTQuMTUtMjAuOTQtOC43NmgwdjcuNWgwdjI0LjM3aDBzLS4wNS0uMDEtLjA1LS4wMWgtLjA2cy05LjQ2LTEuODItOS40Ni0xLjgyYzAsMCwwLS4wMSwwLS4wMWwtMzEuOTYtNi4xNWgwczEzLjk2LDQuMzUsMTMuOTYsNC4zNWw0LjQ2LDEuMzksMy40LDEuMDYsOS42NiwzLjAxLDMuNDYsMS4wOCw2LjU5LDIuMDUuMjMtLjA3LDQxLjYyLTExLjkxczAsMCwwLDBjMCwwLDAsLjAxLDAsLjAzLDAsLjA2LDAsLjItLjE0LjQxLS4wMS4wMi0uMDIuMDMtLjAzLjA1LS4wMS4wMi0uMDMuMDUtLjA1LjA3LDAsMC0uMDEuMDItLjAyLjAyLS4wMi4wMy0uMDQuMDYtLjA2LjA5LS4wMS4wMi0uMDMuMDQtLjA0LjA1LS4wNC4wNS0uMDguMS0uMTMuMTYtLjAyLjAyLS4wNS4wNS0uMDcuMDctLjAyLjAyLS4wMy4wMy0uMDUuMDUtLjA0LjA0LS4wNy4wOC0uMTIuMTItLjAzLjAzLS4wOC4wNy0uMTEuMS0uMDIuMDItLjA0LjA0LS4wNy4wNi0uMDQuMDQtLjA4LjA3LS4xMy4xMS0uMDEsMC0uMDMuMDItLjA0LjAzLS4xNy4xNC0uMzcuMjktLjU5LjQ1LS4yMy4xNi0uNDguMzQtLjc4LjUyLS4wMSwwLS4wMi4wMS0uMDMuMDItLjA0LjAzLS4wOS4wNi0uMTQuMDgtLjE2LjEtLjMxLjE5LS40OS4zLS4wMSwwLS4wMi4wMS0uMDQuMDItLjAzLjAyLS4wNy4wNC0uMS4wNS0uMTQuMDgtLjI5LjE3LS40NC4yNS0uMi4xMS0uNC4yMi0uNjIuMzQtLjE1LjA4LS4zLjE2LS40Ni4yNC0uMDUuMDMtLjExLjA2LS4xNy4wOC0uMDQuMDItLjA4LjA0LS4xMi4wNi0uMjMuMTItLjQ3LjI0LS43Mi4zNiwwLDAtLjAxLDAtLjAyLDAtLjcxLjM1LTEuNTEuNzItMi40MSwxLjEyLS4xNC4wNi0uMy4xMy0uNDQuMTktLjU4LjI1LTEuMi41Mi0xLjg2Ljc5LS4yNS4xLS40OC4yLS43NC4zMS0uMTkuMDgtLjQuMTYtLjU5LjI0LS4zOS4xNS0uNzYuMzEtMS4xOC40Ny0uMDEsMC0uMDMuMDEtLjA0LjAyLS4wMiwwLS4wMy4wMS0uMDUuMDItLjQ1LjE4LS45My4zNi0xLjQxLjU0LS4xNS4wNi0uMjguMTEtLjQ0LjE3LDAsMC0uMDEsMC0uMDIsMC0uMDMuMDEtLjA2LjAyLS4wOS4wMy0uNS4xOS0xLjAyLjM4LTEuNTUuNTctLjIxLjA4LS40NC4xNi0uNjYuMjQtLjQ1LjE2LS44OS4zMi0xLjM2LjQ5LS41NS4yLTEuMTIuMzktMS43LjYtMy40NCwxLjE5LTcuNDUsMi41MS0xMi4xNCwzLjk2LS45NC4yOS0xLjkuNTgtMi45Ljg5LTEuMjkuMzktMi42NC43OS00LjAyLDEuMi0uNzUuMjItMS41MS40NC0yLjI5LjY3bC0uMSwxNC4xLS4xLDE0LjJ2NTcuNzFoMHM3LjE3LTQuNzksNy4xNy00Ljc5bDE1Ljc2LTEwLjU0aDBzLS4wMi4wMy0uMDcuMDhjLS4wNS4wNi0uMTIuMTQtLjIxLjI1LS4xNC4xNi0uMzYuNC0uNjEuNjgtLjA5LjEtLjE3LjE5LS4yNy4zaDBzMCwwLDAsMGMwLDAsMCwwLDAsMC0uNy43NS0xLjczLDEuODMtMy4xNiwzLjIxLS4yLjItLjQyLjQtLjY0LjYxLS4wMy4wMy0uMDYuMDYtLjA5LjA4LS44My44LTEuOCwxLjY5LTIuODcsMi42Ni0uNC4zNi0uODIuNzQtMS4yNiwxLjEzLS4yNS4yMi0uNDguNDMtLjc0LjY2LS4wOS4wOC0uMi4xNy0uMjkuMjUtMy4yNywyLjg2LTcuNDQsNi4zMS0xMi43LDEwLjM2LDAsMC0uMDYtLjAzLS4wNy0uMDQtLjAyLDAtLjAyLDAtLjA0LS4wMi0uMDMtLjAxLS4wNy0uMDQtLjEyLS4wNy0uMDUtLjAzLS4xMi0uMDctLjItLjExLS4xMy0uMDctLjI5LS4xNi0uNDgtLjI3LS4wNC0uMDItLjA5LS4wNS0uMTMtLjA3LS4xMS0uMDYtLjIyLS4xMy0uMzUtLjItLjAxLDAtLjAzLS4wMi0uMDUtLjAzLS4wOC0uMDUtLjE2LS4xLS4yNS0uMTUtLjAyLS4wMS0uMDQtLjAyLS4wNi0uMDMtLjA4LS4wNS0uMTYtLjEtLjI1LS4xNC0uMDgtLjA1LS4xNi0uMS0uMjUtLjE1LS4xNy0uMS0uMzQtLjItLjUzLS4zMS0uMjQtLjE0LS40OS0uMjktLjc1LS40Ni0uMTYtLjEtLjMzLS4yLS41LS4zMS0uMDQtLjAzLS4wOC0uMDUtLjEzLS4wOC0uMzEtLjE5LS42Mi0uMzgtLjk2LS41OS0uMS0uMDYtLjIxLS4xNC0uMzItLjItLjQ0LS4yOC0uODktLjU3LTEuMzgtLjg5LS4yNS0uMTYtLjUyLS4zNC0uNzctLjUxLS4yOC0uMTgtLjU4LS4zOS0uODgtLjU4LS4yOS0uMTktLjU3LS4zOC0uODgtLjU4LS4wNi0uMDQtLjEzLS4wOS0uMTktLjEzLS4xNC0uMS0uMjktLjE5LS40NC0uMy0uNi0uNDEtMS4yNi0uODctMS45MS0xLjMyLS4yMS0uMTUtLjQyLS4yOS0uNjMtLjQzLS4xNi0uMTEtLjMyLS4yMi0uNDktLjM0LTEuMDUtLjc0LTIuMTUtMS41My0zLjMxLTIuMzgtLjE4LS4xMy0uMzUtLjI2LS41My0uMzktLjQtLjI5LS44LS42LTEuMjEtLjktLjcxLS41My0xLjQzLTEuMDctMi4xOC0xLjY1LS4wNy0uMDYtLjE1LS4xMi0uMjMtLjE4LS4wNi0uMDUtLjEyLS4xLS4xOS0uMTQtLjI3LS4yMS0uNTUtLjQzLS44My0uNjQtLjM3LS4yOC0uNzMtLjU3LTEuMTEtLjg2LS4zNS0uMjctLjctLjU1LTEuMDUtLjgzLS4yMS0uMTctLjQxLS4zMi0uNjMtLjQ5LS4yMS0uMTctLjQ0LS4zNi0uNjUtLjUzLTEuMzctMS4xLTIuNzYtMi4yMy00LjIyLTMuNDQtLjQxLS4zNC0uODMtLjY5LTEuMjUtMS4wNC0uOC0uNjctMS42LTEuMzUtMi40Mi0yLjA2LS4wMi0uMDItLjA0LS4wNC0uMDYtLjA1LS4wNy0uMDYtLjE0LS4xMi0uMjEtLjE4LTEuMTItLjk3LTIuMjYtMS45Ny0zLjQyLTMtLjYyLS41NS0xLjI1LTEuMTItMS44OC0xLjY5LTEuNDMtMS4yOS0yLjg3LTIuNjEtNC4zNi00LS40My0uNDEtLjg4LS44My0xLjMyLTEuMjUtMS40Ny0xLjM5LTIuOTYtMi44Mi00LjQ4LTQuMzEtLjMtLjI5LS41OS0uNTctLjg5LS44Ny0uMjktLjI4LS41OS0uNi0uODgtLjg5LDAsMCwwLDAsMCwwLS4wMi0uMDItLjA0LS4wNC0uMDYtLjA2LTEuNTYtMS41NS0zLjEyLTMuMTEtNC43Mi00Ljc2LS4wNC0uMDUtLjA5LS4wOS0uMTMtLjE0LS4wMi0uMDItLjA0LS4wNS0uMDctLjA3LDAsMCwwLDAsMCwwLS4xMS0uMTEtLjIxLS4yMS0uMzItLjMzLS40My0uNDQtLjg3LS45MS0xLjMtMS4zOC0uNDQtLjQ3LS44OC0uOTQtMS4zMS0xLjQtLjk0LS45OS0xLjg3LTEuOTctMi44MS0yLjk3Wk0yODkuODcsMjg4LjA3czAsMCwwLDBoMGMtMi44MSwzLjU2LTkuOCwxMS42Ny0yMC40MiwxOS0uNjYuNDYtMS4zMy45MS0yLjAyLDEuMzYtMi4xOSwxLjQzLTQuNTMsMi44MS03LDQuMTEtLjg0LjQ0LTEuNy44OC0yLjU3LDEuMy0xLjE1LjU1LTIuMzIsMS4wOS0zLjUyLDEuNiwwLDAtLjE4LS4wNy0uNTEtLjItLjExLS4wNC0uMjQtLjEtLjM4LS4xNSwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMC0uMDMtLjAxLS4wNy0uMDMtLjExLS4wNC0uMjYtLjExLS41Ny0uMjQtLjkyLS4zOS0uMDMtLjAxLS4wNy0uMDMtLjEtLjA1LS4wMiwwLS4wMy0uMDEtLjA0LS4wMi0uMzYtLjE2LS43Ni0uMzMtMS4yMS0uNTItLjEzLS4wNi0uMjktLjEzLS40My0uMTktLjI5LS4xMy0uNi0uMjctLjkyLS40MS0uMTEtLjA1LS4yMS0uMDktLjMyLS4xNC0uMjItLjEtLjQ2LS4yMS0uNy0uMzItLjA4LS4wNC0uMTctLjA4LS4yNS0uMTEtLjMyLS4xNS0uNjUtLjMtMS0uNDYtLjMyLS4xNS0uNjUtLjMxLS45OS0uNDctLjM5LS4xOC0uNzctLjM2LTEuMTgtLjU2LS40Mi0uMi0uODYtLjQyLTEuMy0uNjQtLjI5LS4xNC0uNTctLjI4LS44Ny0uNDMtLjA3LS4wNC0uMTQtLjA3LS4yMi0uMTEtLjA3LS4wMy0uMTMtLjA3LS4yLS4xLS4xMy0uMDYtLjI2LS4xMy0uMzktLjE5LS4xOC0uMDktLjM5LS4yMS0uNTgtLjMtLjktLjQ2LTEuODItLjk0LTIuNzctMS40NS0uMzItLjE3LS42Mi0uMzItLjk0LS41LTEuMTQtLjYyLTIuMzMtMS4yOC0zLjUzLTEuOTYtLjMzLS4xOS0uNjctLjM4LTEtLjU4LS4xMi0uMDctLjI0LS4xNC0uMzctLjIxLS41My0uMzEtMS4wOC0uNjUtMS42Mi0uOTctLjU0LS4zMi0xLjA3LS42My0xLjYyLS45Ny0uNDEtLjI1LS44MS0uNS0xLjIzLS43Ni0uOTktLjYyLTEuOTgtMS4yNy0yLjk4LTEuOTItLjE1LS4xLS4zLS4xOS0uNDUtLjI5LS4wNy0uMDQtLjEzLS4wOS0uMi0uMTMtLjE5LS4xMi0uMzctLjI0LS41Ni0uMzYtLjIxLS4xNC0uNDEtLjMtLjYyLS40NC0xLjMtLjg4LTIuNTktMS43OS0zLjg3LTIuNzMtLjA3LS4wNS0uMTQtLjEtLjIxLS4xNSwwLDAsMCwwLDAsMC0xLjQ3LTEuMDktMi45Mi0yLjIyLTQuMzQtMy4zOCwwLDAsMCwwLDAsMC0uMDItLjAyLS4wNC0uMDMtLjA2LS4wNS0uMDQtLjA0LS4wOS0uMDctLjEzLS4xMS0uMzEtLjI1LS42LS41MS0uOTEtLjc3LS45My0uNzktMS44NS0xLjU5LTIuNzUtMi40Mi0uMTgtLjE2LS4zNy0uMzItLjU1LS40OS0uMDEtLjAxLS4wMi0uMDItLjAzLS4wMy0uMDItLjAyLS4wNC0uMDQtLjA2LS4wNi0xLjE1LTEuMDctMi4yNi0yLjE2LTMuMzItMy4yOC0uMDItLjAyLS4wMy0uMDQtLjA1LS4wNXMtLjAzLS4wNC0uMDUtLjA1Yy0uMDMtLjAzLS4wNi0uMDctLjA5LS4xLS4wNS0uMDUtLjA5LS4xLS4xNC0uMTYtLjExLS4xMS0uMjMtLjIyLS4zNC0uMzQtLjg0LS45MS0xLjY1LTEuODQtMi40NC0yLjc4LS4wOS0uMTEtLjE4LS4yMS0uMjYtLjMyLS43OS0uOTYtMS41NC0xLjkzLTIuMjYtMi45Mi0xLjE1LTEuNjEtMi4yLTMuMjYtMy4xMi00Ljk1LS4wMy0uMDUtLjA2LS4xLS4wOS0uMTUtLjI3LS41LS41Mi0xLjAxLS43Ny0xLjUxLS4xMy0uMjYtLjI1LS41Mi0uMzctLjc4LS4wNS0uMTItLjEyLS4yMy0uMTctLjM1LS4yNy0uNi0uNTItMS4yMS0uNzUtMS44Mi0uMTEtLjI5LS4yMi0uNTctLjMzLS44NmgwczMuMzUtNy41MSwzLjM1LTcuNTFjMCwwLC43MiwxLjAzLDIuMTYsMi44My4zMi40LjY3Ljg0LDEuMDcsMS4zMi4zNi40NC43NS45MSwxLjE3LDEuNDEuNzIuODUsMS41MywxLjc4LDIuNDMsMi43OSwxLjAxLDEuMTMsMi4xNCwyLjM2LDMuMzgsMy42Ni42Mi42NSwxLjI3LDEuMzIsMS45NSwyLjAxLjY4LjY5LDEuMzgsMS40LDIuMTEsMi4xMi44NC44MiwxLjc1LDEuNjksMi42NiwyLjU1LjA2LjA2LjEzLjEyLjE5LjE4Ljc3LjcyLDEuNTUsMS40NCwyLjM2LDIuMTguMTcuMTUuMzMuMy40OS40NS41Mi40OCwxLjA1Ljk2LDEuNiwxLjQ1LjMzLjMuNjguNiwxLjAyLjg5LjI5LjI1LjU4LjUuODcuNzUuNzMuNjMsMS40OCwxLjI3LDIuMjUsMS45MS4xNS4xMy4zMS4yNi40Ni4zOS4yNS4yMS41LjQyLjc2LjYzLDEuNDUsMS4yLDIuOTUsMi40LDQuNTMsMy42M2gwczAsMCwwLDBoMHMwLDAsMCwwYzAsMC0uMDIsMC0uMDQtLjAyLS4wMy0uMDEtLjA4LS4wMy0uMTUtLjA2aDBjLS4zMS0uMTMtMS4wNC0uNDQtMS45OC0uODUtLjIxLS4wOS0uNDItLjE4LS42NC0uMjgtLjY0LS4yOC0xLjM2LS41OS0yLjEtLjkxLTIuNDMtMS4wNS01LjExLTIuMjItNi40My0yLjg0LDAsMCwuMDYuMDcuMTcuMTksMCwwLC4wMi4wMi4wMy4wMy4wNy4wNy4xNi4xNi4yNi4yNy43NS43NSwyLjQ3LDIuMzQsNS42Nyw0LjY4LjQ0LjMyLjkxLjY2LDEuNDEsMSwuMDUuMDQuMTEuMDguMTcuMTEuMDEsMCwuMDMuMDIuMDQuMDMuMzguMjcuNzguNTQsMS4xOS44Mi40OC4zMywxLC42NywxLjUzLDEuMDIuNzYuNDksMS41NSwxLjAxLDIuNDEsMS41NC4xLjA2LjE4LjEyLjI4LjE4LjA1LjAzLjA5LjA2LjE0LjA5LjY3LjQyLDEuMzguODUsMi4xMiwxLjI5LjEyLjA3LjI1LjE1LjM4LjIyLDEuMTkuNzEsMi40NywxLjQ1LDMuODQsMi4yMiwxLjM2Ljc3LDIuODIsMS41Nyw0LjM2LDIuNC42OC4zNiwxLjM4LjczLDIuMDgsMS4xLjk2LjUsMS45MywxLjAxLDIuOTYsMS41My4wOC4wNC4xNi4wOC4yNC4xMi4zMi4xNi42NC4zMi45Ni40OC41NC4yNywxLjA5LjU0LDEuNjQuODIuMzEuMTYuNjQuMzEuOTYuNDcuNTIuMjYsMS4wNS41MiwxLjU5Ljc4LDAsMCwuMDEsMCwuMDIsMCwwLDAsLjAyLDAsLjAzLjAxLDAsMCwuMS0uMDYuMjctLjE1LjAzLS4wMi4wNi0uMDMuMDktLjA1LjE1LS4wOC4zNC0uMTkuNTctLjMyLjQyLS4yMy45Ny0uNTQsMS42My0uOTFzMS40NC0uOCwyLjMtMS4yOWMuMDMtLjAxLjA1LS4wMy4wOC0uMDQuMDctLjA0LjEzLS4wNy4yLS4xMS4yNC0uMTQuNDktLjI4Ljc1LS40Mi4yMS0uMTIuNDItLjI0LjYzLS4zNi4yLS4xMS40LS4yMy42MS0uMzUuMjEtLjEyLjQ0LS4yNS42Ni0uMzcuMjctLjE1LjUzLS4zLjgxLS40Ni4wMSwwLC4wMi0uMDEuMDMtLjAyLjE2LS4wOS4zMi0uMTguNDgtLjI3LjMyLS4xOC42NC0uMzYuOTctLjU1LjE1LS4wOS4zMS0uMTguNDctLjI2LjE3LS4wOS4zMy0uMTkuNS0uMjkuMTctLjEuMzMtLjE5LjUtLjI5LjA4LS4wNS4xNy0uMS4yNS0uMTUuMDktLjA1LjE3LS4xLjI1LS4xNS4yMS0uMTIuNDItLjI0LjYzLS4zNi4xNi0uMDkuMzEtLjE4LjQ4LS4yNy4wMy0uMDIuMDctLjA0LjEtLjA2LjA4LS4wNS4xNi0uMDkuMjUtLjE0LjE3LS4xLjM1LS4yLjUzLS4zLjItLjExLjQtLjIzLjYtLjM1LjM4LS4yMi43NS0uNDMsMS4xMy0uNjUuMTYtLjEuMzMtLjE5LjQ5LS4yOC4yNi0uMTUuNTEtLjMuNzctLjQ1LjI4LS4xNi41Ny0uMzMuODUtLjQ5LjQtLjIzLjgxLS40NywxLjIxLS43LjE1LS4wOS4zLS4xNy40NC0uMjYuMjUtLjE1LjUtLjI5Ljc1LS40NC4yNi0uMTUuNTEtLjMuNzctLjQ1LjA0LS4wMy4wOS0uMDUuMTMtLjA4LjA1LS4wMy4xLS4wNi4xNS0uMDkuMjgtLjE3LjU2LS4zMy44NC0uNDkuMTItLjA3LjI0LS4xNC4zNi0uMjEuMDctLjA0LjE0LS4wOC4yMS0uMTMuMzMtLjE5LjY1LS4zOS45OC0uNTguMjEtLjEzLjQzLS4yNS42NC0uMzguMjgtLjE3LjU2LS4zNC44NC0uNTEuMTUtLjA5LjMtLjE4LjQ1LS4yNy4wOS0uMDYuMTktLjExLjI4LS4xNy4yNS0uMTUuNDktLjMuNzQtLjQ1LjI2LS4xNS41MS0uMzEuNzYtLjQ2LjI1LS4xNS40OS0uMy43My0uNDUuMjMtLjE0LjQ2LS4yOC42OS0uNDIuMjMtLjE0LjQ2LS4yOC42OC0uNDIuMjMtLjE0LjQ2LS4yOC42OC0uNDIuMTMtLjA4LjI2LS4xNi4zOC0uMjQuMDgtLjA1LjE2LS4xLjIzLS4xNS4yMi0uMTQuNDMtLjI3LjY0LS40MS4yLS4xMy40LS4yNi41OS0uMzguMi0uMTMuMzktLjI1LjU4LS4zOC4xNy0uMTEuMzUtLjIzLjUxLS4zNC4wOS0uMDYuMTgtLjEyLjI3LS4xOC4wOS0uMDYuMTgtLjEyLjI3LS4xOC4wOS0uMDYuMTgtLjEyLjI4LS4xOS4wNi0uMDQuMTItLjA4LjE4LS4xMi4wNy0uMDUuMTMtLjA5LjItLjE0LjA5LS4wNi4xOC0uMTIuMjYtLjE4LjE0LS4xLjI4LS4xOS40LS4yOC4xMS0uMDguMjEtLjE2LjMyLS4yNC4wMy0uMDIuMDYtLjA0LjA4LS4wNi4xMS0uMDguMjItLjE2LjMyLS4yNC4xMi0uMDkuMjItLjE4LjMzLS4yNi4wOC0uMDcuMTctLjE0LjI0LS4yLjEtLjA5LjE3LS4xNi4yNS0uMjQuMDUtLjA1LjExLS4xLjE1LS4xNC4xLS4xMS4xNy0uMi4yMi0uMjgsMCwwLDAsMCwwLS4wMWgwczAsMCwwLDBjMCwwLS40OC42OS0xLjQsMS44NSwwLDAsMCwwLDAsMFpNMjc3LjUzLDI0Ni43OGMtLjI1LDEuMy0uNDcsMS45Ny0uNjMsMi4zMS0uMDIuMDQtLjAzLjA3LS4wNS4xLDAsMCwwLDAsMCwwLS4wMy4wNi0uMDcuMTEtLjA5LjE1LS4wMS4wMS0uMDIuMDItLjAzLjAzLS4wMi4wMi0uMDMuMDQtLjA0LjA1LDAsMC0uMDIuMDEtLjAyLjAyLDAsMC0uMDIuMDEtLjAyLjAxLDAsMC0uMDEsMC0uMDIsMCwwLDAsMCwwLDAsMGgwcy0uMDEtLjA2LS4wMi0uMTFjMC0uMDUsMC0uMTMtLjAxLS4yMSwwLS4xNy0uMDEtLjQxLS4wMS0uNywwLS4xMiwwLS4yNSwwLS4zOSwwLS44NC4wMS0yLjAyLjA0LTMuNDQsMC0uMjQsMC0uNDguMDEtLjczLjAyLTEuMTMuMDUtMi4zOC4wOC0zLjc0LjAyLS45LjA0LTEuODQuMDctMi44MS4wNS0xLjk0LjExLTQuMDEuMTctNi4xMS4wMy0xLjA1LjA2LTIuMTEuMDktMy4xNi4wMi0uNTMuMDMtMS4wNS4wNS0xLjU4LjAzLTEuMDUuMDYtMi4wOS4wOS0zLjExLjAzLTEuMDIuMDYtMi4wMi4wOS0yLjk5LjA1LTEuNTUuMDktMy4wMi4xNC00LjM3LjAzLS45LjA2LTEuNzQuMDgtMi41MS4wNS0xLjU1LjA5LTIuODIuMTItMy43Ljc0LS4yNSwxLjUtLjUyLDIuMjctLjc5LS4wNCwxLjg5LS4wOSwzLjctLjE0LDUuNDItLjAyLjU5LS4wMywxLjE4LS4wNSwxLjc1LS4wNywyLjI2LS4xNCw0LjM2LS4yMiw2LjMzLS4wNC45My0uMDcsMS44My0uMTEsMi43LS4wNC45Mi0uMDgsMS44Mi0uMTIsMi42Ny0uMDQuODQtLjA4LDEuNjQtLjEzLDIuNDItLjA0Ljc3LS4wOSwxLjUyLS4xMywyLjIzLS4wMy41My0uMDcsMS4wNS0uMSwxLjU1LS4wMy41LS4wNy45OS0uMSwxLjQ2cy0uMDcuOTItLjEsMS4zNmMtLjA3Ljg4LS4xNCwxLjY5LS4yLDIuNDUtLjAzLjM4LS4wNy43NC0uMSwxLjEtLjA1LjQ3LS4wOS45MS0uMTQsMS4zMy0uMDMuMzItLjA3LjYyLS4xLjkxLS4wMy4yOS0uMDcuNTctLjEuODMtLjA0LjMzLS4wOC42NC0uMTIuOTQtLjA0LjI2LS4wNy41MS0uMTEuNzQtLjA0LjIzLS4wNy40Ni0uMTEuNjctLjA2LjM0LS4xMS42NS0uMTcuOTJaTTI5MS4xNCwyMzQuNzJjLS4xMy42Ni0uMjUsMS4xOS0uMzYsMS42My0uMDYuMjItLjExLjQxLS4xNi41OC0uMDQuMTItLjA3LjI0LS4xMS4zNC0uMDcuMi0uMTQuMzctLjIuNS0uMDMuMDYtLjA2LjEyLS4wOS4xNy0uMDEuMDItLjAzLjA1LS4wNC4wNy0uMDMuMDQtLjA1LjA4LS4wNy4xMS0uMDUuMDctLjA5LjEtLjEyLjEyLDAsMCwwLDAtLjAxLDAsMCwwLDAsMCwwLDAtLjAzLjAyLS4wNC4wMi0uMDUuMDIsMCwwLDAsMCwwLDBoMHMtLjAxLS4wNy0uMDItLjE1YzAtLjA3LDAtLjE3LS4wMS0uMjgsMC0uMTIsMC0uMjYsMC0uNDIsMC0uMzIsMC0uNzIuMDItMS4xOS4wMS0uNDcuMDMtMSwuMDQtMS42LDAtLjMxLjAyLS42NC4wMy0uOTguMDEtLjMzLjAyLS42OC4wNC0xLjAzLjAyLS41NC4wNC0xLjEuMDYtMS42OS4wMy0uODguMDctMS44Mi4xMS0yLjc5LjAyLS40OS4wNC0uOTguMDYtMS40OHMuMDQtMS4wMS4wNy0xLjUzYy4xLTIuMzEuMjEtNC43My4zMi03LjA5LjExLTIuMzEuMjItNC41Ny4zMS02LjU5LjAyLS40My4wNC0uODQuMDYtMS4yNS4xLTIuMDIuMTktMy43Ni4yNS01LjAxLDAtLjE4LjAyLS4zNS4wMy0uNTFoMGMuMTMtLjA1LjI2LS4xMS4zOS0uMTYuNjMtLjI2LDEuMjctLjUzLDEuOS0uOCwwLDAsMCwwLDAsMC0uMTksNC44NS0uMzksOS4wMi0uNjEsMTIuNjEtLjA3LDEuMjQtLjE1LDIuNDItLjIzLDMuNTItLjEyLDEuNzktLjI1LDMuNDEtLjM4LDQuODctLjA0LjQ0LS4wOC44Ni0uMTEsMS4yNy0uMDQuNDEtLjA4LjgxLS4xMSwxLjE5LS4wNC4zOC0uMDguNzUtLjExLDEuMTEtLjA0LjM2LS4wOC43LS4xMSwxLjAzLS4wOC42Ni0uMTUsMS4yOC0uMjMsMS44NS0uMDUuMzgtLjEuNzQtLjE1LDEuMDgtLjAyLjE3LS4wNS4zMy0uMDcuNS0uMDUuMzItLjEuNjItLjE0LjkxLS4wNy4zOS0uMTMuNzUtLjE5LDEuMDhaTTI2Ni4zNSwyMTMuMzhoMGMwLDIuODItLjAxLDUuNDYtLjAzLDcuOTQsMCwwLDAsLjAyLDAsLjAzLDAsMS4yMy0uMDIsMi40Mi0uMDMsMy41NiwwLC4wMSwwLC4wMywwLC4wNC0uMDIsMS43Mi0uMDQsMy4zNS0uMDcsNC45LDAsLjU0LS4wMiwxLjA3LS4wMywxLjU5LDAsLjI0LS4wMS40OC0uMDIuNzItLjAyLjcyLS4wMywxLjQzLS4wNSwyLjExLS4xLDQuMTktLjI0LDcuNjUtLjM4LDEwLjUtLjA1Ljk1LS4xLDEuODQtLjE1LDIuNjYtLjAzLjQxLS4wNS44MS0uMDgsMS4xOS0uMDUuNzYtLjExLDEuNDYtLjE2LDIuMTEtLjA2LjY1LS4xMSwxLjI0LS4xNywxLjc4LS4wOC44MS0uMTcsMS41MS0uMjUsMi4xLS4wNC4yNy0uMDcuNTEtLjExLjc0LS4wNC4yMy0uMDcuNDQtLjExLjYzLS4wMi4xLS4wMy4xOS0uMDUuMjgtLjAzLjE4LS4wNy4zNC0uMS40OS0uMDMuMTMtLjA2LjI1LS4wOS4zNi0uMDMuMTQtLjA3LjI2LS4xLjM2LS4wNi4xOS0uMTEuMzQtLjE2LjQ1LS4wMi4wNi0uMDUuMS0uMDcuMTQtLjAzLjA1LS4wNS4wOS0uMDguMTIsMCwuMDEtLjAyLjAyLS4wMi4wMy0uMDEuMDEtLjAyLjAzLS4wMy4wNCwwLDAtLjAxLDAtLjAyLjAxLDAsMC0uMDEsMC0uMDIuMDEsMCwwLDAsMC0uMDEsMCwwLDAsMCwwLDAsMGgwcy0uMDEtLjA1LS4wMi0uMWMtLjAxLS4xLS4wMi0uMjUtLjAzLS40NSwwLS4xLDAtLjIxLS4wMS0uMzQsMC0uMi0uMDEtLjQzLS4wMi0uNjksMC0uMjYsMC0uNTQtLjAxLS44NiwwLS4zMSwwLS42NSwwLTEuMDIsMC0uMzYsMC0uNzUsMC0xLjE2LS4wMS0yLjg3LDAtNi44My4wMi0xMS4xNSwwLS4zMSwwLS42MiwwLS45NCwwLTEuMjQuMDEtMi41MS4wMi0zLjc5aDBjMC0uOTcuMDEtMS45My4wMi0yLjg5aDBjMC0uNjUsMC0xLjI5LjAxLTEuOTJoMGMwLS42NSwwLTEuMjguMDItMS45LDAtLjY0LjAxLTEuMjYuMDItMS44OSwwLS42MS4wMS0xLjIyLjAyLTEuODEsMC0uMzEsMC0uNjEsMC0uOTEsMC0uNTguMDEtMS4xNi4wMi0xLjcyLDAtLjI5LDAtLjU3LDAtLjg2LDAtLjgyLjAyLTEuNjIuMDItMi4zNywwLDAsMC0uMDIsMC0uMDMsMC0uNSwwLS45OC4wMS0xLjQ1aDBjMC0uNzIuMDEtMS4zOC4wMi0xLjk5LDAtLjQyLDAtLjgxLjAxLTEuMTgsMC0uMzYsMC0uNjkuMDEtMSwwLS43OS4wMS0xLjQxLjAyLTEuODMuNjgtLjE5LDEuNDItLjQxLDIuMjQtLjY1Wk0yNTQuMjYsMzUxLjc3cy0yLjYyLTEuOTItNi44Ny01LjE2Yy0xNi41NC0xMi42LTU3Ljc2LTQ1LjE0LTY0Ljg5LTYxLjY3bDkuOTEtMTEuMTlzLjA1LjA4LjEyLjE5aC4wMXMuMDUuMDcuMTUuMjJjLjAzLjA1LjA3LjExLjExLjE3LDAsLjAxLjAyLjAyLjAyLjAzLjA5LjEzLjE5LjI5LjMyLjQ3LDAsMCwuMDEuMDIuMDIuMDIuMTQuMi4yOS40Mi40Ny42NywwLDAsMCwwLDAsLjAxLjE5LjI2LjQuNTUuNjMuODYuMDYuMDguMTMuMTcuMTkuMjUsNS43NSw3LjYsMjMuOTksMjguNCw1OS43OSw0MS41NHYuMTFzLjA1LjAyLjA3LjAzaDBzLS4wNy41LS4wNy41djI2Ljg2czcuMjMtLjY0LDQxLjQ0LTI2LjIyYzAsMC0uNDkuNDItMS4zMywxLjE1LjM3LS4yNy43Mi0uNTMsMS4wOS0uODEuMDktLjA3LjE4LS4xMy4yNy0uMiwwLDAtLjA5LjA4LS4yNi4yMy0uMTEuMS0uMjYuMjMtLjQ1LjM5LS4yOC4yNC0uNjMuNTQtMS4wNS45LS4yOC4yNC0uNTkuNTEtLjkzLjgtLjM0LjI5LS43LjYtMS4wOS45NC0uMzkuMzMtLjgxLjY5LTEuMjUsMS4wNi0uMjIuMTktLjQ0LjM4LS42OC41OC0xLjg1LDEuNTctNC4wNCwzLjQyLTYuNDIsNS40Mi0uMTguMTUtLjM3LjMxLS41NS40Ni0uMTcuMTMtLjM1LjI3LS41My40MS0yLjg4LDIuNC01Ljk4LDQuOTQtOS4wNiw3LjQybC0uMDktLjA1Yy0zLjk2LDMuMTgtNy44Nyw2LjIzLTExLjIzLDguNjYtMy4zOSwyLjQ2LTYuMjEsNC4yOC03Ljg5LDQuOTZaIi8+PHBhdGggY2xhc3M9ImciIGQ9Ik0yODMuMDcsMzMwLjM4Yy4xOC0uMTUuMzctLjMxLjU1LS40NiwyLjM4LTEuOTksNC41OC0zLjg1LDYuNDItNS40Mi4yMy0uMi40Ni0uMzkuNjgtLjU4LjQ0LS4zNy44Ni0uNzMsMS4yNS0xLjA2LjM5LS4zMy43Ni0uNjUsMS4wOS0uOTQuMzQtLjI5LjY1LS41Ni45My0uOC40Mi0uMzYuNzctLjY3LDEuMDUtLjkuMTgtLjE2LjMzLS4yOS40NS0uMzkuMTctLjE1LjI2LS4yMy4yNi0uMjMtLjA5LjA3LS4xOC4xMy0uMjcuMi0xLjQzLDEuMjQtNi42Myw1LjczLTEyLjkzLDEwLjk4LjE4LS4xNC4zNi0uMjcuNTMtLjQxWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMTYyLjcyLDE2MC43N2MtOS43NywxMi44NS0yNC44OSwxOS45My00Mi41OCwxOS45My05LDAtMTUuNjctMS44My0xNi40LTIuMDRsLTM0LjkzLTkuOTZjLTE2LjQyLDIuNjItMjkuMzQsMTcuMTUtMjkuODgsMTcuNzdsLTEuMTYsMS4zOSwxLjA3LTEuMjZzLjAyLS4wMy4wNS0uMDZjLjA5LS4xLjI5LS4zMi42LS42NS4yLS4yMi40NS0uNDguNzUtLjc3LjI5LS4zLjYzLS42MywxLjAxLTEsLjM4LS4zNy44LS43NiwxLjI2LTEuMTlzLjk2LS44NywxLjQ5LTEuMzNjLjU0LS40NiwxLjExLS45NSwxLjcxLTEuNDQsNS40Ni00LjQ1LDEzLjczLTkuODIsMjMuMTQtMTEuMzJsMzQuODksOS45NWMuNjQuMTgsNy4zNSwyLjAzLDE2LjUsMi4wMywxMi42OCwwLDMwLjA2LTMuNTQsNDIuNTItMTkuOTMuNzQtLjk3LDEuNDctMS45MywyLjItMi44Ny42Ny0uODcsMS4zNC0xLjczLDItMi41OS4wMS0uMDcuMDItLjE1LjAzLS4yMi0xLjQsMS44LTIuODMsMy42Ni00LjI4LDUuNTZaIi8+PHBvbHlnb24gY2xhc3M9InEiIHBvaW50cz0iMzI3LjA0IDE1NC43NiAzMjcuMDQgMTU0Ljc2IDMyNy4wNCAxNTQuNzYgMzI3LjA0IDE1NC43NiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMzI4LjY2LDE1NS44M3MuMS4wOC4xNS4xM2MtLjMtLjM3LS42Ny0uNjYtMS4wOS0uODkuMjMuMTQuNDUuMy42NS40OC4xLjA5LjIuMTkuMjkuMjlaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0zMDAuODMsMTA0LjA1Yy0uMTEtLjA4LS4yMi0uMTYtLjM0LS4yNC0uMTItLjA4LS4yNS0uMTYtLjM4LS4yNC4yNC4xNi40OC4zMi43Mi40OFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTMzMC42NSwxNDIuMjdjLjA3LjAyLjE0LjA1LjIxLjA3LDAtLjAxLS4wMS0uMDMtLjAyLS4wNC0uNi0xLjYtMS4yNC0zLjE4LTEuOTQtNC43My0uNDYtMS4wMi0uOTQtMi4wMy0xLjQ0LTMuMDMtLjE0LS4yNy0uMjctLjU0LS40MS0uODEtLjUtLjk4LTEuMDItMS45NC0xLjU2LTIuOS0uMDItLjAzLS4wNC0uMDctLjA2LS4xMS0uMDMtLjA1LS4wNi0uMS0uMDktLjE1LS4zOS0uNjktLjc5LTEuMzctMS4yMS0yLjA1LS4xMy0uMjItLjI3LS40My0uNDEtLjY1LS4zMi0uNS0uNjMtMS4wMS0uOTUtMS41MS0uNDctLjcxLS45NC0xLjQxLTEuNDMtMi4xLS45OC0xLjM5LTItMi43NS0zLjA2LTQuMDgtMS4wNi0xLjMyLTIuMTYtMi42MS0zLjMxLTMuODctLjc2LS44NC0xLjU0LTEuNjYtMi4zMy0yLjQ2LS41My0uNTQtMS4wNy0xLjA2LTEuNjEtMS41OC0uNjctLjY0LTEuMzctMS4yNS0yLjA2LTEuODYsMS4wOC45NywyLjE0LDEuOTYsMy4xNywyLjk5LDguMjIsOC4yMSwxNC41MSwxOC4wNSwxOC41LDI4Ljg0WiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNOTkuNjQsNTguNTZjLTMuOTUuOC03LjksMS4yMi0xMS44OCwxLjIzLjAzLDAsLjA1LDAsLjA4LDAsMy44NiwwLDcuNzctLjQsMTEuOC0xLjIzWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMjE1LjMxLDEyLjQ4czAsMCwwLDBjMy42NSwwLDUuODkuMiw2LjMuMjNsLjU5LjA2LjU4LjExYzE2Ljk1LDMuMTksMzAuNzMsOCw0MC45NSwxNC4yOSwxMC4wOCw2LjIsMTcuMDgsMTMuOTksMjAuOCwyMy4xNSw2LjU2LDE2LjEzLDEuNDIsMzIuMi00LjY3LDQzLjU1LjA2LjAyLjEzLjA0LjE5LjA2LjUxLS45NSwxLTEuOTEsMS40Ny0yLjg2LjA0LS4wOC4wNy0uMTUuMS0uMjMuNjktMS40NCwxLjMyLTIuODcsMS44OS00LjMuNDEtMS4wMi43OS0yLjAzLDEuMTQtMy4wNC41My0xLjUyLjk5LTMuMDMsMS4zOC00LjU0LjM1LTEuMzUuNjQtMi42OC44OS00LjAyLjEtLjUyLjE4LTEuMDUuMjYtMS41Ny45NS02LjI5LjY5LTEyLjM4LS44My0xOC4xNC0uMjItLjgyLS40Ni0xLjY0LS43My0yLjQ0LS4yOC0uODMtLjU4LTEuNjYtLjkxLTIuNDctLjQ3LTEuMTYtMS0yLjMtMS41Ny0zLjQxLS40Ni0uODktLjk3LTEuNzctMS40OS0yLjYzLS40Ni0uNzUtLjkzLTEuNDktMS40NC0yLjIyLS4zNi0uNTItLjc0LTEuMDQtMS4xMy0xLjU1LTEwLjE1LTEzLjI2LTI4Ljk4LTIyLjU0LTU2LjE3LTI3LjY2bC0xLjE3LS4xNnMtLjEyLS4wMS0uMjItLjAyYy0uMTctLjAxLS40Mi0uMDMtLjc0LS4wNi0xLjA0LS4wNy0yLjg1LS4xNi01LjMtLjE2LTEuOSwwLTQuMTguMDUtNi43Ny4yMS0xLjA3LjA3LTIuMi4xNS0zLjM4LjI1LS41Ny4wNS0xLjE2LjExLTEuNzUuMTctLjEyLjAxLS4yNC4wMy0uMzcuMDQtMS4wNy4xMS0yLjE3LjI1LTMuMy40LS4xOC4wMi0uMzUuMDUtLjUzLjA3LTEuMS4xNS0yLjIzLjMzLTMuMzkuNTItLjIzLjA0LS40Ny4wOC0uNy4xMi0xLjEyLjE5LTIuMjYuNDEtMy40Mi42NC0yLjI5LjQ2LTQuNjUsMS03LjA4LDEuNjUtMS41Mi40LTMuMDYuODUtNC42MywxLjMzLS4zNi4xMS0uNzMuMjQtMS4wOS4zNiwxNS41OS00Ljk3LDI5LjI4LTUuNzUsMzYuMjUtNS43NVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTU2LjUyLDc2LjAzbC0xNC41My0yNy4xMS0uMDUtLjAyLDE0LjU1LDI3LjE1Yy4wOC4xNS4yMS4zOS4zOS42OS4xMS4xOC4yMy4zOS4zNy42My4xMy4yMi4yOC40Ni40NS43MiwxLjY2LDIuNiw0Ljk2LDcuMTYsMTAuMzcsMTIuMTkuODIuNzYsMS42OSwxLjUzLDIuNiwyLjMxLjkyLjc4LDEuODgsMS41NiwyLjksMi4zNCwxLjM1LDEuMDQsMi43OSwyLjA3LDQuMzIsMy4xLjAxLDAsLjAzLS4wMS4wNC0uMDItMTQuNDMtOS42Ni0yMC41NC0yMC4zNS0yMS40MS0yMS45OVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTE4LjM5LDEzNi40NmMuOTktMS45NSwyLjEtMy44NCwzLjMxLTUuNjctLjU5Ljg5LTEuMTYsMS43OS0xLjcsMi43LDAsMCwwLC4wMS0uMDEuMDIsMCwwLDAsLjAxLDAsLjAyLDAsLjAxLS4wMi4wMy0uMDMuMDQtLjU3Ljk4LTEuMTEsMS45Ni0xLjYyLDIuOTcsMCwuMDItLjAyLjAzLS4wMy4wNS0zLjExLDYuMTMtNC45OSwxMi42Mi01LjY0LDE5LjI1LS4yMiwyLjIxLS4yOSw0LjQzLS4yNCw2LjY2LjE4LDYuOTQsMS43LDEzLjkzLDQuNTUsMjAuNzRsOC4xOCwxOS41Mi4xLS4xMS04LjE5LTE5LjU2Yy02LjUxLTE1LjU0LTYuMDQtMzIuMSwxLjMzLTQ2LjYyWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMzA4LjU3LDExMC4wN2MtLjMtLjI2LS41OC0uNTQtLjg4LS44LS41Ny0uNDktMS4xNS0uOTctMS43NC0xLjQ0LS4yNy0uMjItLjU1LS40Mi0uODMtLjY0LDEuMTcuOTIsMi4zMiwxLjg4LDMuNDUsMi44N1oiLz48cGF0aCBjbGFzcz0iaSIgZD0iTTMwNy43OCwxNzQuMzZjLTEuMzMuNzItMi43OSwxLjQxLTQuMzgsMi4wNi0yLjY1LDEuMDktNS42OCwyLjA1LTkuMTMsMi44LS41Mi4xMS0xLjA0LjIyLTEuNTguMzItLjguMTUtMS42My4yOS0yLjQ4LjQycy0xLjcyLjI0LTIuNjEuMzRsLjQ4LDEuNnMuNTctLjAyLDEuNTctLjA4Yy40LS4wMy44Ni0uMDYsMS4zOS0uMSwxLjA1LS4wOCwyLjMyLS4yLDMuNzUtLjM3LjcyLS4wOCwxLjQ3LS4xOCwyLjI1LS4yOS4zOS0uMDUuNzktLjExLDEuMTktLjE3LDQuNDUtLjY3LDkuNjEtMS43OCwxMy44OC0zLjU4Ljc4LS4zMywxLjUyLS42OCwyLjIzLTEuMDUsMS40MS0uNzUsMi42Ny0xLjYsMy42OS0yLjU2LjI2LS4yNC41LS40OS43Mi0uNzQsMCwwLS4xLDcuNjgtLjIyLDE0LjQ5LS4wMywxLjUxLS4wNSwyLjk4LS4wOCw0LjMxLDAsLjMzLS4wMS42Ni0uMDIuOTctLjA2LDIuODMtLjEyLDQuODUtLjE2LDQuOThoMHMuMDIuMDEuMDUuMDJjMCwwLC4wMiwwLC4wMywwLDAsMCwwLDAsMCwwLDAsMCwuMDEsMCwuMDIsMCwwLDAsMCwwLC4wMSwwLDAsMCwwLDAsLjAxLDAsMCwwLC4wMiwwLC4wMywwLDAsMCwwLDAsMCwwLC4wMSwwLC4wMiwwLC4wNCwwLDAsMCwwLDAsLjAxLDAsLjAxLDAsLjAyLDAsLjAzLDAsLjAxLDAsLjAzLDAsLjA0LDAsMCwwLDAsMCwuMDEsMCwuMDEsMCwuMDMsMCwuMDQtLjAxLDAsMCwuMDEsMCwuMDIsMCwuMDIsMCwuMDQtLjAxLjA2LS4wMiwwLDAsMCwwLDAsMCwuMDEsMCwuMDMtLjAxLjA0LS4wMiwwLDAsLjAyLDAsLjAyLS4wMS4wNC0uMDIuMDgtLjA1LjEyLS4wOCwwLDAsLjAxLDAsLjAyLS4wMS4wNy0uMDUuMTUtLjEyLjIzLS4yMSwwLDAsMCwwLDAsMCwuMDMtLjA0LjA3LS4wOC4xLS4xMiwxLjA1LTEuMzIsMi42NC01Ljk1LDMtMjEuNywwLS4wOSwwLS4xNywwLS4yNi4wNC0xLjY2LjA2LTMuNDYuMDctNS4zOCwwLS41OCwwLTEuMTYsMC0xLjc2LDAtMS41Ni0uMDEtMy4yLS4wNC00LjkzaC0yLjA4cy0xLjE5LDIuMzUtNC4zLDUuMzNjLTEuNDQsMS4zNy0zLjI4LDIuODgtNS42MSw0LjM2LS43OC40OS0xLjYxLjk4LTIuNDksMS40NloiLz48cGF0aCBjbGFzcz0iaSIgZD0iTTI3Ny45MSwyNDQuNDVjLjA0LS4yOS4wOC0uNi4xMi0uOTQuMDMtLjI3LjA3LS41NC4xLS44My4wMy0uMjkuMDctLjU5LjEtLjkxLjA1LS40Mi4wOS0uODYuMTQtMS4zMy4wMy0uMzUuMDctLjcyLjEtMS4xLjA3LS43Ni4xNC0xLjU3LjItMi40NS4wMy0uNDQuMDctLjg5LjEtMS4zNnMuMDctLjk1LjEtMS40NmMuMDMtLjUuMDctMS4wMi4xLTEuNTUuMDQtLjcxLjA5LTEuNDYuMTMtMi4yMy4wNC0uNzcuMDgtMS41OC4xMy0yLjQyLjA0LS44Ni4wOC0xLjc1LjEyLTIuNjcuMDQtLjg3LjA3LTEuNzcuMTEtMi43LjA4LTEuOTYuMTUtNC4wNy4yMi02LjMzLjAyLS41Ny4wMy0xLjE2LjA1LTEuNzUuMDUtMS43Mi4wOS0zLjUyLjE0LTUuNDItLjc3LjI3LTEuNTMuNTMtMi4yNy43OS0uMDMuODktLjA3LDIuMTYtLjEyLDMuNy0uMDIuNzctLjA1LDEuNjEtLjA4LDIuNTEtLjA0LDEuMzUtLjA5LDIuODItLjE0LDQuMzctLjAzLjk3LS4wNiwxLjk3LS4wOSwyLjk5LS4wMywxLjAyLS4wNiwyLjA2LS4wOSwzLjExLS4wMi41Mi0uMDMsMS4wNS0uMDUsMS41OC0uMDMsMS4wNS0uMDYsMi4xMS0uMDksMy4xNi0uMDYsMi4xLS4xMiw0LjE2LS4xNyw2LjExLS4wMy45Ny0uMDUsMS45MS0uMDcsMi44MS0uMDMsMS4zNS0uMDYsMi42MS0uMDgsMy43NCwwLC4yNSwwLC40OS0uMDEuNzMtLjAzLDEuNDItLjA0LDIuNi0uMDQsMy40NCwwLC4xNCwwLC4yNywwLC4zOSwwLC4yOSwwLC41My4wMS43LDAsLjA5LDAsLjE2LjAxLjIxLDAsLjA1LjAxLjA5LjAyLjExaDBzMCwwLDAsMGMwLDAsMCwwLC4wMiwwLDAsMCwuMDIsMCwuMDItLjAxLDAsMCwuMDEsMCwuMDItLjAyLjAxLDAsLjAzLS4wMy4wNC0uMDUuMDEtLjAxLjAyLS4wMi4wMy0uMDMuMDMtLjA0LjA2LS4wOC4wOS0uMTUsMCwwLDAsMCwwLDAsLjAyLS4wMy4wMy0uMDYuMDUtLjEuMTYtLjM0LjM4LTEuMDEuNjMtMi4zMS4wNS0uMjguMTEtLjU4LjE3LS45Mi4wMy0uMjEuMDctLjQzLjExLS42Ny4wNC0uMjMuMDctLjQ4LjExLS43NFoiLz48cGF0aCBjbGFzcz0iaSIgZD0iTTI3Ni42NCwxMTcuNjRjLjQ3LjI1Ljk0LjUxLDEuNC43NywyNi44MSwxNS4xMSwzMy41MSw0My4wNywzNS4xMSw0My4yMS40Mi4wNC41NS0uOTQuNTQtMi4xOCwwLTIuMDYtLjM5LTQuODUtLjM5LTQuODUtMi4xLTEwLjYzLTcuMjctMTguNzItMTMuMzgtMjQuODItLjMxLS4zLS42MS0uNi0uOTItLjktLjkzLS44OS0xLjg4LTEuNzMtMi44NC0yLjUycy0xLjk0LTEuNTUtMi45MS0yLjI3Yy0uNjUtLjQ4LTEuMzEtLjk0LTEuOTYtMS4zOC0uNjUtLjQ0LTEuMzEtLjg3LTEuOTYtMS4yNy0uOTgtLjYxLTEuOTUtMS4xOC0yLjkxLTEuNzItLjk2LS41NC0xLjkxLTEuMDQtMi44NC0xLjUtMi4xNy0xLjA5LTQuMjMtMS45OS02LjEtMi43My0uNTMtLjIxLTEuMDQtLjQtMS41NC0uNTktLjM4LS4xNC0uNzQtLjI3LTEuMS0uNC0uMzUtLjEzLS43LS4yNS0xLjAzLS4zNi0uNDgtLjE2LS45Mi0uMy0xLjM0LS40NC0uODEtLjI2LTEuNTMtLjQ2LTIuMTItLjYzLS4yNy0uMDctLjUtLjE0LS43Mi0uMTktLjA2LS4wMi0uMTMtLjAzLS4xOC0uMDUtLjMtLjA4LS41My0uMTMtLjctLjE3LS4wNCwwLS4wNy0uMDItLjExLS4wMi0uMTQtLjAzLS4yMi0uMDUtLjIyLS4wNWwuNjQsMS42YzIuNjgsMS4wNCw1LjIxLDIuMiw3LjU4LDMuNDZaIi8+PHBhdGggY2xhc3M9ImQiIGQ9Ik0yMTkuMjEsMjgyLjAyYy0uODEtLjc0LTEuNTktMS40Ni0yLjM2LTIuMTgtLjA2LS4wNi0uMTMtLjEyLS4xOS0uMTgtLjkxLS44Ni0xLjgzLTEuNzMtMi42Ni0yLjU1LS43My0uNzItMS40NC0xLjQzLTIuMTEtMi4xMi0uNjgtLjY5LTEuMzMtMS4zNi0xLjk1LTIuMDEtMS4yNC0xLjMtMi4zNy0yLjUzLTMuMzgtMy42Ni0uOS0xLjAxLTEuNzEtMS45NC0yLjQzLTIuNzktLjQyLS41LS44MS0uOTctMS4xNy0xLjQxLS4zOS0uNDgtLjc1LS45Mi0xLjA3LTEuMzItMS40NC0xLjgxLTIuMTYtMi44My0yLjE2LTIuODNsLTMuMzUsNy41MWgwYy4xLjI5LjIyLjU3LjMzLjg2LjI0LjYxLjQ4LDEuMjIuNzUsMS44Mi4wNS4xMi4xMi4yMy4xNy4zNS4xMi4yNi4yNS41Mi4zNy43OC4yNC41MS41LDEuMDEuNzcsMS41MS4wMy4wNS4wNi4xLjA5LjE1LjkyLDEuNjksMS45NywzLjM0LDMuMTIsNC45NS43MS45OSwxLjQ3LDEuOTcsMi4yNiwyLjkyLjA5LjExLjE3LjIxLjI2LjMyLjc4Ljk0LDEuNTksMS44NywyLjQ0LDIuNzguMTEuMTIuMjMuMjIuMzQuMzQuMDUuMDUuMDkuMS4xNC4xNi4wMy4wMy4wNi4wNy4wOS4xLjAyLjAyLjAzLjA0LjA1LjA1cy4wMy4wNC4wNS4wNWMxLjA3LDEuMTIsMi4xOCwyLjIyLDMuMzIsMy4yOC4wMi4wMi4wNC4wNC4wNi4wNi4wMS4wMS4wMi4wMi4wMy4wMy4xOC4xNy4zNi4zMy41NS40OS45LjgyLDEuODIsMS42MywyLjc1LDIuNDIuMy4yNi42LjUyLjkxLjc3LjA0LjA0LjA5LjA3LjEzLjExLjAyLjAyLjA0LjAzLjA2LjA1LDAsMCwwLDAsMCwwLC44Ny43MSwxLjc2LDEuMzgsMi42NSwyLjA2LTQuMDctOS4wOC0xLjA3LTExLjk3LDEuMTUtMTIuODdaIi8+PHBhdGggY2xhc3M9ImkiIGQ9Ik0yOTEuMjcsMjg2LjIyczAsMCwwLDBjLS4wNC4wOC0uMTIuMTctLjIyLjI4LS4wNC4wNC0uMS4xLS4xNS4xNC0uMDguMDgtLjE1LjE1LS4yNS4yNC0uMDcuMDYtLjE2LjEzLS4yNC4yLS4xLjA5LS4yLjE3LS4zMy4yNi0uMS4wOC0uMjEuMTYtLjMyLjI0LS4wMy4wMi0uMDYuMDQtLjA4LjA2LS4xLjA4LS4yLjE1LS4zMi4yNC0uMTMuMDktLjI2LjE5LS40LjI4LS4wOC4wNi0uMTcuMTItLjI2LjE4LS4wNy4wNS0uMTMuMDktLjIuMTQtLjA2LjA0LS4xMi4wOC0uMTguMTItLjA5LjA2LS4xOC4xMi0uMjguMTktLjA5LjA2LS4xOC4xMi0uMjcuMTgtLjA5LjA2LS4xOC4xMi0uMjcuMTgtLjE3LjExLS4zNC4yMi0uNTEuMzQtLjE5LjEyLS4zOC4yNS0uNTguMzgtLjE5LjEyLS4zOS4yNS0uNTkuMzgtLjIxLjEzLS40Mi4yNy0uNjQuNDEtLjA4LjA1LS4xNi4xLS4yMy4xNS0uMTMuMDgtLjI1LjE2LS4zOC4yNC0uMjIuMTQtLjQ1LjI4LS42OC40Mi0uMjMuMTQtLjQ1LjI4LS42OC40Mi0uMjMuMTQtLjQ2LjI4LS42OS40Mi0uMjQuMTUtLjQ4LjMtLjczLjQ1LS4yNS4xNS0uNTEuMzEtLjc2LjQ2LS4yNC4xNS0uNDkuMy0uNzQuNDUtLjA5LjA2LS4xOS4xMS0uMjguMTctLjE1LjA5LS4zLjE4LS40NS4yNy0uMjguMTctLjU2LjM0LS44NC41MS0uMjEuMTMtLjQyLjI1LS42NC4zOC0uMzIuMTktLjY1LjM4LS45OC41OC0uMDcuMDQtLjE0LjA4LS4yMS4xMy0uMTIuMDctLjI0LjE0LS4zNi4yMS0uMjguMTYtLjU2LjMzLS44NC40OS0uMDUuMDMtLjEuMDYtLjE1LjA5LS4wNC4wMy0uMDkuMDUtLjEzLjA4LS4yNi4xNS0uNTEuMy0uNzcuNDUtLjI1LjE1LS41LjI5LS43NS40NC0uMTUuMDktLjMuMTctLjQ0LjI2LS40LjIzLS44MS40Ny0xLjIxLjctLjI4LjE2LS41Ny4zMy0uODUuNDktLjI2LjE1LS41MS4zLS43Ny40NS0uMTcuMS0uMzMuMTktLjQ5LjI4LS4zOC4yMi0uNzYuNDQtMS4xMy42NS0uMi4xMi0uNC4yMy0uNi4zNS0uMTguMS0uMzUuMi0uNTMuMy0uMDguMDUtLjE2LjA5LS4yNS4xNC0uMDQuMDItLjA3LjA0LS4xLjA2LS4xNi4wOS0uMzIuMTgtLjQ4LjI3LS4yMS4xMi0uNDIuMjQtLjYzLjM2LS4wOC4wNS0uMTcuMS0uMjUuMTUtLjA5LjA1LS4xNy4xLS4yNS4xNS0uMTcuMS0uMzQuMTktLjUuMjktLjE3LjEtLjM0LjE5LS41LjI5LS4xNi4wOS0uMzEuMTgtLjQ3LjI2LS4zMy4xOS0uNjUuMzctLjk3LjU1LS4xNi4wOS0uMzIuMTgtLjQ4LjI3LS4wMSwwLS4wMi4wMS0uMDMuMDItLjI3LjE2LS41NC4zMS0uODEuNDYtLjIyLjEzLS40NC4yNS0uNjYuMzctLjIxLjEyLS40MS4yMy0uNjEuMzUtLjIyLjEyLS40My4yNC0uNjMuMzYtLjI1LjE0LS41MS4yOC0uNzUuNDItLjA3LjA0LS4xMy4wOC0uMi4xMS0uMDMuMDEtLjA1LjAzLS4wOC4wNC0uODYuNDktMS42NC45Mi0yLjMsMS4yOXMtMS4yMS42OC0xLjYzLjkxYy0uMjMuMTMtLjQzLjI0LS41Ny4zMi0uMDMuMDItLjA2LjAzLS4wOS4wNS0uMTcuMS0uMjcuMTUtLjI3LjE1LDAsMC0uMDIsMC0uMDMtLjAxLDAsMCwwLDAtLjAyLDAtLjU1LS4yNi0xLjA3LS41Mi0xLjU5LS43OC0uMzItLjE2LS42NC0uMzItLjk2LS40Ny0uNTUtLjI3LTEuMS0uNTUtMS42NC0uODItLjMyLS4xNi0uNjQtLjMyLS45Ni0uNDgtLjA4LS4wNC0uMTYtLjA4LS4yNC0uMTItMS4wMy0uNTItMi0xLjAzLTIuOTYtMS41My0uNzEtLjM3LTEuNDEtLjc0LTIuMDgtMS4xLTEuNTUtLjgzLTMtMS42My00LjM2LTIuNC0xLjM2LS43Ny0yLjY0LTEuNTEtMy44NC0yLjIyLS4xMy0uMDctLjI1LS4xNS0uMzgtLjIyLS43NC0uNDQtMS40NS0uODctMi4xMi0xLjI5LS4wNS0uMDMtLjA5LS4wNi0uMTQtLjA5LS4xLS4wNi0uMTktLjEyLS4yOC0uMTgtLjg1LS41My0xLjY1LTEuMDUtMi40MS0xLjU0LS41My0uMzUtMS4wNS0uNjktMS41My0xLjAyLS40MS0uMjgtLjgxLS41NS0xLjE5LS44Mi0uMDEsMC0uMDMtLjAyLS4wNC0uMDMtLjA2LS4wNC0uMTEtLjA4LS4xNy0uMTEtLjUtLjM1LS45Ny0uNjgtMS40MS0xLTMuMjEtMi4zNC00LjkzLTMuOTMtNS42Ny00LjY4LS4xMS0uMTEtLjE5LS4yLS4yNi0uMjcsMCwwLS4wMi0uMDItLjAzLS4wMy0uMTItLjEzLS4xNy0uMTktLjE3LS4xOSwwLDAsMCwwLDAsMCwxLjMxLjYyLDQsMS43OSw2LjQzLDIuODQuNzQuMzIsMS40Ni42MywyLjEuOTEuMjIuMS40NC4xOS42NC4yOC45NC40LDEuNjcuNzIsMS45OC44NS4wNy4wMy4xMi4wNS4xNS4wNi4wMiwwLC4wNC4wMi4wNC4wMmgwLDBjLTEuNTgtMS4yMi0zLjA4LTIuNDMtNC41My0zLjYyLS4yNi0uMjEtLjUxLS40Mi0uNzYtLjYzLS4xNS0uMTMtLjMxLS4yNi0uNDYtLjM5LS43Ny0uNjQtMS41Mi0xLjI4LTIuMjUtMS45MS0uMjktLjI1LS41OS0uNS0uODctLjc1LS4zNC0uMy0uNjktLjYtMS4wMi0uODktLjU2LS40OS0xLjA4LS45Ny0xLjYtMS40NS0uMTYtLjE1LS4zMy0uMy0uNDktLjQ1LTIuMjIuOTEtNS4yMiwzLjgtMS4xNSwxMi44Ny41Ny40NCwxLjEyLjksMS42OSwxLjMyLDAsMCwwLDAsMCwwLC4wNy4wNS4xNC4xLjIxLjE1LDEuMjguOTUsMi41OCwxLjg1LDMuODcsMi43My4yMS4xNC40MS4zLjYyLjQ0LjE5LjEzLjM4LjI0LjU2LjM2LjA3LjA0LjEzLjA4LjIuMTMuMTUuMS4zLjE5LjQ1LjI5LDEsLjY2LDEuOTksMS4zMSwyLjk4LDEuOTIuNDEuMjYuODIuNTEsMS4yMy43Ni41NS4zNCwxLjA4LjY1LDEuNjIuOTcuNTQuMzIsMS4wOS42NiwxLjYyLjk3LjEyLjA3LjI0LjE0LjM3LjIxLjM0LjE5LjY3LjM5LDEsLjU4LDEuMi42OCwyLjM4LDEuMzQsMy41MywxLjk2LjMyLjE3LjYyLjMzLjk0LjUuOTUuNTEsMS44OC45OSwyLjc3LDEuNDUuMTkuMS40LjIxLjU4LjMuMTQuMDcuMjYuMTMuMzkuMTkuMDcuMDMuMTMuMDYuMi4xLjA3LjA0LjE0LjA3LjIyLjExLjI5LjE1LjU4LjI5Ljg3LjQzLjQ0LjIyLjg4LjQzLDEuMy42NC40MS4yLjc5LjM4LDEuMTguNTYuMzMuMTYuNjcuMzIuOTkuNDcuMzUuMTYuNjguMzEsMSwuNDYuMDguMDQuMTcuMDguMjUuMTEuMjMuMTEuNDguMjIuNy4zMi4xMS4wNS4yMS4xLjMyLjE0LjMyLjE0LjYyLjI4LjkyLjQxLjE0LjA2LjI5LjEzLjQzLjE5LjQ1LjIuODUuMzcsMS4yMS41Mi4wMSwwLC4wMy4wMS4wNC4wMi4wNC4wMi4wNy4wMy4xLjA1LjM2LjE1LjY2LjI4LjkyLjM5LjAzLjAxLjA3LjAzLjExLjA0LDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLC4xNC4wNi4yNy4xMS4zOC4xNS4zMy4xMy41MS4yLjUxLjIsMS4yLS41MSwyLjM3LTEuMDQsMy41Mi0xLjYuODctLjQyLDEuNzMtLjg2LDIuNTctMS4zLDIuNDctMS4zLDQuODEtMi42OCw3LTQuMTEuNjktLjQ1LDEuMzYtLjkxLDIuMDItMS4zNiwxMC42Mi03LjMzLDE3LjYxLTE1LjQ0LDIwLjQyLTE5aDBzMCwwLDAsMGMwLDAsMCwwLDAsMCwuOTItMS4xNywxLjM5LTEuODUsMS40LTEuODVoMFoiLz48cGF0aCBjbGFzcz0iaSIgZD0iTTMwOS40OCwyNjQuNTdzLS4wMi0uMDMtLjAzLS4wNGMtLjE4LS4yMi0uMjgtLjM1LS4yOC0uMzUuMTIsMi43MS0uMjMsNS4zMS0uODIsNy42OS0uMDQuMTYtLjA4LjMxLS4xMi40Ny0uNjQsMi40NS0xLjUzLDQuNjUtMi40Myw2LjQ5LS4xNS4zMS0uMy42LS40NC44OS0uMTMuMjUtLjI2LjUtLjM5LjczLTEuNDMsMi42MS0yLjY3LDQuMTgtMi42Nyw0LjE4LDIuNTYtLjMyLDEwLjIyLTcuMDMsMTAuMjItNy4wM2w3LjUxLDcuODNjLS4yMywxLjY5LS45NiwzLjY2LTEuOTQsNS42OS0uNDUuOTQtLjk2LDEuODktMS41LDIuODMtLjMxLjU0LS42MywxLjA4LS45NSwxLjYxLS42NSwxLjA2LTEuMzIsMi4wOS0xLjk3LDMuMDUtLjY1Ljk2LTEuMjksMS44Ni0xLjg3LDIuNjYtMS42LDIuMi0yLjc5LDMuNjUtMi43OSwzLjY1djEuNDRjMS4zOC0uNzMsMi43NS0xLjc3LDQuMDctMy4wMS4yMi0uMjEuNDQtLjQyLjY2LS42NC4zMy0uMzMuNjUtLjY2Ljk3LTEuMDEsMS45My0yLjA4LDMuNzItNC40OSw1LjI5LTYuODUuNzgtMS4xOCwxLjUxLTIuMzQsMi4xNi0zLjQzLjY2LTEuMDksMS4yNC0yLjEyLDEuNzQtMy4wNC4zNC0uNjEuNjMtMS4xNy44OS0xLjY2LjEzLS4yNS4yNS0uNDguMzYtLjY5LjUxLS45OS43OC0xLjU3Ljc4LTEuNTctLjAyLS4zOC0uMjMtLjg1LS41OC0xLjM5LS43OS0xLjItMi4zLTIuNzMtMy45OS00LjI0LTMuNTYtMy4yLTcuODktNi4zNS03Ljg5LTYuMzUsMC0xLjItLjYxLTIuNjctMS4zNi00LjAzLS4yOC0uNS0uNTgtLjk4LS44Ny0xLjQ0LS4wNC0uMDYtLjA4LS4xMy0uMTItLjE5LS4wMi0uMDQtLjA1LS4wNy0uMDctLjExLS4xNy0uMjUtLjM0LS40OS0uNS0uNzItLjQzLS42MS0uODItMS4xMS0xLjA3LTEuNDNaIi8+PHBhdGggY2xhc3M9ImkiIGQ9Ik0yOTEuNDgsMjMyLjc0Yy4wMi0uMTYuMDUtLjMzLjA3LS41LjA1LS4zNC4xLS43LjE1LTEuMDguMDgtLjU3LjE1LTEuMTguMjMtMS44NS4wNC0uMzMuMDgtLjY4LjExLTEuMDMuMDQtLjM2LjA4LS43My4xMS0xLjExLjA0LS4zOC4wOC0uNzguMTEtMS4xOS4wNC0uNDEuMDgtLjgzLjExLTEuMjcuMTMtMS40Ni4yNS0zLjA4LjM4LTQuODcuMDgtMS4xMS4xNS0yLjI4LjIzLTMuNTIuMjItMy41OS40Mi03Ljc1LjYxLTEyLjYxLDAsMCwwLDAsMCwwLS42My4yNy0xLjI3LjUzLTEuOS44LS4xMy4wNS0uMjYuMTEtLjM5LjE2aDBjMCwuMTYtLjAyLjMzLS4wMy41MS0uMDYsMS4yNS0uMTUsMi45OS0uMjUsNS4wMS0uMDIuNDEtLjA0LjgyLS4wNiwxLjI1LS4xLDIuMDMtLjIxLDQuMjgtLjMxLDYuNTktLjExLDIuMzYtLjIyLDQuNzgtLjMyLDcuMDktLjAyLjUyLS4wNCwxLjAzLS4wNywxLjUzcy0uMDQsMS0uMDYsMS40OGMtLjA0Ljk3LS4wOCwxLjkxLS4xMSwyLjc5LS4wMi41OS0uMDQsMS4xNS0uMDYsMS42OS0uMDEuMzYtLjAzLjctLjA0LDEuMDMtLjAxLjM0LS4wMi42Ny0uMDMuOTgtLjAyLjU5LS4wMywxLjEzLS4wNCwxLjYtLjAxLjQ3LS4wMi44Ny0uMDIsMS4xOSwwLC4xNiwwLC4zLDAsLjQyLDAsLjEyLDAsLjIxLjAxLjI4LDAsLjA3LjAxLjEyLjAyLjE1aDBzMCwwLDAsMGMwLDAsLjAyLDAsLjA1LS4wMiwwLDAsMCwwLDAsMCwwLDAsMCwwLC4wMSwwLC4wMy0uMDIuMDctLjA1LjEyLS4xMi4wMi0uMDMuMDUtLjA2LjA3LS4xMS4wMS0uMDIuMDMtLjA0LjA0LS4wNy4wMy0uMDUuMDYtLjEuMDktLjE3LjA2LS4xMy4xMy0uMjkuMi0uNS4wNC0uMS4wNy0uMjEuMTEtLjM0LjA1LS4xNy4xMS0uMzYuMTYtLjU4LjExLS40NC4yMy0uOTcuMzYtMS42My4wNi0uMzMuMTMtLjY5LjE5LTEuMDguMDUtLjI4LjEtLjU5LjE0LS45MVoiLz48cGF0aCBjbGFzcz0iaSIgZD0iTTMxMS45OSwyMzguNTljLS4xNS0uMTUtLjMtLjMtLjQ1LS40NS0uMzUtLjM1LS42OS0uNjktLjk4LS45OC0uMTktLjE5LS4zNi0uMzctLjUtLjUxLS4yNi0uMjctLjQyLS40My0uNDItLjQzLjI0LS40Mi40OS0xLjE3Ljc1LTIuMTcuMTktLjc1LjM5LTEuNjMuNTktMi42Mi4yLS45OS4zOS0yLjA3LjU5LTMuMjIuMTMtLjc2LjI2LTEuNTYuMzgtMi4zNi4xMy0uODEuMjUtMS42My4zNy0yLjQ2LjA3LS40Ny4xNC0uOTMuMi0xLjQuMjMtMS42MS40NC0zLjIxLjY0LTQuNzIuNTYtNC4zLjk3LTcuODgsMS4wOC04Ljg4LjAyLS4xOC4wMy0uMjguMDMtLjI4LDAsMCwwLS4wNC0uMDItLjExLS4wMS0uMDctLjA0LS4xNy0uMDctLjI3LS4wMy0uMTEtLjA2LS4yMy0uMTEtLjM1LS4wNi0uMTgtLjE0LS4zNC0uMjMtLjQ1LS4wNi0uMDctLjEzLS4xMi0uMi0uMTItLjE4LS4wMS0uNC4yNC0uNjUuOTktLjA1LjE1LS4xMi40LS4yMi43My0uMjguOTktLjc2LDIuNzUtMS4zNCw0LjkzLS4xOS43My0uNCwxLjUtLjYyLDIuMzEtLjQzLDEuNjItLjkxLDMuMzktMS4zOSw1LjE5LS4yMS43OC0uNDMsMS41Ny0uNjQsMi4zNi0uMjgsMS4wNC0uNTcsMi4wOC0uODUsMy4xLS4xMi40NS0uMjUuOS0uMzcsMS4zNC0uMjUuODgtLjQ5LDEuNzQtLjczLDIuNTgtLjI0LjgzLS40NywxLjYzLS42OSwyLjM4LS4xMS4zOC0uMjIuNzQtLjMzLDEuMS0uMTkuNjItLjM3LDEuMi0uNTQsMS43My0uMDUuMTUtLjA5LjI5LS4xNC40My0uNTQsMS42Ny0uOTgsMi44MS0xLjI0LDMuMTNsMy42NywyLjU2cy4wMi4wOS4wMS4xNmMwLC4wMy0uMDIuMDctLjAzLjExLS4wMS4wNi0uMDMuMTItLjA2LjE5LS4wOC4yMy0uMjIuNTMtLjQxLjg5LS4xMy4yNS0uMjkuNTItLjQ3LjgxLS4yNS40MS0uNTMuODctLjg1LDEuMzUtLjA3LjExLS4xNS4yMy0uMjIuMzQtLjE5LjI4LS4zOC41Ny0uNTguODctLjM4LjU1LS43OCwxLjEzLTEuMTksMS43Mi0uMzQuNDgtLjY5Ljk3LTEuMDQsMS40NSwwLC4wMS0uMDIuMDMtLjAzLjA0LS4wMi4wMy0uMDQuMDYtLjA2LjA5LS40NS42Mi0uOSwxLjI0LTEuMzQsMS44NC0uMDIuMDMtLjA1LjA2LS4wNy4wOS0uMDIuMDMtLjA0LjA2LS4wNy4wOS0uMTIuMTYtLjI0LjMzLS4zNi40OS0uMTQuMTktLjI4LjM4LS40Mi41Ny0uMTEuMTUtLjIzLjMxLS4zNC40Ni0uMjEuMjktLjQyLjU2LS42Mi44My0uMTEuMTUtLjIxLjI4LS4zMi40Mi0uMTMuMTctLjI1LjMzLS4zNy40OS0uMDkuMTItLjE5LjI1LS4yNy4zNi0uMTguMjMtLjM0LjQ1LS41LjY2LS4wOS4xMi0uMTcuMjItLjI1LjMyLS4wOC4xMS0uMTYuMjEtLjIzLjMxLS4wNC4wNS0uMDkuMTEtLjEyLjE2LDAsMCwwLC4wMS0uMDIuMDItLjAzLjA0LS4wNS4wNi0uMDcuMDksMCwwLS4wMS4wMi0uMDIuMDItLjAyLjAzLS4wNC4wNS0uMDYuMDgtLjEzLjE3LS4yNS4zMi0uMzMuNDMtLjExLjE1LS4xNy4yMi0uMTcuMjIsMi44OS0xLjg3LDcuOC02LjQ0LDExLjc3LTEwLjMxLjIzLS4yMy40Ni0uNDUuNjktLjY4LjQ1LS40NC44OS0uODgsMS4zMS0xLjI5LjIxLS4yMS40MS0uNDEuNjEtLjYxLjItLjIuMzktLjM5LjU4LS41OCwxLjg2LTEuODcsMy4wOS0zLjE1LDMuMDktMy4xNS0uMDMsMC0uMDctLjAzLS4xMy0uMDYtLjQ1LS4yNi0xLjU3LTEuMzItMi42My0yLjM2WiIvPjxwYXRoIGNsYXNzPSJtIiBkPSJNMTk5LjA0LDI0OC4yMXMuMDkuMDkuMTMuMTRjMS42LDEuNjYsMy4xNiwzLjIxLDQuNzIsNC43Ni4wMi4wMi4wNC4wNC4wNi4wNi0xLjY0LTEuNjMtMy4yOS0zLjI5LTQuOTgtNS4wMy4wMi4wMi4wNS4wNS4wNy4wN1oiLz48cGF0aCBjbGFzcz0ibSIgZD0iTTI1NC4xNSwxNTAuOTZzLjA2LS4wNC4wNi0uMDRoMHMtLjA4LjA2LS4xNi4xMmMuMDQtLjAzLjA4LS4wNS4xLS4wN1oiLz48cG9seWdvbiBjbGFzcz0ibSIgcG9pbnRzPSIyNTQuMjEgMTkyLjYxIDI1NC4yMSAxOTIuNjEgMjU0LjE2IDE5Mi42IDI1NC4yMSAxOTIuNjEiLz48cG9seWdvbiBjbGFzcz0ibSIgcG9pbnRzPSIyMjIuOTYgMTg2LjYgMjEyLjY4IDE4NC42MiAyMTIuNjggMTg0LjYzIDIxMi42OCAxODQuNjMgMjEyLjY4IDE4NC42MyAyNDQuNjQgMTkwLjc3IDI0NC42NCAxOTAuNzcgMjIyLjk2IDE4Ni42Ii8+PHBvbHlnb24gY2xhc3M9Im0iIHBvaW50cz0iMjQ3LjAzIDIwOC4zIDI0Ny4wMiAyMDguMTEgMjQ0LjE2IDIwNi45MiAyMzEuNjMgMjAxLjczIDIyNi4xNiAxOTkuNDYgMjA0LjUgMTkwLjQ5IDIwMC4zOCAxODguNzggMjAwLjM4IDE4OC43OCAyNDcuMDIgMjA4LjExIDI0Ny4wMyAyMDguMyIvPjxwb2x5Z29uIGNsYXNzPSJtIiBwb2ludHM9IjIwNy40NCAyMTMuODUgMjA3LjY3IDIzMy4zOCAyMDcuMjggMjAwLjg0IDIwNy40NCAyMTMuODUiLz48cGF0aCBjbGFzcz0ibSIgZD0iTTI1Mi41MiwyOTIuM2MuMDkuMDUuMTcuMS4yNS4xNS0uMS0uMDYtLjItLjEyLS4zMS0uMTguMDIuMDEuMDQuMDIuMDYuMDNaIi8+PHBhdGggY2xhc3M9ImkiIGQ9Ik0yNTMuODEsMjg4LjExbC0uMDMsNC45Yy4wOC4wNC4xNC4wOC4yLjExLjA1LjAzLjEuMDUuMTIuMDcuMDMuMDEuMDMuMDEuMDQuMDIuMDEsMCwuMDcuMDQuMDcuMDQsNS4yNi00LjA1LDkuNDMtNy41LDEyLjctMTAuMzYuMDktLjA4LjItLjE3LjI5LS4yNS4yNi0uMjMuNDktLjQ0Ljc0LS42Ni40NC0uMzkuODYtLjc2LDEuMjYtMS4xMywxLjA4LS45NywyLjA0LTEuODcsMi44Ny0yLjY2LjAzLS4wMy4wNi0uMDYuMDktLjA4LjIyLS4yMS40My0uNDIuNjQtLjYxLDEuNDMtMS4zOSwyLjQ3LTIuNDYsMy4xNi0zLjIxaDBzMCwwLDAsMGMuMTEtLjExLjE4LS4yLjI3LS4zLjI1LS4yOC40Ny0uNTIuNjEtLjY4LjEtLjExLjE2LS4xOS4yMS0uMjUuMDUtLjA2LjA3LS4wOC4wNy0uMDhoMHMtMTUuNzYsMTAuNTQtMTUuNzYsMTAuNTRsLTcuMTcsNC43OWgwdi01Ny43MWwtLjA1LDYuNTQtLjM2LDUwLjk5WiIvPjxwYXRoIGNsYXNzPSJtIiBkPSJNMTg5LjUyLDE5Ni43N2gwcy0uMDEsMC0uMDMuMDFjLjAyLDAsLjAzLS4wMS4wMy0uMDFaIi8+PHBvbHlnb24gY2xhc3M9Im0iIHBvaW50cz0iMTkwLjk1IDE3Ni40OCAxOTAuOTUgMTc2LjQ4IDE5MC45NSAxNzYuNDggMTkwLjk1IDE3Ni40OCAxOTAuOTUgMTc2LjQ4Ii8+PHBhdGggY2xhc3M9ImUiIGQ9Ik0yMDEuNTIsMTkxLjM4Yy4yNS40My41Ljg2Ljc5LDEuMjcuMTQuMi4yOS40LjQzLjYuMzEuNDEuNjIuOC45NCwxLjE3LjEyLjE0LjIzLjI4LjM1LjQxLjQyLjQ3Ljg1LjkxLDEuMjMsMS4yOS4yNS4yNC40OC40NS42OS42NS4wNS4wNC4xLjA5LjE0LjEzLjIxLjE5LjQuMzYuNTYuNS4wMi4wMi4wNC4wNC4wNy4wNi4zMi4yNy41My40NC41My40NGwuMDQsMi45NS4zOSwzMi41NC4wNSw0LjQ0LDguMzEsNi43MS0uOS0yNi44NS0uNTMtMTUuOGgwczUuMTYsMi4zMyw1LjE2LDIuMzNsMi45OSwxLjM1aDB2NDMuMTNsNS43MSw0LjExLDIuMjgsMS42NHYtLjk0cy0uMzEtMjguMTktLjMxLTI4LjE5bC0uMTYtMTUuMjR2LS41MXMwLDAsMCwwbDUuMjksMS45NSwyLjA2Ljc2aDB2NDYuMzJsMS41NSwxLjA1LDUuMDEsMy40MSwxLjQzLjk3di01MS4xMmgwczEuNi0xLjQ0LDEuNi0xLjQ0bC0uMTUtMy4xNnYtLjE5cy00Ni42NS0xOS4zMy00Ni42NS0xOS4zM2MuMTguNjguNDYsMS4zNC43OSwxLjk5LjExLjIxLjIzLjQxLjM1LjYyWiIvPjxwYXRoIGNsYXNzPSJpIiBkPSJNMjI4Ljg0LDExNS40NWMtMS4yMS43NC0yLjM1LDEuNDktMy40NSwyLjI1LS4zNC4yNC0uNjcuNDgtMSwuNzItLjc1LjU0LTEuNDgsMS4wOC0yLjE4LDEuNjMtLjM0LjI3LS42OS41NC0xLjAyLjgyLS42OC41Ni0xLjM0LDEuMTItMS45NywxLjY5LS4yNy4yNC0uNTUuNDgtLjgxLjcyLS44Ni44LTEuNjksMS42MS0yLjQ2LDIuNDMtLjA2LjA2LS4xMS4xMi0uMTYuMTgtLjcxLjc2LTEuMzgsMS41My0yLjAyLDIuMy0uMjIuMjctLjQyLjUzLS42My44LS40Ni41OC0uOSwxLjE2LTEuMzIsMS43NS0uMjEuMjktLjQxLjU4LS42MS44Ny0uNDEuNjEtLjgsMS4yMi0xLjE4LDEuODMtLjE1LjI0LS4zLjQ4LS40NC43Mi0uNS44NC0uOTYsMS42OS0xLjM5LDIuNTMtLjA0LjA5LS4wOC4xOC0uMTMuMjctLjM4Ljc2LS43MiwxLjUyLTEuMDQsMi4yOC0uMTEuMjYtLjIxLjUyLS4zMS43Ny0uMjQuNi0uNDcsMS4yLS42OCwxLjgtLjA5LjI3LS4xOS41My0uMjcuOC0uMjEuNjQtLjQsMS4yOC0uNTgsMS45Mi0uMDUuMTktLjExLjM4LS4xNi41Ny0uMjIuODQtLjQyLDEuNjctLjU4LDIuNDktLjAxLjA2LS4wMi4xMS0uMDMuMTctLjE1Ljc1LS4yOCwxLjUtLjM4LDIuMjQtLjAzLjIxLS4wNi40Mi0uMDguNjMtLjA4LjYtLjE1LDEuMTktLjIsMS43OC0uMDIuMi0uMDQuNDEtLjA1LjYxLS4wNS42NS0uMDksMS4zLS4xMiwxLjkzLDAsLjEtLjAxLjIxLS4wMS4zMS0uMDMuNzctLjAzLDEuNTMtLjAyLDIuMjd2LS4wM3MwLC4xLDAsLjI0YzAsLjA1LDAsLjA5LDAsLjE0LDAsLjM2LjAyLjcxLjAzLDEuMDZoMGMuMjEsMy4zMSwxLjY0LDExLjQxLDEwLjcsMTIuNzhoMHMwLDAsMCwwaDBjMS4wNC0uMjQsMi4xMS0uNTUsMy4yLS44OS4xOC0uMDYuMzctLjEzLjU1LS4xOS42MS0uMiwxLjIyLS40MSwxLjg0LS42My4zMi0uMTEuNjQtLjIzLjk2LS4zNS4xMi0uMDUuMjUtLjEuMzctLjE1LDEuMDItLjM5LDIuMDUtLjgxLDMuMDktMS4yNi4wMy0uMDEuMDUtLjAyLjA4LS4wMywxLjA0LS40NSwyLjA4LS45MywzLjExLTEuNDIuMS0uMDUuMi0uMDkuMy0uMTMuMjUtLjEyLjUtLjI1Ljc1LS4zNy4xOC0uMDkuMzUtLjE4LjUzLS4yNi41Mi0uMjYsMS4wNS0uNTEsMS41Ny0uNzguMzctLjE5Ljc0LS4zOCwxLjExLS41Ny4xMi0uMDYuMjQtLjEzLjM2LS4xOS41OC0uMywxLjE2LS42MSwxLjc0LS45Mi4zMS0uMTcuNjItLjMzLjkzLS41LDItMS4xLDMuOTQtMi4yMSw1Ljc3LTMuMjkuMjYtLjE1LjUtLjMuNzUtLjQ1LjY3LS40LDEuMzItLjgsMS45Ni0xLjE5LjE4LS4xMS4zNS0uMjEuNTItLjMyLjA4LS4wNS4xNS0uMS4yMy0uMTQuMTQtLjA4LjI2LS4xNi4zOS0uMjUuNTEtLjMyLDEuMDEtLjYzLDEuNDktLjk0LjEzLS4wOC4yNi0uMTcuMzktLjI1LjAzLS4wMi4wNy0uMDQuMTEtLjA3LjI1LS4xNi41LS4zMi43NC0uNDgsMS4yOC0uODIsMi40My0xLjU4LDMuNC0yLjIzLDAsMCwwLDAsMCwwaDBjMy43NS0yMC42OC0yLjE5LTQ0LjAyLTQuNTUtNTIuMDIsMCwwLDAsMCwwLDAtLjgzLjg5LTEuNTUsMS43OC0yLjE2LDIuNi0uMi4yNy0uMzkuNTQtLjU3Ljc5LS4yNC4zNC0uNDUuNjYtLjY0Ljk0LS42Mi45NS0uOTgsMS42LTEuMDIsMS42OSwwLDAsMCwuMDEtLjAxLjAyLDAsMC0uMDEuMDItLjAxLjAyLjA0LjA0LjA3LjA4LjEuMTIuNjkuNzEsMS4zMSwxLjU0LDEuODgsMi40NS4yOC40NS41NS45Mi44LDEuNDEsMS45NSwzLjczLDMuMTIsOC40MiwzLjgsMTIuMjkuMDkuNTEuMTcsMS4wMS4yNSwxLjQ5LjE5LDEuMjIuMzMsMi4zMi40MywzLjIzaDBjLjE4LDEuNjMuMjQsMi42Ni4yNCwyLjY2LDAsMCwwLDAsMCwwaDBjLS4yLTIuMDItLjgyLTQuMTYtMS42NC02LjI0LS4xNC0uMzctLjI5LS43My0uNDUtMS4xLS4xNy0uNC0uMzUtLjgtLjUzLTEuMTktLjQ5LTEuMDUtMS4wMS0yLjA4LTEuNTMtMy4wMy0uNDctLjg3LS45NS0xLjY4LTEuNC0yLjQzLS4xNS0uMjUtLjMtLjQ5LS40NC0uNzItLjEzLS4yMS0uMjYtLjQxLS4zOC0uNi0uMjUtLjM5LS40OC0uNzUtLjctMS4wNy0uMTEtLjE2LS4yMS0uMzItLjMxLS40Ni0uMjYtLjM5LS40OS0uNzEtLjY2LS45NS0uMjYtLjM3LS40MS0uNTctLjQxLS41Ny0uOTUuMDktMS44OS4yMi0yLjgyLjM3LS4wNy4wMS0uMTUuMDItLjIyLjAzLS43OC4xMy0xLjU0LjI5LTIuMy40NS0uMDEsMC0uMDIsMC0uMDQsMC0uMTguMDQtLjM3LjA3LS41NS4xMS0xLjg5LjQzLTMuNzIuOTYtNS40OCwxLjU5LDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLS4xMy4wNC0uMjUuMS0uMzcuMTVaIi8+PHBhdGggY2xhc3M9ImQiIGQ9Ik0yNDguMDMsOTkuNDZjLS43My42Mi0xLjQsMS4yOC0yLjAyLDEuOTR0MCwwYzIuMzUsOCw4LjI5LDMxLjM0LDQuNTUsNTIuMDIsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsLjE5LS4xMy4zNi0uMjQuNTMtLjM2LjEzLS4wOS4yNS0uMTcuMzctLjI1LjIxLS4xNC40MS0uMjguNTktLjQuMDItLjAyLjA0LS4wMy4wNi0uMDQuNDItLjI5Ljc5LS41NCwxLjA4LS43NSwwLDAsLjAxLS4wMS4wMi0uMDIsMCwwLC4wMi0uMDEuMDMtLjAyLjM3LS4yNi42LS40Mi43Ni0uNTMsMCwwLC4wMi0uMDEuMDItLjAyLjA5LS4wNi4xNi0uMTIuMTYtLjEydi00My4xN2gwdi0xMS40NmgwYy0yLjAyLjM5LTMuODcsMS4zOC01LjQ5LDIuNjItLjIzLjE4LS40Ni4zNi0uNjguNTUsMCwwLDAsMCwwLDBaIi8+PHBhdGggY2xhc3M9ImkiIGQ9Ik0yNTQuMjEsMTYwLjc0YzkuNDIsNC42MSwxNi4xOCw3LjI1LDIwLjk0LDguNzYsMCwwLC4wMSwwLC4wMiwwLDMuMTMuOTksNS4zOSwxLjQ5LDcsMS43My4wMiwwLC4wNSwwLC4wOC4wMS4zNy4wNS42OS4wOS45OS4xMi4wMywwLC4wNiwwLC4wOS4wMS45MS4wOSwxLjQ4LjA3LDEuODIuMDQsMCwwLDAsMCwwLDAsLjEzLS4wMS4yMi0uMDIuMjktLjAzLjA2LS4wMS4wOS0uMDIuMDktLjAyaDBjLTMuNjctMS4zNi03LjI0LTIuODktMTAuNTgtNC40My0uNDgtLjIyLS45NS0uNDQtMS40Mi0uNjYtLjkzLS40NC0xLjg1LS44OS0yLjc0LTEuMzMtOS43OS00Ljg2LTE2Ljc0LTkuMzktMTYuNzQtOS4zOWwuMTYsNS4xOWgwWiIvPjxwYXRoIGNsYXNzPSJpIiBkPSJNMjU0LjQxLDIwMi4zaDBjLjc4LS4yMywxLjUzLS40NSwyLjI5LS42NywxLjM4LS40MSwyLjczLS44MSw0LjAyLTEuMi45OS0uMywxLjk2LS42LDIuOS0uODksNC42OS0xLjQ1LDguNy0yLjc2LDEyLjE0LTMuOTYuNTgtLjIsMS4xNS0uNCwxLjctLjYuNDctLjE3LjkxLS4zMywxLjM2LS40OS4yMi0uMDguNDQtLjE2LjY2LS4yNC41My0uMTksMS4wNi0uMzksMS41NS0uNTcuMDMtLjAxLjA2LS4wMi4wOS0uMDMsMCwwLC4wMSwwLC4wMiwwLC4xNS0uMDYuMjktLjExLjQ0LS4xNy40OC0uMTguOTYtLjM3LDEuNDEtLjU0LjAyLDAsLjAzLS4wMS4wNS0uMDIuMDEsMCwuMDMtLjAxLjA0LS4wMi40MS0uMTYuNzktLjMxLDEuMTgtLjQ3LjE5LS4wOC40LS4xNi41OS0uMjQuMjYtLjExLjUtLjIuNzQtLjMxLjY1LS4yNywxLjI4LS41MywxLjg2LS43OS4xNC0uMDYuMy0uMTMuNDQtLjE5LjktLjQsMS43LS43NywyLjQxLTEuMTIsMCwwLC4wMSwwLC4wMiwwLC4yNi0uMTMuNDktLjI0LjcyLS4zNi4wNC0uMDIuMDgtLjA0LjEyLS4wNi4wNi0uMDMuMTEtLjA2LjE3LS4wOC4xNi0uMDguMzEtLjE2LjQ2LS4yNC4yMi0uMTIuNDMtLjIzLjYyLS4zNC4xNS0uMDguMy0uMTcuNDQtLjI1LjAzLS4wMi4wNi0uMDQuMS0uMDUuMDEsMCwuMDMtLjAxLjA0LS4wMi4xOC0uMS4zMy0uMi40OS0uMy4wNC0uMDMuMDktLjA2LjE0LS4wOC4wMSwwLC4wMi0uMDEuMDMtLjAyLjI5LS4xOS41NS0uMzYuNzgtLjUyLjIzLS4xNi40Mi0uMzEuNTktLjQ1LjAxLDAsLjAzLS4wMi4wNC0uMDMuMDUtLjA0LjA5LS4wOC4xMy0uMTEuMDItLjAyLjA0LS4wNC4wNy0uMDYuMDQtLjAzLjA4LS4wNy4xMS0uMS4wNC0uMDQuMDgtLjA4LjEyLS4xMi4wMi0uMDIuMDMtLjAzLjA1LS4wNS4wMi0uMDIuMDUtLjA1LjA3LS4wNy4wNS0uMDYuMDktLjExLjEzLS4xNi4wMS0uMDIuMDMtLjA0LjA0LS4wNS4wMi0uMDMuMDQtLjA2LjA2LS4wOSwwLDAsLjAxLS4wMi4wMi0uMDIuMDItLjAyLjA0LS4wNS4wNS0uMDcuMDEtLjAyLjAyLS4wMy4wMy0uMDUuMTMtLjIyLjE0LS4zNS4xNC0uNDEsMC0uMDIsMC0uMDMsMC0uMDMsMCwwLDAsMCwwLDBsLTQxLjYyLDExLjkxLS4wMyw0LjhaIi8+PHBhdGggY2xhc3M9Im0iIGQ9Ik0yMDYuMDIsMTcyLjI2cy4wNy4wNC4xMS4wNmMuMzYuMTguNjguMzQuOTguNDguMDMuMDEuMDYuMDMuMDkuMDQuODIuMzksMS4zNy42NCwxLjU2LjcyLjA0LjAyLjA5LjA0LjA5LjA0aDBzLTIuODMtMS4zNS0yLjgzLTEuMzVaIi8+PHBhdGggY2xhc3M9ImkiIGQ9Ik0yNjQuMDgsMjE2Ljg2YzAsLjM3LDAsLjc2LS4wMSwxLjE4LDAsLjYxLS4wMSwxLjI3LS4wMiwxLjk4aDBjMCwuNDgsMCwuOTYtLjAxLDEuNDYsMCwwLDAsLjAyLDAsLjAzLDAsLjc2LS4wMSwxLjU1LS4wMiwyLjM3LDAsLjI4LDAsLjU3LDAsLjg2LDAsLjU2LS4wMSwxLjE0LS4wMiwxLjcyLDAsLjMsMCwuNiwwLC45MSwwLC42LS4wMSwxLjItLjAyLDEuODEsMCwuNjItLjAxLDEuMjUtLjAyLDEuODksMCwuNjItLjAxLDEuMjYtLjAyLDEuODloMGMwLC42NSwwLDEuMjgtLjAxLDEuOTJoMGMwLC45Ny0uMDEsMS45NC0uMDIsMi44OWgwYzAsMS4yOS0uMDIsMi41Ni0uMDIsMy44LDAsLjMxLDAsLjYzLDAsLjk0LS4wMiw0LjMyLS4wMyw4LjI4LS4wMiwxMS4xNSwwLC40MSwwLC44LDAsMS4xNiwwLC4zNiwwLC43LDAsMS4wMiwwLC4zMSwwLC42LjAxLjg2LDAsLjI2LjAxLjQ5LjAyLjY5LDAsLjEyLDAsLjI0LjAxLjM0LDAsLjIuMDIuMzUuMDMuNDUsMCwuMDUuMDEuMDguMDIuMWgwczAsMCwwLDBjMCwwLDAsMCwuMDEsMCwwLDAsLjAxLDAsLjAyLS4wMSwwLDAsLjAxLDAsLjAyLS4wMSwwLDAsLjAyLS4wMi4wMy0uMDQsMCwwLC4wMS0uMDEuMDItLjAzLjAyLS4wMy4wNS0uMDcuMDgtLjEyLjAyLS4wNC4wNC0uMDkuMDctLjE0LjA1LS4xMS4xLS4yNi4xNi0uNDUuMDMtLjExLjA3LS4yMy4xLS4zNi4wMy0uMTEuMDYtLjIzLjA5LS4zNi4wMy0uMTUuMDctLjMxLjEtLjQ5LjAyLS4wOS4wMy0uMTguMDUtLjI4LjAzLS4xOS4wNy0uNC4xMS0uNjMuMDQtLjIzLjA3LS40Ny4xMS0uNzQuMDgtLjYuMTctMS4yOS4yNS0yLjEuMDYtLjU0LjExLTEuMTMuMTctMS43OC4wNi0uNjUuMTEtMS4zNS4xNi0yLjExLjAzLS4zOC4wNS0uNzguMDgtMS4xOS4wNS0uODIuMS0xLjcxLjE1LTIuNjYuMTUtMi44NS4yOC02LjMxLjM4LTEwLjUuMDItLjY4LjAzLTEuMzkuMDUtMi4xMSwwLS4yNC4wMS0uNDguMDItLjcyLjAxLS41Mi4wMi0xLjA1LjAzLTEuNTkuMDMtMS41NS4wNS0zLjE4LjA3LTQuOSwwLS4wMSwwLS4wMywwLS4wNC4wMS0xLjE1LjAyLTIuMzQuMDMtMy41NiwwLDAsMC0uMDIsMC0uMDMuMDItMi40OC4wMy01LjEyLjAzLTcuOTRoMGMtLjgyLjI0LTEuNTcuNDYtMi4yNC42NSwwLC40Mi0uMDEsMS4wNC0uMDIsMS44MywwLC4zMSwwLC42NC0uMDEsMVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI2NS4yNSw5Ni43MWMuMzguNDQuNzUuODgsMS4xMiwxLjMzLS43My0uOTItMS41LTEuODItMi4zMi0yLjY3LDAsMCwwLC4wMS0uMDEuMDIuNDIuNDMuODIuODcsMS4yMiwxLjMyWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMzA3LjE5LDEyNy4yNWMtLjYyLS43NC0xLjI2LTEuNDctMS45MS0yLjE5LjY1LjcxLDEuMjgsMS40NCwxLjksMi4xOCwwLDAsMCwwLDAsMFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI5NS42NCwxMTYuMzFjLS44My0uNjEtMS42Ni0xLjIyLTIuNTItMS43OS44Mi41NSwxLjYyLDEuMTMsMi40MSwxLjcyLjAzLjAzLjA3LjA1LjEuMDdaIi8+PHBhdGggY2xhc3M9InEiIGQ9Ik0zMDUuMTksMTI0Ljk2cy4wNS4wNS4wNy4wN2MtMS4zMy0xLjQ3LTIuNzQtMi44Ni00LjItNC4yLjY4LjYzLDEuMzYsMS4yNywyLjAyLDEuOTMuNzIuNzIsMS40MiwxLjQ1LDIuMTEsMi4yWiIvPjxwYXRoIGNsYXNzPSJxIiBkPSJNMzAwLjQ5LDEyMC4zMWMtLjQ1LS40LS45LS43OS0xLjM1LTEuMTguMzguMzIuNzUuNjQsMS4xMi45Ny4wOC4wNy4xNi4xNC4yMy4yMVoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTI5OC42OCwxMTguNzNjLS4yNS0uMjEtLjUtLjQxLS43NS0uNjIuNDEuMzMuODEuNjgsMS4yMSwxLjAyLS4xNS0uMTMtLjMtLjI3LS40Ni0uNFoiLz48cGF0aCBjbGFzcz0icSIgZD0iTTMwMC45NCwxMjAuNzFjLS4xNS0uMTQtLjMtLjI3LS40NS0uNC4xOS4xNy4zOC4zNC41Ny41Mi0uMDQtLjA0LS4wOC0uMDgtLjEyLS4xMloiLz48cGF0aCBjbGFzcz0ibyIgZD0iTTE3Mi45LDg2Ljg3YzEuMDUtMS4yMywyLjA4LTIuNDEsMy4xMS0zLjUzLjA0LS4wNS4wOS0uMS4xMy0uMTQuOC0uODcsMS42LTEuNywyLjQtMi41LDAsMCwwLDAsMCwwLDcuNDQtNy4zNywxNS40Ny0xMS42OSwyOS45OC0xMS4yNCwxNi41NC41MiwzNS45OSwxNi40NCw0MS4xNCwyMS41Mi4yLS4xMi4zOS0uMjUuNi0uMzYtLjItLjQ3LS40NS0uOTktLjczLTEuNTctLjctMS40NC0xLjY1LTMuMTgtMi44OS01LjA4LS41LS43Ni0xLjA0LTEuNTUtMS42My0yLjM2LTIuMDctMi44Mi00Ljc2LTUuODUtOC4xNy04LjcxLS40OS0uNDEtLjk5LS44MS0xLjUxLTEuMjEtMy4xMS0yLjM5LTYuNzgtNC42Mi0xMS4wNy02LjQyLTIuODYtMS4yLTYuMDEtMi4yMi05LjQ2LTIuOTgtMS43My0uMzgtMy41My0uNjktNS40MS0uOTQtMi44Mi0uMzYtNS44Mi0uNTYtOS4wMS0uNTYsMCwwLC40Ny0uMTMsMS40LS4yNi4yNi0uMDQuNTctLjA4LjkxLS4xMi4xNy0uMDIuMzUtLjA0LjUzLS4wNi4zNy0uMDQuNzktLjA3LDEuMjMtLjEuNDUtLjAzLjkzLS4wNSwxLjQ0LS4wNiwxLjI5LS4wMywyLjgtLjAyLDQuNTMuMSwxLjAzLjA3LDIuMTQuMTcsMy4zMy4zMS4zOS4wNS44LjEsMS4yMS4xNiwxLjY0LjIzLDMuNDIuNTQsNS4zMi45Ni44My4xOCwxLjY5LjM5LDIuNTcuNjEuMjYuMDcuNTIuMTMuNzguMi43NC4xOSwxLjQ5LjQsMi4yNi42My4zMi4wOS42NC4xOS45Ni4yOS4zNy4xMS43NS4yMywxLjEzLjM1LjQ2LjE1LjkuMywxLjM0LjQ1cy44Ny4zMiwxLjI5LjQ4YzE1Ljk2LDYuMTcsMjEuMzYsMTguODEsMjIuNjMsMjQuOS4zMS0uMDYuNjMtLjEuOTYtLjE0LjQyLS4wNS44NS0uMDgsMS4zLS4wOC4wMiwwLC4wMywwLC4wNSwwLC4wMiwwLC4wNCwwLC4wNywwaDBjLjY3LTIuNDgsMS4xMy01LDEuMzQtNy40NC4wNy0uODEuMTEtMS42Mi4xMy0yLjQyLjAyLTEuMDYsMC0yLjA5LS4wOC0zLjEtLjAzLS40LS4wNy0uOC0uMTItMS4xOS0uMTktMS41Ni0uNS0zLjAzLS45NS00LjM2LS4xMS0uMzMtLjIzLS42Ni0uMzYtLjk3LS41Ny0xLjM4LTEuMy0yLjU4LTIuMi0zLjU1LS42LS42NS0xLjI4LTEuMi0yLjAzLTEuNjMsMCwwLDExLjk5LDUuMTUsNi42LDI0Ljg5LjU2LjExLDEuMDYuMjksMS41Ni40Ni4xMi0uMjkuMjYtLjYxLjQtLjk2LjA1LS4xMy4xMS0uMjguMTctLjQyLjAyLS4wNi4wNC0uMTEuMDctLjE3LjA2LS4xNi4xMy0uMzIuMTktLjUuMDctLjE3LjEzLS4zNi4yLS41NC4wMS0uMDMuMDItLjA1LjAzLS4wOC4wNy0uMi4xNS0uNC4yMi0uNjEuMDgtLjI0LjE3LS40OS4yNS0uNzQuMDMtLjEuMDctLjIuMS0uMy4wMy0uMS4wNy0uMi4xLS4zLjAzLS4xLjA2LS4yLjEtLjMuMDYtLjE5LjEyLS4zOC4xOC0uNTguMDYtLjE5LjEyLS4zNy4xNy0uNTYuMS0uMzMuMTktLjY3LjI5LTEuMDEuMDItLjA4LjA0LS4xNS4wNi0uMjMuMDMtLjEuMDYtLjIxLjA5LS4zMS4xLS4zNy4xOS0uNzUuMjktMS4xNC4wMi0uMDcuMDMtLjE0LjA1LS4yMi4wMi0uMDkuMDQtLjE4LjA2LS4yNy4wNS0uMjEuMDktLjQyLjE0LS42NC4wNS0uMjEuMS0uNDIuMTQtLjY0LjAyLS4wOC4wMy0uMTcuMDUtLjI1LjAxLS4wNi4wMi0uMTEuMDMtLjE3LjA5LS40Ni4xOC0uOTMuMjYtMS40MS4wMi0uMTEuMDMtLjIxLjA1LS4zMi4wOC0uNTIuMTYtMS4wNC4yMy0xLjU3LDAtLjAzLDAtLjA2LjAxLS4wOSwwLS4wMiwwLS4wNSwwLS4wNywxLjMzLTEwLjk4LTEuMTgtMjQuNjMtMTguNTMtMzEuNzItLjA1LS4wMi0uMTEtLjA1LS4xNi0uMDctMS4yNy0uNTEtMi42My0uOTktNC4wNy0xLjQzLS4xLS4wMy0uMi0uMDYtLjMtLjA5LTEuNDItLjQzLTIuOTMtLjgyLTQuNTEtMS4xNi0uMTQtLjAzLS4yOC0uMDYtLjQyLS4wOS0xLjU5LS4zNC0zLjI2LS42NC01LjAyLS44OS0uMDctLjAxLS4xMy0uMDMtLjIxLS4wNC04LjQ5LjU4LTE4LjY5LDMuNDQtMzAuMzMsMTAuNzEtMzUuNzgsMjIuMzYtNTAuNDgsMjguNzUtNTAuNDgsMjguNzUsMCwwLDEzLjQyLTEuOTIsMTcuMjUtMy4xOSwzLjgzLTEuMjgtMTYuNjEsMzEuOTUtMzEuMzEsMzcuMDYtMTMuMTEsNC41Ni04NC4zOSw5LjA4LTk5Ljk3LDQ2LjMzLDAsLjA0LS4wMS4wNi0uMDIuMDgsMCwuMDMtLjAxLjA3LS4wMi4xMS0uMDIuMDktLjA0LjE4LS4wNS4yNXMtLjAzLjE1LS4wNC4yMmMwLC4wNC0uMDIuMDktLjAzLjEzLDAsLjAzLDAsLjA0LS4wMS4wNiwwLC4wNi0uMDIuMDktLjAyLjE0LDAsLjA0LS4wMS4wOS0uMDIuMTMsMCwuMDQtLjAxLjA3LS4wMS4wNywwLDAtMS45Myw0LjE4LDMuNTQtMi4yNS4xNy0uMi4zNS0uNDEuNTUtLjYzLjM5LS40NC44Mi0uOTEsMS4zLTEuNDIuMjQtLjI1LjQ5LS41MS43NS0uNzguNTEtLjUyLDEuMDctMS4wNywxLjY3LTEuNjQuMDMtLjAzLjA2LS4wNi4wOS0uMDkuMjktLjI3LjU4LS41NS44OS0uODMuOTItLjg0LDEuOTEtMS43MiwyLjk4LTIuNiw3LjYyLTYuMzIsMTguOTQtMTMuMzQsMzEuNjUtMTQuMzksMS4yNi0uMSwyLjU0LS4xNSwzLjgyLS4xMyw1Ljc5LjA5LDExLjM4LjAyLDE2Ljc3LS4zOCwxLjItLjA5LDIuMzgtLjE5LDMuNTYtLjMxLDUuMy0uNTUsMTAuMzgtMS40NiwxNS4yNS0yLjksMS4wOC0uMzIsMi4xNS0uNjcsMy4yMS0xLjA0LjUzLS4xOSwxLjA2LS4zOCwxLjU4LS41OCw0LjcxLTEuODEsOS4xOS00LjIxLDEzLjQyLTcuMzUsMTAuNTMtNy44MywxOC4xNS0xNS4zOCwyNC4yOC0yMi4yNC4wOC0uMDkuMTUtLjE3LjIzLS4yNiwyLjQyLTIuNzIsNC42Mi01LjMzLDYuNjctNy44LjQxLS40OS44MS0uOTgsMS4yMS0xLjQ2Ljc5LS45NiwxLjU3LTEuODksMi4zMy0yLjguNjYtLjc5LDEuMzEtMS41NiwxLjk1LTIuMzJaIi8+PHBhdGggY2xhc3M9ImgiIGQ9Ik0xMzUuMzcsMTEzLjU1YzE0LjctNS4xMSwzNS4xNC0zOC4zNCwzMS4zMS0zNy4wNi0zLjgzLDEuMjgtMTcuMjUsMy4xOS0xNy4yNSwzLjE5LDAsMCwxNC43LTYuMzksNTAuNDgtMjguNzUsMTEuNjMtNy4yNywyMS44NC0xMC4xNCwzMC4zMy0xMC43MS0uMTEtLjAyLS4yNC0uMDItLjM1LS4wNC0uNzctLjExLTEuNTQtLjIxLTIuMzMtLjMtLjc5LS4wOS0xLjYtLjE3LTIuNDMtLjI1LS4xLDAtLjE5LS4wMi0uMjktLjAzLTEuODUtLjE1LTMuNzctLjI4LTUuNzktLjM0LS43NS0uMDItMS40OS0uMDQtMi4yNC0uMDQtNy42Mi0uMDMtMTQuOTMsMS4wNS0yMS45OCwyLjg5LS45OS4yNi0xLjk3LjUzLTIuOTUuODItNC41NiwxLjM1LTkuMDIsMy0xMy4zNyw0Ljg4LS43My4zMS0xLjQ1LjYzLTIuMTcuOTUtOC42NCwzLjg5LTE2LjksOC41Ny0yNC44NywxMy4zMS0xLjE4LjctMi4zNiwxLjQxLTMuNTQsMi4xMi0uOTUuNTctMS45LDEuMTQtMi44NCwxLjcxLS44LjQ4LTEuNi45Ni0yLjM5LDEuNDQtLjU4LjM1LTEuMTUuNjktMS43MywxLjA0LS45My41Ni0xLjg3LDEuMTItMi43OSwxLjY3LS40Mi4yNS0uODUuNS0xLjI3Ljc1LTIuMywxLjM2LTQuNTksMi42OC02Ljg1LDMuOTUtMy43MywyLjA4LTcuNDEsNC0xMS4wNSw1LjY3LS4xMy4wNi0uMjYuMTItLjM5LjE4LTEuMjYuNTctMi41MiwxLjExLTMuNzgsMS42Mi0uMjUuMS0uNS4yLS43NC4zLS41My4yMS0xLjA3LjQxLTEuNi42MS0zLjcyLDEuMzgtNy40MSwyLjQ0LTExLjA5LDMuMDZoMHMxMC45NCwxLjY2LDIxLjQ1LjhjLjUtLjA0LDEtLjA5LDEuNS0uMTQsMS45OS0uMjEsMy45NS0uNTIsNS43OS0uOTYsMi43Ni0uNjUsNS4yNy0xLjYsNy4yNi0yLjkyLDAsMC0uMzguNy0xLjE5LDEuOTItLjMyLjQ5LS43MSwxLjA2LTEuMTgsMS43MS0uMjMuMzItLjQ4LjY2LS43NSwxLjAyLS44LDEuMDgtMS43NiwyLjMtMi44OSwzLjY0LS43NS44OS0xLjU4LDEuODQtMi40OSwyLjgyLS40NS40OS0uOTMsMS0xLjQyLDEuNTEtLjk4LDEuMDItMi4wNSwyLjA4LTMuMTksMy4xNi0xLjE1LDEuMDgtMi4zNywyLjE4LTMuNjgsMy4zLS45NC44LTEuOTUsMS42MS0yLjk4LDIuNDItMi41NSwyLjAxLTUuMzYsNC4wMy04LjQ3LDYtMi4yMSwxLjQtNC41OCwyLjc3LTcuMDksNC4xLTEuNDUuNzctMi45NCwxLjUzLTQuNSwyLjI3LTEuMDYuNS0yLjE0Ljk5LTMuMjUsMS40Ny0xLjQxLjYxLTIuODcsMS4yLTQuMzYsMS43Ny0yLjAyLjc4LTQuMSwxLjUzLTYuMjYsMi4yMi0xLjI2LjQtMi41NC43OS0zLjg0LDEuMTYtLjI3LjA4LS41My4xNi0uNzkuMjMtLjc0LjIyLTEuNDcuNDQtMi4xOS42Ni0uMi4wNi0uNDEuMTMtLjYxLjE5LS4zOC4xMi0uNzQuMjUtMS4xMS4zNy0uNTcuMTktMS4xNC4zOS0xLjcuNTgtLjE5LjA3LS4zOS4xMy0uNTguMi0uNDIuMTUtLjgzLjMxLTEuMjQuNDYtLjY3LjI1LTEuMzMuNS0xLjk4Ljc2LS40MS4xNi0uODEuMzMtMS4yMS41LS42Mi4yNi0xLjI0LjUyLTEuODQuNzktLjM4LjE3LS43Ni4zNC0xLjEzLjUxLS42MS4yOC0xLjIuNTYtMS43OS44NS0uMzMuMTYtLjY2LjMyLS45OC40OC0uMzMuMTYtLjYzLjMzLS45NS41LS4zMi4xNy0uNjQuMzMtLjk1LjUtLjExLjA2LS4yMy4xMi0uMzUuMTktLjEyLjA2LS4yMy4xMi0uMzUuMTktLjg0LjQ3LTEuNjYuOTQtMi40NCwxLjQxLS4wOC4wNS0uMTQuMDktLjIyLjE0LS43LjQzLTEuMzkuODYtMi4wNSwxLjMtLjIzLjE1LS40NC4zLS42Ni40NS0uNDkuMzQtLjk4LjY3LTEuNDUsMS4wMS0uMTIuMDktLjI0LjE3LS4zNi4yNi0uMTIuMDktLjI0LjE3LS4zNi4yNi0uMTEuMDgtLjIxLjE2LS4zMi4yNC0uMzIuMjQtLjY0LjQ4LS45NS43Mi0uMjMuMTgtLjQ1LjM2LS42Ny41My0uNC4zMi0uNzkuNjUtMS4xNy45Ny0uMi4xNy0uNDEuMzUtLjYxLjUyLS4zOS4zNC0uNzcuNjktMS4xNCwxLjAzLS4xNi4xNS0uMzMuMy0uNDkuNDUtLjQ0LjQyLS44Ni44My0xLjI3LDEuMjUtLjA3LjA3LS4xNS4xNS0uMjIuMjItLjQ5LjUtLjk1LDEtMS4zOSwxLjUtLjA1LjA2LS4xLjEyLS4xNS4xOC0uMzguNDMtLjc0Ljg1LTEuMDksMS4yNy0uMTIuMTQtLjIyLjI4LS4zMy40Mi0uMjcuMzQtLjU0LjY4LS44LDEuMDEtLjEyLjE2LS4yMy4zMS0uMzQuNDYtLjExLjE0LS4yLjI4LS4zMS40My0uMTIuMTctLjI1LjM0LS4zNy41MS0uMDYuMDktLjEyLjE3LS4xOC4yNi0uMDUuMDctLjEuMTQtLjE1LjIxLS4yMS4zMS0uNDEuNjEtLjYuOTEtLjA5LjE1LS4xOS4yOS0uMjguNDQtLjIuMzItLjM4LjYzLS41Ny45NC0uMDcuMTItLjE1LjI0LS4yMS4zNi0uMTIuMjItLjI0LjQzLS4zNS42NC0uMS4xNy0uMi4zNS0uMjkuNTIsMCwwLDAsLjAxLS4wMS4wMi0uMDEuMDItLjAyLjA0LS4wMy4wNS0uMjIuNDEtLjQyLjgxLS42MSwxLjItLjA0LjA5LS4wOC4xOC0uMTMuMjctLjE0LjI5LS4yNy41Ny0uMzkuODUtLjA2LjEzLS4xMS4yNS0uMTYuMzctLjEuMjMtLjE5LjQ1LS4yOC42Ny0uMDUuMTQtLjExLjI3LS4xNi40LS4wOC4yLS4xNS4zOS0uMjIuNTgtLjA1LjEzLS4wOS4yNi0uMTQuMzktLjAzLjA5LS4wNi4xNy0uMDkuMjUtLjAzLjA4LS4wNi4xNy0uMDguMjUtLjA0LjEyLS4wOC4yNS0uMTIuMzYtLjAxLjA0LS4wMi4wNy0uMDMuMTEtLjAzLjExLS4wNy4yMi0uMS4zMy0uMDMuMTEtLjA3LjIzLS4xLjM0LS4wMy4xMi0uMDYuMjItLjA5LjMzLS4wNS4xOS0uMDkuMzYtLjE0LjUzLS4wMy4xMS0uMDUuMjItLjA4LjMyLDE1LjU4LTM3LjI0LDg2Ljg1LTQxLjc3LDk5Ljk3LTQ2LjMzWiIvPjxwb2x5Z29uIGNsYXNzPSJlIiBwb2ludHM9Ijg3Ljc2IDU5Ljc5IDg3Ljc2IDU5Ljc5IDg3Ljc2IDU5Ljc5IDg3Ljc2IDU5Ljc5Ii8+PHBhdGggY2xhc3M9ImUiIGQ9Ik0zMjcuMDYsMTMzLjc0Yy4xNC4yNy4yNy41NC40MS44MS41LDEsLjk4LDIsMS40NCwzLjAzLjY5LDEuNTUsMS4zNCwzLjEzLDEuOTQsNC43MywwLDAsMCwuMDIsMCwuMDItLjU5LTEuNTktMS4yMy0zLjE2LTEuOTItNC43LS4zNi0uOC0uNzMtMS41OS0xLjExLTIuMzgtLjExLS4yNC0uMjQtLjQ3LS4zNi0uNy0uMTQtLjI3LS4yNy0uNTQtLjQxLS44MS0uMTMtLjI1LS4yNS0uNTEtLjM5LS43Ni0uMDEtLjAyLS4wMi0uMDQtLjA0LS4wNy0uMzgtLjcyLS43Ny0xLjQ0LTEuMTgtMi4xNSwwLDAsMC0uMDEtLjAxLS4wMi4wMi4wMy4wNC4wNy4wNi4xMS41NC45NSwxLjA1LDEuOTIsMS41NiwyLjlaIi8+PHBvbHlnb24gY2xhc3M9ImUiIHBvaW50cz0iMzMyLjkyIDE0My4xNyAzMzIuOTIgMTQzLjE3IDMzMi45MiAxNDMuMTcgMzMyLjkyIDE0My4xNyIvPjxwYXRoIGNsYXNzPSJrIiBkPSJNMzMzLjg2LDE0My42MmMuNDguMjUuOTUuNTEsMS40LjgiLz48cGF0aCBjbGFzcz0iZSIgZD0iTTMzMy44NSwxNDMuNjJzMCwwLDAsMGMtLjAyLDAtLjA0LS4wMi0uMDYtLjAzLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLC4wMiwwLC4wMy4wMi4wNS4wM1oiLz48cGF0aCBjbGFzcz0iZSIgZD0iTTE5Ljk2LDEzMy41NnMwLDAsMCwwYy0uNTcuOTctMS4xMSwxLjk2LTEuNjIsMi45Ni0uMDEuMDItLjAyLjA0LS4wMy4wNiwwLS4wMi4wMi0uMDMuMDMtLjA1LjUxLTEsMS4wNS0xLjk5LDEuNjItMi45NywwLDAsMCwwLDAsMFoiLz48cGF0aCBjbGFzcz0iZSIgZD0iTTIzLjg1LDEyNy43NXMwLDAsMCwwYy0uMDUuMDctLjExLjE0LS4xNi4yLDAsMCwwLDAsMCwwLC4wNS0uMDcuMS0uMTMuMTYtLjJaIi8+PHBhdGggY2xhc3M9ImUiIGQ9Ik0yMS44LDEzMC42M2MtLjYzLjk0LTEuMjIsMS44OS0xLjc5LDIuODYuNTQtLjkxLDEuMTEtMS44MiwxLjctMi43LjAzLS4wNS4wNi0uMS4xLS4xNVoiLz48cGF0aCBjbGFzcz0iZSIgZD0iTTIwLjAxLDEzMy40OXMtLjAxLjAyLS4wMi4wM2MwLDAsMCwuMDEtLjAxLjAyLDAsMCwwLS4wMS4wMS0uMDIsMCwwLDAtLjAxLDAtLjAyLDAsMCwwLS4wMS4wMS0uMDJaIi8+PHBvbHlnb24gY2xhc3M9ImUiIHBvaW50cz0iMzguODQgMTg2LjYgMzcuNzcgMTg3Ljg2IDM3Ljc3IDE4Ny44NyAzOC44NCAxODYuNiIvPjxwYXRoIGNsYXNzPSJlIiBkPSJNMjkwLjY3LDk4LjE2cy0uMDctLjAzLS4xLS4wNWMuMDkuMDQuMTcuMDguMjYuMTMtLjA1LS4wMy0uMTEtLjA2LS4xNi0uMDhaIi8+PHBhdGggY2xhc3M9ImUiIGQ9Ik01Ny43LDc4LjA5YzEuNjYsMi42LDQuOTYsNy4xNiwxMC4zNywxMi4xOS01LjQxLTUuMDMtOC43MS05LjU5LTEwLjM3LTEyLjE5WiIvPjxwYXRoIGNsYXNzPSJrIiBkPSJNNjguMDcsOTAuMjdjLjgyLjc2LDEuNjksMS41MywyLjYsMi4zMSIvPjxwYXRoIGNsYXNzPSJlIiBkPSJNNzMuNTcsOTQuOTNjLTEuMDItLjc4LTEuOTgtMS41Ny0yLjktMi4zNC45Mi43OCwxLjg4LDEuNTYsMi45LDIuMzRaIi8+PHBhdGggY2xhc3M9ImUiIGQ9Ik0xNjkuNCwyMS44MXMwLDAsLjAxLDBjLS4wNS4wMi0uMS4wNC0uMTUuMDYsMCwwLDAsMCwwLDAsLjA0LS4wMi4wOS0uMDQuMTMtLjA2WiIvPjxwYXRoIGNsYXNzPSJlIiBkPSJNMzAwLjQ5LDEwMy44MWMtLjItLjE0LS40MS0uMjYtLjYxLS40LjA4LjA1LjE2LjEuMjMuMTYuMTIuMDguMjYuMTYuMzguMjRaIi8+PHBhdGggY2xhc3M9ImUiIGQ9Ik0xODAuMTUsMTcuODhjLS41Ni4xNy0xLjE0LjM3LTEuNzEuNTYuMjEtLjA3LjQxLS4xNC42Mi0uMi4zNi0uMTIuNzMtLjI1LDEuMDktLjM2WiIvPjxwYXRoIGNsYXNzPSJlIiBkPSJNMzA1Ljk1LDEwNy44M2MtLjM3LS4zLS43Ni0uNTktMS4xNC0uODguMS4wOC4yMS4xNi4zMS4yNC4yNy4yMS41Ni40Mi44My42NFoiLz48cGF0aCBjbGFzcz0iayIgZD0iTTMxOC4zLDEyMC4yMWMtMS4wNi0xLjMyLTIuMTYtMi42MS0zLjMxLTMuODciLz48cGF0aCBjbGFzcz0iaSIgZD0iTTI3My4zOSwzMzguMTVsLjA5LjA1YzMuMDktMi40OCw2LjE5LTUuMDMsOS4wNi03LjQyLDYuMzEtNS4yNSwxMS41MS05Ljc0LDEyLjkzLTEwLjk4LS4zNy4yOC0uNzMuNTQtMS4wOS44MS44NS0uNzMsMS4zMy0xLjE1LDEuMzMtMS4xNS0zNC4yMiwyNS41OC00MS40NCwyNi4yMi00MS40NCwyNi4yMnYtMjYuODZsLjA3LS41aDBzLS4wNS0uMDItLjA3LS4wM3YtLjExYy0zNS44LTEzLjEzLTU0LjA0LTMzLjkzLTU5Ljc5LTQxLjU0LjMxLjQxLjY0Ljg1LDEuMDMsMS4zNC40Ni41OS45OCwxLjIzLDEuNTYsMS45MS4zNy40NS43OC45MSwxLjIsMS40LjMyLjM2LjY1LjczLDEsMS4xMi42OS43NiwxLjQ0LDEuNTcsMi4yNSwyLjQuNC40Mi44Mi44NCwxLjI0LDEuMjcuMDIuMDIuMDMuMDMuMDUuMDUtMi40MiwzLjIxLTYuNDcsMTMuMjksMTIuNjUsMzQuMDQtMjUuMzEtMjAuMDktMzIuNjYtMzQuOC0zMi44LTM1LjA4LDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwbDkuODktMTEuMTdjLS4wNy0uMTEtLjEyLS4xOS0uMTItLjE5bC05LjkxLDExLjE5YzcuMTIsMTYuNTQsNDguMzQsNDkuMDcsNjQuODksNjEuNjcsNC4yNSwzLjI0LDYuODcsNS4xNiw2Ljg3LDUuMTYsMS42OC0uNjcsNC41LTIuNSw3Ljg5LTQuOTYsMy4zNi0yLjQzLDcuMjctNS40OCwxMS4yMy04LjY2WiIvPjxwYXRoIGNsYXNzPSJkIiBkPSJNMTgyLjY1LDI4NS4xczAsMCwwLDBjMCwwLDAsMCwwLDAsLjE0LjI4LDcuNDgsMTQuOTgsMzIuOCwzNS4wOC0xOS4xMi0yMC43NS0xNS4wNy0zMC44My0xMi42NS0zNC4wNC0uMDItLjAyLS4wMy0uMDMtLjA1LS4wNS0uNDMtLjQzLS44NC0uODYtMS4yNC0xLjI3LS44LS44My0xLjU1LTEuNjQtMi4yNS0yLjQtLjM1LS4zOC0uNjgtLjc2LTEtMS4xMi0uNDMtLjQ5LS44My0uOTYtMS4yLTEuNC0uNTgtLjY5LTEuMDktMS4zMy0xLjU2LTEuOTEtLjM4LS40OS0uNzItLjkzLTEuMDMtMS4zNC0uMDYtLjA4LS4xMy0uMTctLjE5LS4yNS0uMjMtLjMxLS40NC0uNi0uNjMtLjg2LDAsMCwwLDAsMC0uMDEtLjE4LS4yNS0uMzQtLjQ4LS40Ny0uNjcsMCwwLS4wMS0uMDItLjAyLS4wMi0uMTMtLjE5LS4yMy0uMzQtLjMyLS40NywwLS4wMS0uMDItLjAyLS4wMi0uMDMtLjA0LS4wNy0uMDgtLjEyLS4xMS0uMTctLjEtLjE1LS4xNS0uMjMtLjE1LS4yM2gtLjAxcy05Ljg5LDExLjE4LTkuODksMTEuMThjMCwwLDAsMCwwLDBaIi8+PHBhdGggY2xhc3M9ImYiIGQ9Ik0yNDcuMDIsMjA4LjExbC0yLjg2LTEuMTktMTIuNTMtNS4xOS01LjQ4LTIuMjctMjEuNjYtOC45Ny00LjEyLTEuNzFoMGMuMTguNjguNDYsMS4zNC43OSwxLjk5LjExLjIxLjIzLjQxLjM1LjYyLjI1LjQzLjUuODYuNzksMS4yNy4xNC4yLjI5LjQuNDMuNi4zMS40MS42Mi44Ljk0LDEuMTcuMTIuMTQuMjMuMjguMzUuNDEuNDIuNDcuODUuOTEsMS4yMywxLjI5LjI1LjI0LjQ4LjQ1LjY5LjY1LjA1LjA0LjEuMDkuMTQuMTMuMjEuMTkuNC4zNi41Ni41LjAyLjAyLjA0LjA0LjA3LjA2LjMyLjI3LjUzLjQ0LjUzLjQ0bC4wNCwyLjk1LjE2LDEzLjAxLjIzLDE5LjUzLjA1LDQuNDQsOC4zMSw2LjcxLS45LTI2Ljg1LS41My0xNS44aDBzNS4xNiwyLjMzLDUuMTYsMi4zM2wyLjk5LDEuMzVoMHY0My4xM2w1LjcxLDQuMTEsMi4yOCwxLjY0di0uOTRzLS4zMS0yOC4xOS0uMzEtMjguMTlsLS4xNi0xNS4yNHYtLjUxczAsMCwwLDBsNS4yOSwxLjk1LDIuMDYuNzZoMHY0Ni4zMmwxLjU1LDEuMDUsNS4wMSwzLjQxLDEuNDMuOTd2LTUxLjEyaDBzMS42LTEuNDQsMS42LTEuNDRsLS4xNS0zLjE2di0uMTlaIi8+PHBhdGggY2xhc3M9ImQiIGQ9Ik0yNTQuMjEsMTk3LjU2bC02LjU5LTIuMDUtMy40Ni0xLjA4LTkuNjYtMy4wMS0zLjQtMS4wNi00LjQ2LTEuMzktMTMuOTYtNC4zNWgwczEwLjI5LDEuOTgsMTAuMjksMS45OGwyMS42OCw0LjE3aDBzMCwuMDEsMCwuMDFsOS40NiwxLjhoLjA2cy4wNS4wMi4wNS4wMmgwdi0yNC4zN2gwdi03LjVoMHMtLjE2LTUuMTktLjE2LTUuMTljLS40OC4zNy0uOTYuNzEtMS40NCwxLjA1LS42Ny40OC0xLjM0Ljk1LTIsMS40LS4yOS4yLS41OC40LS44Ny42LS4wNC4wMy0uMDcuMDUtLjExLjA3LS4xOC4xMS0uMzUuMjItLjUzLjM0LTEuMDkuNy0yLjE3LDEuMzctMy4yNCwyLjAxLS4xOS4xMS0uMzcuMjMtLjU2LjMzLS4wNC4wMi0uMDcuMDUtLjExLjA3LS4wMSwwLS4wMy4wMi0uMDQuMDMtLjEuMDYtLjE5LjEtLjI4LjE1LTEuMDYuNi0yLjExLDEuMTgtMy4xNSwxLjcxLS4xLjA1LS4xOS4xLS4yOS4xNC0xLjA4LjU1LTIuMTQsMS4wNy0zLjE5LDEuNTUtLjAzLjAxLS4wNS4wMi0uMDguMDQtLjA0LjAyLS4wOC4wMy0uMTEuMDUtLjguMzYtMS41OC43LTIuMzYsMS4wMy0uMjYuMTEtLjUyLjIyLS43OC4zMy0uMDYuMDItLjEyLjA1LS4xNy4wNy0uMjQuMS0uNDcuMTgtLjcuMjgtLjUzLjIxLTEuMDYuNDEtMS41OC42LS4yMy4wOS0uNDcuMTgtLjcuMjYtLjA3LjAzLS4xNC4wNS0uMjIuMDgtLjYyLjIyLTEuMjIuNDItMS44Mi42Mi0uMzEuMS0uNjMuMjItLjkzLjMxLS4xLjAzLS4yLjA2LS4zLjA5LS4xNy4wNS0uMzQuMS0uNTIuMTYtLjU4LjE4LTEuMTQuMzQtMS42OS41LS4wOS4wMy0uMTguMDUtLjI3LjA4LS4wMSwwLS4wMywwLS4wNC4wMS0uMS4wMy0uMi4wNS0uMy4wOC0uNzcuMjEtMS41Mi40LTIuMjIuNTctLjA5LjAyLS4xOC4wNC0uMjguMDYtLjM2LjA5LS43Mi4xNy0xLjA3LjI1LS4zNS4wOC0uNjkuMTUtMS4wMS4yMi0uMzkuMDgtLjc3LjE2LTEuMTQuMjItLjMyLjA2LS42My4xMi0uOTIuMTctLjc0LjEzLTEuNC4yMy0xLjk4LjMxLS41OC4wOC0xLjA4LjE0LTEuNDguMTktLjMzLjA0LS41OS4wNi0uOC4wOCwwLDAsMCwwLDAsMC0uMDIsMC0uMDMsMC0uMDUsMC0uMTUuMDEtLjI2LjAyLS4zMy4wMy0uMDcsMC0uMTEsMC0uMTEsMGgwYy05LjA2LTEuMzctMTAuNDktOS40Ni0xMC43LTEyLjc4aDBjLS4wMS0uMzUtLjAyLS43LS4wMy0xLjA2LDAtLjA1LDAtLjA5LDAtLjE0LDAtLjE0LDAtLjI0LDAtLjI0di4wM2MtLjAyLS43NC0uMDEtMS41LjAxLTIuMjcsMC0uMS4wMS0uMi4wMS0uMzEuMDItLjYzLjA2LTEuMjguMTItMS45My4wMi0uMi4wNC0uNDEuMDUtLjYxLjA1LS41OS4xMi0xLjE4LjItMS43OC4wMy0uMjEuMDUtLjQyLjA4LS42My4xMS0uNzQuMjMtMS40OC4zOC0yLjI0LjAxLS4wNi4wMi0uMTEuMDMtLjE3LjE3LS44Mi4zNi0xLjY1LjU4LTIuNDkuMDUtLjE5LjExLS4zOC4xNi0uNTcuMTgtLjYzLjM3LTEuMjcuNTgtMS45Mi4wOS0uMjcuMTgtLjUzLjI3LS44LjIxLS42LjQ0LTEuMi42OC0xLjguMS0uMjYuMi0uNTIuMzEtLjc3LjMyLS43Ni42Ny0xLjUyLDEuMDQtMi4yOC4wNC0uMDkuMDgtLjE4LjEzLS4yNy40Mi0uODQuODktMS42OSwxLjM5LTIuNTMuMTQtLjI0LjMtLjQ4LjQ0LS43Mi4zNy0uNjEuNzYtMS4yMiwxLjE4LTEuODMuMi0uMjkuNC0uNTguNjEtLjg3LjQyLS41OC44Ni0xLjE3LDEuMzItMS43NS4yMS0uMjcuNDEtLjUzLjYzLS44LjY0LS43NywxLjMtMS41NCwyLjAyLTIuMy4wNi0uMDYuMTEtLjEyLjE2LS4xOC43Ny0uODIsMS41OS0xLjYzLDIuNDYtMi40My4yNi0uMjQuNTQtLjQ4LjgxLS43Mi42My0uNTcsMS4yOS0xLjEzLDEuOTctMS42OS4zMy0uMjcuNjctLjU1LDEuMDItLjgyLjctLjU1LDEuNDMtMS4wOSwyLjE4LTEuNjMuMzMtLjI0LjY2LS40OCwxLS43MiwxLjEtLjc2LDIuMjQtMS41MSwzLjQ1LTIuMjUtMS4wMS4zNy0yLC43Ny0yLjk2LDEuMTktMi45LDEuMjgtNS42LDIuOC04LjExLDQuNTEtLjAyLjAyLS4wNS4wMy0uMDcuMDUtLjQ1LjMxLS44OC42NC0xLjMyLjk2LS4zMy4yNC0uNjYuNDctLjk4LjcxLS4wMi4wMi0uMDUuMDQtLjA3LjA1LS4wNS4wNC0uMS4wNy0uMTQuMTEtLjU0LjQxLTEuMDUuODQtMS41NywxLjI3LS4xNi4xMy0uMzMuMjYtLjQ5LjM5LS4wMy4wMi0uMDUuMDUtLjA4LjA3LS4wNi4wNS0uMTMuMTEtLjE5LjE2LS42My41NC0xLjI0LDEuMS0xLjg0LDEuNjYtLjAzLjAzLS4wNi4wNS0uMDkuMDgtLjA3LjA3LS4xNS4xNC0uMjIuMi0uNTEuNDktMSwuOTktMS40OSwxLjQ5LS4xNi4xNy0uMzQuMzMtLjUuNDksMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAtLjk4LDEuMDItMS44OSwyLjA4LTIuNzgsMy4xNC0uNDIuNTEtLjg1LDEuMDEtMS4yNSwxLjUyLDAsMCwwLDAsMCwuMDEtLjEuMTMtLjIuMjctLjMuNC0uNDguNjItLjk2LDEuMjUtMS40MSwxLjg4LS4wNC4wNi0uMDguMTItLjEzLjE4LS4wMi4wMi0uMDQuMDUtLjA1LjA3LS41LjcxLS45OSwxLjQyLTEuNDUsMi4xMy0uMDUuMDgtLjEuMTUtLjE1LjIzLTEuMDksMS42OS0yLjA3LDMuMzctMi45NCw1LjAzLS4zNS42Ny0uNjksMS4zNC0xLjAxLDEuOTktLjAyLjA0LS4wNC4wOC0uMDUuMTEtLjIzLjQ3LS40My45My0uNjQsMS40LS4wOS4yMS0uMi40My0uMjkuNjQtLjA1LjExLS4xLjIzLS4xNC4zNCwwLC4wMi0uMDIuMDQtLjAzLjA2LS4wNS4xMS0uMDkuMjItLjEzLjMzLS4xOS40Ny0uMzkuOTMtLjU2LDEuMzktLjA2LjE1LS4xMS4yOS0uMTcuNDQtLjIyLjU4LS40MSwxLjE0LS42LDEuNywwLC4wMy0uMDIuMDYtLjAzLjA5LS4wMi4wNy0uMDUuMTUtLjA3LjIyLS40MiwxLjMtLjc1LDIuNTMtLjk5LDMuNjcsMCwuMDQtLjAyLjA4LS4wMi4xMi0uMDIuMS0uMDQuMi0uMDYuMy0uMDMuMTYtLjA1LjMtLjA4LjQ2LS4wNC4yNC0uMDkuNDgtLjEyLjcxLS4wMy4xOC0uMDUuMzQtLjA3LjUxLS4wMi4xNi0uMDMuMzEtLjA1LjQ3LS4wMi4xNi0uMDMuMzItLjA1LjQ3LS4wMS4xNi0uMDIuMzMtLjAzLjQ4LS4wMS4zLDAsLjU4LDAsLjg1LDAsLjEyLDAsLjI2LjAxLjM4LjAzLjM4LjA3LjczLjE0LDEuMDQuMDkuMzguMjQuNzcuNDMsMS4xNi4wNi4xMy4xNS4yNS4yMy4zOC4xNS4yNi4zMS41Mi41Ljc4LjExLjE1LjI0LjMuMzcuNDUuMi4yNC4zOS40Ny42Mi43LjE1LjE2LjMxLjMxLjQ3LjQ2LjIyLjIyLjQ1LjQzLjY5LjY0LDAsMCwuMDIuMDIuMDMuMDMuMDIuMDIuMDUuMDQuMDcuMDYuMTUuMTMuMzEuMjYuNDcuNC4yNy4yMi41NC40My44MS42NC4xOS4xNC4zNy4yOC41Ni40Mi4zLjIyLjYxLjQzLjkyLjY1LjE4LjEyLjM2LjI1LjU0LjM3LjM1LjIzLjcuNDUsMS4wNS42Ny4xNS4wOS4zLjE5LjQ0LjI4LjMxLjE5LjYxLjM2LjkyLjU0LjE5LjExLjM4LjIzLjU2LjMzLjQyLjI0LjgyLjQ1LDEuMjEuNjcuMTEuMDYuMjQuMTMuMzUuMTkuMS4wNi4yLjEuMy4xNi4yNC4xMi40NS4yMy42Ny4zNS4xNy4wOS4zNC4xOC41LjI2LDAsMCwuMDIuMDEuMDMuMDIuMDIuMDEuMDQuMDIuMDYuMDMsMCwwLDAsMCwwLDBsMi44MywxLjM0aDBzLS4wNy42MS0uMDcuNjFsLS4wOS44M2MtMS45My0uMzQtMy42NC0uNzMtNS4yMi0xLjE0LTEuNS0uMzktMi44Ni0uODEtNC4wOS0xLjI1LS40MS0uMTUtLjgtLjMtMS4xOC0uNDUtLjY0LS4yNS0xLjIzLS41Mi0xLjc5LS43OC0uMTMtLjA2LS4yNi0uMTItLjM5LS4xOCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMC0uNjUtLjMxLTEuMjQtLjYzLTEuNzgtLjk1LS4wNC0uMDItLjA3LS4wNC0uMTEtLjA2LS41NS0uMzItMS4wNS0uNjQtMS41MS0uOTYtLjIzLS4xNi0uNDUtLjMyLS42Ni0uNDgtLjIxLS4xNi0uNDEtLjMyLS42LS40Ny0uMDMtLjAzLS4wNy0uMDYtLjEtLjA5LS4zNi0uMy0uNjktLjU5LS45OS0uODgtLjAxLDAtLjAyLS4wMi0uMDMtLjAzLS4zMS0uMy0uNTktLjYtLjg1LS44OC0uMDItLjAzLS4wNC0uMDUtLjA3LS4wOC0uMjItLjI0LS40MS0uNDgtLjU5LS43LS4wNC0uMDUtLjA5LS4xMS0uMTMtLjE2LS4xOC0uMjMtLjM2LS40Ni0uNTEtLjY3LS4xMS0uMTUtLjIzLS4yOS0uMzYtLjQyLS44OC0uOTEtMi4wNC0xLjM0LTIuMDQtMS4zNC0uMDIuNTEtLjAzLDEuMDItLjA1LDEuNTEtLjAyLjUzLS4wMywxLjA1LS4wNSwxLjU3LDAsLjE3LDAsLjM0LS4wMS41MSwwLC4xNywwLC4zNC0uMDEuNTEtLjAyLjYzLS4wMywxLjI2LS4wNCwxLjg2LDAsMCwwLC4wMSwwLC4wMiwwLC40LS4wMS43OC0uMDIsMS4xNywwLC41LS4wMS45OS0uMDIsMS40NiwwLC4yMSwwLC40MiwwLC42MywwLC4yMSwwLC40MiwwLC42MywwLC40LDAsLjc5LDAsMS4xOGgwYzAsLjQ1LDAsLjg5LDAsMS4zMiwwLC4yOSwwLC41NiwwLC44NCwwLC40OC4wMS45NS4wMiwxLjQxLjAyLDEuMzQuMDYsMi41OS4xMSwzLjc1LjA0LDEuMDQuMSwyLC4xNiwyLjksMCwuMDYsMCwuMTEuMDEuMTcuMTIsMS43OC4yOCwzLjMxLjQ1LDQuNjIsMCwuMDIsMCwuMDMsMCwuMDUsMCwuMDEsMCwuMDMsMCwuMDQuMDQuMjkuMDguNTcuMTIuODQuMDguNTQuMTcsMS4wMy4yNiwxLjQ4LjA0LjIzLjA5LjQ0LjE0LjY1LjM0LDEuNTYuNzEsMi42MSwxLjA3LDMuMywwLDAsMCwwLDAsMCwuMjIuNDIuNDMuNzEuNjMuOTEsMCwwLDAsMCwwLDAsLjIuMi4zNy4zLjUzLjM2LDAsMCwwLDAsMCwwLC4wNy4wMy4xNC4wNC4yLjA1LDAsMCwwLDAsMCwwaDBjLjEyLDAsLjIxLS4wMS4yNS0uMDMsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsLjAyLDAsLjAzLS4wMS4wMy0uMDEtLjAxLTEuMDQtLjAxLTIuMDMtLjAxLTIuOTdoMGMwLS42NiwwLTEuMy4wMS0xLjkxLDAtLjYxLjAyLTEuMi4wMy0xLjc3LDAtLjM4LjAyLS43NS4wMy0xLjExLjE1LTUuMDMuNDktOC4xNi44LTEwLjA0LjAzLS4xOC4wNi0uMzMuMDktLjQ5LjAxLS4wOC4wMy0uMTcuMDQtLjI0LDAtLjA1LjAyLS4wOS4wMy0uMTQuMDUtLjI3LjEtLjUuMTUtLjY5LjAyLS4wOS4wNC0uMTUuMDYtLjIyLDAtLjAyLjAxLS4wNS4wMi0uMDguMDUtLjE4LjA5LS4zMy4xMi0uNDMsMCwwLDAsMCwwLS4wMS4wMi0uMDYuMDQtLjExLjA1LS4xNC4wMS0uMDMuMDItLjA1LjAyLS4wNSwwLDAsMCwwLDAsMGgwYy4wMy4zOS4wNS43NC4wOCwxLjEzaDBjLjE1LDIuMi4zLDQuMzguNDYsNi41LjA1Ljc0LjExLDEuNDYuMTcsMi4xOS4xNCwxLjc5LjI4LDMuNTUuNDIsNS4yOC4wNi43LjExLDEuNC4xNywyLjA5LjE2LDEuODguMzEsMy43LjQ3LDUuNDguMDQuNC4wNy44MS4xMSwxLjIxLjIsMi4yNi40MSw0LjQ0LjYxLDYuNTMsMCwwLDAsMCwwLDAsLjA2LjY1LjEyLDEuMjkuMTksMS45Mi4wNi42My4xMiwxLjI1LjE5LDEuODcuMDYuNjEuMTIsMS4yLjE4LDEuNzksMCwuMDYuMDEuMTIuMDIuMTguMDcuNzIuMTUsMS40Mi4yMiwyLjExLjA2LjYyLjEzLDEuMjQuMTksMS44NC4wNi41My4xMSwxLjA1LjE3LDEuNTYuMDYuNTEuMTEsMS4wMS4xNiwxLjUuMDcuNjEuMTMsMS4xOS4yLDEuNzcuMDYuNTQuMTIsMS4wNi4xOCwxLjU3LjA2LjU1LjEyLDEuMDkuMTgsMS42MS4wOS44My4xOSwxLjYyLjI4LDIuMzcuMDYuNTIuMTIsMSwuMTgsMS40OS4wNC4zNi4wOS43MS4xMywxLjA1LjA1LjQ1LjExLjg5LjE2LDEuMy4wMy4yMS4wNS40Mi4wOC42Mi4wMy4yNC4wNi40OC4wOS43MSwwLC4wOC4wMi4xNS4wMy4yMi4wMy4yNi4wNi41MS4wOS43NS4wMS4xLjAzLjIxLjA0LjMxLDAsLjA1LjAxLjA5LjAyLjE0LjAzLjI0LjA2LjQ4LjA5LjcuMDMuMjQuMDYuNDYuMDkuNjcuMDQuMjcuMDcuNTEuMS43NC4wMi4xMS4wMy4yMy4wNC4zMywwLC4wMywwLC4wNSwwLC4wNy4wMS4wOS4wMi4xNy4wMy4yNi4wMi4xNy4wNC4zMi4wNi40NC4wMi4xMi4wMi4xOC4wMy4yNS4wMS4wOS4wMi4xMy4wMi4xNCwwLDAsMCwuMDMsMCwuMDNoMHMtNC42MywzLjgzLTQuNjMsMy44M2gwYy4zMy4zNi42Ni43Ljk4LDEuMDUuOTQsMSwxLjg3LDEuOTgsMi44MSwyLjk3LjQzLjQ2Ljg3LjkzLDEuMzEsMS40LjQ0LjQ3Ljg4LjkzLDEuMywxLjM4LjExLjExLjIxLjIxLjMyLjMzLDAsMCwwLDAsMCwwLDEuNjksMS43NCwzLjM0LDMuNCw0Ljk4LDUuMDMsMCwwLDAsMCwwLDAsLjI5LjI5LjU5LjYuODguODkuMy4zLjU5LjU3Ljg5Ljg3LDEuNTIsMS40OSwzLjAxLDIuOTIsNC40OCw0LjMxLjQ0LjQyLjg4Ljg0LDEuMzIsMS4yNSwxLjQ4LDEuMzksMi45MywyLjcxLDQuMzYsNCwuNjMuNTcsMS4yNiwxLjE0LDEuODgsMS42OSwxLjE2LDEuMDMsMi4zLDIuMDMsMy40MiwzLC4wNy4wNi4xNC4xMi4yMS4xOC4wMi4wMi4wNC4wNC4wNi4wNS44Mi43MSwxLjYyLDEuMzgsMi40MiwyLjA2LjQyLjM1LjgzLjcsMS4yNSwxLjA0LDEuNDUsMS4yMSwyLjg1LDIuMzQsNC4yMiwzLjQ0LjIxLjE3LjQ0LjM3LjY1LjUzLjIyLjE3LjQxLjMyLjYzLjQ5LjM1LjI4LjcuNTUsMS4wNS44My4zNy4yOS43NC41OCwxLjExLjg2LjI4LjIyLjU2LjQzLjgzLjY0LjA2LjA1LjEyLjEuMTkuMTQuMDguMDYuMTUuMTIuMjMuMTguNzUuNTcsMS40NywxLjExLDIuMTgsMS42NS40MS4zLjgxLjYxLDEuMjEuOS4xOC4xMy4zNS4yNi41My4zOSwxLjE2Ljg1LDIuMjYsMS42NCwzLjMxLDIuMzguMTcuMTIuMzMuMjMuNDkuMzQuMjEuMTQuNDEuMjkuNjMuNDMuNjUuNDUsMS4zLjkxLDEuOTEsMS4zMi4xNS4xLjI5LjIuNDQuMy4wNi4wNC4xMy4wOC4xOS4xMy4zMS4yMS41OC4zOS44OC41OC4yOS4xOS42LjQuODguNTguMjYuMTcuNTMuMzUuNzcuNTEuNDkuMzIuOTQuNjEsMS4zOC44OS4xMS4wNy4yMi4xNC4zMi4yLjM0LjIxLjY1LjQuOTYuNTkuMDQuMDMuMDguMDUuMTMuMDguMTcuMS4zNC4yMS41LjMxLjI3LjE2LjUyLjMxLjc1LjQ2LjE5LjExLjM2LjIyLjUzLjMxLjA5LjA1LjE3LjEuMjUuMTUuMDguMDUuMTcuMS4yNS4xNC4xMS4wNi4yMS4xMi4zMS4xOC4wMSwwLC4wMy4wMi4wNS4wMy4xMi4wNy4yNC4xNC4zNS4yLjA0LjAyLjA5LjA1LjEzLjA3LjE4LjEuMzQuMTkuNDguMjdoMHMuNDQuMjQuNDQuMjRsLjExLTc4LjA1LjA5LTEyLjloMHMuMDMtNC44LjAzLTQuOGwtLjIzLjA3Wk0yNDUuNTksMjEyLjloMHY1MS4xMmwtMS40My0uOTctNS4wMS0zLjQxLTEuNTUtMS4wNXYtNDYuMzJoMHMtMi4wNi0uNzYtMi4wNi0uNzZsLTUuMjktMS45NWgwczAsLjUxLDAsLjUxbC4xNiwxNS4yNC4zLDI4LjE5di45NHMtMi4yNy0xLjY0LTIuMjctMS42NGwtNS43MS00LjExdi00My4xM2gwcy0yLjk5LTEuMzUtMi45OS0xLjM1bC01LjE2LTIuMzNoMHMuNTMsMTUuOC41MywxNS44bC45LDI2Ljg1LTguMzEtNi43MS0uMDUtNC40NC0uMjMtMTkuNTMtLjE2LTEzLjAxLS4wNC0yLjk1cy0uMi0uMTYtLjUzLS40NGMtLjAyLS4wMi0uMDQtLjA0LS4wNy0uMDYtLjE2LS4xNC0uMzUtLjMxLS41Ni0uNS0uMDQtLjA0LS4xLS4wOS0uMTQtLjEzLS4yMi0uMi0uNDQtLjQxLS42OS0uNjUtLjM5LS4zOC0uODEtLjgyLTEuMjMtMS4yOS0uMTItLjEzLS4yMy0uMjctLjM1LS40MS0uMzItLjM3LS42My0uNzYtLjk0LTEuMTctLjE1LS4yLS4yOS0uMzktLjQzLS42LS4yOC0uNDEtLjU0LS44NC0uNzktMS4yNy0uMTItLjIxLS4yNC0uNDEtLjM1LS42Mi0uMzItLjY1LS42MS0xLjMxLS43OS0xLjk5aDBzNC4xMiwxLjcxLDQuMTIsMS43MWwyMS42Niw4Ljk3LDUuNDgsMi4yNywxMi41Myw1LjE5LDIuODYsMS4xOXYuMTlzLjE2LDMuMTYuMTYsMy4xNmwtMS42LDEuNDRaIi8+PC9nPjwvc3ZnPg=="
            style="width:240px;height:auto;
                   mix-blend-mode:screen;
                   filter:drop-shadow(0 0 32px rgba(26,86,219,0.8)) drop-shadow(0 0 64px rgba(26,86,219,0.4)) drop-shadow(0 2px 12px rgba(26,86,219,0.6));
                   display:block;margin:0 auto 12px;">
          <div style="font-size:12px;color:var(--text2);letter-spacing:1px;text-transform:uppercase;">League Management Dashboard</div>
        </div>

        <div class="card" style="padding:28px;">
          <!-- Tab switcher -->
          <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:20px;">
            <button id="authTabLogin" onclick="authShowTab('login')"
              style="flex:1;background:none;border:none;padding:8px;font-family:'DM Sans';font-size:13px;
                     font-weight:700;color:var(--gold);border-bottom:2px solid var(--gold);
                     margin-bottom:-1px;cursor:pointer;">Sign In</button>
            <button id="authTabRegister" onclick="authShowTab('register')"
              style="flex:1;background:none;border:none;padding:8px;font-family:'DM Sans';font-size:13px;
                     font-weight:700;color:var(--text2);border-bottom:2px solid transparent;
                     margin-bottom:-1px;cursor:pointer;">Create Account</button>
            <button id="authTabReset" onclick="authShowTab('reset')"
              style="flex:1;background:none;border:none;padding:8px;font-family:'DM Sans';font-size:13px;
                     font-weight:700;color:var(--text2);border-bottom:2px solid transparent;
                     margin-bottom:-1px;cursor:pointer;">Reset Password</button>
          </div>

          <!-- Login -->
          <div id="authFormLogin">
            <div class="form-group" style="margin-bottom:14px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--text2);display:block;margin-bottom:6px;">Username</label>
              <input id="authLoginUser" type="text" class="draft-input" placeholder="Your username"
                style="width:100%;" onkeydown="if(event.key==='Enter')authDoLogin()">
            </div>
            <div class="form-group" style="margin-bottom:20px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--text2);display:block;margin-bottom:6px;">Password</label>
              <input id="authLoginPw" type="password" class="draft-input" placeholder="Password"
                style="width:100%;" onkeydown="if(event.key==='Enter')authDoLogin()">
            </div>
            <div id="authLoginErr" style="font-size:12px;color:var(--red);margin-bottom:10px;display:none;"></div>
            ${jbEnabled()
              ? `<div style="font-size:11px;color:var(--green);margin-bottom:10px;text-align:center;">☁️ Cloud sync active — accounts work on any device</div>`
              : `<div style="font-size:11px;color:var(--text2);margin-bottom:10px;text-align:center;">⚠️ No cloud sync — this device only</div>`
            }
            <button id="authLoginBtn" class="btn btn-gold" onclick="authDoLogin()" style="width:100%;padding:11px;">Sign In</button>
            <div style="text-align:center;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:16px;">
              <button onclick="authShowTab('reset')" style="background:none;border:none;color:var(--text2);font-size:11px;cursor:pointer;text-decoration:underline;font-family:'DM Sans';min-height:32px;padding:0 8px;">Forgot password?</button>
              <span style="color:var(--border);font-size:11px;">·</span>
              <button onclick="authOfflineBypass()" style="background:none;border:none;color:var(--text2);font-size:11px;cursor:pointer;text-decoration:underline;font-family:'DM Sans';min-height:32px;padding:0 8px;" title="Use if cloud sync is unreachable">Offline mode</button>
            </div>
          </div>

          <!-- Reset Password -->
          <div id="authFormReset" style="display:none;">
            <div style="font-size:12px;color:var(--text2);margin-bottom:16px;line-height:1.5;">
              Enter your username, current password, and a new password. Requires cloud sync to be active.
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);display:block;margin-bottom:6px;">Username</label>
              <input id="authResetUser" type="text" class="draft-input" placeholder="Your username" style="width:100%;">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);display:block;margin-bottom:6px;">Current Password</label>
              <input id="authResetOld" type="password" class="draft-input" placeholder="Current password" style="width:100%;">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);display:block;margin-bottom:6px;">New Password</label>
              <input id="authResetNew" type="password" class="draft-input" placeholder="New password (min 4 chars)" style="width:100%;">
            </div>
            <div class="form-group" style="margin-bottom:20px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);display:block;margin-bottom:6px;">Confirm New Password</label>
              <input id="authResetNew2" type="password" class="draft-input" placeholder="Repeat new password" style="width:100%;">
            </div>
            <div id="authResetErr" style="font-size:12px;color:var(--red);margin-bottom:10px;display:none;"></div>
            <div id="authResetOk" style="font-size:12px;color:var(--green);margin-bottom:10px;display:none;">✓ Password updated! You can now sign in.</div>
            <button id="authResetBtn" class="btn btn-gold" onclick="authDoResetPassword()" style="width:100%;padding:11px;">Update Password</button>
          </div>

          <!-- Register -->
          <div id="authFormRegister" style="display:none;">
            <div class="form-group" style="margin-bottom:14px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--text2);display:block;margin-bottom:6px;">Choose Username</label>
              <input id="authRegUser" type="text" class="draft-input" placeholder="e.g. coach_tim"
                style="width:100%;" onkeydown="if(event.key==='Enter')authDoRegister()">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--text2);display:block;margin-bottom:6px;">Password</label>
              <input id="authRegPw" type="password" class="draft-input" placeholder="Min 4 characters"
                style="width:100%;" onkeydown="if(event.key==='Enter')authDoRegister()">
            </div>
            <div class="form-group" style="margin-bottom:20px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--text2);display:block;margin-bottom:6px;">Confirm Password</label>
              <input id="authRegPw2" type="password" class="draft-input" placeholder="Repeat password"
                style="width:100%;" onkeydown="if(event.key==='Enter')authDoRegister()">
            </div>
            <div class="form-group" style="margin-bottom:20px;">
              <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
                  color:var(--text2);display:block;margin-bottom:6px;">League PIN</label>
              <input id="authRegPin" type="password" class="draft-input" placeholder="Enter league PIN"
                style="width:100%;" onkeydown="if(event.key==='Enter')authDoRegister()">
              <div style="font-size:10px;color:var(--text2);margin-top:4px;">Ask your league admin for the PIN</div>
            </div>
            <div id="authRegErr" style="font-size:12px;color:var(--red);margin-bottom:10px;display:none;"></div>
            <button id="authRegBtn" class="btn btn-gold" onclick="authDoRegister()" style="width:100%;padding:11px;">Create Account</button>
          </div>
        </div>

        <!-- New browser options -->
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px;text-align:center;">
          <div style="font-size:11px;color:var(--text2);margin-bottom:8px;">Signing in from a new browser?</div>
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;
              padding:7px 14px;border-radius:7px;border:1px solid var(--border);
              background:rgba(255,255,255,0.04);font-size:12px;color:var(--text);
              transition:background .15s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.04)'">
            <input type="file" accept=".json" style="display:none;" onchange="authImportAccount(this.files[0])">
            ↑ Import Data File
          </label>
        </div>
      </div>
    </div>
    </div>`;
}

// ── Offline bypass — lets coaches access the dashboard when cloud is unreachable ──
// Uses locally cached credentials (saved on the last successful cloud login).
// If no credentials cached, prompts for username and bypasses password check
// since the data is already local. Not for first-time logins.
function authOfflineBypass() {
  const user = (document.getElementById('authLoginUser')?.value || '').trim();
  const pw   = (document.getElementById('authLoginPw')?.value  || '').trim();
  const err  = document.getElementById('authLoginErr');

  // Try local user store first (password-verified)
  if (user && pw) {
    const pwHash = _simpleHash(pw);
    const localUsers = _localGetUsers();
    const found = localUsers.find(u => u.username.toLowerCase() === user.toLowerCase() && u.pwHash === pwHash);
    if (found) {
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: found.username }));
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appRoot').style.display = '';
      initApp();
      toast('⚠️ Signed in offline — sync when connection is restored');
      return;
    }
  }

  // Try cached session (no password needed — data already local)
  const cached = (() => { try { return JSON.parse(sessionStorage.getItem('lll_last_user')||'null'); } catch { return null; }})();
  if (cached?.username) {
    const confirm = window.confirm(`Sign in as "${cached.username}" in offline mode?\n\nYour local data will load. Changes won't sync until cloud reconnects.`);
    if (confirm) {
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: cached.username }));
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('appRoot').style.display = '';
      initApp();
      toast('⚠️ Offline mode — data will sync when cloud reconnects');
      return;
    }
    return;
  }

  // Check if any local users exist for this username
  if (user) {
    const localUsers = _localGetUsers();
    const found = localUsers.find(u => u.username.toLowerCase() === user.toLowerCase());
    if (found) {
      const confirm = window.confirm(`Sign in as "${found.username}" in offline mode?\n\nPassword will be verified locally.`);
      if (confirm && pw && _simpleHash(pw) === found.pwHash) {
        sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ username: found.username }));
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('appRoot').style.display = '';
        initApp();
        toast('⚠️ Offline mode — signed in locally');
        return;
      } else if (confirm) {
        if (err) { err.textContent = 'Incorrect password for offline login'; err.style.display = ''; }
        return;
      }
      return;
    }
  }

  // No cached credentials — explain the situation
  if (err) {
    err.textContent = 'No offline credentials saved on this device. Sign in normally at least once when connected.';
    err.style.display = '';
  }
}

function authShowTab(tab) {
  document.getElementById('authFormLogin').style.display    = tab==='login'    ? '' : 'none';
  document.getElementById('authFormRegister').style.display = tab==='register' ? '' : 'none';
  document.getElementById('authFormReset').style.display    = tab==='reset'    ? '' : 'none';
  document.getElementById('authTabLogin').style.color         = tab==='login'    ? 'var(--gold)' : 'var(--text2)';
  document.getElementById('authTabRegister').style.color      = tab==='register' ? 'var(--gold)' : 'var(--text2)';
  const resetTab = document.getElementById('authTabReset');
  if (resetTab) resetTab.style.color = tab==='reset' ? 'var(--gold)' : 'var(--text2)';
  document.getElementById('authTabLogin').style.borderBottomColor    = tab==='login'    ? 'var(--gold)' : 'transparent';
  document.getElementById('authTabRegister').style.borderBottomColor = tab==='register' ? 'var(--gold)' : 'transparent';
  if (resetTab) resetTab.style.borderBottomColor = tab==='reset' ? 'var(--gold)' : 'transparent';
}

async function authSaveCloudKey() {
  const key = document.getElementById('jbKeyInput')?.value || '';
  const btn = event?.target;
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  const res = await authTestAndSaveKey(key);
  if (btn) { btn.textContent = 'Save Key'; btn.disabled = false; }
  if (!res.ok) {
    alert('Could not connect: ' + res.msg + '\n\nMake sure you copied the Master Key from jsonbin.io → Account Settings → API Keys');
  } else {
    openSettings(); // refresh UI
  }
}


async function authCopySetupUrl(btn) {
  const key = jbApiKey();
  const bin = jbDirBin();
  if (!key || !bin) { toast('Enable cloud sync first'); return; }
  const base = location.href.split('?')[0].split('#')[0];
  const url  = `${base}?key=${encodeURIComponent(key)}&bin=${encodeURIComponent(bin)}`;
  const orig = btn.textContent;
  try { await navigator.clipboard.writeText(url); }
  catch { prompt('Copy this URL and share with coaches:', url); return; }
  btn.textContent = '✓ Copied!';
  btn.disabled = true;
  toast('Setup URL copied — coaches open it once to configure cloud sync, then sign in or create an account');
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
}


async function authDoLogin() {
  const user = document.getElementById('authLoginUser')?.value || '';
  const pw   = document.getElementById('authLoginPw')?.value   || '';
  const err  = document.getElementById('authLoginErr');
  const btn  = document.getElementById('authLoginBtn');
  err.style.display = 'none';
  if (btn) { btn.textContent = 'Signing in…'; btn.disabled = true; }
  const res = await authLogin(user, pw);
  if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
  if (res.ok) {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appRoot').style.display    = '';
    initApp();
  } else {
    err.textContent = res.msg; err.style.display = '';
  }
}

async function authDoResetPassword() {
  const user    = (document.getElementById('authResetUser')?.value  || '').trim();
  const oldPw   = (document.getElementById('authResetOld')?.value   || '').trim();
  const newPw   = (document.getElementById('authResetNew')?.value   || '').trim();
  const newPw2  = (document.getElementById('authResetNew2')?.value  || '').trim();
  const err     = document.getElementById('authResetErr');
  const ok      = document.getElementById('authResetOk');
  const btn     = document.getElementById('authResetBtn');

  err.style.display = 'none'; ok.style.display = 'none';
  if (!user || !oldPw || !newPw || !newPw2) { err.textContent = 'All fields required'; err.style.display = ''; return; }
  if (newPw.length < 4) { err.textContent = 'New password must be at least 4 characters'; err.style.display = ''; return; }
  if (newPw !== newPw2) { err.textContent = 'New passwords do not match'; err.style.display = ''; return; }

  btn.textContent = 'Updating…'; btn.disabled = true;
  const oldHash = _simpleHash(oldPw);
  const newHash = _simpleHash(newPw);

  try {
    if (jbEnabled()) {
      const dir = await jbGetDir();
      const entry = dir.users?.[user.toLowerCase()];
      if (!entry) { err.textContent = 'Username not found'; err.style.display = ''; return; }
      if (entry.pwHash !== oldHash) { err.textContent = 'Current password is incorrect'; err.style.display = ''; return; }
      // Update hash in directory
      dir.users[user.toLowerCase()].pwHash = newHash;
      await jbSet(jbDirBin(), dir);
      ok.style.display = '';
      toast('✓ Password updated!');
    } else {
      // Local fallback
      const users = _localGetUsers();
      const u = users.find(u => u.username.toLowerCase() === user.toLowerCase());
      if (!u) { err.textContent = 'Username not found'; err.style.display = ''; return; }
      if (u.pwHash !== oldHash) { err.textContent = 'Current password is incorrect'; err.style.display = ''; return; }
      u.pwHash = newHash;
      _localSaveUsers(users);
      ok.style.display = '';
      toast('✓ Password updated!');
    }
  } catch(e) {
    err.textContent = 'Error: ' + e.message; err.style.display = '';
  } finally {
    btn.textContent = 'Update Password'; btn.disabled = false;
  }
}

async function authDoRegister() {
  const user = document.getElementById('authRegUser')?.value  || '';
  const pw   = document.getElementById('authRegPw')?.value    || '';
  const pw2  = document.getElementById('authRegPw2')?.value   || '';
  const err  = document.getElementById('authRegErr');
  const btn  = document.getElementById('authRegBtn');
  const pin    = document.getElementById('authRegPin')?.value || '';
  const storedPin = leaguePinGet();
  if (storedPin && pin.trim() !== storedPin) {
    err.textContent = 'Incorrect league PIN'; err.style.display=''; return;
  }
  if (!storedPin) {
    // No PIN set yet — only allow if cloud isn't configured (first-time setup)
    // or if user is creating the very first account
  }
  if (pw !== pw2) { err.textContent = 'Passwords do not match'; err.style.display=''; return; }
  err.style.display = 'none';
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }
  const res = await authRegister(user, pw);
  if (btn) { btn.textContent = 'Create Account'; btn.disabled = false; }
  if (res.ok) {
    // Auto-register as a coach in the shared directory
    await authRegisterCoachProfile(user);
    // Show team claim screen before entering app
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appRoot').style.display    = '';
    initApp();
    // Show team claim modal after a short delay
    setTimeout(() => showTeamClaimModal(user), 800);
  } else {
    err.textContent = res.msg; err.style.display = '';
  }
}

// ── Register coach in shared cloud directory ──────────────────────────────
async function authRegisterCoachProfile(username) {
  if (!jbEnabled()) return;
  try {
    const dir = await jbGetDir();
    dir.coaches = dir.coaches || {};
    if (!dir.coaches[username.toLowerCase()]) {
      dir.coaches[username.toLowerCase()] = {
        username,
        displayName: username.replace(/_/g,' '),
        teams: [],
        joinedAt: new Date().toISOString(),
        sharing: { evals: false, drafts: false }
      };
      await jbSet(jbDirBin(), dir);
    }
  } catch(e) { console.warn('coach profile register failed', e); }
}

// ── Get all coach profiles from cloud ────────────────────────────────────
async function getSharedCoaches() {
  if (!jbEnabled()) return [];
  try {
    const dir = await jbGetDir();
    const coachProfiles = dir.coaches || {};

    // Also include every registered user from dir.users as a fallback
    // so accounts show up even if their coach profile write failed
    const users = dir.users || {};
    Object.keys(users).forEach(key => {
      if (!coachProfiles[key]) {
        const u = users[key];
        coachProfiles[key] = {
          username: u.username || key,
          displayName: (u.username || key).replace(/_/g, ' '),
          teams: [],
          joinedAt: null,
          sharing: { evals: false, drafts: false }
        };
      }
    });

    // Write any missing profiles back so they're persisted
    const missing = Object.keys(users).filter(k => !(dir.coaches || {})[k]);
    if (missing.length) {
      dir.coaches = coachProfiles;
      jbSet(jbDirBin(), dir).catch(() => {});
    }

    return Object.values(coachProfiles);
  } catch { return []; }
}

// ── Get/set my sharing prefs in cloud ────────────────────────────────────
async function myCoachProfile() {
  if (!jbEnabled()) return null;
  const u = authCurrentUser();
  if (!u) return null;
  try {
    const dir = await jbGetDir();
    return (dir.coaches || {})[u.username.toLowerCase()] || null;
  } catch { return null; }
}

async function saveCoachProfile(updates) {
  if (!jbEnabled()) return;
  const u = authCurrentUser();
  if (!u) return;
  try {
    const dir = await jbGetDir();
    dir.coaches = dir.coaches || {};
    const key = u.username.toLowerCase();
    dir.coaches[key] = Object.assign(dir.coaches[key] || { username: u.username }, updates);
    await jbSet(jbDirBin(), dir);
  } catch(e) { console.warn('coach profile save failed', e); }
}

// ── Team Claim Modal ──────────────────────────────────────────────────────
async function showTeamClaimModal(username) {
  // Find teams in player data that have coach names not yet claimed
  if (typeof players === 'undefined') return;
  const sharedCoaches = await getSharedCoaches();
  const claimedTeams = new Set(sharedCoaches.flatMap(c => (c.teams||[]).map(t => t.name+'|'+t.year)));

  // Build list of unique teams from player registrations
  const teamMap = {};
  players.forEach(p => {
    if (!p.team) return;
    const key = p.team + '|' + p.year;
    if (!teamMap[key]) teamMap[key] = { name: p.team, year: p.year, sport: p.sport, division: p.division };
  });
  const unclaimedTeams = Object.values(teamMap).filter(t => !claimedTeams.has(t.name+'|'+t.year))
    .sort((a,b) => b.year - a.year || a.name.localeCompare(b.name));

  if (!unclaimedTeams.length) return;

  const modal = document.getElementById('teamClaimModal');
  const content = document.getElementById('teamClaimContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <div style="font-size:13px;color:var(--text2);margin-bottom:14px;">
      Select any teams you have coached. This helps other coaches find you in the system.
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;margin-bottom:16px;">
      ${unclaimedTeams.map(t => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;
            border:1px solid var(--border);cursor:pointer;background:rgba(255,255,255,0.03);">
          <input type="checkbox" value="${t.name}|${t.year}|${t.sport}" style="accent-color:var(--gold);width:16px;height:16px;">
          <div>
            <div style="font-weight:600;font-size:13px;">${t.name}</div>
            <div style="font-size:11px;color:var(--text2);">${t.year} · ${t.sport} ${t.division||''}</div>
          </div>
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm" onclick="closeModal('teamClaimModal')">Skip</button>
      <button class="btn btn-gold btn-sm" onclick="saveClaimedTeams('${username}')">Save My Teams</button>
    </div>`;

  openModal('teamClaimModal');
}

async function saveClaimedTeams(username) {
  const checkboxes = document.querySelectorAll('#teamClaimContent input[type=checkbox]:checked');
  const claimed = Array.from(checkboxes).map(cb => {
    const [name, year, sport] = cb.value.split('|');
    return { name, year: parseInt(year), sport };
  });
  await saveCoachProfile({ username, displayName: username.replace(/_/g,' '), teams: claimed });
  closeModal('teamClaimModal');
  if (claimed.length) toast(`✓ Claimed ${claimed.length} team${claimed.length>1?'s':''}!`);
}

// ═══════════════════════════════════════════════════════════
// COACHES MODULE  v2
// Coach object: { id, name, phone, email, role, teams: [{name,year,role}], notes }
// role = 'Head Coach' | 'Assistant Coach' | 'Volunteer'
// ═══════════════════════════════════════════════════════════

function coachGetAll() {
  try { return JSON.parse(localStorage.getItem(userKey('coaches')) || '[]'); }
  catch { return []; }
}
function coachSaveAll(arr) {
  localStorage.setItem(userKey('coaches'), JSON.stringify(arr));
  setTimeout(authCloudPush, 600);
}
function coachById(id) { return coachGetAll().find(c => c.id === id); }

function coachForTeam(teamName, year) {
  if (!teamName) return null;
  const t = teamName.trim().toLowerCase();
  for (const c of coachGetAll()) {
    if ((c.teams || []).some(a =>
      a.name.toLowerCase() === t &&
      (!year || !a.year || String(a.year) === String(year))
    )) return c.name || '(unnamed)';
  }
  return null;
}

function coachesForTeam(teamName, year) {
  // Returns [{name, role}] filtered by year when provided
  if (!teamName) return [];
  const t = teamName.trim().toLowerCase();
  const result = [];
  coachGetAll().forEach(c => {
    const match = (c.teams || []).find(a =>
      a.name.toLowerCase() === t &&
      (!year || !a.year || String(a.year) === String(year))
    );
    if (match) result.push({ name: c.name || '(unnamed)', role: match.role || c.role || '' });
  });
  return result;
}

function allKnownTeams() {
  const teams = new Set();
  players.forEach(p => {
    const t = (p.team || '').trim();
    if (t && t.toLowerCase() !== 'nan' && t.toLowerCase() !== 'unallocated') teams.add(t);
  });
  return [...teams].sort();
}

// ── CRUD ─────────────────────────────────────────────────────────────────

function coachAddNew() {
  const coaches = coachGetAll();
  coaches.unshift({
    id: Date.now(),
    name: '', phone: '', email: '',
    role: 'Head Coach',
    teams: [], notes: '',
  });
  coachSaveAll(coaches);
  // Make sure analysis section visibility is re-evaluated
  const analysisEl = document.getElementById('coachAnalysisSection');
  if (analysisEl) analysisEl.style.display = 'none';
  renderCoachRoster();
  // Focus the new name input
  setTimeout(() => {
    const inputs = document.querySelectorAll('.coach-name-input');
    if (inputs.length) inputs[0].focus();
  }, 80);
}

function coachDelete(id) {
  if (!confirm('Remove this coach from the roster?')) return;
  coachSaveAll(coachGetAll().filter(c => c.id !== id));
  renderCoachTab();
}

function coachField(id, field, val) {
  const coaches = coachGetAll();
  const c = coaches.find(c => c.id === id);
  if (!c) return;
  c[field] = val;
  coachSaveAll(coaches);
  clearTimeout(coachField._t);
  coachField._t = setTimeout(() => { renderCoachRetentionTable(); renderCoachRetentionChart(); }, 700);
}

function coachAddAssignment(id) {
  const sel  = document.getElementById(`coach-team-sel-${id}`);
  const role = document.getElementById(`coach-team-role-${id}`);
  const year = document.getElementById(`coach-team-year-${id}`);
  if (!sel || !sel.value) return;
  const coaches = coachGetAll();
  const c = coaches.find(c => c.id === id);
  if (!c) return;
  if (!c.teams) c.teams = [];
  // Avoid exact duplicates
  if (c.teams.some(t => t.name === sel.value && t.year == (year?.value||''))) {
    toast('Already linked', 'error'); return;
  }
  c.teams.push({ name: sel.value, role: role?.value || 'Head Coach', year: year?.value || '' });
  coachSaveAll(coaches);
  renderCoachTab();
}

function coachRemoveAssignment(coachId, idx) {
  const coaches = coachGetAll();
  const c = coaches.find(c => c.id === coachId);
  if (!c) return;
  c.teams.splice(idx, 1);
  coachSaveAll(coaches);
  renderCoachTab();
}

// ── RENDER: Individual coach card (flip card) ──────────────────────────────

function _coachCard(c) {
  const roles    = ['Head Coach', 'Assistant Coach', 'Volunteer'];
  const allTeams = allKnownTeams();
  const allYrs   = years();
  const latestYr = allYrs[allYrs.length-1] || 2026;
  const uid = `coach_${c.id}`;

  // Retention stats
  const allRet = computeTeamRetention();
  const myRet  = allRet.filter(r => r.coach === c.name);
  const avgRet = myRet.length ? Math.round(myRet.reduce((a,b)=>a+b.pct,0)/myRet.length) : null;
  const retCol = avgRet===null?'var(--text2)':avgRet>=70?'var(--green)':avgRet>=45?'var(--gold)':'var(--red)';
  const roleColor = c.role==='Head Coach'?'var(--gold)':c.role==='Assistant Coach'?'#60a5fa':'var(--text2)';

  // Best/lowest team
  const bestTeam  = myRet.length ? myRet.reduce((a,b)=>a.pct>b.pct?a:b) : null;
  const worstTeam = myRet.length > 1 ? myRet.reduce((a,b)=>a.pct<b.pct?a:b) : null;
  const trend     = myRet.length >= 2
    ? (myRet[myRet.length-1].pct >= myRet[myRet.length-2].pct ? '↑ Improving' : '↓ Declining')
    : null;
  const trendCol  = trend?.startsWith('↑') ? 'var(--green)' : '#ef4444';

  // Team assignment rows
  const assignmentRows = (c.teams || []).map((t, idx) => `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px;
                background:rgba(255,255,255,0.04);font-size:11px;margin-bottom:3px;">
      <span style="flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.name}</span>
      ${t.year?`<span style="color:var(--gold);font-size:10px;">${t.year}</span>`:''}
      <span style="color:var(--text2);font-size:10px;">${t.role||'Coach'}</span>
      <button onclick="coachRemoveAssignment(${c.id},${idx});event.stopPropagation();"
        style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:11px;padding:0;line-height:1;">✕</button>
    </div>`).join('');

  return `
  <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card);position:relative;">

    <!-- FRONT — always visible, click to flip -->
    <div id="${uid}_front" onclick="coachToggleExpand(${c.id})" style="cursor:pointer;padding:14px 16px;user-select:none;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${roleColor};flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Bebas Neue';font-size:18px;letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${c.name||'<span style="color:var(--text2);">Unnamed</span>'}
            ${c._isCloudUser?`<span style="font-size:9px;background:rgba(96,165,250,0.2);color:#60a5fa;border:1px solid #60a5fa44;border-radius:3px;padding:1px 5px;margin-left:5px;vertical-align:middle;">✓ registered</span>`:''}
          </div>
          <div style="font-size:11px;color:var(--text2);">${c.role||'Coach'}</div>
        </div>
        ${avgRet!==null?`<div style="text-align:center;">
          <div style="font-family:'Bebas Neue';font-size:26px;line-height:1;color:${retCol};">${avgRet}%</div>
          <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">retention</div>
        </div>`:''}
        <span id="${uid}_arrow" style="color:var(--text2);font-size:13px;">▾</span>
      </div>

      <!-- Team chips -->
      ${(c.teams||[]).length ? `
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
        ${(c.teams||[]).slice(0,4).map(t=>`<span style="font-size:10px;background:${roleColor}18;border:1px solid ${roleColor}33;border-radius:4px;padding:2px 7px;white-space:nowrap;">${t.name}${t.year?` '${String(t.year).slice(-2)}`:''}</span>`).join('')}
        ${(c.teams||[]).length>4?`<span style="font-size:10px;color:var(--text2);">+${(c.teams||[]).length-4} more</span>`:''}
      </div>` : `<div style="font-size:11px;color:var(--text2);font-style:italic;margin-bottom:8px;">No teams linked yet</div>`}

      <!-- Spotlight stats (compact) -->
      ${myRet.length ? `
      <div style="font-size:10px;color:var(--text2);border-top:1px solid rgba(255,255,255,0.05);padding-top:8px;">
        ${bestTeam?`🏆 Best: <strong>${bestTeam.team} ${bestTeam.fromYear}</strong> (${bestTeam.pct}%)`:''}
        ${worstTeam?`<br>⚠️ Lowest: <strong>${worstTeam.team} ${worstTeam.fromYear}</strong> (${worstTeam.pct}%)`:''}
        ${trend?`<br><span style="color:${trendCol};">${trend}</span>`:''}
      </div>` : ''}
    </div>

    <!-- BACK — expanded edit/manage panel -->
    <div id="${uid}_body" style="display:none;border-top:1px solid var(--border);padding:12px 14px;">
      <!-- Name + role edit -->
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;">
        <input type="text" class="draft-input coach-name-input" value="${c.name}" placeholder="Coach name"
          list="coachDatalist" oninput="coachField(${c.id},'name',this.value)"
          style="flex:1;font-weight:700;font-size:13px;">
        <select class="draft-select" style="font-size:11px;padding:4px 7px;"
          onchange="coachField(${c.id},'role',this.value)">
          ${roles.map(r=>`<option value="${r}" ${c.role===r?'selected':''}>${r}</option>`).join('')}
        </select>
        <button class="btn btn-danger btn-sm" onclick="coachDelete(${c.id})" style="padding:3px 8px;font-size:11px;">✕</button>
      </div>

      <!-- Team assignments -->
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);margin-bottom:6px;">Team Links</div>
      ${assignmentRows||`<div style="font-size:11px;color:var(--text2);font-style:italic;margin-bottom:6px;">No teams linked</div>`}
      <!-- Quick-add row -->
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;align-items:center;">
        <select id="coach-team-sel-${c.id}" class="draft-select" style="font-size:11px;padding:3px 7px;flex:2;min-width:110px;">
          <option value="">+ Link team…</option>
          ${allTeams.filter(t=>!(c.teams||[]).some(a=>a.name===t)).map(t=>`<option value="${t.replace(/"/g,'&quot;')}">${t}</option>`).join('')}
        </select>
        <select id="coach-team-role-${c.id}" class="draft-select" style="font-size:11px;padding:3px 7px;">
          ${roles.map(r=>`<option value="${r}">${r}</option>`).join('')}
        </select>
        <select id="coach-team-year-${c.id}" class="draft-select" style="font-size:11px;padding:3px 7px;">
          <option value="">All yrs</option>
          ${allYrs.map(y=>`<option value="${y}" ${y===latestYr?'selected':''}>${y}</option>`).join('')}
        </select>
        <button class="btn btn-gold btn-sm" onclick="coachAddAssignment(${c.id})"
          style="font-size:11px;padding:3px 10px;">Link</button>
      </div>

      <!-- Notes -->
      <div style="margin-top:10px;">
        <input type="text" class="draft-input" value="${c.notes||''}" placeholder="Notes…"
          oninput="coachField(${c.id},'notes',this.value)"
          style="width:100%;font-size:11px;color:var(--text2);box-sizing:border-box;">
      </div>

      <!-- Claim team (cloud users) -->
      ${c._isCloudUser ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
        <button class="btn btn-primary btn-sm" onclick="showTeamClaimModal('${c.username}')"
          style="font-size:11px;width:100%;">🔗 Manage Team Claims</button>
      </div>` : ''}
    </div>
  </div>`;
}

function coachToggleExpand(id) {
  const body  = document.getElementById(`coach_${id}_body`);
  const arrow = document.getElementById(`coach_${id}_arrow`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (arrow) arrow.textContent = open ? '▾' : '▴';
}

// ── RENDER: Roster grid ───────────────────────────────────────────────────

// ── RENDER: Roster grid ───────────────────────────────────────────────────

// ── Coaches sub-tab switcher ──────────────────────────────────────────────

function switchCoachSub(sub) {
  // Sub-tab pills removed — coaches and analysis are on one page.
  // Kept as stub so legacy callers don't error.
  if (sub === 'teams') renderTeamsPage();
}

// ── Teams Page ────────────────────────────────────────────────────────────

function renderTeamsPage() {
  const el = document.getElementById('teamsPageGrid');
  if (!el) return;

  // Populate year dropdown
  const yearSel = document.getElementById('teamPageYear');
  if (yearSel && !yearSel.options.length) {
    const allYrs = years().sort((a,b)=>b-a);
    allYrs.forEach(y => {
      const o = document.createElement('option');
      o.value = y; o.text = y;
      yearSel.appendChild(o);
    });
    yearSel.value = String(allYrs[0]||2026);
  }

  const yr     = parseInt(document.getElementById('teamPageYear')?.value || years()[years().length-1]);
  const sport  = document.getElementById('teamPageSport')?.value || 'all';
  const combine = document.getElementById('teamPageCombine')?.checked || false;
  const prevYr = yr - 1;
  const prevYrPlayers = players.filter(p=>p.year===prevYr);
  const prevKeys = new Set(prevYrPlayers.map(retentionKey));
  const curYrPlayers = players.filter(p=>p.year===yr);

  // Build team groups
  // Default: key = name|||sport|||division (keeps same-named teams in different divisions separate)
  // Combined: key = name only (merges all divisions of same team name together)
  const teamMap = {};
  players.filter(p => p.year===yr && (sport==='all'||p.sport===sport)).forEach(p => {
    const t = (p.team||'').trim();
    if (!t || t.toLowerCase()==='unallocated' || t.toLowerCase()==='nan') return;
    const key = combine ? t.toLowerCase() : `${t}|||${p.sport}|||${p.division}`;
    if (!teamMap[key]) teamMap[key] = {
      name: t,
      sport: p.sport,
      division: combine ? null : p.division, // null = multi-division
      divisions: new Set(),
      sports: new Set(),
      players: []
    };
    teamMap[key].players.push(p);
    teamMap[key].divisions.add(p.division);
    teamMap[key].sports.add(p.sport);
  });

  if (!Object.keys(teamMap).length) {
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2);">
      No team data for ${yr}${sport!=='all'?' '+sport:''}.
      Teams are assigned during the draft or via the roster.
    </div>`;
    return;
  }

  const sportColors = { Baseball:'#2563eb', Softball:'#ec4899', 'T-Ball':'#8b5cf6' };

  el.innerHTML = Object.entries(teamMap)
    .sort(([,a],[,b]) => {
      const sA = [...a.sports][0]||'', sB = [...b.sports][0]||'';
      return sA.localeCompare(sB) || ([...a.divisions][0]||'').localeCompare([...b.divisions][0]||'') || a.name.localeCompare(b.name);
    })
    .map(([key, data]) => {
      const primarySport = [...data.sports].sort()[0] || 'Baseball';
      const color = sportColors[primarySport] || 'var(--gold)';
      const coaches = coachesForTeam(data.name, yr);
      const headCoach = coaches.find(c=>c.role==='Head Coach');
      const assistants = coaches.filter(c=>c.role!=='Head Coach');

      const returning = data.players.filter(p =>
        (prevKeys.has(retentionKey(p)) || ((_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p)))))
      ).length;
      const newPlayers = data.players.length - returning;
      const retPct  = data.players.length ? Math.round(returning/data.players.length*100) : 0;
      const retColor = retPct>=70?'var(--green)':retPct>=45?'var(--gold)':'#ef4444';

      const safeId = 'team_' + key.replace(/[^a-zA-Z0-9]/g,'_');

      // Division/sport label — show all if combined
      const divSportLabel = combine
        ? [...data.sports].join('/') + ' · ' + [...data.divisions].sort().join(', ')
        : `${data.sport} · ${data.division}`;

      const coachLine = headCoach
        ? `<span style="font-size:11px;color:var(--text2);">👤 ${headCoach.name}${assistants.length?` +${assistants.length} asst`:''}  ·</span>`
        : `<span style="font-size:11px;color:var(--text2);font-style:italic;">No coach assigned  ·</span>`;

      const coachBlock = headCoach
        ? `<div style="padding:8px 10px;background:${color}12;border-radius:8px;border-left:3px solid ${color};margin-bottom:10px;">
            <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Coaching Staff</div>
            <div style="font-weight:700;font-size:13px;">👤 ${headCoach.name}</div>
            ${assistants.map(a=>`<div style="font-size:12px;color:var(--text2);">🤝 ${a.name} (${a.role})</div>`).join('')}
           </div>`
        : `<div style="margin-bottom:10px;font-size:12px;color:var(--text2);font-style:italic;">
            No coaches assigned — <span style="color:var(--gold);cursor:pointer;text-decoration:underline;"
            onclick="switchTab('coaches')">add via Coaches tab</span>
           </div>`;

      const playerList = data.players
        .sort((a,b) => a.last.localeCompare(b.last))
        .map(p => {
          const ret = (prevKeys.has(retentionKey(p)) || ((_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p)))));
          const divBadge = combine
            ? `<span class="badge badge-${(p.division||'').toLowerCase().replace(/[^a-z]/g,'')}" style="font-size:9px;">${p.division}</span>`
            : '';
          return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;
                      border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;"
                      onclick="showJourney(${players.indexOf(p)})" title="View player">
            <span style="font-size:13px;font-weight:600;flex:1;">${p.first} ${p.last}</span>
            ${divBadge}
            <span style="font-size:10px;color:var(--text2);">${p.city||''}</span>
            <span class="badge ${ret?'badge-returning':'badge-new'}" style="font-size:10px;">${ret?'↩':'✦'}</span>
          </div>`;
        }).join('');

      // Combined-mode: group player list by division
      const groupedPlayerList = combine && data.divisions.size > 1
        ? [...data.divisions].sort().map(div => {
            const divPlayers = data.players.filter(p=>p.division===div).sort((a,b)=>a.last.localeCompare(b.last));
            const divColor = sportColors[divPlayers[0]?.sport] || color;
            return `<div style="margin-bottom:10px;">
              <div style="font-size:10px;color:${divColor};text-transform:uppercase;letter-spacing:.5px;font-weight:700;
                          padding:4px 0;border-bottom:1px solid ${divColor}33;margin-bottom:4px;">
                ${divPlayers[0]?.sport||''} · ${div} (${divPlayers.length})
              </div>
              ${divPlayers.map(p => {
                const ret = (prevKeys.has(retentionKey(p)) || ((_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p)))));
                return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;
                            border-bottom:1px solid rgba(255,255,255,0.03);cursor:pointer;"
                            onclick="showJourney(${players.indexOf(p)})" title="View player">
                  <span style="font-size:13px;font-weight:600;flex:1;">${p.first} ${p.last}</span>
                  <span style="font-size:10px;color:var(--text2);">${p.city||''}</span>
                  <span class="badge ${ret?'badge-returning':'badge-new'}" style="font-size:10px;">${ret?'↩':'✦'}</span>
                </div>`;
              }).join('')}
            </div>`;
          }).join('')
        : playerList;

      return `<div class="card" style="padding:0;overflow:hidden;margin-bottom:10px;">
        <div onclick="toggleRankDetail('${safeId}')"
          style="padding:14px 16px;background:${color}15;cursor:pointer;
                 display:flex;align-items:center;gap:12px;flex-wrap:wrap;user-select:none;">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-family:'Bebas Neue';font-size:19px;letter-spacing:1px;color:#fff;
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${data.name}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
              <span style="font-size:11px;color:var(--text2);">${divSportLabel}</span>
              <span style="color:var(--border);">·</span>
              ${coachLine}
              <span style="font-size:11px;color:var(--text2);">
                <strong style="color:${color};">${data.players.length}</strong> players
                <span style="color:var(--text2);opacity:.7;margin-left:4px;">(↩${returning} ret · ✦${newPlayers} new)</span>
              </span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-shrink:0;">
            <div style="text-align:center;">
              <div style="font-family:'Bebas Neue';font-size:22px;color:${retColor};">${retPct}%</div>
              <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">retention</div>
            </div>
            <div style="font-size:13px;color:var(--text2);">▾</div>
          </div>
        </div>
        <div id="${safeId}" style="display:none;padding:14px 16px;border-top:1px solid var(--border);">
          ${coachBlock}
          <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;
              font-weight:700;margin-bottom:6px;">Roster (${data.players.length})</div>
          ${groupedPlayerList}
        </div>
      </div>`;
    }).join('');
}



function renderCoachRoster() {
  const el = document.getElementById('coachRosterGrid');
  if (!el) return;

  const localCoaches = coachGetAll().filter(c => c.name && c.name.trim());
  const localNames   = new Set(localCoaches.map(c => c.name.toLowerCase()));

  // Merge in cloud-registered coaches not already in local list
  let cloudOnly = [];
  try {
    const cached = JSON.parse(localStorage.getItem('lll_cached_coaches') || '[]');
    cloudOnly = cached
      .filter(c => {
        const dn = c.displayName || c.username;
        return dn && !localNames.has(dn.toLowerCase()) && !localNames.has(c.username.toLowerCase());
      })
      .map(c => ({
        id: 'cloud_' + c.username,
        name: c.displayName || c.username,
        username: c.username,
        role: 'Coach',
        teams: (c.teams || []).map(t => ({ name: t.name, year: t.year, role: 'Coach' })),
        phone: '', email: '', notes: '',
        _isCloudUser: true
      }));
  } catch {}

  const allCoaches = [...localCoaches, ...cloudOnly];

  if (!allCoaches.length) {
    el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;
        background:rgba(255,255,255,0.03);border:1px dashed var(--border);border-radius:14px;">
      <div style="font-size:32px;margin-bottom:8px;">👤</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:6px;">No coaches yet</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;">
        Add coaches to the roster, then link them to team names from registration data.
      </div>
      <button class="btn btn-gold" onclick="coachAddNew()">+ Add First Coach</button>
    </div>`;
    return;
  }
  el.innerHTML = allCoaches.map(c => _coachCard(c)).join('');
}

// ── RENDER: Retention Table ───────────────────────────────────────────────

function renderCoachRetentionTable() {
  const el = document.getElementById('coachRetentionContent');
  if (!el) return;
  const allRet = computeTeamRetention();
  if (!allRet.length) { el.innerHTML = '<div class="empty">No team data available.</div>'; return; }

  const pairs = [...new Set(allRet.map(r=>`${r.fromYear}→${r.toYear}`))].sort().reverse();
  let html = '';
  pairs.forEach(pair => {
    const rows = allRet.filter(r=>`${r.fromYear}→${r.toYear}`===pair).sort((a,b)=>b.pct-a.pct);
    html += `<div style="margin-bottom:20px;">
      <div style="font-family:Bebas Neue;font-size:16px;letter-spacing:1px;color:var(--gold);margin-bottom:8px;">${pair}</div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Team</th>
          <th style="text-align:left;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Head Coach</th>
          <th style="text-align:left;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Assistants</th>
          <th style="text-align:right;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Players</th>
          <th style="text-align:right;padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Returned</th>
          <th style="padding:6px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;min-width:160px;">Retention</th>
        </tr></thead><tbody>
        ${rows.map(r => {
          const coaches = coachesForTeam(r.team, r.fromYear);
          const head  = coaches.filter(c=>c.role==='Head Coach').map(c=>c.name).join(', ') || '—';
          const assts = coaches.filter(c=>c.role!=='Head Coach').map(c=>`${c.name} (${c.role})`).join(', ') || '—';
          const bc = r.pct>=70?'var(--green)':r.pct>=45?'var(--gold)':'var(--red)';
          return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:6px 10px;font-weight:600;">${r.team}</td>
            <td style="padding:6px 10px;">${head}</td>
            <td style="padding:6px 10px;color:var(--text2);font-size:11px;">${assts}</td>
            <td style="padding:6px 10px;text-align:right;">${r.total}</td>
            <td style="padding:6px 10px;text-align:right;">${r.returned}</td>
            <td style="padding:6px 10px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="flex:1;background:rgba(255,255,255,0.07);border-radius:3px;height:6px;">
                  <div style="width:${r.pct}%;background:${bc};height:100%;border-radius:3px;"></div>
                </div>
                <span style="font-size:12px;font-weight:700;color:${bc};min-width:36px;">${r.pct}%</span>
              </div>
            </td>
          </tr>`;
        }).join('')}
        </tbody></table></div>
    </div>`;
  });
  el.innerHTML = html;
}

// ── RENDER: Chart ─────────────────────────────────────────────────────────

function renderCoachRetentionChart() {
  const sel = document.getElementById('coachChartYear');
  if (!sel) return;
  const allRet = computeTeamRetention();
  const pairs  = [...new Set(allRet.map(r=>`${r.fromYear}→${r.toYear}`))].sort().reverse();
  if (!sel.options.length) {
    pairs.forEach(p => { const o = document.createElement('option'); o.value = p; o.text = p; sel.appendChild(o); });
  }
  const chosen = sel.value || pairs[0];
  if (!sel.value) sel.value = chosen;
  const rows = allRet.filter(r=>`${r.fromYear}→${r.toYear}`===chosen).sort((a,b)=>b.pct-a.pct);
  if (!rows.length) return;

  const labels   = rows.map(r => {
    const hc = coachesForTeam(r.team, r.fromYear).filter(c=>c.role==='Head Coach').map(c=>c.name)[0];
    return hc ? `${r.team}  · ${hc}` : r.team;
  });
  const pcts     = rows.map(r=>r.pct);
  const bgColors = pcts.map(p=>p>=70?'#10b98199':p>=45?'#f5a62399':'#ef444499');
  const bdColors = pcts.map(p=>p>=70?'#10b981'  :p>=45?'#f5a623'   :'#ef4444');

  destroyChart('coachRetentionChart');
  const ctx = document.getElementById('coachRetentionChart');
  if (!ctx) return;
  chartInstances['coachRetentionChart'] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets:[{ label:'Retention %', data:pcts,
      backgroundColor:bgColors, borderColor:bdColors, borderWidth:2, borderRadius:6 }] },
    options: {
      indexAxis:'y', responsive:true, maintainAspectRatio:false, animation:{ duration:400 },
      plugins: {
        legend:{ display:false },
        tooltip:{ callbacks:{ label: ctx =>
          ` ${ctx.raw}%  (${rows[ctx.dataIndex].returned}/${rows[ctx.dataIndex].total} players returned)` }}
      },
      scales: {
        x:{ min:0, max:100, ticks:{ color:'#94a3b8', callback:v=>v+'%' }, grid:{ color:'rgba(255,255,255,0.05)' } },
        y:{ ticks:{ color:'#94a3b8', font:{ size:11 } }, grid:{ display:false } }
      }
    }
  });
    patchChartClick('coachRetentionChart', null, null);
}

// Keep the coach datalist in sync with the registry + cloud coach profiles
function renderCoachDatalist() {
  const dl = document.getElementById('coachDatalist');
  if (!dl) return;
  // Local coaches
  const localNames = coachGetAll().filter(c => c.name).map(c => c.name);
  // Cloud coaches (already cached from last sync)
  const cloudNames = [];
  try {
    const cached = JSON.parse(localStorage.getItem('lll_cached_coaches') || '[]');
    cached.forEach(c => {
      if (c.displayName && !localNames.includes(c.displayName)) cloudNames.push(c.displayName);
      if (c.username  && !localNames.includes(c.username))      cloudNames.push(c.username);
    });
  } catch {}
  const allNames = [...new Set([...localNames, ...cloudNames])];
  dl.innerHTML = allNames.map(n => `<option value="${n.replace(/"/g,'&quot;')}">`).join('');
}

// Refresh cloud coach cache periodically
async function refreshCloudCoachCache() {
  if (!jbEnabled()) return;
  try {
    const coaches = await getSharedCoaches();
    localStorage.setItem('lll_cached_coaches', JSON.stringify(coaches));
    renderCoachDatalist();
  } catch {}
}


// ── Full tab ──────────────────────────────────────────────────────────────

function renderCoachTab() {
  // Refresh cloud coach list so newly registered coaches appear
  refreshCloudCoachCache().then(() => renderCoachRoster());
  renderCoachRoster();
  renderCoachDatalist();
  const hasLinked = coachGetAll().some(c => (c.teams||[]).length > 0);
  const analysisEl = document.getElementById('coachAnalysisSection');
  if (analysisEl) analysisEl.style.display = hasLinked ? '' : 'none';
  // + Add Coach button is now in the static tab header
  if (hasLinked) {
    renderCoachRetentionTable();
    renderCoachRetentionChart();
  }
}

// ── Wire coaches into draft setup dropdowns ───────────────────────────────
// Call this from renderDraftSetup to populate a coach picker from the registry

function coachPickerOptions(selectedName) {
  const coaches = coachGetAll();
  const opts = coaches.map(c =>
    `<option value="${(c.name||'').replace(/"/g,'&quot;')}" ${c.name===selectedName?'selected':''}>${c.name}</option>`
  ).join('');
  return `<option value="">— Type or select —</option>${opts}`;
}


// RENDER: ROSTER
function renderRoster() {
  // Populate year dropdown dynamically from data
  const yearEl = document.getElementById('filterYear');
  const currentYrVal = yearEl.value;
  const allYrs = years().sort((a,b) => b-a); // newest first
  const latestYr = allYrs[0] || 2026;
  yearEl.innerHTML = '<option value="all">All Years</option>' +
    allYrs.map(y => `<option value="${y}" ${String(y)===currentYrVal?'selected':''}>${y}</option>`).join('');
  // Default to latest year on first load
  if (!currentYrVal || currentYrVal === 'all' && !yearEl.dataset.touched) {
    yearEl.value = String(latestYr);
  }
  yearEl.dataset.touched = '1';

  const yr = yearEl.value;
  const sport = document.getElementById('filterSport').value;
  const divEl = document.getElementById('filterDiv');
  const div = divEl.value;
  const q = (document.getElementById('filterSearch').value||'').toLowerCase();
  const divs = [...new Set(players.filter(p=>sport==='all'||p.sport===sport).map(p=>p.division))].sort();
  const curDiv = divEl.value;
  divEl.innerHTML = '<option value="all">All Divisions</option>'+divs.map(d=>`<option value="${d}" ${d===curDiv?'selected':''}>${d}</option>`).join('');
  const latestYrNum = years()[years().length-1] || 2026;
  const prevYrNum   = years()[years().length-2] || 2025;
  const playersLatest = players.filter(p=>p.year===latestYrNum);
  const playersPrev   = players.filter(p=>p.year===prevYrNum);
  // prevKeys needed for status badge — define here so it's always available
  const prevKeys = new Set(playersPrev.map(retentionKey));

  let filtered = players.filter(p=>{
    if(yr!=='all'&&p.year!=yr) return false;
    if(sport!=='all'&&p.sport!==sport) return false;
    if(div!=='all'&&p.division!==div) return false;
    if(q&&!(`${p.first} ${p.last} ${p.city||''} ${p.team||''}`).toLowerCase().includes(q)) return false;
    return true;
  });

  // When a search is active and showing All Years, deduplicate by person —
  // keep only the most recent registration for each unique player+sport combo.
  const isSearching = q.length > 0;
  if (isSearching && yr === 'all') {
    const seen = {};
    const deduped = [];
    // Sort newest first so we keep the latest record
    const sorted = [...filtered].sort((a,b) => b.year - a.year);
    sorted.forEach(p => {
      const key = `${p.first}|${p.last}|${p.sport}`.toLowerCase();
      if (!seen[key]) { seen[key] = true; deduped.push(p); }
    });
    filtered = deduped;
  }
  filtered.sort((a,b)=>{
    let av=a[sortKey]||'',bv=b[sortKey]||'';
    if(typeof av==='number') return (av-bv)*sortDir;
    return av.toString().localeCompare(bv.toString())*sortDir;
  });
  document.getElementById('rosterCount').textContent = `${filtered.length} player${filtered.length!==1?'s':''}`;
  const rows = [];
  for (const p of filtered) {
   try {
    const sportSafe = (p.sport||'Baseball');
    const divSafe   = (p.division||'');
    const sportBadge = `<span class="badge badge-${sportSafe.toLowerCase().replace(/[^a-z]/g,'')}">` + sportSafe + `</span>`;
    const divBadge   = divSafe ? `<span class="badge badge-${divSafe.toLowerCase().replace(/[^a-z]/g,'')}">` + divSafe + `</span>` : `<span style="color:var(--text2);font-size:11px;">—</span>`;
    let status = '';
    if(p.year===latestYrNum) {
      // Returning = had a record last year (same sport OR progressed from T-Ball/lower div)
      const prevRecord = playersPrev.find(x => playerKey(x) === playerKey(p));
      const wasHereBefore = prevRecord
        ? (prevKeys.has(retentionKey(prevRecord)) || isRetained(prevRecord, playersLatest))
        : false;
      status = wasHereBefore
        ? `<span class="badge badge-returning">Returning</span>`
        : `<span class="badge badge-new">New</span>`;
    } else if(p.year===prevYrNum) {
      const retained = !isAgedOut(p) && isRetained(p, playersLatest);
      const aged     = isAgedOut(p);
      status = aged
        ? `<span class="badge" style="background:rgba(148,163,184,.15);color:#94a3b8;">Aged Out</span>`
        : retained
          ? `<span class="badge badge-returning">Retained</span>`
          : `<span class="badge" style="background:rgba(239,68,68,.18);color:#fca5a5;">Not Retained</span>`;
    }
    const realIdx = players.indexOf(p);
    const teamName = (p.team&&p.team!=='nan'&&p.team!=='') ? p.team : null;
    const teamDisplay = teamName
      ? `<span class="team-link" onclick="showTeamModal(this.dataset.team,${p.year},'${p.sport}','${p.division}')" data-team="${teamName.replace(/"/g,'&quot;')}">${teamName}</span>`
      : `<span style="color:var(--text2);font-size:11px;font-style:italic;">Unassigned</span>`;
    const _pKey = `${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`;
    const _hasStats = typeof GC_STATS!=='undefined' && GC_STATS.some(s=>s.key===_pKey);
    const _recentAS = (p.allstar_years||[]).some(y => y >= new Date().getFullYear() - 1);
    rows.push(`<tr class="roster-row">
      <td style="cursor:pointer;">
        <div onclick="showJourney(${realIdx})" title="View player profile"
          style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 8px;border-radius:8px;cursor:pointer;
            background:${_recentAS?'rgba(245,166,35,0.1)':'rgba(255,255,255,0.05)'};
            border:1px solid ${_recentAS?'rgba(245,166,35,0.45)':'rgba(255,255,255,0.1)'};
            transition:all .12s;"
          onmouseover="this.style.background='rgba(96,165,250,0.12)';this.style.borderColor='rgba(96,165,250,0.4)'"
          onmouseout="this.style.background='${_recentAS?'rgba(245,166,35,0.1)':'rgba(255,255,255,0.05)'}';this.style.borderColor='${_recentAS?'rgba(245,166,35,0.45)':'rgba(255,255,255,0.1)'}'">
          ${_recentAS?'<span style="font-size:10px;">⭐</span>':''}
          <span style="font-weight:600;color:var(--text);font-size:13px;">${p.first} ${p.last}</span>
          ${(_hasStats&&(typeof canShowStats!=='function'||canShowStats())) ? '<span style="font-size:9px;color:#60a5fa;">📊</span>' : ''}
          ${(p._evalScore && canShowEvalData()) ? `<span title="Eval score: ${p._evalScore}/100" style="font-size:10px;font-family:Bebas Neue;padding:0 5px;border-radius:3px;background:${p._evalScore>=70?'rgba(96,165,250,0.15)':p._evalScore>=50?'rgba(245,166,35,0.15)':'rgba(239,68,68,0.15)'};color:${p._evalScore>=70?'#60a5fa':p._evalScore>=50?'#f5a623':'#ef4444'};">${p._evalScore}</span>` : ''}
        </div>
        ${isSearching && yr==='all' ? (() => {
          const hist = players.filter(x => x.first===p.first && x.last===p.last && (x.sport===p.sport||x.sport==='T-Ball'||p.sport==='T-Ball'));
          const yrs = [...new Set(hist.map(x=>x.year))].sort();
          return yrs.length > 1
            ? `<span style="font-size:10px;color:var(--text2);display:block;padding-left:8px;margin-top:2px;">${yrs.join(', ')}</span>`
            : '';
        })() : ''}
      </td>
      <td><span style="color:var(--text2)">${p.year}</span></td>
      <td>${sportBadge}</td>
      <td>${divBadge}</td>
      <td style="color:var(--text2)">${p.city||'—'}</td>
      <td style="color:var(--text2);font-size:12px">${teamDisplay}</td>
      <td>${status}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="editPlayer(${realIdx})" style="padding:3px 8px;font-size:11px;">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deletePlayer(${realIdx})" style="padding:3px 8px;font-size:11px;margin-left:4px;">Del</button>
      </td>
    </tr>`);
   } catch(rowErr) { console.warn('Row render error:', rowErr, p); }
  }
  document.getElementById('rosterBody').innerHTML = rows.join('');
}

function sortRoster(key) {
  if(sortKey===key) sortDir*=-1; else { sortKey=key; sortDir=1; }
  renderRoster();
}

// TEAM MODAL
function showTeamModal(teamName, year, sport, division) {
  if (typeof teamName !== 'string') return;
  year = parseInt(year);
  // Filter by division too when provided — prevents same-name teams across divisions merging
  const teamPlayers = players.filter(p =>
    p.year === year && p.sport === sport && p.team === teamName &&
    (!division || division === 'undefined' || p.division === division)
  );
  const divLabel = division && division !== 'undefined' ? ` · ${division}` : '';
  document.getElementById('teamModalTitle').textContent = teamName;
  document.getElementById('teamNameInput').value = teamName;
  document.getElementById('teamModalMeta').textContent = `${sport}${divLabel} · ${year} · ${teamPlayers.length} player${teamPlayers.length!==1?'s':''}`;
  document.getElementById('teamNameInput').dataset.oldName = teamName;
  document.getElementById('teamNameInput').dataset.year = year;
  document.getElementById('teamNameInput').dataset.sport = sport;
  document.getElementById('teamNameInput').dataset.division = division || '';
  const yearSel = document.getElementById('teamYearSelect');
  if (yearSel) { yearSel.value = year; if (!yearSel.value) yearSel.value = 2026; }
  const prevYr = year - 1;
  const prevYrPlayers = players.filter(p=>p.year===prevYr);
  // prevKeys used for fast name-based lookup; isRetained() handles cross-sport progression
  const prevKeys = new Set(prevYrPlayers.map(retentionKey));
  const curYrPlayers = players.filter(p=>p.year===(typeof curYr!=='undefined'?curYr:prevYr+1));
  let html = '';
  if (teamPlayers.length === 0) {
    html = '<div class="empty">No players found on this team.</div>';
  } else {
    html = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:1px solid var(--border);">
        <th style="text-align:left;padding:7px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Name</th>
        <th style="text-align:left;padding:7px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Division</th>
        <th style="text-align:left;padding:7px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">City</th>
        <th style="text-align:left;padding:7px 10px;color:var(--text2);font-size:11px;text-transform:uppercase;">Status</th>
      </tr></thead><tbody>`;
    teamPlayers.forEach(p => {
      const badge = (prevKeys.has(retentionKey(p)) || (_pPrev => _pPrev ? isRetained(_pPrev, curYrPlayers) : false)(prevYrPlayers.find(x=>playerKey(x)===playerKey(p))))
        ? `<span class="badge badge-returning">Returning</span>`
        : `<span class="badge badge-new">New</span>`;
      const pIdx = players.indexOf(p);
      html += `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:7px 10px;font-weight:600;cursor:pointer;" onclick="showJourney(${pIdx})" title="View player profile">
          <span style="border-bottom:1px dashed rgba(255,255,255,0.2);">${p.first} ${p.last}</span>
        </td>
        <td style="padding:7px 10px;"><span class="badge badge-${(p.division||'').toLowerCase().replace(/[^a-z]/g,'')}">${p.division||'—'}</span></td>
        <td style="padding:7px 10px;color:var(--text2);">${p.city||'—'}</td>
        <td style="padding:7px 10px;">${badge}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }
  document.getElementById('teamPlayerList').innerHTML = html;
  openModal('teamModal');
  // Populate coach section after modal opens
  setTimeout(renderTeamCoachRows, 50);
}

function saveTeamYear() {
  const input = document.getElementById('teamNameInput');
  const teamName = input.dataset.oldName;
  const oldYear = parseInt(input.dataset.year);
  const newYear = parseInt(document.getElementById('teamYearSelect').value);
  const sport = input.dataset.sport;
  const division = input.dataset.division || null;
  if (isNaN(newYear)) { toast('Please select a valid year', 'error'); return; }
  if (newYear === oldYear) { toast('Year is already ' + oldYear, 'error'); return; }
  let cnt = 0;
  players.forEach(p => {
    if (p.year === oldYear && p.sport === sport && p.team === teamName &&
        (!division || division === 'undefined' || p.division === division)) {
      p.year = newYear; cnt++;
    }
  });
  if (cnt === 0) { toast('No players found to update', 'error'); return; }
  closeModal('teamModal');
  refreshAll();
  save();
  setTimeout(authCloudPush, 600);
  toast(`Moved ${cnt} player${cnt!==1?'s':''} on "${teamName}" from ${oldYear} → ${newYear}`, 'success');
}

function saveTeamName() {
  const input = document.getElementById('teamNameInput');
  const oldName = input.dataset.oldName;
  const newName = input.value.trim();
  const year = parseInt(input.dataset.year);
  const sport = input.dataset.sport;
  if (!newName) { toast('Team name cannot be empty', 'error'); return; }
  if (newName === oldName) { closeModal('teamModal'); return; }
  const division = input.dataset.division || null;
  let cnt = 0;
  players.forEach(p => {
    if (p.year === year && p.sport === sport && p.team === oldName &&
        (!division || division === 'undefined' || p.division === division)) {
      p.team = newName; cnt++;
    }
  });
  // Also update coach registry team references
  const coaches = coachGetAll();
  coaches.forEach(c => {
    (c.teams||[]).forEach(t => { if (t.name === oldName) t.name = newName; });
  });
  coachSaveAll(coaches);
  save();
  closeModal('teamModal');
  refreshAll();
  const divStr = division && division !== 'undefined' ? ` in ${division}` : '';
  toast(`✓ Renamed to "${newName}" for ${cnt} player${cnt!==1?'s':''}${divStr}`);
}

// ── Team modal coach section ──────────────────────────────────────────────

function _teamCoachKey() {
  const inp = document.getElementById('teamNameInput');
  return `${inp.dataset.oldName}|${inp.dataset.year}|${inp.dataset.sport}`;
}

function renderTeamCoachRows() {
  const el = document.getElementById('teamCoachRows');
  if (!el) return;
  const inp  = document.getElementById('teamNameInput');
  const team = inp.dataset.oldName;
  const year = inp.dataset.year;
  const teamSafe = (team||'').replace(/'/g,"\\'");

  const allCoaches = coachGetAll();
  const linked = allCoaches
    .map(c => {
      const match = (c.teams||[]).find(t =>
        t.name === team && (!t.year || String(t.year) === String(year))
      );
      return match ? { coach: c, role: match.role || 'Head Coach' } : null;
    })
    .filter(Boolean)
    .sort((a,b) => {
      const order = ['Head Coach','Assistant Coach','Volunteer'];
      return order.indexOf(a.role) - order.indexOf(b.role);
    });

  const headCoach  = linked.find(x => x.role === 'Head Coach') || null;
  const assistants = linked.filter(x => x.role !== 'Head Coach');

  // Render a labelled coach row — identical style to draft setup
  function coachRow(label, item, role) {
    const cid   = item ? item.coach.id : null;
    const cname = item ? (item.coach.name||'') : '';
    const onchange = item
      ? `teamUpdateCoachName(${cid}, this.value)`
      : `teamAssignNewCoach('${teamSafe}','${year}','${role}',this.value)`;
    const removeBtn = item
      ? `<button onclick="teamRemoveCoach(${cid},'${teamSafe}',${year})"
            title="Remove" style="background:none;border:none;color:var(--text2);
            cursor:pointer;font-size:13px;padding:0 2px;line-height:1;">✕</button>`
      : '';
    return `<div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:11px;color:var(--text2);min-width:90px;flex-shrink:0;">${label}</span>
      <input type="text" class="draft-input" value="${cname}" list="coachDatalist"
        placeholder="Type name or select…"
        onchange="${onchange}"
        style="flex:1;font-size:13px;">
      ${removeBtn}
    </div>`;
  }

  let html = coachRow('👤 Head Coach', headCoach, 'Head Coach');

  // Always show at least 1 assistant slot; show all existing ones
  const asstSlots = assistants.length ? assistants : [null];
  asstSlots.forEach((item, i) => {
    html += coachRow(`🤝 Asst. ${i+1}`, item, 'Assistant Coach');
  });

  el.innerHTML = html;
}

// Called when an empty slot input gets a value — creates/links the coach
function teamAssignNewCoach(teamName, year, role, name) {
  if (!name || !name.trim()) return;
  const coaches = coachGetAll();
  let coach = coaches.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
  if (!coach) {
    coach = { id: Date.now(), name: name.trim(), phone:'', email:'', role, teams:[], notes:'' };
    coaches.push(coach);
  }
  if (!coach.teams) coach.teams = [];
  if (!coach.teams.some(t => t.name === teamName && (!t.year || String(t.year) === String(year)))) {
    coach.teams.push({ name: teamName, role, year: String(year) });
  }
  coachSaveAll(coaches);
  renderTeamCoachRows();
  renderCoachDatalist();
}

function teamUpdateCoachName(coachId, newName) {
  if (!newName.trim()) return;
  const coaches = coachGetAll();
  const c = coaches.find(x => x.id === coachId);
  if (!c) return;
  c.name = newName.trim();
  coachSaveAll(coaches);
  renderCoachDatalist();
}

function teamUpdateCoachRole(coachId, teamName, year, newRole) {
  const coaches = coachGetAll();
  const c = coaches.find(x => x.id === coachId);
  if (!c) return;
  const t = (c.teams||[]).find(t => t.name === teamName && (!t.year || String(t.year) === String(year)));
  if (t) t.role = newRole;
  coachSaveAll(coaches);
  renderTeamCoachRows();
}

function teamRemoveCoach(coachId, teamName, year) {
  const coaches = coachGetAll();
  const c = coaches.find(x => x.id === coachId);
  if (!c) return;
  c.teams = (c.teams||[]).filter(t => !(t.name === teamName && (!t.year || String(t.year) === String(year))));
  coachSaveAll(coaches);
  renderTeamCoachRows();
  toast('Coach unlinked from this team');
}

function teamAddAssistantRow() {
  // Add a placeholder assistant coach slot — user fills it in via the input
  const inp  = document.getElementById('teamNameInput');
  const team = inp.dataset.oldName;
  const year = inp.dataset.year;
  const coaches = coachGetAll();
  const linked = coaches.filter(c =>
    (c.teams||[]).some(t => t.name === team && (!t.year || String(t.year) === String(year)) && t.role !== 'Head Coach')
  );
  if (linked.length >= 4) { toast('Maximum 4 assistants', 'error'); return; }
  // Add a blank placeholder coach that becomes real when the user types a name
  const placeholder = { id: Date.now(), name: '', phone:'', email:'', role:'Assistant Coach', teams:[
    { name: team, role: 'Assistant Coach', year: String(year) }
  ], notes:'' };
  coaches.push(placeholder);
  coachSaveAll(coaches);
  renderTeamCoachRows();
  // Focus the new input
  setTimeout(() => {
    const inputs = document.querySelectorAll('#teamCoachRows input[type="text"]');
    if (inputs.length) inputs[inputs.length-1].focus();
  }, 60);
}

// RENDER: MANAGE
function renderManage() {
  const yr = years();
  let html = '';
  yr.forEach(y=>{
    ['Baseball','Softball','T-Ball'].forEach(s=>{
      const n = count(y,s);
      if(n) html += `<div class="info-row"><span class="ir-label">${y} — ${s}</span><span class="ir-val">${n} players | ${fmt$(revenue(y,s))}</span></div>`;
    });
  });
  html += `<div class="info-row" style="border-bottom:none"><span class="ir-label"><strong>TOTAL</strong></span><span class="ir-val"><strong>${players.length} players | ${fmt$(revenue())}</strong></span></div>`;
  document.getElementById('dataSummary').innerHTML = html;

  // Show admin-only feature flags panel and sync toggle states
  const flagsPanel = document.getElementById('adminFlagsPanel');
  if (flagsPanel) {
    flagsPanel.style.display = isAdmin() ? '' : 'none';
    if (isAdmin()) _renderFeatureFlagToggles();
  }
}

// ALL RENDERS
function refreshAll() {
  if (typeof navRestoreState === 'function') navRestoreState();
  renderCoachDatalist();
  // NOTE: intentionally NOT calling save() here — refreshAll is called after cloud
  // pulls which would cause a push→pull→push loop. Saves happen explicitly in
  // edit/add functions that actually mutate data.
  updateHeader();
  renderOverview();
  renderYoY();
  renderHealth();
  renderAllStars();
  renderRoster();
  renderManage();
}

function isAdmin() {
  const u = authCurrentUser();
  if (!u) return false;
  const uname = u.username.toLowerCase();
  // Allow configurable admin username stored in localStorage
  const configuredAdmin = localStorage.getItem('lll_admin_username');
  if (configuredAdmin && uname === configuredAdmin.toLowerCase()) return true;
  return uname === 'coach_steele';
}

function updateHeader() {
  const latestYr = years()[years().length-1]||2026;
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  // Aug-Nov = registration/planning for next year; Dec-Jul = current spring season
  const seasonLabel = (month >= 8 && month <= 11) ? `${latestYr + 1} Season Preview` : `Spring ${latestYr} Season`;
  const _hs = document.getElementById('headerSub'); if (_hs) _hs.innerHTML = `${seasonLabel} &nbsp;·&nbsp; ${count(latestYr)} registered &nbsp;·&nbsp; ${fmt$(revenue(latestYr))} revenue`;
  // Hide Manage Data tab for non-admins (always visible to real admin even in preview)
  const manageTab = document.querySelector('[data-tab="manage"]');
  if (manageTab) manageTab.style.display = isAdmin() ? '' : 'none';
  // Hide Settings button from non-admins
  const settingsBtn = document.getElementById('settingsHeaderBtn');
  if (settingsBtn) settingsBtn.style.display = isAdmin() ? '' : 'none';
  // Show/hide journey modal Evals tab based on eval visibility
  const jEvalsTab = document.getElementById('jTab-evals');
  if (jEvalsTab) jEvalsTab.style.display = canShowEvalData() ? '' : 'none';
  // Restore preview banner if still in preview mode
  _applyPreviewBanner();
  // Apply feature flag visibility
  applyFeatureFlags();
}

// TABS
const TAB_IDS = ['overview','yoy','health','timing','allstars','roster','teams','coaches','timeline','evals','social','manage','draft','tools'];
// ═══════════════════════════════════════════════════════════
// EVALUATIONS MODULE

// Categories: manual scoring 1-10 each
// Auto-populated from GC stats where available (shown greyed out, overrideable)
// ── Drill definitions ─────────────────────────────────────────────────────
// Each drill has sub-principles rated 1-5 (Poor/Fair/Good/Very Good/Excellent)
// weight: how much this drill contributes to overall score
const EVAL_DRILLS = [
  {
    id: 'batting_cage', label: 'Batting Cage', icon: '⚾', weight: 0.18,
    principles: [
      { id: 'contact',      label: 'Contact' },
      { id: 'power',        label: 'Power' },
      { id: 'timing',       label: 'Timing' },
      { id: 'mechanics',    label: 'Mechanics' },
      { id: 'bunting',      label: 'Bunting Ability' },
    ]
  },
  {
    id: 'pitching', label: 'Pitching Drill', icon: '💪', weight: 0.14,
    principles: [
      { id: 'accuracy',     label: 'Accuracy' },
      { id: 'power',        label: 'Power/Velocity' },
      { id: 'mechanics',    label: 'Mechanics' },
      { id: 'experience',   label: 'Experience' },
    ]
  },
  {
    id: 'around_horn', label: 'Around the Horn', icon: '🎯', weight: 0.13,
    principles: [
      { id: 'throw_acc',    label: 'Throwing Accuracy' },
      { id: 'transition',   label: 'Transition' },
      { id: 'athleticism',  label: 'Athleticism' },
      { id: 'catching',     label: 'Catching' },
      { id: 'throw_power',  label: 'Throwing Power' },
    ]
  },
  {
    id: 't_work', label: 'T Work / Soft Toss', icon: '🪃', weight: 0.10,
    principles: [
      { id: 'timing',       label: 'Timing' },
      { id: 'swing_mech',   label: 'Swing Mechanics' },
      { id: 'power',        label: 'Power' },
    ]
  },
  {
    id: 'running', label: 'Running Drill', icon: '⚡', weight: 0.10,
    principles: [
      { id: 'speed',        label: 'Speed' },
      { id: 'instincts',    label: 'Instincts' },
      { id: 'reaction',     label: 'Reaction Time' },
      { id: 'quickness',    label: 'Quickness' },
    ]
  },
  {
    id: 'grounders', label: 'Grounders', icon: '🧤', weight: 0.13,
    principles: [
      { id: 'field_form',   label: 'Fielding Form' },
      { id: 'footwork',     label: 'Footwork' },
      { id: 'glovework',    label: 'Glovework' },
      { id: 'transition',   label: 'Transition to Throw' },
      { id: 'throwing',     label: 'Throwing' },
      { id: 'charges_ball', label: 'Charges the Ball?' },
      { id: 'backhand',     label: 'Proper Backhand?' },
    ]
  },
  {
    id: 'turning_two', label: 'Turning Two', icon: '🔄', weight: 0.10,
    principles: [
      { id: 'field_form',   label: 'Fielding Form' },
      { id: 'transition',   label: 'Transition to Throw' },
      { id: 'proper_flip',  label: 'Proper Flip' },
      { id: 'flip_trans',   label: 'Transition to Flip' },
      { id: 'throw_1st',    label: 'Throw to 1st' },
    ]
  },
  {
    id: 'intangibles', label: 'Intangibles', icon: '🧠', weight: 0.12,
    principles: [
      { id: 'engagement',   label: 'Engagement/Effort' },
      { id: 'behavior',     label: 'Behavior' },
      { id: 'batting_iq',   label: 'Understands Batting' },
      { id: 'baserunning',  label: 'Understands Baserunning' },
      { id: 'pickups',      label: 'Understands Pickups' },
      { id: 'leading',      label: 'Understands Leading' },
      { id: 'sliding',      label: 'Understands Sliding' },
    ]
  },
];

// Rating labels for 1-5 scale
const EVAL_RATINGS = ['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
const EVAL_RATING_COLORS = ['', '#ef4444', '#f97316', '#f5a623', '#60a5fa', '#10b981'];

// Backwards-compat: keep EVAL_CATEGORIES pointing to drills for any code that iterates it
const EVAL_CATEGORIES = EVAL_DRILLS.map(d => ({
  id: d.id, label: d.label, icon: d.icon, weight: d.weight, statAuto: false, desc: ''
}));

// Colour scale for 1-10
function evalScoreColor(n) {
  if (!n) return 'var(--border)';
  if (n>=9)  return '#10b981';
  if (n>=7)  return '#60a5fa';
  if (n>=5)  return '#f5a623';
  if (n>=3)  return '#f97316';
  return '#ef4444';
}

// Compute auto-scores from GC stats for a player
function evalAutoScores(playerObj) {
  if (typeof GC_STATS === 'undefined') return {};
  const key = `${playerObj.first.toLowerCase()}|${playerObj.last[0]?.toUpperCase()||''}`;
  const rec = GC_STATS.filter(g=>g.key===key).sort((a,b)=>b.year-a.year)[0];
  if (!rec) return {};

  const b = rec.batting, pi = rec.pitching;
  const auto = {};

  if ((b?.ab||0) >= 4) {
    const ops  = parseFloat(b.ops)||0;
    const avg  = parseFloat(b.avg)||0;
    // Hitting: OPS 1.2=10, 0.4=1  — linear scale
    auto.hitting = Math.round(Math.min(10, Math.max(1, (ops-0.4)/0.8*9+1)));
    // Speed: SB rate
    const sbRate = b.ab ? (b.sb||0)/b.ab : 0;
    auto.speed = Math.round(Math.min(10, Math.max(1, sbRate/0.25*9+1)));
    // Clutch: RBI/AB vs expected
    const clutchRate = b.ab ? (b.rbi||0)/b.ab : 0;
    auto.clutch = Math.round(Math.min(10, Math.max(1, clutchRate/0.3*9+1)));
  }

  if ((pi?.ip_dec||0) >= 2) {
    const era  = parseFloat(pi.era)||99;
    const whip = parseFloat(pi.whip)||9;
    const kRate= pi.ip_dec>0?pi.so/pi.ip_dec:0;
    // Pitching: ERA 0=10, 12=1
    const eraScore  = Math.max(1, 10 - era*0.75);
    const whipScore = Math.max(1, 10 - whip*3);
    const kScore    = Math.min(10, kRate/4*9+1);
    auto.pitching = Math.round((eraScore*0.4 + whipScore*0.35 + kScore*0.25));
  }

  return auto;
}

// Compute overall 0-100 MLB The Show style
function evalComputeOverall(playerData, sessionPlayer) {
  // Experience score
  const history = typeof players !== 'undefined' ?
    players.filter(p => p.first.toLowerCase()===playerData.first.toLowerCase() &&
      p.last[0]?.toUpperCase()===playerData.last[0]?.toUpperCase() &&
      p.sport===playerData.sport) : [];
  const yearsInOrg = new Set(history.map(p=>p.year)).size;
  const divRank = {'T-Ball':0,'Farm':1,'Rookies':2,'10U':2,'12U':3,'Minors':3,'Senior':3,'Majors':4};
  const topDiv  = Math.max(0, ...history.map(p=>divRank[p.division]||0));
  const expScore = Math.min(10, yearsInOrg*1.5 + topDiv*0.5 + (history.some(p=>p.allstar_years?.length)?1:0));

  // Eval Day scoring: use dayGrades (simple 1-5 per category)
  const dayGrades = sessionPlayer?.dayGrades || {};
  const dayVals = Object.values(dayGrades).filter(v => v > 0);
  if (dayVals.length > 0) {
    const dayAvg = dayVals.reduce((a,b)=>a+b,0) / dayVals.length; // 1-5
    const dayAvg10 = (dayAvg - 1) / 4 * 9 + 1; // map 1-5 → 1-10
    const expBonus = Math.min(4, expScore * 0.4);
    const raw = ((dayAvg10 - 1) / 9) * 50 + 48 + expBonus;
    return { score: Math.min(99, Math.max(48, Math.round(raw))), grades: {}, expScore: Math.round(expScore*10)/10, yearsInOrg };
  }

  const dg = sessionPlayer?.drillGrades || {};

  // Compute per-drill average (1-5 → 1-10 mapped)
  let weightedSum = 0, totalWeight = 0;
  EVAL_DRILLS.forEach(drill => {
    const pScores = (drill.principles || []).map(pr => {
      const v = dg[drill.id]?.[pr.id] || 0;
      return v; // 1-5
    }).filter(v => v > 0);
    if (!pScores.length) return;
    const drillAvg = pScores.reduce((a,b)=>a+b,0) / pScores.length; // 1-5
    const drillAvg10 = (drillAvg - 1) / 4 * 9 + 1; // map 1-5 → 1-10
    weightedSum += drillAvg10 * drill.weight;
    totalWeight += drill.weight;
  });

  // Fall back to legacy grades if no drills graded yet
  if (totalWeight === 0) {
    const auto = evalAutoScores(playerData);
    const grades = {};
    EVAL_CATEGORIES.forEach(cat => {
      const manual = sessionPlayer?.grades?.[cat.id] || 0;
      grades[cat.id] = manual || auto[cat.id] || 0;
    });
    let legacySum = 0, legacyWeight = 0;
    EVAL_CATEGORIES.forEach(cat => {
      if (grades[cat.id]) { legacySum += grades[cat.id]*cat.weight; legacyWeight += cat.weight; }
    });
    if (legacyWeight === 0) return null;
    const avg = legacySum / legacyWeight;
    const expBonus = Math.min(4, expScore * 0.4);
    const raw = ((avg - 1) / 9) * 50 + 48 + expBonus;
    return { score: Math.min(99, Math.max(48, Math.round(raw))), grades: {}, expScore: Math.round(expScore*10)/10, yearsInOrg };
  }

  const weightedAvg = weightedSum / totalWeight; // 1-10 scale
  const expBonus = Math.min(4, expScore * 0.4);
  // Scale: avg=1→48, avg(3/5 Good)→~78, avg(4/5 VeryGood)→~89, avg=10→98+bonus
  const raw = ((weightedAvg - 1) / 9) * 50 + 48 + expBonus;

  return { score: Math.min(99, Math.max(48, Math.round(raw))), grades: {}, expScore: Math.round(expScore*10)/10, yearsInOrg };
}

function evalOverallColor(score) {
  if (!score) return 'var(--text2)';
  if (score >= 85) return '#10b981';
  if (score >= 70) return '#60a5fa';
  if (score >= 55) return '#f5a623';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

// ── State ─────────────────────────────────────────────────

// ── Evaluation Day categories (simplified indoor sheet) ──────────────────
const EVAL_DAY_CATS = [
  { id:'catch',       label:'Catch',        icon:'🧤', type:'dots5' },
  { id:'grounders',   label:'Grounders',    icon:'⬇️', type:'dots5' },
  { id:'throwing',    label:'Throwing',     icon:'💪', type:'dots5' },
  { id:'hitting',     label:'Hitting',      icon:'⚾', type:'hitting' },  // special: 1-5 mechanics + 0-10 contact
  { id:'speed',       label:'Speed',        icon:'⚡', type:'dots5' },
  { id:'coachability',label:'Coachability', icon:'🧠', type:'dots5' },
  { id:'pitching',    label:'Pitching',     icon:'🎯', type:'pitching', optional:true }, // 0-15 strikes
];

const EVAL_RATINGS_5 = ['', 'Needs Work', 'Below Avg', 'Average', 'Above Avg', 'Excellent'];
const EVAL_COLORS_5  = ['', '#ef4444', '#f97316', '#f5a623', '#60a5fa', '#10b981'];

function evalSetType(type) {
  EVAL_SESSION.evalType = type;
  const clinicEl   = document.getElementById('evalTypeClinic');
  const evalDayEl  = document.getElementById('evalTypeEvalDay');
  const inputEl    = document.getElementById('evalTypeInput');
  if (clinicEl) {
    const isClinic = type === 'clinic';
    clinicEl.style.background   = isClinic ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.03)';
    clinicEl.style.borderColor  = isClinic ? 'var(--gold)' : 'var(--border)';
    clinicEl.querySelector('div').style.color = isClinic ? 'var(--gold)' : 'var(--text2)';
    evalDayEl.style.background  = !isClinic ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.03)';
    evalDayEl.style.borderColor = !isClinic ? '#60a5fa' : 'var(--border)';
    evalDayEl.querySelector('div').style.color = !isClinic ? '#60a5fa' : 'var(--text2)';
  }
  if (inputEl) inputEl.value = type;
}


const EVAL_SESSION = {
  coachName: '',
  sport: 'Baseball',
  division: 'Minors',
  year: 2026,
  evalType: 'clinic', // 'clinic' | 'evalday'
  pickOrder: [], // ordered array of player keys for draft ranking
  players: [], // { key, first, last, number, present, grades:{}, drillGrades:{}, notes:{}, overall:'', overallNotes:'', _overall100:null }
  activeKey: null,
};

function evalGetAll() {
  try { return JSON.parse(localStorage.getItem(userKey('evals'))||'[]'); }
  catch { return []; }
}
function evalSaveAll(arr) {
  localStorage.setItem(userKey('evals'), JSON.stringify(arr));
  setTimeout(authCloudPush, 800);
}

// ── Tab init ──────────────────────────────────────────────

function renderEvalsTab() {
  // Populate year dropdown
  const yrSel = document.getElementById('evalYear');
  if (yrSel && !yrSel.options.length) {
    years().sort((a,b)=>b-a).forEach(y => {
      const o = document.createElement('option'); o.value=y; o.text=y; yrSel.appendChild(o);
    });
  }
  // Populate coach dropdown
  evalFilterChanged();
  evalCoachChanged();
  // Show setup by default
  document.getElementById('evalSetup').style.display = '';
  document.getElementById('evalGrading').style.display = 'none';

  // Show this user's saved sessions
  const saved = evalGetAll();
  const savedEl = document.getElementById('evalSavedSessions');
  if (!savedEl) return;

  // Shared evals received from other coaches
  const sharedEvals = evalGetShared();

  if (!saved.length && !sharedEvals.length) { savedEl.style.display='none'; return; }
  savedEl.style.display = '';

  const myCard = saved.length ? `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title" style="margin-bottom:12px;">📋 Your <span class="accent">Saved Evaluations</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">
        ${saved.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(s => {
          const d = new Date(s.date);
          const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
          const graded = (s.players||[]).filter(p=>Object.values(p.grades||{}).some(v=>v>0)||Object.values(p.dayGrades||{}).some(v=>v>0)||Object.values(p.drillGrades||{}).some(dg=>Object.values(dg).some(v=>v>0))).length;
          const withScores = (s.players||[]).filter(p=>p._overall100);
          const avgScore = withScores.length ? Math.round(withScores.reduce((a,p)=>a+p._overall100,0)/withScores.length) : null;
          return `<div style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);
              background:rgba(255,255,255,0.03);">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
              <div style="font-weight:700;font-size:13px;">${s.division} ${s.sport}</div>
              ${(s.evalType||'clinic')==='evalday'
                ? '<span style="font-size:9px;padding:1px 6px;border-radius:10px;font-weight:700;background:rgba(96,165,250,0.2);color:#60a5fa;">📊 Eval Day</span>'
                : '<span style="font-size:9px;padding:1px 6px;border-radius:10px;font-weight:700;background:rgba(245,166,35,0.2);color:var(--gold);">⚾ Clinic</span>'}
            </div>
            <div style="font-size:11px;color:var(--text2);">${dateStr} · ${s.year}</div>
            <div style="margin-top:6px;display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:11px;color:var(--green);">✓ ${graded} graded</span>
              ${avgScore?`<span style="font-family:Bebas Neue;font-size:16px;color:${evalOverallColor(avgScore)};">${avgScore} avg</span>`:''}
            </div>
            <div style="margin-top:6px;display:flex;gap:4px;">
              <button onclick="evalResumeSession(${s.id})"
                class="btn btn-gold btn-sm" style="font-size:10px;padding:3px 8px;flex:1;">Resume / Update</button>
              <button onclick="evalDeleteSession(${s.id})"
                class="btn btn-danger btn-sm" style="font-size:10px;padding:3px 8px;">✕</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const sharedCard = sharedEvals.length ? `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title" style="margin-bottom:12px;">🤝 <span class="accent">Shared With You</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">
        ${sharedEvals.sort((a,b)=>new Date(b.sharedAt||b.date)-new Date(a.sharedAt||a.date)).map(s => {
          const d = new Date(s.sharedAt || s.date);
          const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
          const graded = (s.players||[]).filter(p=>Object.values(p.grades||{}).some(v=>v>0)||Object.values(p.dayGrades||{}).some(v=>v>0)||Object.values(p.drillGrades||{}).some(dg=>Object.values(dg).some(v=>v>0))).length;
          const withScores = (s.players||[]).filter(p=>p._overall100);
          const avgScore = withScores.length ? Math.round(withScores.reduce((a,p)=>a+p._overall100,0)/withScores.length) : null;
          return `<div style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);
              background:rgba(255,255,255,0.03);border-left:3px solid var(--blue);">
            <div style="font-size:10px;color:var(--blue);font-weight:700;margin-bottom:4px;">
              Shared by ${s.sharedBy || 'a coach'}
            </div>
            <div style="font-weight:700;font-size:13px;">${s.division} ${s.sport}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px;">${dateStr} · ${s.year}</div>
            <div style="margin-top:6px;display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:11px;color:var(--green);">✓ ${graded} graded</span>
              ${avgScore?`<span style="font-family:Bebas Neue;font-size:16px;color:${evalOverallColor(avgScore)};">${avgScore} avg</span>`:''}
            </div>
            <div style="margin-top:6px;display:flex;gap:4px;">
              <button onclick="evalResumeSession(${s.id}, true)"
                class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;flex:1;">View</button>
              <button onclick="evalDeleteShared(${s.id})"
                class="btn btn-danger btn-sm" style="font-size:10px;padding:3px 8px;" title="Remove">✕</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  savedEl.innerHTML = myCard + sharedCard;
}

function evalResumeSession(id) {
  const s = evalGetAll().find(x=>x.id===id);
  if (!s) return;
  // Restore session state
  EVAL_SESSION.coachName = s.coachName;
  EVAL_SESSION.sport     = s.sport;
  EVAL_SESSION.division  = s.division;
  EVAL_SESSION.year      = s.year;
  EVAL_SESSION.evalType  = s.evalType || 'clinic';
  EVAL_SESSION.pickOrder = s.pickOrder || [];
  // Restore players array — merge with current registrants so new players appear
  const currentPool = players.filter(p=>
    p.year===s.year && p.sport===s.sport && p.division===s.division
  );
  const savedByKey = {};
  (s.players||[]).forEach(p => { savedByKey[p.key] = p; });

  EVAL_SESSION.players = currentPool.map(p => {
    const k = `${p.first}|${p.last}|${p.sport}`;
    return savedByKey[k] || {
      key:k, first:p.first, last:p.last, number:'', present:false,
      grades:{}, drillGrades:{}, dayGrades:{}, // dayGrades[catId] = 1-5 for evalday
      notes:{},
      overall:'', overallNotes:'', _overall100:null, selectTeam:false, wantToDraft:null, media:[]
    };
  });
  // Also include any saved players not in current pool
  (s.players||[]).forEach(p => {
    if (!EVAL_SESSION.players.find(x=>x.key===p.key)) EVAL_SESSION.players.push(p);
  });

  // Set dropdowns to match
  ['evalSport','evalDivision','evalYear'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id==='evalSport')    el.value = s.sport;
    if (id==='evalDivision') el.value = s.division;
    if (id==='evalYear')     el.value = String(s.year);
  });

  document.getElementById('evalSetup').style.display = 'none';
  document.getElementById('evalGrading').style.display = '';
  renderEvalProgressStrip();
  const d = new Date(s.date);
  document.getElementById('evalGradingTitle').textContent =
    `${s.division} ${s.sport} — Updated ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;

  renderEvalPlayerTabs();
  const present = EVAL_SESSION.players.filter(p=>p.present);
  if (present.length) evalSelectPlayer(present[0].key);
  else if (EVAL_SESSION.players.length) {
    EVAL_SESSION.players[0].present = true;
    evalSelectPlayer(EVAL_SESSION.players[0].key);
  }
  renderEvalSummary();
  renderEvalPicksCard();
}

function evalDeleteShared(id) {
  const u = authCurrentUser();
  if (!u) return;
  const key = 'lll_' + u.username + '_sharedEvals';
  try {
    const all = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify(all.filter(s => s.id !== id)));
    renderEvalsTab();
    toast('Removed from shared evals');
  } catch {}
}


function evalDeleteSession(id) {
  const session = evalGetAll().find(s => s.id === id);
  if (!session) return;
  const label = `${session.division} ${session.sport} ${session.year}`;
  const graded = (session.players||[]).filter(p => Object.values(p.grades||{}).some(v=>v>0)).length;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--navy3);border:1px solid var(--border);border-radius:14px;
        padding:24px 28px;max-width:360px;width:90%;text-align:center;">
      <div style="font-size:28px;margin-bottom:10px;">🗑</div>
      <div style="font-weight:700;font-size:16px;margin-bottom:6px;">Delete Evaluation?</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:4px;">${label}</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:20px;">${graded} player${graded!==1?'s':''} graded — this cannot be undone</div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button class="btn btn-ghost" onclick="this.closest('[style*=fixed]').remove()"
          style="padding:8px 20px;">Cancel</button>
        <button class="btn btn-danger" style="padding:8px 20px;"
          onclick="
            this.closest('[style*=fixed]').remove();
            evalSaveAll(evalGetAll().filter(s=>s.id!==${id}));
            renderEvalsTab();
            toast('Evaluation deleted');
          ">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function evalCoachChanged() {
  const sel = document.getElementById('evalCoach');
  if (!sel) return;
  const localCoaches = coachGetAll().filter(c => c.name).map(c => c.name);
  // Also include cloud-registered coaches
  let cloudCoaches = [];
  try {
    const cached = JSON.parse(localStorage.getItem('lll_cached_coaches') || '[]');
    cloudCoaches = cached.map(c => c.displayName || c.username).filter(n => n && !localCoaches.includes(n));
  } catch {}
  const allCoaches = [...new Set([...localCoaches, ...cloudCoaches])].sort();
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select coach —</option>' +
    allCoaches.map(n => `<option value="${n}" ${n===cur?'selected':''}>${n}</option>`).join('');
  sel.innerHTML += '<option value="__other__">Other / Guest</option>';
  EVAL_SESSION.coachName = sel.value === '__other__' ? '' : sel.value;
}

function evalFilterChanged() {
  EVAL_SESSION.sport    = document.getElementById('evalSport')?.value || 'Baseball';
  EVAL_SESSION.division = document.getElementById('evalDivision')?.value || 'Minors';
  EVAL_SESSION.year     = parseInt(document.getElementById('evalYear')?.value || years()[years().length-1]);
  EVAL_SESSION.evalType = document.getElementById('evalTypeInput')?.value || 'clinic';
  renderEvalAttendance();
}

// ── Attendance grid ───────────────────────────────────────

function renderEvalAttendance() {
  const el = document.getElementById('evalAttendanceGrid');
  if (!el) return;

  const pool = players.filter(p =>
    p.year === EVAL_SESSION.year &&
    p.sport === EVAL_SESSION.sport &&
    p.division === EVAL_SESSION.division
  ).sort((a,b) => a.last.localeCompare(b.last)||a.first.localeCompare(b.first));

  if (!pool.length) {
    el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text2);">
      No ${EVAL_SESSION.division} ${EVAL_SESSION.sport} players found for ${EVAL_SESSION.year}.
    </div>`;
    return;
  }

  // Sync with session players
  const existingKeys = new Set(EVAL_SESSION.players.map(p=>p.key));
  pool.forEach(p => {
    const k = `${p.first}|${p.last}|${p.sport}`;
    if (!existingKeys.has(k)) {
      EVAL_SESSION.players.push({
        key:k, first:p.first, last:p.last, number:'',
        present:false,
        grades:{hitting:0,fielding:0,pitching:0,speed:0,athleticism:0},
        notes:{hitting:'',fielding:'',pitching:'',speed:'',athleticism:''},
        overall:'', overallNotes:'',
      });
    }
  });

  el.innerHTML = pool.map(p => {
    const k = `${p.first}|${p.last}|${p.sport}`;
    const sp = EVAL_SESSION.players.find(x=>x.key===k);
    const present = sp?.present || false;
    const hasGrades = sp && Object.values(sp.grades).some(v=>v>0);
    return `<div onclick="evalTogglePresent('${k}')" style="
        display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:8px;cursor:pointer;
        border:2px solid ${present?'var(--green)':'var(--border)'};
        background:${present?'rgba(16,185,129,0.1)':'rgba(255,255,255,0.03)'};
        transition:all .15s;">
      <div style="width:20px;height:20px;border-radius:50%;border:2px solid ${present?'var(--green)':'var(--border)'};
          background:${present?'var(--green)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        ${present?'<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>':''}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.first} ${p.last}</div>
        ${hasGrades?'<div style="font-size:10px;color:var(--gold);">✓ Graded</div>':''}
      </div>
    </div>`;
  }).join('');

  // Also show write-in players that aren't in the registered pool
  const writeIns = EVAL_SESSION.players.filter(sp => sp._writeIn);
  if (writeIns.length) {
    el.innerHTML += writeIns.map(sp => {
      const present = sp.present;
      const hasGrades = Object.values(sp.grades).some(v=>v>0);
      return `<div onclick="evalTogglePresent('${sp.key}')" style="
          display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:8px;cursor:pointer;
          border:2px solid ${present?'var(--green)':'var(--gold)'};
          background:${present?'rgba(16,185,129,0.1)':'rgba(251,191,36,0.05)'};
          transition:all .15s;position:relative;">
        <div style="width:20px;height:20px;border-radius:50%;border:2px solid ${present?'var(--green)':'var(--gold)'};
            background:${present?'var(--green)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          ${present?'<svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>':''}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sp.first} ${sp.last}</div>
          <div style="font-size:9px;color:var(--gold);">✏️ write-in${hasGrades?' · ✓ Graded':''}</div>
        </div>
        <button onclick="event.stopPropagation();evalRemoveWriteIn('${sp.key}')"
          style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:12px;padding:2px;line-height:1;">✕</button>
      </div>`;
    }).join('');
  }

  updateEvalAttendCount();
}

function evalToggleWriteIn() {
  const area = document.getElementById('evalWriteInArea');
  if (!area) return;
  const open = area.style.display !== 'none';
  area.style.display = open ? 'none' : '';
  if (!open) document.getElementById('evalWriteInFirst')?.focus();
}

function evalAddWriteIn() {
  const first = (document.getElementById('evalWriteInFirst')?.value || '').trim();
  const last  = (document.getElementById('evalWriteInLast')?.value  || '').trim();
  if (!first || !last) { toast('Enter first and last name', 'error'); return; }

  const key = `${first}|${last}|${EVAL_SESSION.sport}`;
  if (EVAL_SESSION.players.find(p => p.key === key)) {
    toast(`${first} ${last} is already on the list`);
    return;
  }

  EVAL_SESSION.players.push({
    key, first, last, number: '',
    present: true,   // auto-mark present since coach is adding them right now
    _writeIn: true,  // flag as unregistered write-in
    grades: { hitting:0, fielding:0, pitching:0, speed:0, arm:0, athleticism:0, clutch:0, coachability:0 },
    notes:  { hitting:'', fielding:'', pitching:'', speed:'', arm:'', athleticism:'', clutch:'', coachability:'' },
    overall:'', overallNotes:'',
  });

  // Clear inputs
  document.getElementById('evalWriteInFirst').value = '';
  document.getElementById('evalWriteInLast').value  = '';
  document.getElementById('evalWriteInFirst').focus();

  toast(`✓ ${first} ${last} added`);
  renderEvalAttendance();
}

function evalRemoveWriteIn(key) {
  EVAL_SESSION.players = EVAL_SESSION.players.filter(p => p.key !== key);
  renderEvalAttendance();
}

function evalTogglePresent(key) {
  const sp = EVAL_SESSION.players.find(p=>p.key===key);
  if (sp) sp.present = !sp.present;
  renderEvalAttendance();
}

function evalSelectAll() {
  EVAL_SESSION.players.forEach(p => p.present = true);
  renderEvalAttendance();
}
function evalClearAll() {
  EVAL_SESSION.players.forEach(p => p.present = false);
  renderEvalAttendance();
}
function updateEvalAttendCount() {
  const n = EVAL_SESSION.players.filter(p=>p.present).length;
  const el = document.getElementById('evalAttendCount');
  if (el) el.textContent = `${n} player${n!==1?'s':''} selected`;
}

// ── Grading phase ─────────────────────────────────────────

function evalStartGrading() {
  const present = EVAL_SESSION.players.filter(p=>p.present);
  if (!present.length) { toast('Select at least one player', 'error'); return; }

  const selCoach = document.getElementById('evalCoach');
  const u = authCurrentUser();
  // Use selected coach, or logged-in user's display name, or username
  let coachName = selCoach?.value && selCoach.value !== '__other__' ? selCoach.value : '';
  if (!coachName && u) {
    try {
      const cached = JSON.parse(localStorage.getItem('lll_cached_coaches') || '[]');
      const me = cached.find(c => c.username.toLowerCase() === u.username.toLowerCase());
      coachName = me?.displayName || u.username;
    } catch { coachName = u.username; }
  }
  EVAL_SESSION.coachName = coachName || 'Unknown';

  document.getElementById('evalSetup').style.display = 'none';
  document.getElementById('evalGrading').style.display = '';

  const d = new Date();
  const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  document.getElementById('evalGradingTitle').textContent =
    `${EVAL_SESSION.division} ${EVAL_SESSION.sport} — ${dateStr}`;

  renderEvalPlayerTabs();
  // Select first player
  if (present.length) evalSelectPlayer(present[0].key);
  renderEvalSummary();
}

function renderEvalPlayerTabs() {
  renderEvalProgressStrip();
  const el = document.getElementById('evalPlayerTabs');
  if (!el) return;
  const present = EVAL_SESSION.players.filter(p=>p.present);
  el.innerHTML = present.map(p => {
    const hasGrades = Object.values(p.grades).some(v=>v>0);
    const isActive  = p.key === EVAL_SESSION.activeKey;
    const playerData = (typeof players!=='undefined') ? players.find(pl=>
      pl.first.toLowerCase()===p.first.toLowerCase() &&
      pl.last[0]?.toUpperCase()===p.last[0]?.toUpperCase() &&
      pl.sport===EVAL_SESSION.sport && pl.year===EVAL_SESSION.year) : null;
    // Offseason sessions: compute overall for display but do NOT show score badge —
    // offseason work is notes-only and must not affect eval ratings
    const _isOffseason = (EVAL_SESSION.evalType||'').toLowerCase() === 'offseason';
    const ov = _isOffseason ? null : evalComputeOverall(playerData||{first:p.first,last:p.last,sport:EVAL_SESSION.sport}, p);
    const ovScore = ov?.score || null;
    const ovColor = evalOverallColor(ovScore);
    const draftIcon = p.wantToDraft===true ? '<span style="color:#10b981;font-size:11px;">✓</span>'
                     : p.wantToDraft===false ? '<span style="color:#ef4444;font-size:11px;">✗</span>' : '';
    const starIcon  = p.selectTeam ? '<span style="font-size:11px;">⭐</span>' : '';
    return `<div onclick="evalSelectPlayer('${p.key}')" style="
        display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;cursor:pointer;
        border:2px solid ${p.selectTeam?'#f5a623':isActive?'var(--gold)':ovScore?ovColor:'var(--border)'};
        background:${isActive?'rgba(245,166,35,0.12)':ovScore?ovColor+'15':'rgba(255,255,255,0.03)'};
        font-size:12px;font-weight:${isActive?'700':'600'};white-space:nowrap;">
      ${starIcon}
      ${p.number?`<span style="font-size:10px;color:var(--text2);">#${p.number}</span>`:''}
      ${p.first} ${p.last}
      ${ovScore?`<span style="font-family:Bebas Neue;font-size:15px;color:${ovColor};margin-left:2px;">${ovScore}</span>`:''}
      ${draftIcon}
    </div>`;
  }).join('');
}

function _evalGradeColor(v) {
  // Now accepts number 1-10 or legacy letter
  if (typeof v === 'number') return evalScoreColor(v);
  return {'A':'#10b981','B':'#60a5fa','C':'#f5a623','D':'#f97316','F':'#ef4444'}[v]||'var(--text2)';
}

function evalSelectPlayer(key) {
  EVAL_SESSION.activeKey = key;
  renderEvalPlayerTabs();
  renderEvalProgressStrip();
  renderEvalGradingCard();
}

function renderEvalGradingCard() {
  const el = document.getElementById('evalGradingCard');
  if (!el) return;
  const p = EVAL_SESSION.players.find(x=>x.key===EVAL_SESSION.activeKey);
  if (!p) { el.innerHTML='<div style="color:var(--text2);padding:20px;">Select a player above</div>'; return; }

  if (!p.drillGrades) p.drillGrades = {};
  if (!p.notes) p.notes = {};

  const playerData = (typeof players!=='undefined') ? players.find(pl=>
    pl.first.toLowerCase()===p.first.toLowerCase() &&
    pl.last[0]?.toUpperCase()===p.last[0]?.toUpperCase() &&
    pl.sport===EVAL_SESSION.sport && pl.year===EVAL_SESSION.year
  ) : null;

  // Offseason sessions: show player card normally but suppress the numeric eval score
  const _isOffseasonCard = (EVAL_SESSION.evalType||'').toLowerCase() === 'offseason';
  const overall  = evalComputeOverall(playerData||{first:p.first,last:p.last,sport:EVAL_SESSION.sport}, p);
  const ovScore  = _isOffseasonCard ? null : (overall?.score || null);
  const ovColor  = evalOverallColor(ovScore);
  const yearsInOrg = overall?.yearsInOrg || 0;
  const expLabel = yearsInOrg>=5?'Veteran':yearsInOrg>=3?'Experienced':yearsInOrg>=1?'Returning':'New';
  const expColor = yearsInOrg>=5?'var(--gold)':yearsInOrg>=3?'var(--green)':'var(--text2)';
  const safeKey  = p.key.replace(/[|]/g,'_');

function _renderClinicSections(p, safeKey) {
  if (!p.drillGrades) p.drillGrades = {};
  if (!p.notes) p.notes = {};
  return EVAL_DRILLS.map(drill => {
    const dg = p.drillGrades[drill.id] || {};
    const rated = drill.principles.map(pr=>dg[pr.id]||0).filter(v=>v>0);
    const drillAvg = rated.length ? (rated.reduce((a,b)=>a+b,0)/rated.length) : 0;
    const drillCol = drillAvg>=4?'#10b981':drillAvg>=3?'#60a5fa':drillAvg>=2?'#f5a623':drillAvg>0?'#ef4444':'var(--border)';

    const principleRows = drill.principles.map(pr => {
      const val = dg[pr.id] || 0;
      const col = val ? EVAL_RATING_COLORS[val] : 'var(--border)';
      const btns = [1,2,3,4,5].map(n => {
        const rc = EVAL_RATING_COLORS[n];
        const active = val === n;
        return `<button onclick="evalSetDrillGrade('${p.key}','${drill.id}','${pr.id}',${active?0:n})"
          title="${EVAL_RATINGS[n]}"
          style="padding:4px 7px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;min-width:32px;
                 white-space:nowrap;border:1px solid ${active?rc:'rgba(255,255,255,0.08)'};
                 background:${active?rc+'33':'transparent'};color:${active?rc:'rgba(255,255,255,0.3)'};"
          >${EVAL_RATINGS[n]}</button>`;
      }).join('');
      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 0;
          border-bottom:1px solid rgba(255,255,255,0.04);flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:600;min-width:120px;flex:1;color:${val?'var(--text)':'var(--text2)'};">${pr.label}</span>
        <div style="display:flex;gap:3px;flex-wrap:wrap;">${btns}</div>
        ${val?`<span style="font-size:11px;font-weight:700;color:${col};min-width:14px;">${val}</span>`:'<span style="min-width:14px;"></span>'}
      </div>`;
    }).join('');

    const drillNote = (p.notes[drill.id]||'').replace(/"/g,'&quot;');
    const completedCount = rated.length;
    const totalCount = drill.principles.length;

    return `<div style="margin-bottom:12px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <div onclick="toggleRankDetail('drill_${safeKey}_${drill.id}')"
        style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;background:rgba(255,255,255,0.03);">
        <span style="font-size:16px;">${drill.icon}</span>
        <span style="font-family:Bebas Neue;font-size:15px;letter-spacing:.5px;flex:1;">${drill.label}</span>
        <span style="font-size:10px;color:var(--text2);">${completedCount}/${totalCount}</span>
        ${drillAvg>0?`<span style="font-family:Bebas Neue;font-size:12px;padding:2px 8px;border-radius:5px;
            background:${drillCol}22;color:${drillCol};border:1px solid ${drillCol}44;">
            ${EVAL_RATINGS[Math.round(drillAvg)]}</span>`:''}
        <span style="color:var(--text2);font-size:11px;">▾</span>
      </div>
      <div id="drill_${safeKey}_${drill.id}" style="padding:10px 14px;">
        ${principleRows}
        <input type="text" value="${drillNote}" placeholder="Notes for ${drill.label}…"
          oninput="evalSetNote('${p.key}','${drill.id}',this.value)"
          style="width:100%;margin-top:8px;background:rgba(255,255,255,0.05);border:1px solid var(--border);
                 color:var(--text);padding:5px 8px;border-radius:6px;font-size:11px;
                 font-family:'DM Sans';box-sizing:border-box;">
      </div>
    </div>`;
  }).join('');
}

function _evalDotSlider(key, catId, val) {
  // 5 colored dots — tap to select, tap same to deselect
  return [1,2,3,4,5].map(n => {
    const col = EVAL_COLORS_5[n];
    const active = val === n;
    const sz = active ? '24px' : '18px';
    return `<div onclick="event.stopPropagation();evalSetDayGrade('${key}','${catId}',${active?0:n})"
      style="width:${sz};height:${sz};border-radius:50%;cursor:pointer;flex-shrink:0;
             background:${active ? col : col+'44'};
             border:2px solid ${active ? col : 'transparent'};
             transition:all .15s;box-shadow:${active ? '0 0 8px '+col+'88' : 'none'};"></div>`;
  }).join('');
}

function _evalVoiceBtn(key, catId) {
  // Microphone button — records a voice note
  return `<button onclick="evalRecordVoice('${key}','${catId}')"
    title="Voice note"
    style="width:30px;height:30px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;
           background:rgba(255,255,255,0.08);color:var(--text2);font-size:14px;
           display:flex;align-items:center;justify-content:center;">🎙️</button>`;
}

function _renderEvalDaySections(p, safeKey) {
  if (!p.dayGrades) p.dayGrades = {};
  if (!p.notes)     p.notes = {};

  return EVAL_DAY_CATS.map(cat => {
    const val = p.dayGrades[cat.id] || 0;
    const col = val ? EVAL_COLORS_5[val] : 'rgba(255,255,255,0.15)';

    // ── Dots-only categories ──────────────────────────────────────────
    if (cat.type === 'dots5') {
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;
          border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="font-size:20px;width:28px;text-align:center;flex-shrink:0;">${cat.icon}</span>
        <div style="font-family:'Bebas Neue';font-size:16px;letter-spacing:.5px;width:100px;flex-shrink:0;">${cat.label}</div>
        <div style="display:flex;align-items:center;gap:8px;flex:1;">${_evalDotSlider(p.key, cat.id, val)}</div>
        ${_evalVoiceBtn(p.key, cat.id)}
      </div>`;
    }

    // ── Hitting: mechanics (1-5 dots) + contact count (0-10) ─────────
    if (cat.type === 'hitting') {
      const mechanics = val || 0;  // dayGrades.hitting = mechanics 1-5
      const contact   = p.dayGrades['hitting_contact'] || 0;  // 0-10
      const colM = mechanics ? EVAL_COLORS_5[mechanics] : 'rgba(255,255,255,0.15)';
      const colC = contact >= 8 ? '#10b981' : contact >= 5 ? '#60a5fa' : contact >= 3 ? '#f5a623' : contact > 0 ? '#ef4444' : 'rgba(255,255,255,0.15)';
      return `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:20px;width:28px;text-align:center;flex-shrink:0;">${cat.icon}</span>
          <div style="font-family:'Bebas Neue';font-size:16px;letter-spacing:.5px;width:100px;flex-shrink:0;">${cat.label}</div>
          <div style="display:flex;align-items:center;gap:8px;flex:1;">${_evalDotSlider(p.key, 'hitting', mechanics)}</div>
          ${_evalVoiceBtn(p.key, 'hitting')}
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding-left:38px;">
          <div style="font-size:11px;color:var(--text2);flex-shrink:0;">Contact <span style="font-size:9px;">(of 10)</span></div>
          <div style="display:flex;gap:5px;flex:1;flex-wrap:wrap;">
            ${[0,1,2,3,4,5,6,7,8,9,10].map(n => {
              const active = contact === n;
              const c = n >= 8 ? '#10b981' : n >= 5 ? '#60a5fa' : n >= 3 ? '#f5a623' : '#ef4444';
              return `<div onclick="event.stopPropagation();evalSetDayGrade('${p.key}','hitting_contact',${active?0:n})"
                style="width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;
                       cursor:pointer;font-size:11px;font-weight:700;flex-shrink:0;
                       background:${active?c+'44':'rgba(255,255,255,0.06)'};
                       border:1px solid ${active?c:'rgba(255,255,255,0.1)'};
                       color:${active?c:'var(--text2)'};">${n}</div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
    }

    // ── Pitching: strikes out of 15 ───────────────────────────────────
    if (cat.type === 'pitching') {
      const strikes = p.dayGrades['pitching_strikes'] || 0;
      const colP = strikes >= 11 ? '#10b981' : strikes >= 8 ? '#60a5fa' : strikes >= 5 ? '#f5a623' : strikes > 0 ? '#ef4444' : 'rgba(255,255,255,0.15)';
      return `<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:20px;width:28px;text-align:center;flex-shrink:0;">${cat.icon}</span>
          <div style="font-family:'Bebas Neue';font-size:16px;letter-spacing:.5px;width:100px;flex-shrink:0;">${cat.label}</div>
          <div style="font-size:11px;color:var(--text2);">Strikes <span style="font-size:9px;">(of 15)</span></div>
          <div style="font-family:'Bebas Neue';font-size:24px;color:${colP};margin-left:auto;min-width:32px;text-align:right;">${strikes||'—'}</div>
          ${_evalVoiceBtn(p.key, 'pitching')}
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;padding-left:38px;">
          ${[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(n => {
            const active = strikes === n;
            const c = n >= 11 ? '#10b981' : n >= 8 ? '#60a5fa' : n >= 5 ? '#f5a623' : '#ef4444';
            return `<div onclick="event.stopPropagation();evalSetDayGrade('${p.key}','pitching_strikes',${active?0:n})"
              style="width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;
                     cursor:pointer;font-size:11px;font-weight:700;flex-shrink:0;
                     background:${active?c+'44':'rgba(255,255,255,0.06)'};
                     border:1px solid ${active?c:'rgba(255,255,255,0.1)'};
                     color:${active?c:'var(--text2)'};">${n}</div>`;
          }).join('')}
        </div>
      </div>`;
    }

    return '';
  }).join('');
}

  const drillSections = EVAL_SESSION.evalType === 'evalday'
    ? _renderEvalDaySections(p, safeKey)
    : _renderClinicSections(p, safeKey);

  el.innerHTML = `
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;flex-wrap:wrap;
      padding-bottom:14px;border-bottom:1px solid var(--border);">
    <div style="flex:1;min-width:0;">
      <div style="font-family:Bebas Neue;font-size:22px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.first} ${p.last}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:2px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--text2);">${EVAL_SESSION.sport} · ${EVAL_SESSION.division}</span>
        <span style="font-size:10px;padding:1px 8px;border-radius:4px;font-weight:700;
          background:${EVAL_SESSION.evalType==='evalday'?'rgba(96,165,250,0.15)':'rgba(245,166,35,0.15)'};
          color:${EVAL_SESSION.evalType==='evalday'?'#60a5fa':'var(--gold)'};">
          ${EVAL_SESSION.evalType==='evalday'?'📊 Eval Day':'⚾ Clinic'}
        </span>
        <span style="font-size:10px;color:${expColor};background:${expColor}18;padding:1px 6px;border-radius:4px;">${expLabel} · ${yearsInOrg} yr${yearsInOrg!==1?'s':''}</span>
      </div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;"># Jersey</div>
      <input type="number" value="${p.number||''}" placeholder="—" min="0" max="99"
        oninput="evalSetField('${p.key}','number',this.value)"
        style="width:52px;background:rgba(255,255,255,0.06);border:1px solid var(--border);
               color:var(--text);padding:5px;border-radius:6px;font-size:14px;font-family:Bebas Neue;
               text-align:center;letter-spacing:1px;">
    </div>
    <div style="text-align:center;min-width:64px;">
      <div style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px;">Overall</div>
      <div id="eval_score_${safeKey}"
           style="font-family:Bebas Neue;font-size:36px;line-height:1;color:${ovColor};">${ovScore||'—'}</div>
    </div>
  </div>

  <!-- Select Team + Draft Decision row -->
  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
    <!-- Select Team Star -->
    <button onclick="evalToggleSelectTeam('${p.key}')"
      title="${p.selectTeam ? 'Remove from Select Team' : 'Flag for Select Team'}"
      style="display:flex;align-items:center;gap:7px;padding:9px 14px;border-radius:10px;cursor:pointer;
             border:2px solid ${p.selectTeam ? '#f5a623' : 'rgba(255,255,255,0.12)'};
             background:${p.selectTeam ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.04)'};
             color:${p.selectTeam ? '#f5a623' : 'var(--text2)'};flex:1;min-width:140px;
             transition:all .15s;font-family:inherit;">
      <span style="font-size:20px;line-height:1;">${p.selectTeam ? '⭐' : '☆'}</span>
      <div style="text-align:left;">
        <div style="font-size:12px;font-weight:700;">Select Team</div>
        <div style="font-size:10px;opacity:.7;">${p.selectTeam ? 'Flagged ✓' : 'Tap to flag'}</div>
      </div>
    </button>

    <!-- Draft Yes/No -->
    <div style="display:flex;align-items:center;gap:0;border-radius:10px;overflow:hidden;
        border:2px solid rgba(255,255,255,0.12);flex:1;min-width:200px;">
      <div style="padding:6px 10px;font-size:10px;font-weight:700;color:var(--text2);
          background:rgba(255,255,255,0.04);white-space:nowrap;border-right:1px solid rgba(255,255,255,0.08);">
        Draft?
      </div>
      <button onclick="evalToggleDraft('${p.key}', true)"
        style="flex:1;padding:9px 8px;cursor:pointer;font-size:12px;font-weight:700;
               border:none;background:${p.wantToDraft===true ? '#10b981' : 'rgba(16,185,129,0.08)'};
               color:${p.wantToDraft===true ? '#fff' : '#10b981'};transition:all .15s;font-family:inherit;">
        ✓ Yes
      </button>
      <button onclick="evalToggleDraft('${p.key}', false)"
        style="flex:1;padding:9px 8px;cursor:pointer;font-size:12px;font-weight:700;
               border:none;border-left:1px solid rgba(255,255,255,0.08);
               background:${p.wantToDraft===false ? '#ef4444' : 'rgba(239,68,68,0.08)'};
               color:${p.wantToDraft===false ? '#fff' : '#ef4444'};transition:all .15s;font-family:inherit;">
        ✗ No
      </button>
      <button onclick="evalToggleDraft('${p.key}', null)"
        style="flex:1;padding:9px 8px;cursor:pointer;font-size:12px;font-weight:700;
               border:none;border-left:1px solid rgba(255,255,255,0.08);
               background:${p.wantToDraft===null ? 'rgba(255,255,255,0.12)' : 'transparent'};
               color:${p.wantToDraft===null ? 'var(--text)' : 'var(--text2)'};transition:all .15s;font-family:inherit;">
        — Skip
      </button>
    </div>
  </div>

  ${drillSections}

  <div style="margin-bottom:8px;margin-top:4px;display:flex;align-items:center;gap:8px;">
    <label style="font-size:10px;color:var(--text2);font-weight:700;flex:1;">📝 Overall Notes (voice)</label>
    <button onclick="evalRecordVoice('${p.key}','overall')"
      style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.06);
             color:var(--text2);font-size:12px;cursor:pointer;">🎙️ Record</button>
  </div>

  <div style="margin-bottom:12px;">
    <div style="font-size:10px;color:var(--text2);font-weight:700;margin-bottom:6px;">📎 Photos &amp; Video</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;" id="eval_media_${safeKey}">
      ${_evalMediaThumbs(p, safeKey)}
    </div>
    <div style="font-size:9px;color:var(--text2);margin-top:5px;opacity:.7;">Tap to view · ✕ to remove · stored with session</div>
  </div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:8px;">
    ${_evalPrevNext(p.key)}
  </div>`;
}

function _evalPrevNext(key) {
  const present = EVAL_SESSION.players.filter(p=>p.present);
  const idx = present.findIndex(p=>p.key===key);
  const prev = idx > 0 ? present[idx-1] : null;
  const next = idx < present.length-1 ? present[idx+1] : null;
  return `<div>
    ${prev?`<button class="btn btn-ghost btn-sm" onclick="evalSelectPlayer('${prev.key}')">← ${prev.first} ${prev.last}</button>`:'<span></span>'}
  </div>
  <div>
    ${next?`<button class="btn btn-gold btn-sm" onclick="evalSelectPlayer('${next.key}')">Next: ${next.first} ${next.last} →</button>`:
           `<button class="btn btn-gold btn-sm" onclick="evalSaveSession();renderEvalSummary();">✓ Done — Save</button>`}
  </div>`;
}

function evalSetGrade(key, catId, val) {
  const p = EVAL_SESSION.players.find(x=>x.key===key);
  if (!p) return;
  p.grades[catId] = val;
  _evalUpdateOverall(key, p);
  renderEvalPlayerTabs();
  clearTimeout(evalSetGrade._saveTimer);
  evalSetGrade._saveTimer = setTimeout(() => evalSaveSession(), 2000);
}
evalSetGrade._saveTimer = null;

function evalSetDrillGrade(key, drillId, principleId, val) {
  const p = EVAL_SESSION.players.find(x=>x.key===key);
  if (!p) return;
  if (!p.drillGrades) p.drillGrades = {};
  if (!p.drillGrades[drillId]) p.drillGrades[drillId] = {};
  p.drillGrades[drillId][principleId] = val;

  // Recompute overall and update score display
  _evalUpdateOverall(key, p);

  // Refresh just this drill section without full card re-render
  renderEvalGradingCard();

  clearTimeout(evalSetGrade._saveTimer);
  evalSetGrade._saveTimer = setTimeout(() => evalSaveSession(), 2000);
}

function evalSetDayGrade(key, catId, val) {
  const p = EVAL_SESSION.players.find(x=>x.key===key);
  if (!p) return;
  if (!p.dayGrades) p.dayGrades = {};
  p.dayGrades[catId] = val;
  _evalUpdateOverall(key, p);
  renderEvalGradingCard();
  clearTimeout(evalSetGrade._saveTimer);
  evalSetGrade._saveTimer = setTimeout(() => evalSaveSession(), 2000);
}


function _evalUpdateOverall(key, p) {
  // Offseason sessions must NOT store a numeric rating — notes only
  const _isOffseason = (EVAL_SESSION.evalType||'').toLowerCase() === 'offseason';

  const playerData = typeof players!=='undefined' ? players.find(pl=>
    pl.first.toLowerCase()===p.first.toLowerCase() &&
    pl.last[0]?.toUpperCase()===p.last[0]?.toUpperCase() &&
    pl.sport===EVAL_SESSION.sport && pl.year===EVAL_SESSION.year
  ) : null;
  const ov = evalComputeOverall(playerData||{first:p.first,last:p.last,sport:EVAL_SESSION.sport}, p);

  if (_isOffseason) {
    // Explicitly clear any previously stored rating so it cannot be picked up by draft scoring
    p._overall100 = null;
  } else if (ov) {
    p._overall100 = ov.score;
  }

  const scoreEl = document.getElementById(`eval_score_${key.replace(/[|]/g,'_')}`);
  if (scoreEl) {
    if (!_isOffseason && ov) {
      scoreEl.textContent = ov.score;
      scoreEl.style.color = evalOverallColor(ov.score);
    } else {
      scoreEl.textContent = '—';
      scoreEl.style.color = 'var(--text2)';
    }
  }
}

function evalRecordVoice(key, catId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Voice recording not supported on this device');
    return;
  }
  const btn = event.target.closest('button');
  if (btn._recording) {
    // Stop recording
    btn._recorder?.stop();
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const chunks = [];
    const rec = new MediaRecorder(stream);
    btn._recording = true;
    btn._recorder = rec;
    btn.textContent = '⏹️';
    btn.style.background = 'rgba(239,68,68,0.2)';
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      btn._recording = false;
      btn.textContent = '🎙️';
      btn.style.background = 'rgba(255,255,255,0.08)';
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = ev => {
        const p = EVAL_SESSION.players.find(x => x.key === key);
        if (!p) return;
        if (!p.voiceNotes) p.voiceNotes = {};
        p.voiceNotes[catId] = ev.target.result;
        btn.title = '🎙️ Voice note saved';
        btn.style.color = '#10b981';
        evalSaveSession();
        toast('✓ Voice note saved');
      };
      reader.readAsDataURL(blob);
    };
    rec.start();
    setTimeout(() => { if (btn._recording) rec.stop(); }, 30000); // 30s max
  }).catch(() => toast('Microphone access denied'));
}

function evalSetNote(key, catId, val) {
  const p = EVAL_SESSION.players.find(x=>x.key===key);
  if (p) p.notes[catId] = val;
}

// ── Eval mobile: touch swipe navigation ──────────────────────────────────
let _evalTouchX = null;
function evalTouchStart(e) { _evalTouchX = e.touches[0].clientX; }
function evalTouchEnd(e) {
  if (_evalTouchX === null) return;
  const dx = e.changedTouches[0].clientX - _evalTouchX;
  _evalTouchX = null;
  if (Math.abs(dx) < 50) return;
  const present = EVAL_SESSION.players.filter(p => p.present);
  const idx = present.findIndex(p => p.key === EVAL_SESSION.activeKey);
  if (dx < 0 && idx < present.length - 1) evalSelectPlayer(present[idx + 1].key);
  else if (dx > 0 && idx > 0) evalSelectPlayer(present[idx - 1].key);
}

// ── Eval mobile: progress strip (dot nav) ─────────────────────────────────
function renderEvalProgressStrip() {
  const strip = document.getElementById('evalProgressStrip');
  if (!strip) return;
  const present = EVAL_SESSION.players.filter(p => p.present);
  if (!present.length) { strip.innerHTML = ''; return; }
  const idx = present.findIndex(p => p.key === EVAL_SESSION.activeKey);
  const cur = idx >= 0 ? idx : 0;
  const graded = present.filter(p =>
    Object.values(p.drillGrades || {}).some(dg => Object.values(dg).some(v => v > 0)) ||
    Object.values(p.dayGrades || {}).some(v => v > 0)
  ).length;

  const dots = present.map((p, i) => {
    const hasGrade = Object.values(p.drillGrades || {}).some(dg => Object.values(dg).some(v => v > 0)) ||
                     Object.values(p.dayGrades || {}).some(v => v > 0);
    const isActive = p.key === EVAL_SESSION.activeKey;
    const ov = p._overall100;
    const col = ov ? evalOverallColor(ov) : (hasGrade ? '#60a5fa' : 'rgba(255,255,255,0.15)');
    const escKey = p.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<button onclick="evalSelectPlayer('${escKey}')" title="${p.first} ${p.last}"
      style="width:28px;height:28px;border-radius:50%;border:2px solid ${isActive ? 'var(--gold)' : col};
             background:${isActive ? 'var(--gold)' : col + '33'};cursor:pointer;font-size:9px;
             font-weight:700;color:${isActive ? 'var(--navy)' : col};
             transition:all .15s;flex-shrink:0;">${ov || (i + 1)}</button>`;
  }).join('');

  strip.innerHTML = `
    <div class="eval-progress-strip">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:12px;color:var(--text2);">
          <strong style="color:var(--text);">${cur + 1}</strong> of ${present.length}
        </span>
        <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.08);overflow:hidden;">
          <div style="height:100%;width:${Math.round(graded / present.length * 100)}%;
               background:var(--gold);border-radius:2px;transition:width .3s;"></div>
        </div>
        <span style="font-size:11px;color:var(--text2);">${graded}/${present.length} graded</span>
      </div>
      <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;" class="eval-dot-strip">
        ${dots}
      </div>
    </div>`;
}

// ── Eval media: photo/video upload ────────────────────────────────────────
function _evalMediaThumbs(p, safeKey) {
  if (!p.media || !p.media.length) {
    return '<label style="width:72px;height:72px;border-radius:8px;border:1px dashed var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;background:rgba(255,255,255,.03);">' +
      '<span style="font-size:20px;">📷</span><span style="font-size:9px;color:var(--text2);">Add</span>' +
      '<input type="file" accept="image/*,video/*" capture="environment" style="display:none;" onchange="evalAddMedia(\'' + p.key + '\',event)"></label>';
  }
  let html = p.media.map((m, mi) => {
    const thumb = m.type === 'video'
      ? '<video src="' + m.data + '" style="width:100%;height:100%;object-fit:cover;" muted></video>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3);pointer-events:none;"><span style="font-size:18px;">▶</span></div>'
      : '<img src="' + m.data + '" style="width:100%;height:100%;object-fit:cover;">';
    return '<div style="position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid var(--border);flex-shrink:0;cursor:pointer;" onclick="evalViewMedia(\'' + p.key + '\',' + mi + ')">' +
      thumb +
      '<button onclick="event.stopPropagation();evalRemoveMedia(\'' + p.key + '\',' + mi + ')" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.75);border:none;color:#fff;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;">✕</button>' +
      '</div>';
  }).join('');
  if (p.media.length < 6) {
    html += '<label style="width:72px;height:72px;border-radius:8px;border:1px dashed var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;background:rgba(255,255,255,.03);flex-shrink:0;">' +
      '<span style="font-size:20px;">📷</span><span style="font-size:9px;color:var(--text2);">Add</span>' +
      '<input type="file" accept="image/*,video/*" capture="environment" style="display:none;" onchange="evalAddMedia(\'' + p.key + '\',event)"></label>';
  }
  return html;
}


function evalAddMedia(key, event) {
  const file = event.target.files[0];
  if (!file) return;
  const p = EVAL_SESSION.players.find(x => x.key === key);
  if (!p) return;
  if (!p.media) p.media = [];
  if (p.media.length >= 6) { toast('Max 6 items per player'); return; }
  const isVideo = file.type.startsWith('video/');
  if (isVideo && file.size > 30 * 1024 * 1024) { toast('Video too large — max 30MB'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    if (isVideo) {
      p.media.push({ type: 'video', data: e.target.result, name: file.name });
      renderEvalGradingCard(); evalSaveSession();
    } else {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        p.media.push({ type: 'image', data: canvas.toDataURL('image/jpeg', 0.8), name: file.name });
        renderEvalGradingCard(); evalSaveSession();
      };
      img.src = e.target.result;
    }
  };
  reader.readAsDataURL(file);
}

function evalRemoveMedia(key, idx) {
  const p = EVAL_SESSION.players.find(x => x.key === key);
  if (!p || !p.media) return;
  p.media.splice(idx, 1);
  renderEvalGradingCard(); evalSaveSession();
}

function evalViewMedia(key, idx) {
  const p = EVAL_SESSION.players.find(x => x.key === key);
  if (!p || !p.media?.[idx]) return;
  const m = p.media[idx];
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = () => ov.remove();
  ov.innerHTML = m.type === 'video'
    ? `<video src="${m.data}" controls autoplay style="max-width:100%;max-height:90vh;border-radius:8px;" onclick="event.stopPropagation()"></video>`
    : `<img src="${m.data}" style="max-width:100%;max-height:90vh;border-radius:8px;object-fit:contain;" onclick="event.stopPropagation()">`;
  document.body.appendChild(ov);
}


function evalToggleSelectTeam(key) {
  const p = EVAL_SESSION.players.find(x=>x.key===key);
  if (!p) return;
  p.selectTeam = !p.selectTeam;
  renderEvalGradingCard();
  renderEvalPlayerTabs();
  renderEvalPicksCard();
}

function evalToggleDraft(key, val) {
  const p = EVAL_SESSION.players.find(x=>x.key===key);
  if (!p) return;
  p.wantToDraft = p.wantToDraft === val ? null : val;
  renderEvalGradingCard();
  renderEvalPlayerTabs();
  renderEvalPicksCard();
}


function evalSetField(key, field, val) {
  const p = EVAL_SESSION.players.find(x=>x.key===key);
  if (!p) return;
  p[field] = val;
  if (field === 'overall') { renderEvalGradingCard(); renderEvalPlayerTabs(); }
}

// ── Summary ───────────────────────────────────────────────

// ── Draft Picks ranker ────────────────────────────────────────────────────

function renderEvalPicksCard() {
  const card   = document.getElementById('evalPicksCard');
  const listEl = document.getElementById('evalPicksList');
  const stEl   = document.getElementById('evalSelectTeamList');
  if (!card || !listEl) return;

  const yesPlayers  = EVAL_SESSION.players.filter(p => p.present && p.wantToDraft === true);
  const selectTeamPlayers = EVAL_SESSION.players.filter(p => p.present && p.selectTeam);

  card.style.display = (yesPlayers.length || selectTeamPlayers.length) ? '' : 'none';
  if (!yesPlayers.length && !selectTeamPlayers.length) return;

  // Preserve existing rank order, put new Yes players at end
  if (!EVAL_SESSION.pickOrder) EVAL_SESSION.pickOrder = [];
  const knownKeys = new Set(EVAL_SESSION.pickOrder);
  yesPlayers.forEach(p => { if (!knownKeys.has(p.key)) EVAL_SESSION.pickOrder.push(p.key); });
  // Remove any no-longer-yes players
  EVAL_SESSION.pickOrder = EVAL_SESSION.pickOrder.filter(k => yesPlayers.some(p=>p.key===k));

  // Build ranked list (draggable)
  listEl.innerHTML = EVAL_SESSION.pickOrder.map((key, rank) => {
    const p = EVAL_SESSION.players.find(x=>x.key===key);
    if (!p) return '';
    const ov = p._overall100;
    const ovColor = ov ? evalOverallColor(ov) : 'var(--text2)';
    const starBadge = p.selectTeam ? '<span style="font-size:13px;" title="Select Team candidate">⭐</span>' : '';
    return `<div draggable="true"
      data-key="${key}" data-rank="${rank}"
      ondragstart="evalPickDragStart(event)"
      ondragover="evalPickDragOver(event)"
      ondrop="evalPickDrop(event)"
      ondragend="evalPickDragEnd(event)"
      style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;cursor:grab;
             background:rgba(255,255,255,0.04);border:1px solid var(--border);user-select:none;
             transition:opacity .15s;" id="pick_${key}">
      <span style="font-family:Bebas Neue;font-size:18px;color:var(--text2);min-width:22px;text-align:center;">${rank+1}</span>
      <div style="width:3px;height:28px;border-radius:2px;background:${ovColor};flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:5px;">
          ${p.first} ${p.last}
          ${starBadge}
          ${p.number ? `<span style="font-size:10px;color:var(--text2);">#${p.number}</span>` : ''}
        </div>
        ${p.overallNotes ? `<div style="font-size:10px;color:var(--text2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.overallNotes}</div>` : ''}
      </div>
      ${ov ? `<div style="font-family:Bebas Neue;font-size:26px;color:${ovColor};">${ov}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:3px;padding:2px 0;opacity:.4;">
        <div style="width:16px;height:2px;background:var(--text2);border-radius:1px;"></div>
        <div style="width:16px;height:2px;background:var(--text2);border-radius:1px;"></div>
        <div style="width:16px;height:2px;background:var(--text2);border-radius:1px;"></div>
      </div>
    </div>`;
  }).join('');

  // Select Team section
  if (stEl) {
    if (selectTeamPlayers.length) {
      const stRows = selectTeamPlayers.map(p => {
        const ov = p._overall100;
        const ovColor = ov ? evalOverallColor(ov) : 'var(--gold)';
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:8px;
            background:rgba(245,166,35,0.06);border:1px solid rgba(245,166,35,0.2);">
          <span style="font-size:16px;">⭐</span>
          <span style="font-size:13px;font-weight:700;flex:1;">${p.first} ${p.last}
            ${p.number ? `<span style="font-size:10px;color:var(--text2);">#${p.number}</span>` : ''}
          </span>
          ${ov ? `<span style="font-family:Bebas Neue;font-size:22px;color:${ovColor};">${ov}</span>` : ''}
        </div>`;
      }).join('');
      stEl.innerHTML = `<div style="font-family:Bebas Neue;font-size:14px;letter-spacing:.5px;margin-bottom:8px;">
        ⭐ Select Team <span style="color:var(--gold);">Candidates</span>
        <span style="font-size:10px;font-family:'DM Sans';color:var(--text2);font-weight:400;margin-left:6px;">${selectTeamPlayers.length} flagged</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;">${stRows}</div>`;
    } else {
      stEl.innerHTML = '';
    }
  }
}

// ── Drag-to-reorder ───────────────────────────────────────────────────────
let _evalDragKey = null;

function evalPickDragStart(e) {
  _evalDragKey = e.currentTarget.dataset.key;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}

function evalPickDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Visual indicator
  const target = e.currentTarget;
  if (target.dataset.key !== _evalDragKey) {
    target.style.borderColor = 'var(--gold)';
  }
}

function evalPickDrop(e) {
  e.preventDefault();
  const targetKey = e.currentTarget.dataset.key;
  if (!_evalDragKey || targetKey === _evalDragKey) return;
  const order = EVAL_SESSION.pickOrder;
  const fromIdx = order.indexOf(_evalDragKey);
  const toIdx   = order.indexOf(targetKey);
  if (fromIdx < 0 || toIdx < 0) return;
  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, _evalDragKey);
  renderEvalPicksCard();
}

function evalPickDragEnd(e) {
  _evalDragKey = null;
  // Reset all borders
  document.querySelectorAll('#evalPicksList > div').forEach(el => {
    el.style.opacity = '1';
    el.style.borderColor = 'var(--border)';
  });
}


function renderEvalSummary() {
  const el = document.getElementById('evalSummaryTable');
  if (!el) return;
  const isEvalDay = EVAL_SESSION.evalType === 'evalday';

  const graded = EVAL_SESSION.players.filter(p => p.present && (
    Object.values(p.drillGrades||{}).some(dg => Object.values(dg).some(v=>v>0)) ||
    Object.values(p.dayGrades||{}).some(v=>v>0) ||
    Object.values(p.grades||{}).some(v=>v>0)
  ));
  if (!graded.length) { el.innerHTML='<div style="color:var(--text2);font-size:13px;">No grades recorded yet.</div>'; return; }

  const getOv = p => {
    const pd = (typeof players!=='undefined') ? players.find(pl =>
      pl.first.toLowerCase()===p.first.toLowerCase() &&
      pl.last[0]?.toUpperCase()===p.last[0]?.toUpperCase() &&
      pl.sport===EVAL_SESSION.sport && pl.year===EVAL_SESSION.year
    ) : null;
    return evalComputeOverall(pd||{first:p.first,last:p.last,sport:EVAL_SESSION.sport}, p);
  };

  const getDrillAvg = (p, drillId) => {
    const dg = (p.drillGrades||{})[drillId] || {};
    const vals = Object.values(dg).filter(v=>v>0);
    return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
  };

  const cols = isEvalDay
    ? EVAL_DAY_CATS.map(c => `<th style="text-align:center;padding:4px 6px;color:var(--text2);font-size:10px;white-space:nowrap;">${c.icon} ${c.label}</th>`).join('')
    : EVAL_DRILLS.map(d => `<th style="text-align:center;padding:4px 6px;color:var(--text2);font-size:10px;white-space:nowrap;">${d.icon} ${d.label}</th>`).join('');

  const rows = graded.sort((a,b)=>(getOv(b)?.score||0)-(getOv(a)?.score||0)).map(p => {
    const ov = getOv(p);
    const ovScore = ov?.score||null;
    const ovColor = evalOverallColor(ovScore);
    const cells = isEvalDay
      ? EVAL_DAY_CATS.map(cat => {
          const val = (p.dayGrades||{})[cat.id] || 0;
          const col = val ? EVAL_COLORS_5[val] : 'var(--border)';
          return `<td style="text-align:center;padding:5px 6px;">
            ${val ? `<div style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;">
              <span style="font-family:Bebas Neue;font-size:16px;color:${col};">${val}</span>
              <span style="font-size:8px;color:${col};white-space:nowrap;">${EVAL_RATINGS_5[val]}</span>
            </div>` : '<span style="color:var(--border);font-size:11px;">—</span>'}
          </td>`;
        }).join('')
      : EVAL_DRILLS.map(d => {
          const avg = getDrillAvg(p, d.id);
          const col = avg>=4?'#10b981':avg>=3?'#60a5fa':avg>=2?'#f5a623':avg>0?'#ef4444':'var(--border)';
          return `<td style="text-align:center;padding:5px 6px;">
            ${avg>0?`<span style="font-family:Bebas Neue;font-size:13px;color:${col};">${EVAL_RATINGS[Math.round(avg)]}</span>`:'<span style="color:var(--border);font-size:11px;">—</span>'}
          </td>`;
        }).join('');
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:7px 10px;font-weight:600;white-space:nowrap;">${p.first} ${p.last}${p.number?` <span style="font-size:10px;color:var(--text2);">#${p.number}</span>`:''}</td>
      ${cells}
      <td style="text-align:center;padding:7px 10px;">
        ${ovScore?`<span style="font-family:Bebas Neue;font-size:20px;color:${ovColor};">${ovScore}</span>`:'<span style="color:var(--border);">—</span>'}
      </td>
    </tr>`;
  }).join('');

  const bodyEl = document.getElementById('evalSummaryBody');
  if (bodyEl && graded.length) bodyEl.style.display = '';
  el.innerHTML = `<div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="border-bottom:1px solid var(--border);">
      <th style="text-align:left;padding:6px 10px;color:var(--text2);min-width:110px;">Player</th>
      ${cols}
      <th style="text-align:center;padding:6px 10px;color:var(--text2);">OVR</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ── Save / Export / Commit ────────────────────────────────

// ── Eval Sharing ──────────────────────────────────────────────────────────

async function evalShareWith(sessionId, targetUsername) {
  if (!jbEnabled()) { toast('Cloud sync required for sharing'); return; }
  const session = evalGetAll().find(s => s.id === sessionId);
  if (!session) return;

  try {
    const dir = await jbGetDir();
    const target = (dir.coaches || {})[targetUsername.toLowerCase()];
    if (!target) { toast('Coach not found'); return; }

    // Get target's bin and push eval
    const entry = (dir.users || {})[targetUsername.toLowerCase()];
    if (!entry?.binId) { toast('Cannot reach that coach'); return; }

    const rec = await jbGet(entry.binId);
    const sharedEvals = rec.data?.['lll_' + targetUsername + '_sharedEvals'] || [];
    const payload = Object.assign({}, session, {
      sharedBy: authCurrentUser()?.username,
      sharedAt: new Date().toISOString()
    });
    // Replace if same session already shared
    const idx = sharedEvals.findIndex(e => e.id === session.id && e.sharedBy === payload.sharedBy);
    if (idx >= 0) sharedEvals[idx] = payload; else sharedEvals.push(payload);
    rec.data['lll_' + targetUsername + '_sharedEvals'] = sharedEvals;
    await jbSet(entry.binId, rec);
    toast('✓ Eval shared with ' + (target.displayName || targetUsername));
  } catch(e) { toast('Share failed: ' + e.message); }
}

function evalGetShared() {
  const u = authCurrentUser();
  if (!u) return [];
  try { return JSON.parse(localStorage.getItem('lll_' + u.username + '_sharedEvals') || '[]'); }
  catch { return []; }
}

async function evalAutoShareAll() {
  // Push all my evals to coaches who have auto-receive turned on
  if (!jbEnabled()) return;
  const u = authCurrentUser();
  if (!u) return;
  try {
    const dir = await jbGetDir();
    const myProfile = (dir.coaches || {})[u.username.toLowerCase()];
    if (!myProfile?.sharing?.evals) return;
    const coaches = Object.values(dir.coaches || {});
    for (const c of coaches) {
      if (c.username === u.username) continue;
      evalGetAll().forEach(s => evalShareWith(s.id, c.username).catch(()=>{}));
    }
  } catch {}
}

async function openShareEvalModal(sessionId) {
  if (!jbEnabled()) { toast('Cloud sync required'); return; }
  const coaches = await getSharedCoaches();
  const u = authCurrentUser();
  const others = coaches.filter(c => c.username.toLowerCase() !== u?.username?.toLowerCase());

  if (!others.length) { toast('No other coaches in system yet'); return; }

  const modal = document.getElementById('shareEvalModal');
  const content = document.getElementById('shareEvalContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <div style="font-size:13px;color:var(--text2);margin-bottom:14px;">
      Select coaches to share this evaluation session with:
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;margin-bottom:16px;">
      ${others.map(c => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;
            border:1px solid var(--border);cursor:pointer;background:rgba(255,255,255,0.03);">
          <input type="checkbox" value="${c.username}" style="accent-color:var(--gold);width:16px;height:16px;">
          <div style="font-weight:600;font-size:13px;">${c.displayName || c.username}</div>
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm" onclick="closeModal('shareEvalModal')">Cancel</button>
      <button class="btn btn-gold btn-sm" onclick="
        const checks = document.querySelectorAll('#shareEvalContent input:checked');
        Promise.all(Array.from(checks).map(cb => evalShareWith(${sessionId}, cb.value)))
          .then(() => closeModal('shareEvalModal'));
      ">Share</button>
    </div>`;

  openModal('shareEvalModal');
}


function evalSaveSession() {
  const all = evalGetAll();
  // Compute _overall100 for each player before saving
  EVAL_SESSION.players.forEach(p => {
    const pd = (typeof players!=='undefined') ? players.find(pl=>
      pl.first.toLowerCase()===p.first.toLowerCase() &&
      pl.last[0]?.toUpperCase()===p.last[0]?.toUpperCase() &&
      pl.sport===EVAL_SESSION.sport && pl.year===EVAL_SESSION.year) : null;
    const ov = evalComputeOverall(pd||{first:p.first,last:p.last,sport:EVAL_SESSION.sport}, p);
    if (ov) p._overall100 = ov.score;
  });

  const session = {
    id: Date.now(),
    coachName: EVAL_SESSION.coachName,
    sport: EVAL_SESSION.sport,
    division: EVAL_SESSION.division,
    year: EVAL_SESSION.year,
    evalType: EVAL_SESSION.evalType || 'clinic',
    date: new Date().toISOString(),
    players: JSON.parse(JSON.stringify(EVAL_SESSION.players.filter(p=>p.present))),
  };
  const existing = all.findIndex(s =>
    s.coachName===session.coachName && s.sport===session.sport &&
    s.division===session.division && s.year===session.year
  );
  if (existing>=0) {
    session.id = all[existing].id; // preserve original ID
    all[existing] = session;
  } else {
    all.push(session);
  }
  evalSaveAll(all);
  toast(`Evaluation saved — ${session.players.filter(p=>Object.values(p.grades).some(v=>v>0)).length} players graded`);
  setTimeout(authCloudPush, 800);
  renderEvalSummary();
}

function evalExport() {
  evalSaveSession();
  const session = {
    coachName: EVAL_SESSION.coachName,
    sport: EVAL_SESSION.sport,
    division: EVAL_SESSION.division,
    year: EVAL_SESSION.year,
    players: EVAL_SESSION.players.filter(p=>p.present),
  };
  const lines = [`LYBS PLAYER EVALUATIONS`,
    `Coach: ${session.coachName} | ${session.division} ${session.sport} | ${session.year}`,
    `Date: ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}`,
    `${'─'.repeat(60)}`,
    '',
  ];
  session.players.filter(p=>Object.values(p.grades).some(v=>v>0)).forEach(p => {
    const overall = p.overall || '—';
    lines.push(`${p.first} ${p.last}${p.number?' #'+p.number:''}  [Overall: ${overall}]`);
    const playerData=(typeof players!=='undefined')?players.find(pl=>pl.first.toLowerCase()===p.first.toLowerCase()&&pl.last[0]?.toUpperCase()===p.last[0]?.toUpperCase()&&pl.sport===session.sport&&pl.year===session.year):null;
    const ov=evalComputeOverall(playerData||{first:p.first,last:p.last,sport:session.sport},p);
    EVAL_CATEGORIES.forEach(cat => {
      const v = p.grades[cat.id]||0;
      const note = p.notes[cat.id] ? `  → ${p.notes[cat.id]}` : '';
      lines.push(`  ${cat.icon} ${cat.label.padEnd(14)} ${v?v+'/10':'—'}${note}`);
    });
    if (ov?.score) lines.push(`  📊 Overall Score: ${ov.score}/100 (Exp: ${ov.expScore} yrs in org)`);
    if (p.overallNotes) lines.push(`  📝 ${p.overallNotes}`);
    lines.push('');
  });

  const blob = new Blob([lines.join('\n')], {type:'text/plain'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `LYBS_Evals_${session.division}_${session.sport}_${session.year}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Evaluation exported');
}

function evalCommit() {
  evalSaveSession();
  let committed = 0;
  EVAL_SESSION.players.filter(p=>p.present).forEach(p => {
    const hasGrade = Object.values(p.grades).some(v=>v>0) || p.overall;
    if (!hasGrade) return;
    // Find the matching player in the main players array and update their grade
    const match = players.find(pl =>
      pl.first.toLowerCase()===p.first.toLowerCase() &&
      pl.last[0]?.toUpperCase()===p.last[0]?.toUpperCase() &&
      pl.sport===EVAL_SESSION.sport &&
      pl.year===EVAL_SESSION.year
    );
    if (match) {
      // Use computed 0-100 score to set grade; also store raw score for badge display
      const ov = evalComputeOverall(match, p);
      const score = ov?.score || 0;
      if (score) {
        match.grade = score>=88?'A+':score>=78?'A':score>=68?'B+':score>=58?'B':score>=48?'C+':score>=38?'C':'D';
        match._evalScore = score;
      } else if (p.overall) {
        // Fallback: manual overall letter from eval session
        match.grade = p.overall;
      }
      // Persist positions if they were set during eval
      if (p.number && !match.number) match.number = p.number;
      // Store positions from pitching flag
      if (p.grades.pitching >= 4 && !match.pitching) match.pitching = true;
      committed++;
    }
  });
  save();
  toast(`✓ ${committed} player${committed!==1?'s':''} pushed to your draft board — view in Draft tab`);
}

function evalBackToSetup() {
  document.getElementById('evalGrading').style.display = 'none';
  document.getElementById('evalSetup').style.display = '';
  renderEvalAttendance();
}


const _LEAGUE_TABS   = ['overview','yoy','health','timeline','social'];

// ── Debounced search helpers ──────────────────────────────────────────────
let _rosterSearchTimer = null;
function _debouncedRosterSearch() {
  clearTimeout(_rosterSearchTimer);
  _rosterSearchTimer = setTimeout(renderRoster, 200);
}

let _draftSearchTimer = null;
function _debouncedDraftSearch() {
  clearTimeout(_draftSearchTimer);
  _draftSearchTimer = setTimeout(() => {
    if (typeof renderAvailablePlayers === 'function') renderAvailablePlayers();
  }, 200);
}
const _COACHES_TABS  = ['roster','allstars','teams','coaches','evals','draft','tools','manage'];

function switchTab(id) {
  // Manage tab: allow real admins even in preview mode (they need it to exit preview)
  if (id === 'manage' && !isAdmin()) return;

  // Persist tab for reload restore
  try { sessionStorage.setItem('activeTab', id); } catch(e) {}

  // Show correct section
  TAB_IDS.forEach(t => {
    document.getElementById('tab-'+t)?.classList.toggle('active', t === id);
  });

  // Scroll to top on tab change (mobile especially needs this)
  window.scrollTo({ top: 0, behavior: 'instant' });

  // Update pill active states
  document.querySelectorAll('.nav-pill[data-tab]').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === id);
  });

  // Auto-switch mode if needed
  const isCoach = _COACHES_TABS.includes(id);
  navSetMode(isCoach ? 'coaches' : 'league', false);

  setTimeout(()=>{
    if(id==='yoy') renderYoY();
    else if(id==='health') renderHealth();
    else if(id==='timing') renderTiming();
    else if(id==='allstars') renderAllStars();
    else if(id==='coaches') renderCoachTab();
    else if(id==='teams') renderTeamsPage();
    else if(id==='social') {
      if(typeof renderSocialSection!=='undefined') {
        renderSocialSection();
      } else {
        // Lazy-load social_module.js on first visit
        const script = document.createElement('script');
        script.src = 'social_module.js';
        script.onload = () => { if(typeof renderSocialSection!=='undefined') renderSocialSection(); };
        document.body.appendChild(script);
      }
    }
    else if(id==='roster') renderRoster();
    else if(id==='evals') renderEvalsTab();
    else if(id==='manage') renderManage();
    else if(id==='draft') onDraftTabOpen();
    else if(id==='timeline') renderTimeline();
    else if(id==='tools') {
      // Ensure section is active (safety net if tools not in TAB_IDS of cached versions)
      const toolsSection = document.getElementById('tab-tools');
      if (toolsSection) {
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        toolsSection.classList.add('active');
      }
      if(typeof renderCoachingToolsPanel==='function')
        renderCoachingToolsPanel('coachingToolsPanel','ath');
    }
  }, 50);
}

function navSetMode(mode, switchToFirst=true) {
  const leagueBtn   = document.getElementById('modeBtn-league');
  const coachesBtn  = document.getElementById('modeBtn-coaches');
  const leaguePills = document.getElementById('navpills-league');
  const coachPills  = document.getElementById('navpills-coaches');

  if (mode === 'league') {
    leagueBtn?.classList.add('active');
    coachesBtn?.classList.remove('active');
    if (leaguePills) leaguePills.style.display = '';
    if (coachPills) coachPills.style.display = 'none';
    if (switchToFirst) switchTab('overview');
  } else {
    coachesBtn?.classList.add('active');
    leagueBtn?.classList.remove('active');
    if (coachPills) coachPills.style.display = '';
    if (leaguePills) leaguePills.style.display = 'none';
    if (switchToFirst) switchTab('roster');
  }
  try { sessionStorage.setItem('navMode', mode); } catch(e){}
}

function navRestoreState() {
  try {
    const mode = sessionStorage.getItem('navMode');
    const tab  = sessionStorage.getItem('activeTab');
    // Never restore manage tab for non-admins
    if (tab === 'manage' && !isAdmin()) {
      sessionStorage.removeItem('activeTab');
      return;
    }
    if (mode === 'coaches') {
      navSetMode('coaches', false);
      if (tab && _COACHES_TABS.includes(tab)) switchTab(tab);
    } else if (tab && _LEAGUE_TABS.includes(tab)) {
      switchTab(tab);
    }
  } catch(e) {}
}

// Legacy stub — no-op now
function navToggleGroup() {}

// MODALS
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(el=>{
  el.addEventListener('click',e=>{ if(e.target===el) el.classList.remove('open'); });
});

function updateDivDropdown() {
  const sport = document.getElementById('ap_sport').value;
  const dob = document.getElementById('ap_dob').value;
  const regYear = parseInt(document.getElementById('ap_year').value) || new Date().getFullYear();
  const div = assignDivision(sport, dob, regYear);
  const el = document.getElementById('ap_div');
  const opts = {Baseball:['Majors','Minors','Rookies'],Softball:['Senior','Majors','Minors','Farm'],'T-Ball':['T-Ball']};
  el.innerHTML = (opts[sport]||[]).map(d=>`<option value="${d}" ${d===div?'selected':''}>${d}</option>`).join('');
}
document.getElementById('ap_dob')?.addEventListener('change',updateDivDropdown);
document.getElementById('ap_sport')?.addEventListener('change',updateDivDropdown);
document.getElementById('ap_year')?.addEventListener('change',updateDivDropdown);

function addPlayer() {
  const dob = document.getElementById('ap_dob').value;
  const allstarYearsRaw = document.getElementById('ap_allstar_years')?.value || '';
  const regYear = parseInt(document.getElementById('ap_year').value);
  const sport = document.getElementById('ap_sport').value;
  const rawLast = document.getElementById('ap_last').value.trim();
  // Store only the initial of the last name for privacy
  const lastInitial = rawLast ? rawLast[0].toUpperCase() : '';
  const p = {
    year: regYear,
    first: document.getElementById('ap_first').value.trim(),
    last: lastInitial,
    gender: document.getElementById('ap_gender').value,
    sport: sport,
    division: document.getElementById('ap_div').value || assignDivision(sport, dob),
    allstar_division: dob ? calcAllstarBracket(sport, dob, regYear) : '',
    city: document.getElementById('ap_city').value.trim(),
    team: document.getElementById('ap_team').value.trim(),
    amount: parseFloat(document.getElementById('ap_amount').value)||0,
    pitching: document.getElementById('ap_pitching')?.checked || false,
    catching: document.getElementById('ap_catching')?.checked || false,
    allstar_years: allstarYearsRaw ? allstarYearsRaw.split(',').map(y=>parseInt(y.trim())).filter(y=>!isNaN(y)) : [],
    // dob is intentionally not stored — used only to compute division/bracket above
  };
  if(!p.first||!p.last) { toast('First and last name required','error'); return; }
  if ((p.year||0) >= 2022 && !p.pid) { const maxPid = Math.max(10000, ...players.filter(x=>x.pid).map(x=>x.pid)); p.pid = maxPid + 1; }
  players.push(p);
  save();  // persists to localStorage + triggers cloud push
  closeModal('addPlayerModal');
  refreshAll();
  toast(`Added ${p.first} ${p.last}!`);
}

function editPlayer(idx) {
  const p = players[idx];
  if(!p) return;
  document.getElementById('ep_idx').value = idx;
  document.getElementById('ep_first').value = p.first;
  document.getElementById('ep_last').value = p.last;
  document.getElementById('ep_gender').value = p.gender||'';
  document.getElementById('ep_sport').value = p.sport;
  document.getElementById('ep_div').value = p.division;
  document.getElementById('ep_year').value = p.year;
  document.getElementById('ep_city').value = p.city||'';
  document.getElementById('ep_team').value = (p.team&&p.team!=='nan')?p.team:'';
  document.getElementById('ep_amount').value = p.amount||0;
  if(document.getElementById('ep_pitching')) document.getElementById('ep_pitching').checked = p.pitching || false;
  if(document.getElementById('ep_catching')) document.getElementById('ep_catching').checked = p.catching || false;
  if(document.getElementById('ep_allstar_years')) document.getElementById('ep_allstar_years').value = (p.allstar_years||[]).join(', ');
  if(document.getElementById('ep_positions')) document.getElementById('ep_positions').value = (p.positions||[]).join(', ');
  if(document.getElementById('ep_grade')) document.getElementById('ep_grade').value = p.grade || '';

  // Populate team datalist filtered by this player's year
  _populateTeamDatalist('ep_team_datalist', p.year, p.sport);

  // Pre-fill "Add Season" defaults — default to next year, same sport, next division up
  const divOrder = ['T-Ball','Farm','Rookies','Minors','Majors','Senior'];
  const curDivIdx = divOrder.indexOf(p.division);
  const nextDiv = curDivIdx >= 0 && curDivIdx < divOrder.length - 1 ? divOrder[curDivIdx + 1] : p.division;
  const nextYear = Math.min(p.year + 1, 2027);
  if (document.getElementById('ep_add_year')) document.getElementById('ep_add_year').value = String(nextYear);
  if (document.getElementById('ep_add_div')) document.getElementById('ep_add_div').value = nextDiv;
  if (document.getElementById('ep_add_sport')) document.getElementById('ep_add_sport').value = p.sport === 'T-Ball' ? 'Baseball' : p.sport;
  if (document.getElementById('ep_add_team')) document.getElementById('ep_add_team').value = '';
  if (document.getElementById('ep_add_amount')) document.getElementById('ep_add_amount').value = p.amount || 0;

  // Populate add-season team datalist
  _populateTeamDatalist('ep_add_team_datalist', nextYear, p.sport === 'T-Ball' ? 'Baseball' : p.sport);

  // Update add-season datalist when year changes
  const addYearSel = document.getElementById('ep_add_year');
  const addSportSel = document.getElementById('ep_add_sport');
  const refreshAddDl = () => _populateTeamDatalist('ep_add_team_datalist',
    parseInt(addYearSel?.value || nextYear), addSportSel?.value || p.sport);
  if (addYearSel) addYearSel.onchange = refreshAddDl;
  if (addSportSel) addSportSel.onchange = refreshAddDl;

  openModal('editPlayerModal');
}

function _populateTeamDatalist(datalistId, year, sport) {
  const dl = document.getElementById(datalistId);
  if (!dl) return;
  // Get teams from players in this year (and sport if provided)
  const teams = new Set();
  players.forEach(x => {
    if (x.year !== parseInt(year)) return;
    if (sport && x.sport !== sport && !(sport === 'T-Ball' || x.sport === 'T-Ball')) return;
    const t = (x.team || '').trim();
    if (t && t.toLowerCase() !== 'nan' && t.toLowerCase() !== 'unallocated') teams.add(t);
  });
  dl.innerHTML = [...teams].sort().map(t => `<option value="${t.replace(/"/g,'&quot;')}"></option>`).join('');
}

function addSeasonForPlayer() {
  const idx = parseInt(document.getElementById('ep_idx')?.value);
  if (isNaN(idx)) return;
  const base = players[idx];
  if (!base) return;

  const year    = parseInt(document.getElementById('ep_add_year')?.value || 2026);
  const div     = document.getElementById('ep_add_div')?.value || base.division;
  const sport   = document.getElementById('ep_add_sport')?.value || base.sport;
  const team    = (document.getElementById('ep_add_team')?.value || '').trim();
  const amount  = parseFloat(document.getElementById('ep_add_amount')?.value || 0) || 0;

  // Check if a record already exists for this player + year + sport + division
  const existing = players.find(x =>
    x.first.toLowerCase() === base.first.toLowerCase() &&
    x.last[0]?.toUpperCase() === base.last[0]?.toUpperCase() &&
    x.year === year && x.sport === sport && x.division === div
  );
  if (existing) {
    toast(`${base.first} ${base.last} already has a ${year} ${div} ${sport} record`, 'error');
    return;
  }

  // Clone base player into new season record
  const newEntry = {
    ...base,
    year,
    division: div,
    sport,
    team: team || '',
    amount,
    _evalScore: undefined,
    grade: '',
    // Clear season-specific flags but keep personal info
    pitching: base.pitching,
    catching: base.catching,
    allstar_years: base.allstar_years || [],
    positions: base.positions || [],
  };
  delete newEntry._evalScore;

  players.push(newEntry);
  save();
  refreshAll();
  setTimeout(authCloudPush, 600);
  toast(`✓ Added ${year} ${div} ${sport} season for ${base.first} ${base.last}`);

  // Reset the add-season fields
  if (document.getElementById('ep_add_team')) document.getElementById('ep_add_team').value = '';
}

function saveEdit() {
  const idx = parseInt(document.getElementById('ep_idx').value);
  if(isNaN(idx)) return;
  const editAllstarRaw = document.getElementById('ep_allstar_years')?.value || '';
  const rawLast = document.getElementById('ep_last').value.trim();
  // Store only the initial of the last name for privacy
  const lastInitial = rawLast ? rawLast[0].toUpperCase() : (players[idx]?.last || '');
  players[idx] = {
    ...players[idx],
    first: document.getElementById('ep_first').value.trim(),
    last: lastInitial,
    gender: document.getElementById('ep_gender').value,
    sport: document.getElementById('ep_sport').value,
    division: document.getElementById('ep_div').value,
    year: parseInt(document.getElementById('ep_year').value),
    city: document.getElementById('ep_city').value.trim(),
    team: document.getElementById('ep_team').value.trim(),
    amount: parseFloat(document.getElementById('ep_amount').value)||0,
    pitching: document.getElementById('ep_pitching')?.checked || false,
    catching: document.getElementById('ep_catching')?.checked || false,
    allstar_years: editAllstarRaw ? editAllstarRaw.split(',').map(y=>parseInt(y.trim())).filter(y=>!isNaN(y)) : [],
    positions: (document.getElementById('ep_positions')?.value||'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean),
    grade: document.getElementById('ep_grade')?.value || '',
  };
  closeModal('editPlayerModal');
  refreshAll();
  save();
  setTimeout(authCloudPush, 600);
  toast('Player updated — synced to cloud!');
}

// ── GC Stats CSV Import ───────────────────────────────────────────────────
// Parses a GameChanger team season export (the multi-header format with
// Batting / Pitching / Fielding column groups) and merges results into the
// live GC_STATS array so player profiles update immediately.
let _pendingGCStats = null;

function openGCStatsImport() {
  if (!isAdmin()) { toast('Admin access required', 'error'); return; }
  document.getElementById('gcStatsPreview').innerHTML = '';
  document.getElementById('gcStatsConfirmBtn').style.display = 'none';
  _pendingGCStats = null;
  openModal('gcStatsModal');
}

function handleGCStatsFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const result = parseGCStatsCSV(e.target.result);
      if (!result.length) {
        document.getElementById('gcStatsPreview').innerHTML =
          '<div style="color:var(--red);font-size:13px;">⚠️ No player rows found. Make sure this is a GameChanger team stats export.</div>';
        return;
      }
      _pendingGCStats = result;
      const matched = result.filter(r =>
        players.some(p => `${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}` === r.key)
      ).length;
      document.getElementById('gcStatsPreview').innerHTML =
        `<div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:12px;font-size:13px;color:var(--green);">
          ✓ Found <strong>${result.length}</strong> players — <strong>${matched}</strong> matched to registered players.
          <div style="margin-top:8px;font-size:11px;color:var(--text2);">${result.map(r=>`${r.first} ${r.last}`).join(', ')}</div>
        </div>`;
      document.getElementById('gcStatsConfirmBtn').style.display = 'block';
    } catch(err) {
      document.getElementById('gcStatsPreview').innerHTML =
        `<div style="color:var(--red);font-size:13px;">⚠️ Parse error: ${err.message}</div>`;
    }
  };
  reader.readAsText(file);
}

function parseGCStatsCSV(text) {
  const rawLines = text.split(/\r?\n/);

  function parseRow(line) {
    const out = []; let cur = ''; let inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    out.push(cur.trim());
    return out.map(v => v.replace(/^"|"$/g, '').trim());
  }

  // GC exports: Row 0 = group labels (Batting/Pitching/Fielding), Row 1 = stat names, Row 2+ = data
  // Detect group row and header row
  let groupRow = [], headerRow = [], dataStart = 2;
  for (let i = 0; i < Math.min(rawLines.length, 5); i++) {
    const cols = parseRow(rawLines[i]);
    if (cols.some(c => /^batting$/i.test(c))) {
      groupRow = cols;
      dataStart = i + 2;
    }
    if (cols.some(c => /^last$/i.test(c)) && cols.some(c => /^first$/i.test(c))) {
      headerRow = cols.map(h => h.toLowerCase());
      if (!groupRow.length) dataStart = i + 1;
    }
  }
  if (!headerRow.length) throw new Error('Could not find column headers (Last, First)');

  // Map group sections to column ranges
  const sections = { batting: -1, pitching: -1, fielding: -1 };
  groupRow.forEach((g, i) => {
    const gl = g.toLowerCase();
    if (gl === 'batting'  && sections.batting  < 0) sections.batting  = i;
    else if (gl === 'pitching' && sections.pitching < 0) sections.pitching = i;
    else if (gl === 'fielding' && sections.fielding < 0) sections.fielding = i;
  });

  function sectionMap(start, end) {
    const m = {};
    for (let i = start; i < end && i < headerRow.length; i++) {
      const h = headerRow[i];
      if (h && !m[h]) m[h] = i;
    }
    return m;
  }
  const bEnd = sections.pitching > 0 ? sections.pitching : sections.fielding > 0 ? sections.fielding : headerRow.length;
  const pEnd = sections.fielding > 0 ? sections.fielding : headerRow.length;
  const bCols = sections.batting  >= 0 ? sectionMap(sections.batting,  bEnd) : {};
  const pCols = sections.pitching >= 0 ? sectionMap(sections.pitching, pEnd) : {};
  const fCols = sections.fielding >= 0 ? sectionMap(sections.fielding, headerRow.length) : {};
  const useSimple = sections.batting < 0;

  const yr   = parseInt(document.getElementById('gcStats_year')?.value) || new Date().getFullYear() - 1;
  const team = document.getElementById('gcStats_team')?.value?.trim() || 'Imported';
  const results = [];

  for (let i = dataStart; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;
    const vals = parseRow(line);
    const last  = (vals[headerRow.indexOf('last')]  || '').trim();
    const first = (vals[headerRow.indexOf('first')] || '').trim();
    const num   = (vals[headerRow.indexOf('number')]|| '').trim();
    if (!last || !first || /^(team|glossary)$/i.test(last)) continue;

    const gv = (m, k) => useSimple ? (vals[headerRow.indexOf(k)] || '') : (m[k] !== undefined ? vals[m[k]] : '') || '';
    const bN = k => parseFloat(gv(bCols, k)) || 0;
    const bS = k => gv(bCols, k) || '0';
    const pN = k => parseFloat(gv(pCols, k)) || 0;
    const pS = k => gv(pCols, k) || '0';
    const fN = k => parseFloat(gv(fCols, k)) || 0;
    const fS = k => gv(fCols, k) || '-';

    results.push({
      key: `${first.toLowerCase()}|${last[0].toUpperCase()}`,
      first, last, number: num, team, year: yr, sport: 'Baseball',
      batting: {
        gp: bN('gp'), pa: bN('pa'), ab: bN('ab'),
        avg: bS('avg'), obp: bS('obp'), ops: bS('ops'), slg: bS('slg'),
        h: bN('h'), '1b': bN('1b'), '2b': bN('2b'), '3b': bN('3b'), hr: bN('hr'),
        rbi: bN('rbi'), r: bN('r'), bb: bN('bb'), so: bN('so'), hbp: bN('hbp'),
        sb: bN('sb'), sb_pct: bS('sb%'), cs: bN('cs'),
        xbh: bN('2b') + bN('3b') + bN('hr'),
        tb: bN('tb'), qab: bN('qab'), qab_pct: bS('qab%'),
      },
      pitching: {
        ip: pS('ip'), ip_dec: parseFloat(pS('ip')) || 0,
        gp: pN('gp'), gs: pN('gs'), w: pN('w'), l: pN('l'), sv: pN('sv'),
        h: pN('h'), r: pN('r'), er: pN('er'), bb: pN('bb'), so: pN('so'),
        era: pS('era'), whip: pS('whip'), pitches: pN('#p'), baa: pS('baa'),
      },
      fielding: { tc: fN('tc'), a: fN('a'), po: fN('po'), fpct: fS('fpct'), e: fN('e') },
    });
  }
  return results;
}
function confirmGCStatsImport() {
  if (!_pendingGCStats?.length) return;
  // Merge into live GC_STATS array — replace existing entries with same key+year, add new ones
  const yr = _pendingGCStats[0].year;
  const team = _pendingGCStats[0].team;
  // Remove old entries for same year+team to avoid duplicates
  const filtered = GC_STATS.filter(s => !(s.year === yr && s.team === team));
  filtered.push(..._pendingGCStats);
  GC_STATS.length = 0;
  GC_STATS.push(...filtered);
  // Also persist in localStorage so it survives refresh within session
  try {
    localStorage.setItem(userKey('gc_stats_extra'), JSON.stringify(_pendingGCStats));
  } catch(e) {}
  _pendingGCStats = null;
  closeModal('gcStatsModal');
  refreshAll();
  setTimeout(authCloudPush, 600);
  toast(`GC Stats imported — cloud synced!`);
}

// ── Box score screenshot storage ──────────────────────────────────────────
// Box scores are stored per-player under lll_boxscores_{first}_{last}
function boxScoreKey(p) {
  return userKey(`boxscores_${(p.first||'').toLowerCase()}_${(p.last||'').toLowerCase()}`);
}
function getBoxScores(p) {
  try { return JSON.parse(localStorage.getItem(boxScoreKey(p)) || '[]'); } catch { return []; }
}
function saveBoxScores(p, arr) {
  try {
    localStorage.setItem(boxScoreKey(p), JSON.stringify(arr));
    setTimeout(authCloudPush, 800);
  } catch(e) { toast('Storage full — try removing older screenshots', 'error'); }
}

function addBoxScore(playerIdx, event) {
  const p = players[playerIdx];
  if (!p) return;
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Images only', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const imgData = canvas.toDataURL('image/jpeg', 0.82);
      const arr = getBoxScores(p);
      arr.unshift({ data: imgData, date: new Date().toLocaleDateString(), name: file.name });
      if (arr.length > 20) arr.length = 20;
      saveBoxScores(p, arr);
      renderBoxScoreSection(playerIdx);
      toast('Box score saved! Scanning for stats…');
      // Try AI OCR extraction in background
      _ocrBoxScore(imgData, p, playerIdx);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function _ocrBoxScore(imgData, player, playerIdx) {
  try {
    const base64 = imgData.split(',')[1];
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: `This is a youth baseball box score or stat sheet. Find stats for "${player.first} ${player.last}" (or similar name spelling). Extract only their row.

Return ONLY valid JSON, no other text:
{"found": true/false, "name_found": "exact name in image", "batting": {"ab": 0, "h": 0, "r": 0, "rbi": 0, "bb": 0, "so": 0, "sb": 0, "hr": 0}, "pitching": {"ip": 0, "h": 0, "r": 0, "er": 0, "bb": 0, "so": 0, "pitches": 0}, "game_date": ""}

If a stat isn't visible, use 0. If no batting row found set found=false.` }
          ]
        }]
      })
    });
    const data = await resp.json();
    const text = (data.content || []).map(c => c.text || '').join('');
    let parsed;
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch { return; }
    if (!parsed?.found) { toast(`Stats not found for ${player.first} in this image`); return; }

    // Show confirmation dialog before applying
    _ocrConfirmStats(parsed, player, playerIdx);
  } catch(e) {
    // Silently fail - the screenshot is still saved
    console.warn('OCR failed:', e);
  }
}

function _ocrConfirmStats(parsed, player, playerIdx) {
  const b = parsed.batting || {};
  const pit = parsed.pitching || {};
  const hasPitching = pit.ip > 0 || pit.so > 0;

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:var(--card,#1e293b);border:1px solid var(--border,#334);border-radius:16px;padding:24px;max-width:420px;width:100%;">
      <div style="font-family:'Bebas Neue';font-size:20px;margin-bottom:4px;">📊 Stats Found</div>
      <div style="font-size:12px;color:var(--text2,#94a3b8);margin-bottom:16px;">
        Detected <strong style="color:#fff;">${parsed.name_found || player.first}</strong>
        ${parsed.game_date ? ' · ' + parsed.game_date : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:13px;">
        ${b.ab !== undefined ? `<div style="background:rgba(255,255,255,.05);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#60a5fa;">${b.h||0}-${b.ab||0}</div><div style="font-size:10px;color:#94a3b8;">H-AB</div></div>` : ''}
        ${b.r !== undefined ? `<div style="background:rgba(255,255,255,.05);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#10b981;">${b.r||0}</div><div style="font-size:10px;color:#94a3b8;">Runs</div></div>` : ''}
        ${b.rbi !== undefined ? `<div style="background:rgba(255,255,255,.05);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#f5a623;">${b.rbi||0}</div><div style="font-size:10px;color:#94a3b8;">RBI</div></div>` : ''}
        ${b.sb !== undefined ? `<div style="background:rgba(255,255,255,.05);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#a78bfa;">${b.sb||0}</div><div style="font-size:10px;color:#94a3b8;">SB</div></div>` : ''}
        ${hasPitching ? `<div style="background:rgba(255,255,255,.05);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#ec4899;">${pit.ip||0}</div><div style="font-size:10px;color:#94a3b8;">IP</div></div>` : ''}
        ${hasPitching && pit.so ? `<div style="background:rgba(255,255,255,.05);border-radius:8px;padding:8px;text-align:center;"><div style="font-size:20px;font-weight:700;color:#ec4899;">${pit.so}</div><div style="font-size:10px;color:#94a3b8;">K's</div></div>` : ''}
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:16px;">
        These will be added to ${player.first}'s game log. You can always edit manually in the Stats tab.
      </div>
      <div style="display:flex;gap:10px;">
        <button id="ocrCancel" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border,#334);background:none;color:var(--text,#fff);cursor:pointer;font-family:'DM Sans';font-size:13px;">Discard</button>
        <button id="ocrApply" style="flex:2;padding:10px;border-radius:8px;border:none;background:var(--gold,#f5a623);color:#000;cursor:pointer;font-family:'Bebas Neue';font-size:16px;letter-spacing:1px;">Apply Stats</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.querySelector('#ocrCancel').onclick = () => modal.remove();
  modal.querySelector('#ocrApply').onclick = () => {
    modal.remove();
    _ocrApplyStats(parsed, player, playerIdx);
  };
}

function _ocrApplyStats(parsed, player, playerIdx) {
  const b   = parsed.batting  || {};
  const pit = parsed.pitching || {};
  const gameDate = parsed.game_date || new Date().toLocaleDateString();
  const key = `${player.first.toLowerCase()}|${(player.last||'')[0]?.toUpperCase()||''}`;

  // Build a manual stat entry compatible with the existing manual stats system
  const entry = {
    key,
    first:    player.first,
    last:     player.last[0] ? player.last[0].toUpperCase() : '',
    year:     player.year || (new Date().getFullYear()),
    sport:    player.sport || 'Baseball',
    team:     player.team  || '',
    source:   'ocr',
    game_date: gameDate,
    batting: {
      gp: 1, pa: (b.ab||0) + (b.bb||0),
      ab: b.ab||0, h: b.h||0,
      avg: b.ab ? (b.h/b.ab).toFixed(3) : '.000',
      r: b.r||0, rbi: b.rbi||0,
      bb: b.bb||0, so: b.so||0,
      sb: b.sb||0, hr: b.hr||0,
      xbh: (b.doubles||0)+(b.triples||0)+(b.hr||0),
      tb: (b.h||0) + (b.doubles||0) + (b.triples||0)*2 + (b.hr||0)*3,
    },
    pitching: {
      ip: String(pit.ip||0), ip_dec: parseFloat(pit.ip||0),
      gp: pit.ip > 0 ? 1 : 0, gs: 0,
      h: pit.h||0, r: pit.r||0, er: pit.er||0,
      bb: pit.bb||0, so: pit.so||0,
      pitches: pit.pitches||0,
      era: (pit.ip > 0 && pit.er !== undefined) ? ((pit.er * 7) / parseFloat(pit.ip||1)).toFixed(2) : '-.--',
      w: 0, l: 0, sv: 0,
    },
    fielding: { tc: 0, a: 0, po: 0, e: 0, fpct: '-' }
  };

  // Get existing manual stats and add/merge this game entry
  const all = getAllManualStats ? getAllManualStats() : [];
  all.unshift(entry);
  if (typeof saveAllManualStats === 'function') {
    saveAllManualStats(all);
    toast(`✓ Stats from ${gameDate} added to ${player.first}'s profile!`);
    // Refresh stats display if journey is open
    if (typeof showJourney === 'function') showJourney(playerIdx);
  }
}

function removeBoxScore(playerIdx, scoreIdx) {
  const p = players[playerIdx];
  if (!p) return;
  if (!confirm('Remove this box score screenshot?')) return;
  const arr = getBoxScores(p);
  arr.splice(scoreIdx, 1);
  saveBoxScores(p, arr);
  renderBoxScoreSection(playerIdx);
}

function viewBoxScore(playerIdx, scoreIdx) {
  const p = players[playerIdx];
  if (!p) return;
  const arr = getBoxScores(p);
  const bs = arr[scoreIdx];
  if (!bs) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.93);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:10px;';
  ov.onclick = () => ov.remove();
  const dateLabel = bs.date ? `<div style="font-size:12px;color:#aaa;">${bs.date}</div>` : '';
  ov.innerHTML = `${dateLabel}<img src="${bs.data}" style="max-width:100%;max-height:85vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.8);">
    <div style="font-size:12px;color:#888;">Tap anywhere to close</div>`;
  document.body.appendChild(ov);
}

function renderBoxScoreSection(playerIdx) {
  const el = document.getElementById('journeyBoxScores');
  if (!el) return;
  // Only show box scores to admin or when activity flag is enabled
  if (!canShowActivity()) {
    el.innerHTML = '';
    // Also hide the container label
    const wrap = el.closest ? el.closest('[style*="Box Score"]') : null;
    const parent = el.parentElement;
    if (parent) parent.style.display = 'none';
    return;
  }
  const p = players[playerIdx];
  if (!p) return;
  const arr = getBoxScores(p);
  const addBtn = `<label style="width:80px;height:60px;border-radius:8px;border:1px dashed var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;background:rgba(255,255,255,.03);flex-shrink:0;">
    <span style="font-size:18px;">📋</span><span style="font-size:9px;color:var(--text2);">Add</span>
    <input type="file" accept="image/*" style="display:none;" onchange="addBoxScore(${playerIdx},event)"></label>`;
  if (!arr.length) { el.innerHTML = addBtn; return; }
  const thumbs = arr.map((bs, i) =>
    `<div style="position:relative;flex-shrink:0;cursor:pointer;" onclick="viewBoxScore(${playerIdx},${i})">
       <img src="${bs.data}" style="width:80px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">
       <div style="position:absolute;top:2px;left:4px;font-size:9px;color:#fff;background:rgba(0,0,0,.6);padding:1px 4px;border-radius:3px;">${bs.date||''}</div>
       <button onclick="event.stopPropagation();removeBoxScore(${playerIdx},${i})"
         style="position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.75);border:none;color:#fff;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
     </div>`
  ).join('');
  el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${thumbs}${arr.length < 20 ? addBtn : ''}</div>`;
}

// ── Manual Season Stats Entry ─────────────────────────────────────────────
// Stores manually entered stats in localStorage under the same GC_STATS schema
// so they flow through all existing stat display, position inference, etc.

let _msPlayerIdx = null;

function manualStatsStorageKey() {
  return userKey('manual_stats');
}

function getAllManualStats() {
  try { return JSON.parse(localStorage.getItem(manualStatsStorageKey()) || '[]'); } catch { return []; }
}

function saveAllManualStats(arr) {
  try {
    localStorage.setItem(manualStatsStorageKey(), JSON.stringify(arr));
    // Also merge into live GC_STATS so profiles update immediately
    _mergeManualIntoGCStats(arr);
    setTimeout(authCloudPush, 600);
  } catch(e) { toast('Storage full', 'error'); }
}

function _mergeManualIntoGCStats(all) {
  all.forEach(entry => {
    const idx = GC_STATS.findIndex(s =>
      s.key === entry.key && s.year === entry.year && s.team === entry.team
    );
    if (idx >= 0) GC_STATS[idx] = entry;
    else GC_STATS.push(entry);
  });
}

function openManualStats() {
  if (_msPlayerIdx === null) return;
  const p = players[_msPlayerIdx];
  if (!p) return;
  document.getElementById('msPlayerName').textContent = `${p.first} ${p.last}`;
  document.getElementById('msPlayerIdx').value = _msPlayerIdx;
  // Default year to most recent registration year for this player
  const hist = players.filter(x =>
    x.first.toLowerCase() === p.first.toLowerCase() &&
    x.last.toLowerCase()  === p.last.toLowerCase()
  ).sort((a,b) => b.year - a.year);
  const defaultYear = hist.length ? hist[0].year - 1 : new Date().getFullYear() - 1;
  document.getElementById('ms_year').value = defaultYear;
  document.getElementById('ms_team').value = '';
  document.getElementById('ms_number').value = '';
  document.getElementById('msExistingWarning').style.display = 'none';
  msClearForm();
  // Populate season dropdown with any existing manual entries for this player
  _msPopulateExistingSeasons(p);
  closeModal('journeyModal');
  openModal('manualStatsModal');
}

function _msPopulateExistingSeasons(p) {
  const all = getAllManualStats();
  const key = `${p.first.toLowerCase()}|${p.last[0].toUpperCase()}`;
  const mine = all.filter(s => s.key === key);
  // Update the "Load existing" button label if they have prior entries
  // (just a hint — msLoadExisting() does the actual fill)
  const btn = document.querySelector('#manualStatsModal button[onclick="msLoadExisting()"]');
  if (btn) {
    btn.textContent = mine.length
      ? `↓ Load existing (${mine.map(s=>s.year).join(', ')})`
      : '↓ Load existing';
  }
}

function msLoadExisting() {
  const idx = parseInt(document.getElementById('msPlayerIdx').value);
  const p = players[idx];
  if (!p) return;
  const yr   = parseInt(document.getElementById('ms_year').value) || 0;
  const team = document.getElementById('ms_team').value.trim();
  const key  = `${p.first.toLowerCase()}|${p.last[0].toUpperCase()}`;

  // Find the best match: year+team > year only > latest entry
  const all = getAllManualStats();
  let entry = all.find(s => s.key === key && s.year === yr && s.team === team)
           || all.find(s => s.key === key && s.year === yr)
           || GC_STATS.find(s => s.key === key && s.year === yr && s.team === team)
           || GC_STATS.find(s => s.key === key && s.year === yr)
           || GC_STATS.filter(s => s.key === key).sort((a,b) => b.year - a.year)[0]
           || all.filter(s => s.key === key).sort((a,b) => b.year - a.year)[0];

  if (!entry) { toast('No existing stats found for that year', 'error'); return; }

  document.getElementById('ms_year').value   = entry.year;
  document.getElementById('ms_team').value   = entry.team || '';
  document.getElementById('ms_number').value = entry.number || '';

  const b = entry.batting   || {};
  const pi = entry.pitching || {};
  const f = entry.fielding  || {};

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('ms_b_gp', b.gp);   set('ms_b_pa', b.pa);   set('ms_b_ab', b.ab);
  set('ms_b_avg', b.avg);  set('ms_b_obp', b.obp);  set('ms_b_slg', b.slg);
  set('ms_b_ops', b.ops);  set('ms_b_h', b.h);      set('ms_b_1b', b['1b']);
  set('ms_b_2b', b['2b']); set('ms_b_3b', b['3b']); set('ms_b_hr', b.hr);
  set('ms_b_rbi', b.rbi);  set('ms_b_r', b.r);      set('ms_b_bb', b.bb);
  set('ms_b_so', b.so);    set('ms_b_hbp', b.hbp);  set('ms_b_sb', b.sb);
  set('ms_b_sb_pct', b.sb_pct); set('ms_b_cs', b.cs);
  set('ms_b_xbh', b.xbh); set('ms_b_tb', b.tb);
  set('ms_b_qab', b.qab);  set('ms_b_qab_pct', b.qab_pct);

  set('ms_p_ip', pi.ip);   set('ms_p_gp', pi.gp);   set('ms_p_gs', pi.gs);
  set('ms_p_w', pi.w);     set('ms_p_l', pi.l);      set('ms_p_sv', pi.sv);
  set('ms_p_h', pi.h);     set('ms_p_r', pi.r);      set('ms_p_er', pi.er);
  set('ms_p_bb', pi.bb);   set('ms_p_so', pi.so);    set('ms_p_era', pi.era);
  set('ms_p_whip', pi.whip); set('ms_p_pitches', pi.pitches); set('ms_p_baa', pi.baa);

  set('ms_f_tc', f.tc); set('ms_f_a', f.a); set('ms_f_po', f.po);
  set('ms_f_fpct', f.fpct); set('ms_f_e', f.e);

  const warn = document.getElementById('msExistingWarning');
  warn.style.display = '';
  warn.textContent = `Loaded: ${entry.team || 'unknown team'} ${entry.year} — edit any fields and save.`;

  toast(`Loaded ${entry.year} stats`);
}

function msClearForm() {
  const ids = [
    'ms_b_gp','ms_b_pa','ms_b_ab','ms_b_avg','ms_b_obp','ms_b_slg','ms_b_ops',
    'ms_b_h','ms_b_1b','ms_b_2b','ms_b_3b','ms_b_hr','ms_b_rbi','ms_b_r',
    'ms_b_bb','ms_b_so','ms_b_hbp','ms_b_sb','ms_b_sb_pct','ms_b_cs',
    'ms_b_xbh','ms_b_tb','ms_b_qab','ms_b_qab_pct',
    'ms_p_ip','ms_p_gp','ms_p_gs','ms_p_w','ms_p_l','ms_p_sv',
    'ms_p_h','ms_p_r','ms_p_er','ms_p_bb','ms_p_so',
    'ms_p_era','ms_p_whip','ms_p_pitches','ms_p_baa',
    'ms_f_tc','ms_f_a','ms_f_po','ms_f_fpct','ms_f_e',
  ];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('msExistingWarning').style.display = 'none';
}

function saveManualStats() {
  const idx = parseInt(document.getElementById('msPlayerIdx').value);
  const p = players[idx];
  if (!p) return;

  const yr   = parseInt(document.getElementById('ms_year').value) || new Date().getFullYear() - 1;
  const team = document.getElementById('ms_team').value.trim() || 'Manual Entry';
  const num  = document.getElementById('ms_number').value.trim();
  const key  = `${p.first.toLowerCase()}|${p.last[0].toUpperCase()}`;

  const g = id => document.getElementById(id)?.value?.trim() || '';
  const n = id => parseFloat(g(id)) || 0;
  const s = id => g(id) || '0';

  const entry = {
    key, first: p.first, last: p.last,
    number: num, team, year: yr, sport: p.sport || 'Baseball',
    _manual: true,
    batting: {
      gp: n('ms_b_gp'), pa: n('ms_b_pa'), ab: n('ms_b_ab'),
      avg: s('ms_b_avg'), obp: s('ms_b_obp'), slg: s('ms_b_slg'), ops: s('ms_b_ops'),
      h: n('ms_b_h'), '1b': n('ms_b_1b'), '2b': n('ms_b_2b'),
      '3b': n('ms_b_3b'), hr: n('ms_b_hr'),
      rbi: n('ms_b_rbi'), r: n('ms_b_r'), bb: n('ms_b_bb'),
      so: n('ms_b_so'), hbp: n('ms_b_hbp'),
      sb: n('ms_b_sb'), sb_pct: s('ms_b_sb_pct'), cs: n('ms_b_cs'),
      xbh: n('ms_b_xbh') || n('ms_b_2b') + n('ms_b_3b') + n('ms_b_hr'),
      tb: n('ms_b_tb'), qab: n('ms_b_qab'), qab_pct: s('ms_b_qab_pct'),
    },
    pitching: {
      ip: s('ms_p_ip'), ip_dec: parseFloat(s('ms_p_ip')) || 0,
      gp: n('ms_p_gp'), gs: n('ms_p_gs'),
      w: n('ms_p_w'), l: n('ms_p_l'), sv: n('ms_p_sv'),
      h: n('ms_p_h'), r: n('ms_p_r'), er: n('ms_p_er'),
      bb: n('ms_p_bb'), so: n('ms_p_so'),
      era: s('ms_p_era'), whip: s('ms_p_whip'),
      pitches: n('ms_p_pitches'), baa: s('ms_p_baa'),
    },
    fielding: {
      tc: n('ms_f_tc'), a: n('ms_f_a'), po: n('ms_f_po'),
      fpct: s('ms_f_fpct') || '1.000', e: n('ms_f_e'),
    },
  };

  // Merge into persistent manual stats store — replace same key+year+team
  const all = getAllManualStats();
  const existing = all.findIndex(s => s.key === key && s.year === yr && s.team === team);
  if (existing >= 0) all[existing] = entry;
  else all.push(entry);

  saveAllManualStats(all);
  closeModal('manualStatsModal');
  // Re-open journey modal to show updated stats
  if (idx !== null) showJourney(idx);
  toast(`${p.first} ${p.last} — ${yr} stats saved & synced!`);
}

// On startup: restore manually entered stats into live GC_STATS
(function _restoreManualStats() {
  try {
    const keys = Object.keys(localStorage).filter(k => k.includes('manual_stats'));
    keys.forEach(k => {
      const arr = JSON.parse(localStorage.getItem(k) || '[]');
      _mergeManualIntoGCStats(arr);
    });
  } catch(e) {}
})();

function deletePlayer(idx) {
  if(!confirm(`Delete ${players[idx]?.first} ${players[idx]?.last}?`)) return;
  players.splice(idx,1);
  refreshAll();
  toast('Player deleted');
}

function registerPlayerForSeason(playerIdx, regYear) {
  const p = players[playerIdx];
  if (!p) return;

  // Double-check they're not already registered for this year
  const alreadyIn = players.some(x =>
    x.first === p.first && x.last === p.last && x.sport === p.sport && x.year === regYear
  );
  if (alreadyIn) { toast(`${p.first} is already registered for ${regYear}`); return; }

  // Get their most recent registration to copy from
  const latest = [...players]
    .filter(x => x.first === p.first && x.last === p.last && x.sport === p.sport)
    .sort((a, b) => b.year - a.year)[0] || p;

  const newEntry = {
    year: regYear,
    first: p.first,
    last: p.last,
    sport: latest.sport,
    division: latest.division,
    allstar_division: latest.allstar_division || '',
    gender: latest.gender || '',
    city: latest.city || '',
    team: '',
    amount: 0,
    pitching: latest.pitching || false,
    catching: latest.catching || false,
    allstar_years: latest.allstar_years || [],
    positions: latest.positions || [],
  };

  players.push(newEntry);
  save();
  setTimeout(authCloudPush, 600);
  refreshAll();
  closeModal('journeyModal');
  toast(`${p.first} ${p.last} registered for ${regYear}!`);
}

// PLAYER JOURNEY (with percentile)
// ── Clear a player's committed eval score ────────────────────────────────
function clearEvalScore(playerIdx) {
  const p = players[playerIdx];
  if (!p) return;
  delete p._evalScore;
  delete p.grade;
  save();
  // Re-render wherever player appears
  renderRoster && renderRoster();
  closeModal('journeyModal');
  toast('Eval score removed from draft');
}


function showJourney(playerIdx) {
  if (playerIdx === undefined || playerIdx === null || playerIdx < 0) return;
  const p = players[playerIdx];
  if (!p) return;

  // Populate header nameplate
  const nameEl = document.getElementById('journeyPlayerName');
  if (nameEl) nameEl.textContent = `${p.first} ${p.last}`;

  // Position after name
  const posEl = document.getElementById('journeyPlayerPosition');
  if (posEl) {
    const pos = (p.positions || []).filter(Boolean);
    posEl.textContent = pos.length ? '| ' + pos.slice(0, 3).join(' · ') : '';
    posEl.style.display = pos.length ? '' : 'none';
  }

  // Division context sub-line
  const metaEl = document.getElementById('journeyPlayerMeta');
  if (metaEl) metaEl.textContent = `${p.division} · ${p.sport} · ${p.year}`;

  // All-star gold ring if they were all-star in any recent year (last 2 years)
  const nameplate = document.getElementById('journeyPlayerNameplate');
  const recentYear = new Date().getFullYear();
  const isRecentAllStar = (p.allstar_years || []).some(y => y >= recentYear - 1);
  if (nameplate) {
    if (isRecentAllStar) {
      nameplate.style.border = '1px solid rgba(245,166,35,0.7)';
      nameplate.style.background = 'rgba(245,166,35,0.08)';
      nameplate.style.boxShadow = '0 0 12px rgba(245,166,35,0.25)';
    } else {
      nameplate.style.border = '1px solid rgba(255,255,255,0.1)';
      nameplate.style.background = 'rgba(255,255,255,0.06)';
      nameplate.style.boxShadow = '';
    }
  }

  // Headshot
  const _hs = typeof getHeadshot === 'function' ? getHeadshot(p) : null;
  const _hsImg = document.getElementById('journeyHeadshotImg');
  if (_hsImg) {
    _hsImg.innerHTML = _hs
      ? `<img src="${_hs}" style="width:100%;height:100%;object-fit:cover;">`
      : `<svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg" style="opacity:0.35;"><circle cx="24" cy="18" r="9" fill="#94a3b8"/><ellipse cx="24" cy="42" rx="16" ry="10" fill="#94a3b8"/></svg>`;
  }

  // Gold ring on headshot if all-star
  const headshotWrap = document.getElementById('journeyHeadshotWrap');
  if (headshotWrap) {
    if (isRecentAllStar) {
      headshotWrap.style.border = '2px solid #f5a623';
      headshotWrap.style.boxShadow = '0 0 0 3px rgba(245,166,35,0.35), 0 0 16px rgba(245,166,35,0.3)';
    } else {
      headshotWrap.style.border = '2px solid var(--gold)';
      headshotWrap.style.boxShadow = '0 0 0 3px rgba(245,166,35,0.2)';
    }
  }

  document.getElementById('journeyContent').innerHTML =
    '<div style="color:var(--text2);font-size:13px;padding:16px 0;">Loading…</div>';
  document.getElementById('journeyStatsContent').innerHTML = '';
  document.getElementById('journeyPitchHistory').innerHTML = '';
  const evalsEl = document.getElementById('journeyEvalsContent');
  if (evalsEl) { evalsEl.innerHTML = ''; evalsEl._rendered = false; }
  // Show/hide Evals tab based on feature flag
  const jEvalsTab = document.getElementById('jTab-evals');
  if (jEvalsTab) jEvalsTab.style.display = canShowEvalData() ? '' : 'none';
  // Show/hide box score section and Add Stats footer based on activity flag
  const boxSection = document.getElementById('journeyBoxScoreSection');
  if (boxSection) boxSection.style.display = canShowActivity() ? '' : 'none';
  const addStatsFooter = document.getElementById('journeyAddStatsFooter');
  if (addStatsFooter) addStatsFooter.style.display = canShowActivity() ? '' : 'none';
  jSwitchTab('journey');
  openModal('journeyModal');
  _msPlayerIdx = playerIdx;

  // Build all content asynchronously so modal is visible even if something errors
  setTimeout(() => {
    // Stats tab
    try {
      const statsPanel = document.getElementById('journeyStatsContent');
      const statsTab   = document.getElementById('jTab-stats');
      const _statsOk   = typeof canShowStats === 'function' ? canShowStats() : true;
      if (statsTab) statsTab.style.display = _statsOk ? '' : 'none';
      if (!_statsOk) {
        if (statsPanel) statsPanel.innerHTML = '';
      } else {
        const records = typeof gcLookup === 'function' ? gcLookup(p) : [];
        if (records.length) {
          showPlayerStats(p.first, p.last, { inline: true });
        } else if (statsPanel) {
          statsPanel.innerHTML = `<div style="text-align:center;padding:32px 0;color:var(--text2);font-size:13px;">
            No stats found for ${p.first} ${p.last}.<br>
            <span style="font-size:11px;">Use <strong style="color:#60a5fa;">✏️ Add Stats</strong> to enter manually.</span>
          </div>`;
        }
      }
    } catch(e) {
      const sp = document.getElementById('journeyStatsContent');
      if (sp) sp.innerHTML = '<div style="color:var(--text2);padding:20px;">Could not load stats.</div>';
    }

    // Journey tab content
    try { _buildJourneyContent(playerIdx, p); } catch(e) {
      console.error('showJourney error:', e);
      document.getElementById('journeyContent').innerHTML =
        `<div style="color:#f87171;padding:20px;">Error loading player data: ${e.message}</div>`;
    }

    setTimeout(() => { try { renderBoxScoreSection(playerIdx); } catch(e) {} }, 30);
  }, 0);
}

function _buildJourneyContent(playerIdx, p) {
  const nameKey = `${p.first}|${p.last}`.toLowerCase();
  // Build history: treat T-Ball as natural progression into Baseball/Softball
  // A player who played T-Ball and then moved to Baseball IS the same profile
  const allNameMatches = players
    .filter(x => {
      const xKey = `${x.first}|${x.last}`.toLowerCase();
      if (xKey !== nameKey) return false;
      // Same sport always matches
      if (x.sport === p.sport) return true;
      // T-Ball ↔ Baseball/Softball: natural progression BUT only if not same year
      // Same year T-Ball + competitive = sibling, not the same person
      if (x.sport === 'T-Ball' || p.sport === 'T-Ball') {
        // Check: does this player also have a competitive record in x.year?
        // If so, the T-Ball record belongs to a sibling — exclude it
        const hasSameYearCompetitive = players.some(y =>
          `${y.first}|${y.last}`.toLowerCase() === nameKey &&
          y.year === x.year &&
          y.sport !== 'T-Ball' &&
          ['Majors','Minors','Rookies','Senior','Farm'].includes(y.division)
        );
        if (hasSameYearCompetitive && x.sport === 'T-Ball') return false;
        return true;
      }
      // Baseball/Softball conflict = different person (sibling) — exclude
      return false;
    })
    .sort((a, b) => a.year - b.year);

  // Deduplicate same-year same-sport entries (keep the one with a team assignment)
  const seen = new Map();
  const history = allNameMatches.filter(x => {
    const k = `${x.year}|${x.sport}|${x.division}`;
    if (seen.has(k)) {
      // Keep whichever has a team assigned
      if (x.team && x.team !== 'nan') { seen.set(k, x); return false; }
      return false;
    }
    seen.set(k, x);
    return true;
  });

  const { pct: tenurePct, avgTenure } = computeTenurePercentile(p.first, p.last);
  const percentileLabel = tenurePct >= 90 ? 'Top 10%' : tenurePct >= 75 ? 'Top 25%' : tenurePct >= 50 ? 'Top 50%' : 'Below avg';
  const percentileColor = tenurePct >= 75 ? 'var(--gold)' : tenurePct >= 50 ? 'var(--green)' : 'var(--text2)';

  // Division ranking — where do they rank in their current division?
  const divPeers = players.filter(x => x.sport === p.sport && x.year === p.year && x.division === p.division);
  const divCount = divPeers.length;

  // Average fee paid by peers in the same sport+year
  const peerFees = players
    .filter(x => x.sport === p.sport && x.year === p.year && (x.amount || 0) > 0)
    .map(x => x.amount || 0);
  const peerAvgFee = peerFees.length
    ? Math.round(peerFees.reduce((a, b) => a + b, 0) / peerFees.length)
    : 0;

  const divRank = {'T-Ball':0, Farm:1, Rookies:2, '10U':3, Minors:3, '12U':4, Majors:4, Senior:5};

  // Eval ranking in division
  const evaledPeers = divPeers.filter(x => x._evalScore > 0).sort((a,b) => b._evalScore - a._evalScore);
  const evalRank = p._evalScore ? evaledPeers.findIndex(x => x.first === p.first && x.last === p.last) + 1 : 0;
  const evalRankLabel = evalRank === 1 ? '🥇 #1' : evalRank === 2 ? '🥈 #2' : evalRank === 3 ? '🥉 #3' : evalRank > 0 ? `#${evalRank}` : null;
  const evalRankCol = evalRank === 1 ? 'var(--gold)' : evalRank <= 3 ? 'var(--green)' : '#60a5fa';

  // GC stat ranking in division
  const _gcKey = `${p.first.toLowerCase()}|${p.last[0]?.toUpperCase()||''}`;
  const divGCPeers = divPeers.filter(x => {
    const k = `${x.first.toLowerCase()}|${x.last[0]?.toUpperCase()||''}`;
    return typeof GC_STATS !== 'undefined' && GC_STATS.some(s => s.key === k && s.year === p.year);
  });
  const myGCRec = typeof GC_STATS !== 'undefined' ? GC_STATS.find(s => s.key === _gcKey && s.year === p.year) : null;
  const myAVG = myGCRec?.batting?.avg ? parseFloat(myGCRec.batting.avg) : 0;
  const divAVGs = divGCPeers
    .map(x => { const k = `${x.first.toLowerCase()}|${x.last[0]?.toUpperCase()||''}`; const r = GC_STATS?.find(s=>s.key===k&&s.year===p.year); return r?.batting?.avg ? parseFloat(r.batting.avg) : null; })
    .filter(v => v !== null).sort((a,b) => b-a);
  const avgRank = myAVG > 0 && divAVGs.length > 1 ? divAVGs.findIndex(v => v <= myAVG) + 1 : 0;

  // Third card: ranking or progression metric
  let thirdCardLabel, thirdCardValue, thirdCardSub, thirdCardColor;
  if (canShowEvalData() && evalRankLabel && evaledPeers.length >= 3) {
    thirdCardLabel = 'Eval Rank in Division';
    thirdCardValue = evalRankLabel;
    thirdCardSub = `out of ${evaledPeers.length} evaluated`;
    thirdCardColor = evalRankCol;
  } else if (avgRank > 0 && divAVGs.length >= 3) {
    const avgRankCol = avgRank === 1 ? 'var(--gold)' : avgRank <= 3 ? 'var(--green)' : '#60a5fa';
    thirdCardLabel = 'Batting AVG Rank';
    thirdCardValue = avgRank === 1 ? `🥇 #1` : avgRank === 2 ? `🥈 #2` : `#${avgRank}`;
    thirdCardSub = `in ${p.division} · ${myAVG.toFixed(3)} AVG`;
    thirdCardColor = avgRankCol;
  } else if (history.length > 1) {
    // Division progression
    const firstDiv = history[0].division, latestDiv = history[history.length - 1].division;
    const moved = (divRank[latestDiv] || 0) - (divRank[firstDiv] || 0);
    thirdCardLabel = 'Division Progress';
    thirdCardValue = moved > 0 ? `+${moved}` : moved === 0 ? '→' : `${moved}`;
    thirdCardSub = `${firstDiv} → ${latestDiv}`;
    thirdCardColor = moved > 0 ? 'var(--green)' : 'var(--text2)';
  } else {
    thirdCardLabel = 'Division';
    thirdCardValue = p.division;
    thirdCardSub = `${divCount} players enrolled`;
    thirdCardColor = 'var(--green)';
  }

  // Eval grade hero badge
  const evalHero = (p._evalScore && canShowEvalData()) ? `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;
        background:rgba(255,255,255,0.04);border:1px solid var(--border);margin-bottom:16px;">
      <div style="text-align:center;">
        <div style="font-family:Bebas Neue;font-size:48px;line-height:1;
            color:${evalOverallColor(p._evalScore)};">${p._evalScore}</div>
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Eval Score</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:12px;font-weight:700;margin-bottom:4px;">Committed to Draft Board</div>
        <div style="font-size:11px;color:var(--text2);">Grade: <strong style="color:${evalOverallColor(p._evalScore)};">${p.grade||'—'}</strong></div>
        <button onclick="clearEvalScore(${playerIdx})" class="btn btn-danger btn-sm"
          style="font-size:10px;padding:3px 10px;margin-top:8px;">✕ Remove from Draft</button>
      </div>
    </div>` : '';

  let html = evalHero + `<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
    <div class="stat-card" style="flex:1;min-width:110px;">
      <div class="stat-label">Seasons with League</div>
      <div class="stat-value" style="font-size:34px;color:var(--gold)">${history.length}</div>
      <div style="margin-top:4px;">
        <span style="background:rgba(245,166,35,0.15);color:${percentileColor};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">${percentileLabel} · ${tenurePct}th %ile</span>
      </div>
      <div class="stat-delta" style="color:var(--text2);margin-top:4px;">League avg: ${avgTenure} yrs</div>
    </div>
    <div class="stat-card" style="flex:1;min-width:110px;">
      <div class="stat-label">Current Division</div>
      <div class="stat-value" style="font-size:22px;color:var(--green)">${p.division}</div>
      <div class="stat-delta" style="color:var(--text2)">${p.sport} · ${p.year}</div>
    </div>
    <div class="stat-card" style="flex:1;min-width:110px;">
      <div class="stat-label">${thirdCardLabel}</div>
      <div class="stat-value" style="font-size:22px;color:${thirdCardColor}">${thirdCardValue}</div>
      <div class="stat-delta" style="color:var(--text2)">${thirdCardSub}</div>
    </div>
  </div>`;

  html += `<div style="margin-bottom:20px;">
    <div style="font-family:Bebas Neue;font-size:18px;margin-bottom:14px;letter-spacing:1px;">Season <span class="accent">Timeline</span></div>`;

  history.forEach((h, i) => {
    const isLatest = i === history.length - 1;
    const prevH = history[i-1];
    let progressNote = '';
    if (prevH && prevH.sport === h.sport && prevH.division !== h.division) {
      const r1 = divRank[prevH.division]??0, r2 = divRank[h.division]??0;
      if (r2 > r1) progressNote = `<span style="color:var(--green);font-size:11px;margin-left:8px;">↑ Moved up from ${prevH.division}</span>`;
      else if (r2 < r1) progressNote = `<span style="color:var(--red);font-size:11px;margin-left:8px;">↓ Moved from ${prevH.division}</span>`;
      else progressNote = `<span style="color:var(--text2);font-size:11px;margin-left:8px;">⇄ Changed from ${prevH.division}</span>`;
    }
    const nodeColor = isLatest ? 'var(--gold)' : '#475569';
    html += `<div style="display:flex;align-items:stretch;gap:14px;">
      <div style="display:flex;flex-direction:column;align-items:center;width:36px;flex-shrink:0;">
        <div style="width:13px;height:13px;border-radius:50%;background:${nodeColor};border:2px solid ${isLatest?'var(--gold)':'rgba(255,255,255,0.15)'};margin-top:3px;flex-shrink:0;"></div>
        ${i < history.length-1 ? `<div style="width:2px;flex:1;background:var(--border);margin:3px 0;min-height:20px;"></div>` : ''}
      </div>
      <div style="flex:1;padding-bottom:${i < history.length-1?'14px':'0'};">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
          <div>
            <span style="font-family:Bebas Neue;font-size:20px;color:${isLatest?'var(--gold)':'var(--text)'};">${h.year}</span>
            <span style="font-size:12px;color:var(--text2);margin-left:6px;">${h.sport}</span>
            ${progressNote}
          </div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
            <span class="badge badge-${(h.division||'').toLowerCase().replace(/[^a-z]/g,'')}">${h.division||'—'}</span>
            ${h.allstar_division ? `<span style="background:rgba(245,166,35,0.15);color:var(--gold);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">${h.allstar_division} Eligible</span>` : ''}
            <span style="color:var(--text2);font-size:12px;">${fmt$(h.amount||0)}</span>
          </div>
        </div>
        ${(h.team&&h.team!=='nan') ? `<div style="font-size:11px;color:var(--text2);margin-top:2px;">🏷 <span class="team-link" onclick="showTeamModal(this.dataset.team,${h.year},'${h.sport}','${h.division}')" data-team="${(h.team||'').replace(/"/g,'&quot;')}">${h.team} <span style="font-size:10px;opacity:.6;">· ${h.division}</span></span></div>` : ''}
        ${h.city ? `<div style="font-size:11px;color:var(--text2);margin-top:1px;">📍 ${h.city}</div>` : ''}
      </div>
    </div>`;
  });
  html += `</div>`;

  // ── Register for New Season button ───────────────────────────────────
  // Active registration window rules:
  //   Jan 1 – Apr 4  : current year is open (e.g. register for 2026)
  //   Apr 5 – Nov 30 : season in play, no registration prompt
  //   Dec 1 – Dec 31 : next year opens (e.g. register for 2027)
  const _now = new Date();
  const _month = _now.getMonth() + 1; // 1-12
  const _day   = _now.getDate();
  const _curYear = _now.getFullYear();

  let _regTargetYear = null; // null = no button shown
  if (_month < 4 || (_month === 4 && _day <= 4)) {
    // Jan 1 – Apr 4: current year is the registration target
    _regTargetYear = _curYear;
  } else if (_month >= 12) {
    // December: next year opens
    _regTargetYear = _curYear + 1;
  }
  // Apr 5 – Nov 30: _regTargetYear stays null — no button shown

  // Check by name only — a player who moved from T-Ball to Rookies IS registered for the year
  // even though their sport changed. Use playerKey (first|last) across all records.
  const _playerName = playerKey(p); // first|last lowercase
  const _alreadyInTarget = _regTargetYear !== null &&
    players.some(x => playerKey(x) === _playerName && x.year === _regTargetYear);

  // For the confirmation badge, find what they're actually registered as this year
  const _curYearReg = _alreadyInTarget
    ? players.filter(x => playerKey(x) === _playerName && x.year === _regTargetYear)
              .sort((a,b) => {
                // Prefer non-T-Ball registrations (they've moved up)
                if (a.sport === 'T-Ball' && b.sport !== 'T-Ball') return 1;
                if (b.sport === 'T-Ball' && a.sport !== 'T-Ball') return -1;
                return 0;
              })[0]
    : null;

  // "Last seen" should show the most recent registration across ALL sports
  const _lastReg = [...history].sort((a,b) => b.year - a.year)[0];

  if (_regTargetYear !== null && !_alreadyInTarget) {
    html += `<div style="margin:16px 0;padding:14px 16px;border-radius:10px;
        background:linear-gradient(135deg,rgba(37,99,235,0.15),rgba(16,185,129,0.1));
        border:1px solid rgba(37,99,235,0.3);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <div style="font-size:28px;flex-shrink:0;">📋</div>
      <div style="flex:1;min-width:140px;">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px;">
          ${p.first} is not yet registered for ${_regTargetYear}
        </div>
        <div style="font-size:11px;color:var(--text2);">
          Last seen: ${_lastReg?.year || '—'} · ${_lastReg?.division || p.division} ${_lastReg?.sport || p.sport}
        </div>
      </div>
      <button onclick="registerPlayerForSeason(${playerIdx}, ${_regTargetYear})"
        class="btn btn-primary btn-sm" style="white-space:nowrap;flex-shrink:0;">
        + Register ${_regTargetYear}
      </button>
    </div>`;
  } else if (_regTargetYear !== null && _alreadyInTarget) {
    html += `<div style="margin:16px 0;padding:10px 16px;border-radius:10px;
        background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.25);
        display:flex;align-items:center;gap:10px;font-size:12px;color:#5dde8a;">
      <span style="font-size:16px;">✓</span>
      <span>Registered for ${_regTargetYear} · ${_curYearReg?.division || ''} ${_curYearReg?.sport || ''}</span>
    </div>`;
  }

  html += `<div>
    <div style="font-family:Bebas Neue;font-size:18px;margin-bottom:12px;letter-spacing:1px;">League <span class="accent">Comparison</span></div>
    <div style="display:flex;flex-direction:column;gap:0;">
      <div class="info-row">
        <span class="ir-label">Seasons with league vs avg</span>
        <span class="ir-val"><strong style="color:${history.length>=parseFloat(avgTenure)?'var(--green)':'var(--text)'}">${history.length} seasons</strong> <span style="color:var(--text2);font-size:11px;">(avg: ${avgTenure}) · <span style="color:${percentileColor};">${tenurePct}th percentile</span></span></span>
      </div>
      <div class="info-row">
        <span class="ir-label">Peers in ${p.division} (${p.year})</span>
        <span class="ir-val">${divCount} players</span>
      </div>
      <div class="info-row">
        <span class="ir-label">Registration fee vs ${p.sport} avg (${p.year})</span>
        <span class="ir-val">${fmt$(p.amount||0)} <span style="color:var(--text2);font-size:11px;">(avg: ${fmt$(peerAvgFee)})</span></span>
      </div>
      <div class="info-row" style="border-bottom:none;">
        <span class="ir-label">Sports played</span>
        <span class="ir-val">${(() => {
          const sports = [...new Set(history.map(h=>h.sport))];
          // Only flag as multi-sport if same player registered in BOTH Baseball AND Softball
          // in the same year (true cross-sport), not T-Ball → Baseball progression
          const hasBB = sports.includes('Baseball');
          const hasSB = sports.includes('Softball');
          const hasTB = sports.includes('T-Ball');
          // Check if any single year has both Baseball and Softball
          const years2 = [...new Set(history.map(h=>h.year))];
          const trueCrossSport = years2.some(yr => {
            const yrSports = new Set(history.filter(h=>h.year===yr).map(h=>h.sport));
            return yrSports.has('Baseball') && yrSports.has('Softball');
          });
          if (!trueCrossSport && hasBB && hasSB) {
            // Different people with same name — just show this player's sport
            return p.sport;
          }
          return sports.join(', ') || p.sport;
        })()}</span>
      </div>
    </div>
  </div>`;

  // ── GC Position experience block (click to edit) — hidden when stats off ─
  if (typeof canShowStats !== 'function' || canShowStats()) {
    const POS_LIST = [
      {id:'P',    label:'Pitcher',      short:'P',    color:'#34d399'},
      {id:'SP',   label:'Starting P.',  short:'SP',   color:'#10b981'},
      {id:'C',    label:'Catcher',      short:'C',    color:'#f59e0b'},
      {id:'1B',   label:'1st Base',     short:'1B',   color:'#f97316'},
      {id:'2B',   label:'2nd Base',     short:'2B',   color:'#60a5fa'},
      {id:'3B',   label:'3rd Base',     short:'3B',   color:'#a78bfa'},
      {id:'SS',   label:'Shortstop',    short:'SS',   color:'#ec4899'},
      {id:'OF',   label:'Outfield',     short:'OF',   color:'#818cf8'},
      {id:'IF',   label:'Infield',      short:'IF',   color:'#38bdf8'},
    ];
    const gcPos    = typeof gcInferPositions !== 'undefined' ? gcInferPositions(p) : [];
    const pKey     = `${p.first}|${p.last[0]?.toUpperCase()||''}|${p.sport}`.toLowerCase();
    const manualPos = (USER_DATA?.playerPositions || {})[pKey] || [];
    const activePosIds = manualPos.length ? manualPos : gcPos;
    const isManual = manualPos.length > 0;

    const posPickerHtml = POS_LIST.map(pos => {
      const active = activePosIds.includes(pos.id);
      return `<button
        onclick="togglePlayerPosition('${pKey}','${pos.id}')" title="${pos.label}"
        style="display:flex;flex-direction:column;align-items:center;gap:3px;
          padding:10px 14px;border-radius:10px;cursor:pointer;transition:all .15s;
          background:${active ? pos.color+'22' : 'rgba(255,255,255,.04)'};
          border:2px solid ${active ? pos.color : 'var(--border)'};
          min-width:60px;">
        <div style="font-family:Bebas Neue;font-size:22px;line-height:1;color:${active ? pos.color : 'var(--text2)'};">${pos.short}</div>
        <div style="font-size:9px;color:${active ? pos.color : 'var(--text2)'};opacity:.9;text-align:center;">${pos.label}</div>
      </button>`;
    }).join('');

    html += `<div class="card" style="margin-top:14px;" id="posCard_${pKey.replace(/[^a-z0-9]/g,'_')}">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
        <div class="card-title" style="margin-bottom:0;">🎯 Position <span class="accent">Experience</span></div>
        <span style="font-size:10px;color:var(--text2);font-weight:400;">
          ${isManual ? '✏️ manually set' : gcPos.length ? 'inferred from GameChanger' : 'tap to assign positions'}
        </span>
        ${isManual ? `<button onclick="clearPlayerPositions('${pKey}')"
          style="margin-left:auto;background:none;border:1px solid var(--border);border-radius:6px;
                 color:var(--text2);font-size:10px;padding:2px 8px;cursor:pointer;">Reset to GC</button>` : ''}
      </div>
      <div class="pos-picker-grid" style="display:flex;gap:8px;flex-wrap:wrap;">${posPickerHtml}</div>
    </div>`;
  }


  // ── Evaluation history section ───────────────────────────────────────
  const allEvals = evalGetAll();
  const playerEvals = allEvals.reduce((acc, session) => {
    const sp = session.players?.find(ep =>
      ep.first?.toLowerCase() === p.first.toLowerCase() &&
      ep.last?.[0]?.toUpperCase() === p.last[0]?.toUpperCase() &&
      session.sport === p.sport
    );
    const hasDrills  = sp && Object.values(sp.drillGrades||{}).some(dg => Object.values(dg).some(v=>v>0));
    const hasLegacy  = sp && Object.values(sp.grades||{}).some(v=>v>0);
    const hasDayGrades = sp && Object.values(sp.dayGrades||{}).some(v=>v>0);
    if (sp && (hasDrills || hasLegacy || hasDayGrades)) {
      acc.push({ session, playerData: sp });
    }
    return acc;
  }, []).sort((a,b) => new Date(b.session.date) - new Date(a.session.date));

  if (playerEvals.length) {
    const RATING_LABELS = ['','Poor','Fair','Good','Very Good','Excellent'];
    const RATING_COLORS = ['','#ef4444','#f97316','#f5a623','#60a5fa','#10b981'];
    const evalScoreCol = s => s>=88?'#10b981':s>=70?'#60a5fa':s>=52?'#f5a623':s>=35?'#f97316':'#ef4444';

    html += `<div class="card" style="margin-top:14px;">
      <div class="card-title" style="margin-bottom:12px;">📋 Evaluation <span class="accent">History</span></div>
      ${playerEvals.map(({session, playerData:ep}) => {
        const d = new Date(session.date);
        const dateStr = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        const ovScore = ep._overall100;
        const ovColor = ovScore ? evalScoreCol(ovScore) : 'var(--text2)';

        // Determine eval type
        const drillGrades  = ep.drillGrades || {};
        const dayGradesMap = ep.dayGrades || {};
        const hasDrills    = Object.values(drillGrades).some(dg => Object.values(dg).some(v=>v>0));
        const hasDayGrades = Object.values(dayGradesMap).some(v=>v>0);
        const isEvalDay    = hasDayGrades || session.evalType === 'evalday';

        // Build grade summary rows
        let gradesHtml = '';
        if (isEvalDay && hasDayGrades && typeof EVAL_DAY_CATS !== 'undefined') {
          gradesHtml = `<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:6px;">
            ${EVAL_DAY_CATS.map(cat => {
              const val = dayGradesMap[cat.id] || 0;
              if (!val) return '';
              const col = EVAL_COLORS_5[val] || 'var(--text2)';
              const lbl = EVAL_RATINGS_5[val] || '';
              return `<div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:14px;flex-shrink:0;">${cat.icon}</span>
                <span style="font-size:11px;color:var(--text2);flex:1;min-width:90px;">${cat.label}</span>
                <div style="flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;">
                  <div style="height:100%;width:${(val-1)/4*100}%;background:${col};border-radius:3px;"></div>
                </div>
                <span style="font-size:10px;font-weight:700;color:${col};min-width:64px;text-align:right;">${lbl}</span>
              </div>`;
            }).filter(Boolean).join('')}
          </div>`;
        } else if (hasDrills && typeof EVAL_DRILLS !== 'undefined') {
          gradesHtml = `<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px;">
            ${EVAL_DRILLS.map(drill => {
              const dg = drillGrades[drill.id] || {};
              const vals = drill.principles.map(pr => dg[pr.id]||0).filter(v=>v>0);
              if (!vals.length) return '';
              const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
              const rounded = Math.round(avg);
              const col = RATING_COLORS[rounded] || 'var(--text2)';
              const label = RATING_LABELS[rounded] || '';
              return `<div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:13px;flex-shrink:0;">${drill.icon}</span>
                <span style="font-size:11px;color:var(--text2);flex:1;min-width:80px;">${drill.label}</span>
                <div style="flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;">
                  <div style="height:100%;width:${(avg-1)/4*100}%;background:${col};border-radius:3px;"></div>
                </div>
                <span style="font-size:10px;font-weight:700;color:${col};min-width:60px;text-align:right;">${label}</span>
              </div>`;
            }).join('')}
          </div>`;
        } else {
          // Legacy 1-10 category badges
          const CATS = [
            {id:'hitting',icon:'⚾'},{id:'fielding',icon:'🧤'},{id:'pitching',icon:'💪'},
            {id:'speed',icon:'⚡'},{id:'arm',icon:'🎯'},{id:'athleticism',icon:'🏃'},
            {id:'clutch',icon:'🔥'},{id:'coachability',icon:'🧠'},
          ];
          const legacyCol = s => s>=8?'#10b981':s>=6?'#60a5fa':s>=4?'#f5a623':s>=2?'#f97316':'#ef4444';
          const cells = CATS.map(cat => {
            const v = ep.grades?.[cat.id]||0;
            if (!v) return '';
            const c = legacyCol(v);
            return `<div style="text-align:center;padding:5px;border-radius:6px;background:${c}11;border:1px solid ${c}33;">
              <div style="font-size:11px;">${cat.icon}</div>
              <div style="font-family:Bebas Neue;font-size:18px;color:${c};">${v}</div>
            </div>`;
          }).filter(Boolean);
          if (cells.length) gradesHtml = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px;">${cells.join('')}</div>`;
        }

        return `<div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:10px;">
          <div style="background:rgba(255,255,255,0.04);padding:10px 14px;display:flex;align-items:center;gap:10px;">
            <div style="flex:1;">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px;">
                <span style="font-weight:700;font-size:13px;">${session.division} ${session.sport} — ${session.year}</span>
                <span style="font-size:9px;padding:1px 6px;border-radius:10px;font-weight:700;
                  background:${isEvalDay?'rgba(96,165,250,0.2)':'rgba(245,166,35,0.2)'};
                  color:${isEvalDay?'#60a5fa':'var(--gold)'};">${isEvalDay?'📊 Eval Day':'⚾ Clinic'}</span>
              </div>
              <div style="font-size:11px;color:var(--text2);">${dateStr} · by ${session.coachName||'Coach'}</div>
            </div>
            ${ovScore ? `<div style="text-align:center;padding:6px 12px;border-radius:8px;background:${ovColor}18;border:1px solid ${ovColor}44;">
              <div style="font-size:9px;color:${ovColor};text-transform:uppercase;letter-spacing:.4px;opacity:.8;">OVR</div>
              <div style="font-family:Bebas Neue;font-size:30px;color:${ovColor};line-height:1;">${ovScore}</div>
            </div>` : ''}
          </div>
          <div style="padding:10px 14px;">
            ${gradesHtml}
            ${ep.overallNotes ? `<div style="font-size:11px;color:var(--text2);font-style:italic;border-top:1px solid var(--border);padding-top:6px;">"${ep.overallNotes}"</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }


  document.getElementById('journeyPlayerName').textContent = `${p.first} ${p.last}`;

  // ── Activity log section — admin or showActivity flag only ───────────
  if (canShowActivity()) {
    try { html += _activityLogHtml(playerIdx, p); } catch(e) {}
  }

  document.getElementById('journeyContent').innerHTML = html;

  // ── Pitch history — admin or showActivity flag only ──────────────────
  try {
    const pitchHistoryEl = document.getElementById('journeyPitchHistory');
    if (pitchHistoryEl && typeof pcPlayerHistory === 'function') {
      pitchHistoryEl.innerHTML = canShowActivity() ? pcPlayerHistory(p.first, p.last) : '';
    }
  } catch(e) {}
}

// ── Journey: Evals tab renderer ──────────────────────────────────────────
function renderJourneyEvals(playerIdx) {
  const el = document.getElementById('journeyEvalsContent');
  if (!el) return;
  // Only render eval data for admin or when flag is enabled
  if (!canShowEvalData()) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:20px;text-align:center;">Evaluation data is not available.</div>';
    return;
  }
  const p = players[playerIdx];
  if (!p) return;

  const isAdmin = typeof window.isAdmin === 'function' ? window.isAdmin() : false;
  const nameKey = `${p.first}|${p.last}`.toLowerCase();

  // ── Section 1: Eval score ─────────────────────────────────────────────
  let evalHtml = '';
  if (p._evalScore && canShowEvalData()) {
    const col = evalOverallColor(p._evalScore);
    evalHtml = `<div style="display:flex;align-items:center;gap:14px;padding:14px 16px;
        border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--border);margin-bottom:16px;">
      <div style="text-align:center;min-width:60px;">
        <div style="font-family:Bebas Neue;font-size:52px;line-height:1;color:${col};">${p._evalScore}</div>
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Eval Score</div>
      </div>
      <div>
        <div style="font-size:12px;font-weight:700;margin-bottom:3px;">Draft Board Eval</div>
        <div style="font-size:11px;color:var(--text2);">Grade: <strong style="color:${col};">${p.grade||'—'}</strong></div>
        ${p.pid?`<div style="font-size:10px;color:var(--text2);margin-top:3px;">Player ID: <code style="color:#60a5fa;">#${p.pid}</code></div>`:''}
      </div>
    </div>`;
  } else {
    evalHtml = `<div style="text-align:center;padding:16px;color:var(--text2);font-size:12px;background:rgba(255,255,255,.03);border-radius:8px;border:1px dashed var(--border);margin-bottom:16px;">
      No eval score yet — run an evaluation session to generate one.
      ${p.pid?`<div style="margin-top:4px;font-size:10px;">Player ID: <code style="color:#60a5fa;">#${p.pid}</code></div>`:''}
    </div>`;
  }

  // ── Section 2: Pitch Chart results ───────────────────────────────────
  let pitchHtml = '';
  try {
    const allSessions = typeof pcGetAll === 'function' ? pcGetAll() : [];
    const playerSessions = allSessions.filter(s =>
      s.pitcher &&
      s.pitcher.first.toLowerCase() === p.first.toLowerCase() &&
      s.pitcher.last.toLowerCase()  === p.last.toLowerCase()
    ).sort((a, b) => (b.strikeRate||0) - (a.strikeRate||0)); // best first

    if (playerSessions.length) {
      const top3 = playerSessions.slice(0, 3);
      const rest = playerSessions.slice(3);
      const sessionCard = (s, i) => {
        const col = s.strikeRate >= 70 ? 'var(--green)' : s.strikeRate >= 50 ? 'var(--gold)' : 'var(--red)';
        const speedTxt = s.topSpeed ? ` · Top ${s.topSpeed} mph` : '';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;
            background:rgba(255,255,255,.03);border:1px solid var(--border);margin-bottom:6px;">
          <div style="font-family:Bebas Neue;font-size:28px;color:${col};min-width:48px;text-align:center;">${s.strikeRate}%</div>
          <div style="flex:1;">
            <div style="font-size:12px;font-weight:700;">${s.strikes}/${s.total} strikes${speedTxt}</div>
            <div style="font-size:10px;color:var(--text2);">${s.date||''}${i===0?' 🏆 Best':i===1?' 🥈 2nd':i===2?' 🥉 3rd':''}</div>
            ${s.maxStreak>2?`<div style="font-size:10px;color:var(--gold);">Best streak: ${s.maxStreak}</div>`:''}
          </div>
        </div>`;
      };

      const restHtml = rest.length ? `
        <details style="margin-top:4px;">
          <summary style="font-size:11px;color:var(--text2);cursor:pointer;padding:4px 0;">
            Show all ${rest.length} more session${rest.length!==1?'s':''}
          </summary>
          <div style="margin-top:8px;">${rest.map((s,i)=>sessionCard(s,i+3)).join('')}</div>
        </details>` : '';

      pitchHtml = `<div style="margin-bottom:16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--text2);font-weight:700;margin-bottom:8px;">
          ⚾ Pitch Chart Sessions <span style="font-weight:400;font-size:10px;">(${playerSessions.length} total)</span>
        </div>
        ${top3.map(sessionCard).join('')}
        ${restHtml}
      </div>`;
    } else {
      pitchHtml = `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--text2);font-weight:700;margin-bottom:6px;">⚾ Pitch Chart Sessions</div>
        <div style="font-size:12px;color:var(--text2);padding:8px 0 16px;">No pitch sessions saved for this player yet.</div>`;
    }
  } catch(e) {}

  // ── Section 3: Around the World (leaderboard entries) ─────────────────
  let atwHtml = '';
  try {
    const lb = JSON.parse(localStorage.getItem(userKey('pitch_leaderboard')) || localStorage.getItem('lll_pitch_leaderboard') || '[]');
    const playerLb = lb.filter(e =>
      e.playerName && e.playerName.toLowerCase().includes(p.first.toLowerCase()) &&
      e.playerName.toLowerCase().includes(p.last.toLowerCase())
    ).sort((a, b) => (a.score||999) - (b.score||999));

    if (playerLb.length) {
      const top3 = playerLb.slice(0, 3);
      const rest = playerLb.slice(3);
      const lbCard = (e, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;
          background:rgba(255,255,255,.03);border:1px solid var(--border);margin-bottom:6px;">
        <div style="font-family:Bebas Neue;font-size:26px;color:var(--gold);min-width:36px;text-align:center;">${e.score||'?'}</div>
        <div>
          <div style="font-size:12px;font-weight:700;">${e.gameType||'Around the World'}${i===0?' 🏆 Best':''}</div>
          <div style="font-size:10px;color:var(--text2);">${e.date||''} ${e.division?`· ${e.division}`:''}</div>
        </div>
      </div>`;
      const restHtml = rest.length ? `
        <details style="margin-top:4px;">
          <summary style="font-size:11px;color:var(--text2);cursor:pointer;padding:4px 0;">Show ${rest.length} more</summary>
          <div style="margin-top:8px;">${rest.map((e,i)=>lbCard(e,i+3)).join('')}</div>
        </details>` : '';
      atwHtml = `<div style="margin-bottom:16px;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--text2);font-weight:700;margin-bottom:8px;">
          🎯 Around the World <span style="font-weight:400;font-size:10px;">(${playerLb.length} entries)</span>
        </div>
        ${top3.map(lbCard).join('')}
        ${restHtml}
      </div>`;
    } else {
      atwHtml = `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--text2);font-weight:700;margin-bottom:6px;">🎯 Around the World</div>
        <div style="font-size:12px;color:var(--text2);padding:8px 0 16px;">No leaderboard entries for this player.</div>`;
    }
  } catch(e) {}

  el.innerHTML = evalHtml + pitchHtml + atwHtml;
}

// ── Journey: Evals tab renderer ──────────────────────────────────────────
function jSwitchTab(tab) {
  ['journey','stats','evals'].forEach(t => {
    const panel = document.getElementById('jPanel-' + t);
    const btn   = document.getElementById('jTab-' + t);
    if (!panel || !btn) return;
    const active = t === tab;
    panel.style.display = active ? '' : 'none';
    if (active) btn.classList.add('active');
    else        btn.classList.remove('active');
  });
  // Lazy-render evals tab when first opened
  if (tab === 'evals' && typeof _msPlayerIdx !== 'undefined') {
    const ec = document.getElementById('journeyEvalsContent');
    if (ec && !ec._rendered) { ec._rendered = true; renderJourneyEvals(_msPlayerIdx); }
  }
}

// ── Compact inline stats renderer for journey Stats tab ───────────────────
function _journeyStatsHtml(p, records) {
  const fmtV = v => (v === undefined || v === null || v === '' || v === '0' || v === '.000' || v === '-') ? '—' : v;
  const rows = records.slice().sort((a, b) => b.year - a.year);

  const sections = rows.map(r => {
    const b  = r.batting   || {};
    const pi = r.pitching  || {};
    const f  = r.fielding  || {};
    const manualBadge = r._manual
      ? `<span style="font-size:9px;background:rgba(96,165,250,.15);color:#60a5fa;border:1px solid rgba(96,165,250,.3);border-radius:4px;padding:1px 6px;margin-left:6px;">manual</span>`
      : '';

    const statRow = (label, val) => val && val !== '—'
      ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px;">
           <span style="color:var(--text2);">${label}</span>
           <strong>${val}</strong>
         </div>` : '';

    // Batting block
    const battingBlock = b.gp ? `
      <div style="margin-bottom:10px;">
        <div style="font-size:10px;letter-spacing:1px;color:var(--gold);text-transform:uppercase;font-weight:700;margin-bottom:6px;">⚾ Batting</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;">
          ${statRow('AVG', fmtV(b.avg))}
          ${statRow('OBP', fmtV(b.obp))}
          ${statRow('SLG', fmtV(b.slg))}
          ${statRow('OPS', fmtV(b.ops))}
          ${statRow('GP', fmtV(b.gp))}
          ${statRow('PA', fmtV(b.pa))}
          ${statRow('AB', fmtV(b.ab))}
          ${statRow('H', fmtV(b.h))}
          ${statRow('2B', fmtV(b['2b']))}
          ${statRow('3B', fmtV(b['3b']))}
          ${statRow('HR', fmtV(b.hr))}
          ${statRow('RBI', fmtV(b.rbi))}
          ${statRow('R', fmtV(b.r))}
          ${statRow('BB', fmtV(b.bb))}
          ${statRow('SO', fmtV(b.so))}
          ${statRow('HBP', fmtV(b.hbp))}
          ${statRow('SB', fmtV(b.sb))}
          ${statRow('SB%', fmtV(b.sb_pct))}
          ${statRow('CS', fmtV(b.cs))}
          ${statRow('TB', fmtV(b.tb))}
          ${statRow('XBH', fmtV(b.xbh))}
          ${statRow('QAB', fmtV(b.qab))}
          ${statRow('QAB%', fmtV(b.qab_pct))}
        </div>
      </div>` : '';

    const hasPitching = pi.gp > 0 || parseFloat(pi.ip_dec || 0) > 0;
    const pitchingBlock = hasPitching ? `
      <div style="margin-bottom:10px;">
        <div style="font-size:10px;letter-spacing:1px;color:var(--gold);text-transform:uppercase;font-weight:700;margin-bottom:6px;">🎯 Pitching</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;">
          ${statRow('IP',    fmtV(pi.ip))}
          ${statRow('ERA',   fmtV(pi.era))}
          ${statRow('WHIP',  fmtV(pi.whip))}
          ${statRow('W-L',   (pi.w||0) + '-' + (pi.l||0))}
          ${statRow('SV',    fmtV(pi.sv))}
          ${statRow('GP',    fmtV(pi.gp))}
          ${statRow('GS',    fmtV(pi.gs))}
          ${statRow('SO',    fmtV(pi.so))}
          ${statRow('BB',    fmtV(pi.bb))}
          ${statRow('H',     fmtV(pi.h))}
          ${statRow('ER',    fmtV(pi.er))}
          ${statRow('BAA',   fmtV(pi.baa))}
          ${statRow('Pitches', fmtV(pi.pitches))}
        </div>
      </div>` : '';

    const hasFielding = (f.tc || 0) > 0;
    const fieldingBlock = hasFielding ? `
      <div style="margin-bottom:4px;">
        <div style="font-size:10px;letter-spacing:1px;color:var(--gold);text-transform:uppercase;font-weight:700;margin-bottom:6px;">🧤 Fielding</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;">
          ${statRow('TC',   fmtV(f.tc))}
          ${statRow('PO',   fmtV(f.po))}
          ${statRow('A',    fmtV(f.a))}
          ${statRow('E',    fmtV(f.e))}
          ${statRow('FPCT', fmtV(f.fpct))}
        </div>
      </div>` : '';

    return `
      <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);">
        <div style="font-size:14px;font-weight:700;margin-bottom:12px;">
          ${r.year} — ${r.team || ''}${manualBadge}
        </div>
        ${battingBlock}${pitchingBlock}${fieldingBlock}
      </div>`;
  });

  return sections.length ? sections.join('') : `<div style="text-align:center;padding:40px 0;color:var(--text2);">No stats available.</div>`;
}

// UPLOAD & CSV
function handleModalUpload(input) {
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    const parsed = parseCSV(text);
    if(!parsed.length) { toast('No valid data found in file','error'); return; }
    pendingUploadData = parsed;
    document.getElementById('uploadPreview').innerHTML = `
      <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:12px;font-size:13px;color:var(--green);">
        ✓ Found <strong>${parsed.length}</strong> players in file. Review selections above, then confirm.
      </div>`;
    document.getElementById('uploadConfirmBtn').style.display='block';
  };
  reader.readAsText(file);
}
function handleFileUpload(input) { handleModalUpload(input); openModal('uploadModal'); }
function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if(file) { document.getElementById('csvFileInput').files = e.dataTransfer.files; handleFileUpload({files:e.dataTransfer.files}); }
}
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if(lines.length<2) return [];
  const headers = lines[0].split(',').map(h=>h.replace(/\r/,'').replace(/"/g,'').trim().toLowerCase());
  const result = [];
  for(let i=1;i<lines.length;i++) {
    const vals = lines[i].split(',').map(v=>v.replace(/\r/,'').replace(/"/g,'').trim());
    const row = {};
    headers.forEach((h,j)=>row[h]=vals[j]||'');
    const last = row['last']||row['player last name']||'';
    const first = row['first']||row['player first name']||'';
    const dob = row['birthdate']||row['player birth date']||row['dob']||'';
    const price = row['price']||row['order detail description']||'';
    const total = parseFloat(row['total']||row['orderitem amount']||0)||0;
    const city = row['city']||'';
    const team = row['team']||row['team name']||'';
    if(!last&&!first) continue;
    result.push({last,first,dob,price,total,city,team});
  }
  return result;
}
function confirmUpload() {
  if(!pendingUploadData) return;
  const sport = document.getElementById('mu_sport').value;
  const year = parseInt(document.getElementById('mu_year').value)||2026;
  const mode = document.getElementById('mu_mode').value;
  if(mode==='replace') players = players.filter(p=>!(p.year===year&&p.sport===sport));
  const newPlayers = pendingUploadData.map(row=>{
    const div = assignDivision(sport, row.dob) ||
      (row.price.toLowerCase().includes('major')?'Majors':row.price.toLowerCase().includes('minor')?'Minors':
       row.price.toLowerCase().includes('rookie')?'Rookies':row.price.toLowerCase().includes('senior')?'Senior':
       row.price.toLowerCase().includes('farm')?'Farm':'Unknown');
    return {year, first:row.first, last:row.last, sport, division:div, allstar_division: calcAllstarBracket(sport, row.dob, year), gender:'', city:row.city, team:row.team, amount:row.total};
  });
  players.push(...newPlayers);
  pendingUploadData = null;
  closeModal('uploadModal');
  refreshAll();
  toast(`Imported ${newPlayers.length} players for ${year} ${sport}!`);
}
function exportCSV(filter) {
  const latestYr = years()[years().length-1] || 2026;
  const prevYr   = years()[years().length-2] || (latestYr - 1);
  let data = players;
  if(filter==='latest')          data = players.filter(p=>p.year===latestYr);
  else if(filter==='prev')       data = players.filter(p=>p.year===prevYr);
  else if(/^\d{4}$/.test(filter)) data = players.filter(p=>p.year===parseInt(filter));
  else if(filter==='baseball-latest') data = players.filter(p=>p.year===latestYr&&p.sport==='Baseball');
  else if(filter==='softball-latest') data = players.filter(p=>p.year===latestYr&&p.sport==='Softball');
  else if(filter==='tball-latest')    data = players.filter(p=>p.year===latestYr&&p.sport==='T-Ball');
  // Legacy hardcoded filters still supported for backwards compatibility
  else if(filter==='2026') data = players.filter(p=>p.year===2026);
  else if(filter==='2025') data = players.filter(p=>p.year===2025);
  else if(filter==='baseball-2026') data = players.filter(p=>p.year===2026&&p.sport==='Baseball');
  else if(filter==='softball-2026') data = players.filter(p=>p.year===2026&&p.sport==='Softball');
  else if(filter==='tball-2026')    data = players.filter(p=>p.year===2026&&p.sport==='T-Ball');
  const headers = ['Year','First','Last','Sport','Division','AllStar Division','AllStar Years','Gender','City','Team','Amount','Pitching','Catching','Positions','Grade'];
  const rows = data.map(p=>[
    p.year, p.first, p.last, p.sport, p.division,
    p.allstar_division||'', (p.allstar_years||[]).join(';'),
    p.gender||'', p.city||'', p.team||'', p.amount||0,
    p.pitching?'Yes':'No', p.catching?'Yes':'No',
    (p.positions||[]).join(';'), p.grade||''
  ]);
  const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`LLL_${filter}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast('CSV exported!');
}
function clearYear(yr) {
  if(!confirm(`Delete ALL ${yr} data? This cannot be undone.`)) return;
  players = players.filter(p=>p.year!==yr);
  refreshAll(); toast(`${yr} data cleared`);
}
function clearAllData() {
  if(!confirm('Reset ALL data to original? This cannot be undone.')) return;
  players = JSON.parse(JSON.stringify(INITIAL_DATA));
  save(); refreshAll(); toast('Data reset to original');
}

// INIT — gated by auth
function initApp() {
  loadUserData();         // restore USER_DATA (positions, leaderboards etc) from localStorage
  loadPlayerOverrides();  // restore any player edits/new registrations saved by admin
  if (typeof loadDraftState === 'function') loadDraftState(); // restore draft pre-assignments
  updateHeader();
  applySettings();
  renderOverview();
  // Refresh shared coach list in background so datalist stays current
  setTimeout(refreshCloudCoachCache, 1200);
  // Pull latest cloud data on startup to immediately pick up edits from other devices
  if (jbEnabled() && authCurrentUser()) {
    setTimeout(authCloudPull, 800);
  }

  // ── Auto cloud push every 90 seconds ─────────────────────────────────
  // Ensures evals/grades done on phone appear on other devices automatically
  if (jbEnabled() && authCurrentUser()) {
    setInterval(() => {
      if (jbEnabled() && authCurrentUser()) {
        authCloudPush().catch(()=>{});
      }
    }, 90000); // every 90 seconds
  }
}

// Push local state when returning to the tab (not pull — pulling overwrites local edits).
// Manual "Sync" button does a full pull-then-push when you explicitly want to receive
// changes from another device.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible'
      && typeof jbEnabled === 'function' && jbEnabled()
      && typeof authCurrentUser === 'function' && authCurrentUser()) {
    // Push local state so the cloud stays up to date with what's on screen
    setTimeout(authCloudPush, 500);
  }
});

// Auto-configure cloud keys from URL params (admin shares setup URL once)
(function() {
  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  const bin = params.get('bin');
  if (key) localStorage.setItem(JSONBIN_KEY_KEY, key);
  if (bin) localStorage.setItem(JSONBIN_DIR_KEY, bin);
  if (key || bin) {
    // Strip params from URL cleanly
    history.replaceState(null, '', location.pathname + location.hash);
    toast('Cloud sync configured — create your account or sign in');
  }
})();

// Sync league PIN from cloud so new devices know it
if (jbEnabled()) leaguePinSync();

if (authIsLoggedIn()) {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appRoot').style.display    = '';
  initApp();
} else {
  document.getElementById('authScreen').style.display = '';
  document.getElementById('appRoot').style.display    = 'none';
  renderAuthScreen();
}

// ── Toolbar drag-and-drop reordering ─────────────────────────────────────
// Allows coaches to hold and drag nav pills to reorder them
(function initNavReorder() {

  const STORAGE_KEY_LEAGUE  = 'lll_navorder_league';
  const STORAGE_KEY_COACHES = 'lll_navorder_coaches';
  const LONG_PRESS_MS = 400; // ms hold to start drag

  function saveOrder(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const order = [...container.querySelectorAll('.nav-pill[data-tab]')].map(el => el.dataset.tab);
    const key = containerId === 'navpills-league' ? STORAGE_KEY_LEAGUE : STORAGE_KEY_COACHES;
    try { localStorage.setItem(key, JSON.stringify(order)); } catch(e) {}
  }

  function applyOrder(containerId) {
    const key = containerId === 'navpills-league' ? STORAGE_KEY_LEAGUE : STORAGE_KEY_COACHES;
    let order;
    try { order = JSON.parse(localStorage.getItem(key)); } catch(e) {}
    if (!order || !order.length) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    // Re-insert pills in saved order (unknown tabs stay at end)
    const pills = [...container.querySelectorAll('.nav-pill[data-tab]')];
    const byTab = {};
    pills.forEach(p => { byTab[p.dataset.tab] = p; });
    order.forEach(tabId => {
      if (byTab[tabId]) container.appendChild(byTab[tabId]);
    });
  }

  function setupDragOnContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let dragging = null, placeholder = null, holdTimer = null, isDragging = false;
    let startX = 0, startY = 0, origRect = null;

    function getAfterElement(container, x) {
      const pills = [...container.querySelectorAll('.nav-pill[data-tab]:not(.nav-pill-dragging)')];
      return pills.reduce((closest, el) => {
        const box = el.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: el };
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    function startDrag(pill, clientX, clientY) {
      isDragging = true;
      dragging = pill;
      origRect = pill.getBoundingClientRect();

      // Placeholder
      placeholder = document.createElement('div');
      placeholder.style.cssText = `display:inline-flex;width:${origRect.width}px;height:${origRect.height}px;
        flex-shrink:0;border-radius:99px;border:2px dashed rgba(245,166,35,0.4);background:rgba(245,166,35,0.06);`;
      pill.parentNode.insertBefore(placeholder, pill.nextSibling);

      // Float the pill
      pill.classList.add('nav-pill-dragging');
      pill.style.cssText += `position:fixed;z-index:9999;left:${origRect.left}px;top:${origRect.top}px;
        width:${origRect.width}px;pointer-events:none;opacity:.85;
        transform:scale(1.06);box-shadow:0 6px 24px rgba(245,166,35,0.3);
        border-color:rgba(245,166,35,0.7);transition:none;`;

      document.body.appendChild(pill);
    }

    function moveDrag(clientX, clientY) {
      if (!dragging || !isDragging) return;
      const dx = clientX - startX;
      dragging.style.left = (origRect.left + dx) + 'px';

      // Determine insertion point
      const afterEl = getAfterElement(container, clientX);
      if (afterEl) {
        container.insertBefore(placeholder, afterEl);
      } else {
        container.appendChild(placeholder);
      }
    }

    function endDrag() {
      if (!dragging || !isDragging) return;
      isDragging = false;

      // Restore pill inline
      dragging.classList.remove('nav-pill-dragging');
      dragging.style.position = '';
      dragging.style.zIndex = '';
      dragging.style.left = '';
      dragging.style.top = '';
      dragging.style.width = '';
      dragging.style.pointerEvents = '';
      dragging.style.opacity = '';
      dragging.style.transform = '';
      dragging.style.boxShadow = '';

      // Insert where placeholder is, then remove placeholder
      if (placeholder && placeholder.parentNode === container) {
        container.insertBefore(dragging, placeholder);
      } else {
        container.appendChild(dragging);
      }
      placeholder && placeholder.remove();
      placeholder = null;

      saveOrder(containerId);
      dragging = null;
    }

    function cancelDrag() {
      if (dragging && isDragging) {
        dragging.classList.remove('nav-pill-dragging');
        dragging.style.cssText = dragging.style.cssText
          .replace(/position:[^;]+;?/g,'').replace(/z-index:[^;]+;?/g,'')
          .replace(/left:[^;]+;?/g,'').replace(/top:[^;]+;?/g,'')
          .replace(/pointer-events:[^;]+;?/g,'').replace(/opacity:[^;]+;?/g,'');
        container.appendChild(dragging);
        placeholder && placeholder.remove();
      }
      isDragging = false; dragging = null; placeholder = null;
      clearTimeout(holdTimer);
    }

    // Attach to each pill
    function attachPill(pill) {
      if (pill._reorderAttached) return;
      pill._reorderAttached = true;

      // Mouse
      pill.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        startX = e.clientX; startY = e.clientY;
        holdTimer = setTimeout(() => startDrag(pill, e.clientX, e.clientY), LONG_PRESS_MS);
      });
      document.addEventListener('mousemove', e => {
        if (isDragging && dragging === pill) moveDrag(e.clientX, e.clientY);
        else if (!isDragging && holdTimer && Math.abs(e.clientX - startX) > 6) clearTimeout(holdTimer);
      });
      document.addEventListener('mouseup', e => {
        clearTimeout(holdTimer); holdTimer = null;
        if (isDragging && dragging === pill) endDrag();
      });

      // Touch
      pill.addEventListener('touchstart', e => {
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY;
        holdTimer = setTimeout(() => { startDrag(pill, t.clientX, t.clientY); }, LONG_PRESS_MS);
      }, { passive: true });
      pill.addEventListener('touchmove', e => {
        const t = e.touches[0];
        if (isDragging && dragging === pill) {
          e.preventDefault();
          moveDrag(t.clientX, t.clientY);
        } else if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) {
          clearTimeout(holdTimer); holdTimer = null;
        }
      }, { passive: false });
      pill.addEventListener('touchend', () => {
        clearTimeout(holdTimer); holdTimer = null;
        if (isDragging && dragging === pill) endDrag();
      });
      pill.addEventListener('touchcancel', cancelDrag);
    }

    // Attach to all current pills + watch for new ones
    [...container.querySelectorAll('.nav-pill[data-tab]')].forEach(attachPill);
    new MutationObserver(() => {
      [...container.querySelectorAll('.nav-pill[data-tab]')].forEach(attachPill);
    }).observe(container, { childList: true });
  }

  // Init after DOM ready
  function init() {
    applyOrder('navpills-league');
    applyOrder('navpills-coaches');
    setupDragOnContainer('navpills-league');
    setupDragOnContainer('navpills-coaches');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small defer so other init runs first
    setTimeout(init, 200);
  }
})();

// ── Add drag visual style ─────────────────────────────────────────────────
(function() {
  const style = document.createElement('style');
  style.textContent = `
    .nav-pill-dragging {
      cursor: grabbing !important;
      transition: none !important;
    }
    .nav-pill[data-tab]:not(.nav-pill-dragging) {
      cursor: grab;
    }
    .nav-pill[data-tab]:not(.nav-pill-dragging):active {
      cursor: grabbing;
    }
  `;
  document.head.appendChild(style);
})();
(function injectModalCloseButtons() {
  function addCloseButtons() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      const modal = overlay.querySelector('.modal');
      if (!modal || modal.querySelector('.modal-close-x')) return; // already has one
      const id = overlay.id;
      if (!id) return;
      const btn = document.createElement('button');
      btn.className = 'modal-close-x';
      btn.setAttribute('aria-label', 'Close');
      btn.innerHTML = '&#x2715;'; // ✕
      btn.addEventListener('click', () => {
        if (typeof closeModal === 'function') closeModal(id);
        else overlay.classList.remove('open');
      });
      // Insert as first child of modal so it floats top-right
      modal.insertBefore(btn, modal.firstChild);
    });
  }
  // Run on DOM ready and after any dynamic modal is opened
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addCloseButtons);
  } else {
    addCloseButtons();
  }
  // Re-run whenever a modal opens (MutationObserver on overlay class changes)
  const obs = new MutationObserver(mutations => {
    mutations.forEach(m => {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const el = m.target;
        if (el.classList.contains('open') && el.classList.contains('modal-overlay')) {
          const modal = el.querySelector('.modal');
          if (modal && !modal.querySelector('.modal-close-x')) addCloseButtons();
        }
      }
    });
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal-overlay').forEach(el => {
      obs.observe(el, { attributes: true });
    });
    addCloseButtons();
  });
})();

