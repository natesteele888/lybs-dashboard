// ═══════════════════════════════════════════════════════════
// LYBS DRAFT MODULE
// ═══════════════════════════════════════════════════════════

const TEAM_COLORS = [
  { hex: '#ef4444', name: 'Red'    },
  { hex: '#2563eb', name: 'Blue'   },
  { hex: '#10b981', name: 'Green'  },
  { hex: '#f59e0b', name: 'Amber'  },
  { hex: '#8b5cf6', name: 'Purple' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#ec4899', name: 'Pink'   },
  { hex: '#14b8a6', name: 'Teal'   },
];

const DRAFT = {
  sport: 'Baseball',
  division: 'Minors',
  teams: [], // {name, color, coach, assistants: ['',''], locked: false, players: [playerKey]}
  maxPerTeam: null,  // null = auto-distribute
  snakeDraft: true,
  phase: 'setup', // setup | draft | complete
  allPlayers: [],   // {player, meta, teamIdx(-1=available), preAssigned}
  draftOrder: [],   // sequence of teamIdx for each pick
  currentPickIdx: 0,
  pickHistory: [],  // {playerKey, teamIdx, round, pick, secs}
  pickStartTime: null,
  timerInterval: null,
  timerSecs: 0,
  pendingPick: null, // playerKey awaiting confirmation
};

// ── Helpers ──────────────────────────────────────────────

function draftPlayerKey(p) {
  return `${p.first}|${p.last}|${p.sport}|${p.year}`.toLowerCase();
}

function draftGetMeta(p) {
  const nameKey = `${p.first}|${p.last}`.toLowerCase();
  const history = players.filter(x =>
    `${x.first}|${x.last}`.toLowerCase() === nameKey && x.sport === p.sport
  );
  const yearsInLeague = new Set(history.map(h => h.year)).size;
  const prevYrs = history.filter(h => h.year < p.year).map(h => h.year);
  const prevYear = prevYrs.length ? Math.max(...prevYrs) : null;
  const prevRecord = prevYear ? history.find(h => h.year === prevYear) : null;
  return {
    yearsInLeague,
    prevDivision: prevRecord?.division || null,
    isReturning: !!prevRecord,
  };
}

function draftDivOptions(sport) {
  if (sport === 'Baseball') return ['Majors', 'Minors', 'Rookies'];
  if (sport === 'Softball') return ['Senior', '12U', '10U', 'Farm'];
  return [];
}

function draftBuildOrder() {
  // Only unlocked teams participate in the draft
  const unlockedIdxs = DRAFT.teams.map((t, i) => i).filter(i => !DRAFT.teams[i].locked);
  const numTeams = unlockedIdxs.length;
  if (numTeams === 0) return [];

  const available = DRAFT.allPlayers.filter(p => p.teamIdx === -1);

  // Per-team cap: per-team maxPlayers overrides global; null = auto-distribute
  const globalCap = DRAFT.maxPerTeam;
  const slotsLeft = {};
  unlockedIdxs.forEach(i => {
    const teamCap = DRAFT.teams[i].maxPlayers || globalCap;
    const alreadyHave = DRAFT.allPlayers.filter(p => p.teamIdx === i).length;
    slotsLeft[i] = teamCap ? Math.max(0, teamCap - alreadyHave) : Infinity;
  });

  const order = [];
  let round = 0;
  let safety = 0;
  while (order.length < available.length && safety++ < 5000) {
    const row = [...unlockedIdxs];
    if (DRAFT.snakeDraft && round % 2 === 1) row.reverse();
    let addedThisRound = 0;
    for (const tIdx of row) {
      if (order.length >= available.length) break;
      if (slotsLeft[tIdx] <= 0) continue;
      order.push(tIdx);
      slotsLeft[tIdx]--;
      addedThisRound++;
    }
    // If all teams are full or no progress, stop
    if (addedThisRound === 0) break;
    round++;
  }
  return order;
}

function draftTimerFmt(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── INIT / SETUP ─────────────────────────────────────────


// ── Draft state persistence ────────────────────────────────────────────────
// Saves team assignments and pick history to USER_DATA so cloud sync works
function saveDraftState() {
  if (!DRAFT.allPlayers || !DRAFT.allPlayers.length) return;
  const assignments = {};
  DRAFT.allPlayers.forEach(p => {
    if (p.teamIdx >= 0) assignments[p.key] = { teamIdx: p.teamIdx, preAssigned: !!p.preAssigned };
  });
  if (typeof USER_DATA === 'undefined') return;
  USER_DATA.draftState = {
    year: DRAFT.year || 2026,
    division: DRAFT.division || 'Majors',
    sport: DRAFT.sport || 'Baseball',
    phase: DRAFT.phase || 'pre',
    draftOrder: DRAFT.draftOrder || [],
    teams: DRAFT.teams.map(t => ({
      name: t.name, color: t.color, color2: t.color2 || '',
      coach: t.coach || '', assistants: t.assistants || [],
      maxPlayers: t.maxPlayers, locked: !!t.locked, logo: t.logo || ''
    })),
    assignments,
    pickHistory: DRAFT.pickHistory || [],
    currentPickIdx: DRAFT.currentPickIdx || 0,
    savedAt: Date.now()
  };
  saveUserData();
  // Push immediately so other devices get the live draft state right away
  if (typeof authCloudPush === 'function') setTimeout(authCloudPush, 400);
}

function loadDraftState() {
  if (typeof USER_DATA === 'undefined') return false;
  const state = USER_DATA.draftState;
  if (!state || !state.assignments) return false;

  // If DRAFT isn't configured yet on this device, apply the full saved config
  if (!DRAFT.year)     DRAFT.year     = state.year     || 2026;
  if (!DRAFT.division) DRAFT.division = state.division || 'Majors';
  if (state.sport)     DRAFT.sport    = state.sport;
  if (state.phase && DRAFT.phase !== 'draft') DRAFT.phase = state.phase;
  if (state.draftOrder?.length && !DRAFT.draftOrder?.length) DRAFT.draftOrder = state.draftOrder;
  if ((!DRAFT.teams || !DRAFT.teams.length) && state.teams?.length) {
    DRAFT.teams = state.teams.map(t => ({ ...t, players: [] }));
  } else if (DRAFT.teams?.length && state.teams?.length) {
    // Merge saved team attributes (color, coach, etc.) into existing teams
    state.teams.forEach((st, i) => {
      if (DRAFT.teams[i]) Object.assign(DRAFT.teams[i], { ...st, players: DRAFT.teams[i].players || [] });
    });
  }

  // Year/division guard — only skip if DRAFT is already configured differently
  const yearOk = !DRAFT.year || state.year === DRAFT.year;
  const divOk  = !DRAFT.division || state.division === DRAFT.division;
  if (!yearOk || !divOk) return false;

  // Restore player assignments
  let restored = 0;
  Object.entries(state.assignments).forEach(([key, info]) => {
    const p = DRAFT.allPlayers.find(x => x.key === key);
    if (p) { p.teamIdx = info.teamIdx; p.preAssigned = info.preAssigned; restored++; }
  });
  if (state.pickHistory)     DRAFT.pickHistory    = state.pickHistory;
  if (state.currentPickIdx)  DRAFT.currentPickIdx = state.currentPickIdx;

  // Re-sync teams.players arrays from assignments
  if (DRAFT.teams?.length) {
    DRAFT.teams.forEach(t => { t.players = []; });
    DRAFT.allPlayers.forEach(p => {
      if (p.teamIdx >= 0 && DRAFT.teams[p.teamIdx]) {
        DRAFT.teams[p.teamIdx].players.push(p.key);
      }
    });
  }
  return restored > 0;
}


// ── Cross-device relay (local WiFi — requires draft_relay.js running) ────────
const _RELAY_URL = 'http://localhost:3001';
let _relayEnabled = false;

function _relayPost(endpoint, data) {
  fetch(_RELAY_URL + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => {
    if (r.ok && !_relayEnabled) {
      _relayEnabled = true;
      // relay connected
    }
  }).catch(() => { _relayEnabled = false; });
}

// Probe relay on startup (silent — only logs if running)
setTimeout(() => {
  fetch(_RELAY_URL + '/status').then(r => r.ok && (_relayEnabled = true)).catch(() => {});
}, 1500);

// ── TV Display broadcast (BroadcastChannel) ───────────────────────────────
let _tvChannel = null;
function _tvBroadcastChannel() {
  if (!_tvChannel) {
    try { _tvChannel = new BroadcastChannel('lybs_draft_tv'); } catch(e) { return null; }
    // Respond to state requests from the TV page
    _tvChannel.onmessage = (e) => {
      if (e.data.type === 'request_state' || e.data.type === 'pong') {
        _tvPushFullState();
      }
    };
  }
  return _tvChannel;
}

function _tvBuildPlayerList() {
  return (DRAFT.allPlayers || []).map(dp => {
    const p = dp.player || {};
    try {
      return {
        key: dp.key,
        first: p.first || '',
        last: p.last || '',
        sport: p.sport || 'Baseball',
        teamIdx: typeof dp.teamIdx === 'number' ? dp.teamIdx : -1,
        positions: [],
        pitching: false,
        catching: false,
        evalScore: 0,
        isReturning: false,
      };
    } catch(e) {
      return { key: dp.key||'', first:'', last:'', sport:'Baseball', teamIdx:-1,
               positions:[], pitching:false, catching:false, evalScore:0, isReturning:false };
    }
  });
}

function _tvBuildState() {
  const order = DRAFT.draftOrder || [];
  const teams = (DRAFT.teams || []).map(t => ({
    name: t.name, color: t.color, color2: t.color2,
    maxPlayers: t.maxPlayers, logo: t.logo || null,
  }));
  return {
    phase: DRAFT.phase || 'draft',
    teams,
    players: _tvBuildPlayerList(),
    draftOrder: order,
    currentPickIdx: DRAFT.currentPickIdx || 0,
    pickHistory: DRAFT.pickHistory || [],
    year: DRAFT.year,
    division: DRAFT.division,
  };
}

function _tvPushFullState() {
  const ch = _tvBroadcastChannel();
  if (!ch) return;
  const headshots = {};
  const fullPhotos = {};
  if (typeof USER_DATA !== 'undefined') {
    const hs = USER_DATA.playerHeadshots || {};
    const fp = USER_DATA.playerFullPhotos || {};
    DRAFT.allPlayers.forEach(dp => {
      const p = dp.player;
      const k = (p.first + '|' + p.last[0] + '|' + (p.sport||'Baseball')).toLowerCase();
      if (hs[k]) headshots[k] = hs[k];
      if (fp[k]) fullPhotos[k] = fp[k];
    });
  }
  // Always include the LYBS helmet logo
  const helmetLogo = (typeof LYBS_LOGO_ICON_B64 !== 'undefined') ? LYBS_LOGO_ICON_B64 : null;
  const _relayState = _tvBuildState();
  ch.postMessage({ type: 'draft_state', state: _relayState, headshots, fullPhotos, helmetLogo });
  _relayPost('/state', { state: _relayState });
}

function _tvBroadcastPick(playerKey, teamIdx, pickNum, round) {
  const ch = _tvBroadcastChannel();
  if (!ch) return;
  const dp = DRAFT.allPlayers.find(x => x.key === playerKey);
  if (!dp) return;
  const p = dp.player;
  const meta = dp.meta || {};
  const hKey = (p.first + '|' + p.last[0] + '|' + (p.sport||'Baseball')).toLowerCase();
  const hs = (typeof USER_DATA !== 'undefined' && USER_DATA.playerHeadshots) ? USER_DATA.playerHeadshots : {};
  const fp = (typeof USER_DATA !== 'undefined' && USER_DATA.playerFullPhotos) ? USER_DATA.playerFullPhotos : {};
  const evalR = (typeof draftGetEvalScore !== 'undefined') ? draftGetEvalScore(p) : null;
  const pick = {
    first: p.first, last: p.last, sport: p.sport,
    teamIdx, pickNum, round,
    positions: meta.positions || [],
    isReturning: meta.isReturning || false,
    city: p.city || '',
    evalScore: evalR?.score || 0,
    pitching: p.pitching || false,
    catching: p.catching || false,
  };
  const state = _tvBuildState();
  const headshots = {}; const fullPhotos = {};
  if (hs[hKey]) headshots[hKey] = hs[hKey];
  if (fp[hKey]) fullPhotos[hKey] = fp[hKey];
  const helmetLogo2 = (typeof LYBS_LOGO_ICON_B64 !== 'undefined') ? LYBS_LOGO_ICON_B64 : null;
  ch.postMessage({ type: 'draft_pick', pick, state, headshots, fullPhotos, helmetLogo: helmetLogo2 });
  _relayPost('/pick', { pick, state });
}

// Open TV display in a protected, hard-to-close popup window
let _tvWindow = null;
function openTVDisplay() {
  // If already open and alive, just focus it
  if (_tvWindow && !_tvWindow.closed) {
    _tvWindow.focus();
    _tvPushFullState();
    toast('📺 TV display is already open', 'info');
    return;
  }

  // Open as a chromeless popup — no address bar, no toolbar, no menubar
  // Screen dimensions for best cast/HDMI experience
  const sw = window.screen.width, sh = window.screen.height;
  const w = Math.min(1280, sw), h = Math.min(720, sh);
  const left = Math.round((sw - w) / 2), top = Math.round((sh - h) / 2);

  _tvWindow = window.open(
    'draft_tv.html',
    'lybs_tv_display',
    `width=${w},height=${h},left=${left},top=${top},` +
    `menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes`
  );

  if (!_tvWindow) {
    toast('⚠️ Pop-up blocked — allow pop-ups for this site, then try again', 'error');
    return;
  }

  // Inject a close-guard into the TV window once it loads
  _tvWindow.addEventListener('load', () => {
    try {
      _tvWindow.onbeforeunload = () =>
        'The TV display is showing the live draft. Close it anyway?';
    } catch (_) {}
  }, { once: true });

  // Push state after TV boots — retry multiple times to beat timing issues
  const _tvPushRetry = (attempts) => {
    _tvBroadcastChannel(); // ensure channel open
    _tvPushFullState();
    if (attempts > 0) setTimeout(() => _tvPushRetry(attempts - 1), 1500);
  };
  setTimeout(() => _tvPushRetry(4), 800); // push at 0.8s, 2.3s, 3.8s, 5.3s, 6.8s

  toast('📺 TV display opened — move it to your second screen or TV!', 'success');
}

function openMobileTVDisplay() {
  // Open draft_tv_mobile.html as a new tab from the same origin so it can use
  // BroadcastChannel — no relay server needed. Works on iPad, phone, any device
  // where the dashboard is already open.
  const url = 'draft_tv_mobile.html';
  const win = window.open(url, 'lybs_tv_mobile');
  if (!win) {
    toast('⚠️ Pop-up blocked — allow pop-ups for this site, then try again', 'error');
    return;
  }
  setTimeout(() => _tvPushFullState(), 1000);
  toast('📱 Mobile board opened in new tab', 'success');
}

function initDraft() {
  // Reset
  DRAFT.teams = [];
  DRAFT.phase = 'setup';
  DRAFT.allPlayers = [];
  DRAFT.draftOrder = [];
  DRAFT.currentPickIdx = 0;
  DRAFT.pickHistory = [];
  DRAFT.pickStartTime = null;
  DRAFT.timerSecs = 0;
  DRAFT.year = null; // will default to latest in draftUpdateSportDiv
  clearInterval(DRAFT.timerInterval);

  // Default 4 teams
  for (let i = 0; i < 4; i++) draftAddTeam();

  draftUpdateSportDiv();
  renderDraftSetup();
  showDraftPhase('setup');
}

function draftUpdateSportDiv() {
  const sport = DRAFT.sport;
  const divOpts = draftDivOptions(sport);
  if (!divOpts.includes(DRAFT.division)) DRAFT.division = divOpts[0];

  const allYrs = typeof years === 'function' ? years() : [];
  const latestYr = allYrs[allYrs.length - 1] || 2026;
  // Use DRAFT.year if set; default to latest
  if (!DRAFT.year || !allYrs.includes(DRAFT.year)) DRAFT.year = latestYr;
  const draftYr = DRAFT.year;
  DRAFT.allPlayers = players
    .filter(p => p.year === draftYr && p.sport === sport && p.division === DRAFT.division)
    .map(p => ({
      player: p,
      key: draftPlayerKey(p),
      meta: draftGetMeta(p),
      teamIdx: -1,
      preAssigned: false,
    }));

  // Auto-set pitching experience from GC stats (IP > 2)
  if (typeof GC_STATS !== 'undefined') {
    DRAFT.allPlayers.forEach(dp => {
      const gcRecs = (typeof gcLookupYear !== 'undefined')
        ? gcLookupYear(dp.player)
        : GC_STATS.filter(s => s.key === `${dp.player.first.toLowerCase()}|${dp.player.last[0]?.toUpperCase()||''}`);
      if (gcRecs.some(r => r.pitching.ip_dec > 2)) {
        dp.player.pitching = true;
      }
    });
  }
  if (typeof gcClearCache !== 'undefined') gcClearCache();
}

function draftAddTeam() {
  const idx = DRAFT.teams.length;
  DRAFT.teams.push({
    name: `Team ${idx + 1}`,
    color:  TEAM_COLORS[idx % TEAM_COLORS.length].hex,
    color2: TEAM_COLORS[(idx + 3) % TEAM_COLORS.length].hex, // accent / secondary
    logo:   null,  // base64 data URL uploaded by coach
    coach: '',
    assistants: ['', ''],
    locked: false,
    maxPlayers: null,
    players: [],
  });
}

function draftSetAssistant(teamIdx, assistantIdx, val) {
  if (!DRAFT.teams[teamIdx].assistants) DRAFT.teams[teamIdx].assistants = [];
  DRAFT.teams[teamIdx].assistants[assistantIdx] = val;
}

function draftAddAssistantSlot(teamIdx) {
  if (!DRAFT.teams[teamIdx].assistants) DRAFT.teams[teamIdx].assistants = [];
  if (DRAFT.teams[teamIdx].assistants.length >= 4) return;
  DRAFT.teams[teamIdx].assistants.push('');
  renderDraftSetup();
}

function draftRemoveAssistantSlot(teamIdx, assistantIdx) {
  DRAFT.teams[teamIdx].assistants.splice(assistantIdx, 1);
  renderDraftSetup();
}

function draftRemoveTeam(idx) {
  if (DRAFT.teams.length <= 2) { toast('Minimum 2 teams', 'error'); return; }
  // Unassign any pre-assigned players from this team
  DRAFT.allPlayers.forEach(p => {
    if (p.teamIdx === idx) { p.teamIdx = -1; p.preAssigned = false; }
    else if (p.teamIdx > idx) p.teamIdx--;
  });
  DRAFT.teams.splice(idx, 1);
  renderDraftSetup();
}

function draftSetTeamField(idx, field, val) {
  DRAFT.teams[idx][field] = val;
}

function draftSetSport(sport) {
  DRAFT.sport = sport;
  draftUpdateSportDiv();
  renderDraftSetup();
}

function draftSetDivision(div) {
  DRAFT.division = div;
  draftUpdateSportDiv();
  renderDraftSetup();
}


// ── TEAM REORDER ─────────────────────────────────────────────────────────

function draftMoveTeam(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= DRAFT.teams.length) return;

  // Swap teams
  [DRAFT.teams[idx], DRAFT.teams[newIdx]] = [DRAFT.teams[newIdx], DRAFT.teams[idx]];

  // Remap allPlayers teamIdx references
  DRAFT.allPlayers.forEach(p => {
    if (p.teamIdx === idx)    p.teamIdx = newIdx;
    else if (p.teamIdx === newIdx) p.teamIdx = idx;
  });

  renderDraftSetup();
}

// ── SAVE / LOAD DRAFT ─────────────────────────────────────────────────────

// ── SAVE / LOAD — localStorage + export/import JSON ─────────────────────

function _draftKey() {
  return (typeof userKey !== 'undefined') ? userKey('saved_drafts') : 'lll_saved_drafts';
}

function draftGetLocal() {
  try { return JSON.parse(localStorage.getItem(_draftKey()) || '[]'); }
  catch { return []; }
}

function draftSetLocal(arr) {
  while (arr.length > 20) arr.pop();
  localStorage.setItem(_draftKey(), JSON.stringify(arr));
  // Push to cloud so other devices get the updated saved-drafts list
  if (typeof authCloudPush === 'function') setTimeout(authCloudPush, 800);
}

function _buildSnapshot(name) {
  return {
    name: name.trim(),
    savedAt: Date.now(),
    sport: DRAFT.sport,
    division: DRAFT.division,
    snakeDraft: DRAFT.snakeDraft,
    maxPerTeam: DRAFT.maxPerTeam,
    teams: JSON.parse(JSON.stringify(DRAFT.teams)),
    assignments: DRAFT.allPlayers
      .filter(p => p.preAssigned && p.teamIdx >= 0)
      .map(p => ({ key: p.key, teamIdx: p.teamIdx })),
  };
}

function _applySnapshot(snap) {
  DRAFT.sport    = snap.sport;
  DRAFT.division = snap.division;
  draftUpdateSportDiv();
  DRAFT.teams      = JSON.parse(JSON.stringify(snap.teams));
  DRAFT.snakeDraft = snap.snakeDraft;
  DRAFT.maxPerTeam = snap.maxPerTeam || null;
  DRAFT.allPlayers.forEach(p => { p.teamIdx = -1; p.preAssigned = false; });
  (snap.assignments || []).forEach(a => {
    const p = DRAFT.allPlayers.find(x => x.key === a.key);
    if (p && a.teamIdx < DRAFT.teams.length) { p.teamIdx = a.teamIdx; p.preAssigned = true; }
  });
  renderDraftSetup();
  saveDraftState();  // immediately sync this loaded draft as the live cloud state
  toast(`Loaded "${snap.name}"`);
}

// ── Save to localStorage ──────────────────────────────────────────────────

function draftSave() {
  const defaultName = `${DRAFT.sport} ${DRAFT.division} ${new Date().toLocaleDateString()}`;
  const name = prompt('Name this draft:', defaultName);
  if (!name || !name.trim()) return;

  const snap  = _buildSnapshot(name);
  const saved = draftGetLocal();
  const idx   = saved.findIndex(s => s.name === snap.name);
  if (idx >= 0) saved[idx] = snap; else saved.unshift(snap);
  draftSetLocal(saved);
  toast(`"${snap.name}" saved`);
  renderDraftSavedList();
  // Auto-push to other coaches if sharing is enabled
  draftAutoShare(snap).catch(()=>{});
}

// ── Load / delete from localStorage ──────────────────────────────────────

function draftLoadLocal(idx) {
  const snap = draftGetLocal()[idx];
  if (!snap || !confirm(`Load "${snap.name}"? Current setup will be replaced.`)) return;
  _applySnapshot(snap);
}

function draftDeleteLocal(idx) {
  const saved = draftGetLocal();
  const name  = saved[idx]?.name;
  if (!name || !confirm(`Delete "${name}"?`)) return;
  saved.splice(idx, 1);
  draftSetLocal(saved);
  renderDraftSavedList();
  toast(`Deleted "${name}"`);
}

// ── Export draft as .json file (share with other coaches) ─────────────────

function draftExport(idx) {
  const snap = draftGetLocal()[idx];
  if (!snap) return;
  const json = JSON.stringify(snap, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = snap.name.replace(/[^a-z0-9]/gi, '_') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported "${snap.name}" — send the file to other coaches`);
}

// ── Import a .json file from another coach ────────────────────────────────

function draftImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const snap = JSON.parse(e.target.result);
      if (!snap.name || !snap.sport || !snap.teams) {
        toast('Invalid draft file', 'error'); return;
      }
      // Always save into local list on import
      const saved = draftGetLocal();
      const existing = saved.findIndex(s => s.name === snap.name);
      if (existing >= 0) {
        if (!confirm(`A draft named "${snap.name}" already exists. Replace it?`)) return;
        saved[existing] = snap;
      } else {
        saved.unshift(snap);
      }
      draftSetLocal(saved);
      toast(`Imported "${snap.name}" ✓`);
      renderDraftSavedList();
    } catch {
      toast('Could not read draft file', 'error');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// ── Export/Import ALL saved drafts as one bundle ────────────────────────

function draftExportAll() {
  const saved = draftGetLocal();
  if (!saved.length) { toast('No saved drafts to export', 'error'); return; }
  const bundle = { _type: 'lybs_draft_bundle', version: 1, drafts: saved, exportedAt: Date.now() };
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `lybs_drafts_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${saved.length} draft${saved.length!==1?'s':''} — open this file on the laptop`);
}

function draftImportBundle(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      // Handle both single draft and bundle formats
      const drafts = parsed._type === 'lybs_draft_bundle' ? parsed.drafts : [parsed];
      if (!drafts.length) { toast('No drafts found in file', 'error'); return; }
      const saved = draftGetLocal();
      let added = 0, replaced = 0;
      drafts.forEach(snap => {
        if (!snap.name || !snap.sport || !snap.teams) return;
        const idx = saved.findIndex(s => s.name === snap.name);
        if (idx >= 0) { saved[idx] = snap; replaced++; }
        else { saved.unshift(snap); added++; }
      });
      draftSetLocal(saved);
      toast(`Imported ${added} new + ${replaced} updated draft${(added+replaced)!==1?'s':''} ✓`);
      renderDraftSavedList();
    } catch { toast('Could not read file', 'error'); }
    input.value = '';
  };
  reader.readAsText(file);
}

// ── Cloud Draft Sharing ───────────────────────────────────────────────────

async function draftPushToCloud(snapOrIdx, targetUsername) {
  if (typeof jbEnabled === 'undefined' || !jbEnabled()) {
    toast('Cloud sync required for sharing'); return false;
  }
  const snap = typeof snapOrIdx === 'number' ? draftGetLocal()[snapOrIdx] : snapOrIdx;
  if (!snap) return false;

  try {
    const dir = await jbGetDir();
    const entry = (dir.users || {})[targetUsername.toLowerCase()];
    if (!entry?.binId) { toast('Cannot reach ' + targetUsername); return false; }

    const rec  = await jbGet(entry.binId);
    rec.data   = rec.data || {};
    const key  = 'lll_' + targetUsername + '_sharedDrafts';
    const arr  = rec.data[key] || [];
    const me   = typeof authCurrentUser !== 'undefined' ? authCurrentUser()?.username : 'Unknown';
    const payload = Object.assign({}, snap, {
      sharedBy: me,
      sharedAt: Date.now()
    });
    const idx = arr.findIndex(d => d.name === snap.name && d.sharedBy === me);
    if (idx >= 0) arr[idx] = payload; else arr.unshift(payload);
    while (arr.length > 30) arr.pop();
    rec.data[key] = arr;
    await jbSet(entry.binId, rec);
    return true;
  } catch(e) {
    console.warn('draftPushToCloud failed', e);
    return false;
  }
}

async function draftAutoShare(snap) {
  if (typeof jbEnabled === 'undefined' || !jbEnabled()) return;
  if (localStorage.getItem('lll_share_drafts') !== 'true') return;
  try {
    const dir = await jbGetDir();
    const me  = typeof authCurrentUser !== 'undefined' ? authCurrentUser()?.username : null;
    const coaches = Object.keys(dir.coaches || {});
    const others  = coaches.filter(u => u !== (me||'').toLowerCase());
    await Promise.all(others.map(u => draftPushToCloud(snap, u).catch(()=>{})));
  } catch {}
}

function draftGetShared() {
  const u = typeof authCurrentUser !== 'undefined' ? authCurrentUser() : null;
  if (!u) return [];
  try {
    return JSON.parse(localStorage.getItem('lll_' + u.username + '_sharedDrafts') || '[]');
  } catch { return []; }
}

async function draftPullShared() {
  if (typeof jbEnabled === 'undefined' || !jbEnabled()) return;
  const u = typeof authCurrentUser !== 'undefined' ? authCurrentUser() : null;
  if (!u) return;
  try {
    const dir   = await jbGetDir();
    const entry = (dir.users || {})[u.username.toLowerCase()];
    if (!entry?.binId) return;
    const rec = await jbGet(entry.binId);
    const key = 'lll_' + u.username + '_sharedDrafts';
    const arr = (rec.data || {})[key] || [];
    if (arr.length) {
      localStorage.setItem('lll_' + u.username + '_sharedDrafts', JSON.stringify(arr));
    }
  } catch {}
}

async function openShareDraftModal(idx) {
  if (typeof jbEnabled === 'undefined' || !jbEnabled()) {
    toast('Cloud sync required'); return;
  }
  const snap = draftGetLocal()[idx];
  if (!snap) return;

  if (typeof getSharedCoaches === 'undefined') { toast('Coach directory unavailable'); return; }
  const coaches = await getSharedCoaches();
  const me      = typeof authCurrentUser !== 'undefined' ? authCurrentUser()?.username : null;
  const others  = coaches.filter(c => c.username.toLowerCase() !== (me||'').toLowerCase());

  if (!others.length) { toast('No other coaches in the system yet'); return; }

  const modal   = document.getElementById('shareDraftModal');
  const content = document.getElementById('shareDraftContent');
  if (!modal || !content) return;

  content.innerHTML = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:14px;">
      Sharing <strong style="color:var(--text);">"${snap.name}"</strong> — select who to send it to:
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;margin-bottom:16px;">
      ${others.map(c => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;
            border:1px solid var(--border);cursor:pointer;background:rgba(255,255,255,0.03);">
          <input type="checkbox" value="${c.username}" style="accent-color:var(--gold);width:16px;height:16px;">
          <div>
            <div style="font-weight:600;font-size:13px;">${c.displayName || c.username}</div>
            ${(c.teams||[]).length ? `<div style="font-size:10px;color:var(--text2);">${c.teams.map(t=>t.name).join(', ')}</div>` : ''}
          </div>
        </label>`).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost btn-sm" onclick="closeModal('shareDraftModal')">Cancel</button>
      <button class="btn btn-gold btn-sm" id="shareDraftConfirm" onclick="
        const checks = document.querySelectorAll('#shareDraftContent input:checked');
        const targets = Array.from(checks).map(cb=>cb.value);
        if (!targets.length) { toast('Select at least one coach'); return; }
        document.getElementById('shareDraftConfirm').textContent = 'Sharing…';
        document.getElementById('shareDraftConfirm').disabled = true;
        Promise.all(targets.map(u => draftPushToCloud(${idx}, u)))
          .then(results => {
            const ok = results.filter(Boolean).length;
            toast('✓ Shared with ' + ok + ' coach' + (ok!==1?'es':''));
            closeModal('shareDraftModal');
          });
      ">Share</button>
    </div>`;

  openModal('shareDraftModal');
}


// ── Render saved list ─────────────────────────────────────────────────────

function renderDraftSavedList() {
  const el = document.getElementById('draftSavedList');
  if (!el) return;
  const saved = draftGetLocal();

  if (!saved.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text2);font-style:italic;margin-bottom:8px;">
      No saved drafts yet. Save your setup above, or import a file from another coach.
    </div>`;
    el.innerHTML += _importRow();
    return;
  }

  el.innerHTML = saved.map((s, i) => {
    const dateStr = new Date(s.savedAt).toLocaleDateString('en-US',
      { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;
                background:rgba(255,255,255,0.04);border:1px solid var(--border);margin-bottom:5px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
        <div style="font-size:11px;color:var(--text2);">${s.sport} · ${s.division} · ${s.teams.length} teams · ${dateStr}</div>
      </div>
      <button class="btn btn-gold btn-sm"  onclick="draftLoadLocal(${i})"  style="font-size:11px;white-space:nowrap;">Load</button>
      ${typeof jbEnabled!=='undefined'&&jbEnabled()?`<button class="btn btn-ghost btn-sm" onclick="openShareDraftModal(${i})" style="font-size:11px;white-space:nowrap;" title="Share with coaches">↑ Share</button>`:''}
      <button class="btn btn-ghost btn-sm" onclick="draftExport(${i})"     style="font-size:11px;white-space:nowrap;" title="Export file">📤</button>
      <button class="btn btn-ghost btn-sm" onclick="draftDeleteLocal(${i})" style="font-size:11px;padding:3px 8px;"  title="Delete">✕</button>
    </div>`;
  }).join('') + _importRow();
  // Refresh shared section
  setTimeout(renderSharedDraftList, 0);
}

function _importRow() {
  return `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;
            font-size:12px;color:var(--gold);padding:6px 0;margin-top:2px;font-weight:600;">
    <input type="file" accept=".json" onchange="draftImportBundle(this)"
           style="display:none;">
    📥 Import drafts from file (single or bundle)
  </label>`;
}

function renderSharedDraftList() {
  const el = document.getElementById('draftSharedList');
  if (!el) return;
  const shared = draftGetShared();
  if (!shared.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `
    <div style="font-family:'Bebas Neue';font-size:16px;letter-spacing:1px;
        color:var(--text2);margin:16px 0 8px;">🤝 Shared <span style="color:var(--gold);">With You</span></div>
    ${shared.map((s, i) => {
      const dateStr = new Date(s.sharedAt || s.savedAt).toLocaleDateString('en-US',
        { month:'short', day:'numeric', year:'numeric' });
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;
          border-radius:8px;background:rgba(255,255,255,0.04);
          border:1px solid var(--border);border-left:3px solid var(--blue);margin-bottom:5px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:10px;color:var(--blue);font-weight:700;margin-bottom:2px;">
            Shared by ${s.sharedBy || 'a coach'}
          </div>
          <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name}</div>
          <div style="font-size:11px;color:var(--text2);">${s.sport} · ${s.division} · ${s.teams.length} teams · ${dateStr}</div>
        </div>
        <button class="btn btn-gold btn-sm" onclick="draftLoadShared(${i})"
          style="font-size:11px;white-space:nowrap;">Load</button>
        <button class="btn btn-ghost btn-sm" onclick="draftSaveSharedToLocal(${i})"
          style="font-size:11px;white-space:nowrap;" title="Save to your drafts">+ Save</button>
      </div>`;
    }).join('')}`;
}

function draftLoadShared(idx) {
  const snap = draftGetShared()[idx];
  if (!snap || !confirm(`Load "${snap.name}" from ${snap.sharedBy}? Current setup will be replaced.`)) return;
  _applySnapshot(snap);
}

function draftSaveSharedToLocal(idx) {
  const snap = draftGetShared()[idx];
  if (!snap) return;
  const saved = draftGetLocal();
  const existing = saved.findIndex(s => s.name === snap.name);
  if (existing >= 0) {
    if (!confirm(`A draft named "${snap.name}" already exists. Replace it?`)) return;
    saved[existing] = Object.assign({}, snap, { savedAt: Date.now() });
  } else {
    saved.unshift(Object.assign({}, snap, { savedAt: Date.now() }));
  }
  draftSetLocal(saved);
  toast(`"${snap.name}" saved to your drafts ✓`);
  renderDraftSavedList();
  renderSharedDraftList();
}

// ── Pre-assignment helpers ─────────────────────────────────────────────────
// Called by the ✕ button on assigned players in the pre-draft team builder
function draftUnassign(playerKey) {
  const p = DRAFT.allPlayers.find(x => x.key === playerKey);
  if (!p) return;
  p.teamIdx = -1;
  p.preAssigned = false;
  saveDraftState();
  renderDraftSetup();
}

// Called by the checkbox to add/remove a player from a team in setup
function draftTogglePlayerAssign(teamIdx, playerKey, checked) {
  const p = DRAFT.allPlayers.find(x => x.key === playerKey);
  if (!p) return;
  // If assigning, unassign from any other team first
  if (checked) {
    p.teamIdx = teamIdx;
    p.preAssigned = true;
  } else {
    p.teamIdx = -1;
    p.preAssigned = false;
  }
  saveDraftState();
  renderDraftSetup();
}

// ── RENDER: SETUP ─────────────────────────────────────────

function renderDraftSetup() {
  try {
    _renderDraftSetupInner();
  } catch(e) {
    const el = document.getElementById('draftSetupContent');
    if (el) el.innerHTML = `<div style="color:#ef4444;padding:20px;background:rgba(239,68,68,0.1);border-radius:8px;margin:16px 0;font-family:'DM Sans';font-size:13px;">
      <strong>Draft Setup Error:</strong> ${e.message}<br>
      <small style="opacity:.7">${(e.stack||'').split('\n').slice(0,3).join('<br>')}</small>
    </div>`;
    console.error('[renderDraftSetup] Error:', e);
  }
}
function _renderDraftSetupInner() {
  const sport = DRAFT.sport;
  const div = DRAFT.division;
  const divOpts = draftDivOptions(sport);
  const playerCount = DRAFT.allPlayers.length;
  const lockedCount = DRAFT.teams.filter(t=>t.locked).length;
  const lockedPlayerCount = DRAFT.allPlayers.filter(p=>p.preAssigned && p.teamIdx>=0 && DRAFT.teams[p.teamIdx]?.locked).length;
  const draftableCount = playerCount - lockedPlayerCount;

  let html = '<div id="draftSetupScroll">';

  // ── Step 1: Sport & Division ──
  const draftYr = DRAFT.year || (typeof years === 'function' ? (years()[years().length-1] || 2026) : 2026);
  html += `
  <div class="draft-step-card">
    <div class="draft-step-num">1</div>
    <div class="draft-step-body">
      <div class="draft-step-title">Choose Sport & Division</div>
      <div class="draft-sport-btns">
        <button class="draft-sport-btn ${sport==='Baseball'?'active-baseball':''}" onclick="draftSetSport('Baseball')">⚾ Baseball</button>
        <button class="draft-sport-btn ${sport==='Softball'?'active-softball':''}" onclick="draftSetSport('Softball')">🥎 Softball</button>
      </div>
      <div class="draft-div-btns">
        ${divOpts.map(d=>`<button class="draft-div-btn ${d===div?'active':''}" onclick="draftSetDivision('${d}')">${d}</button>`).join('')}
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
        <label class="draft-toggle-row" style="margin:0;">
          <div class="draft-toggle ${DRAFT.snakeDraft?'on':''}" onclick="DRAFT.snakeDraft=!DRAFT.snakeDraft;renderDraftSetup();"></div>
          <span style="font-size:13px;font-weight:600;">🐍 Snake Draft <span style="color:var(--text2);font-size:12px;font-weight:400;">(even rounds reverse)</span></span>
        </label>
      </div>
      <div class="draft-player-count">
        <span style="color:var(--gold);font-family:'Bebas Neue';font-size:28px;">${playerCount}</span>
        <span style="color:var(--text2);font-size:13px;margin-left:6px;">${sport} ${div} players found in ${draftYr}</span>
      </div>
    </div>
  </div>`;

  // ── Step 2: Teams + Players + Settings ──
  const maxVal = DRAFT.maxPerTeam || '';
  const autoMax = DRAFT.maxPerTeam ? '' :
    (DRAFT.teams.length ? Math.ceil(draftableCount / Math.max(1, DRAFT.teams.filter(t=>!t.locked).length)) : '—');

  html += `
  <div class="draft-step-card">
    <div class="draft-step-num">2</div>
    <div class="draft-step-body">
      <div class="draft-step-title" style="flex-wrap:wrap;gap:8px;">
        Configure Teams
        <div style="display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:400;color:var(--text2);">
            Max players/team
            <input type="number" min="1" max="50" value="${maxVal}" placeholder="${autoMax}"
              oninput="DRAFT.maxPerTeam=this.value?parseInt(this.value):null;renderDraftSetup();"
              style="width:58px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);
                     padding:4px 8px;border-radius:6px;font-size:12px;font-family:'DM Sans';outline:none;text-align:center;">
            <span style="font-size:11px;color:var(--text2);">(auto: ${autoMax})</span>
          </label>
          <button class="btn btn-gold btn-sm" onclick="draftAddTeam();renderDraftSetup();">+ Add Team</button>
        </div>
      </div>

      <div class="draft-team-config-grid">
        ${DRAFT.teams.map((t, i) => {
          const assistants  = t.assistants || ['', ''];
          const canAddAsst  = assistants.length < 4;
          const teamPlayers = DRAFT.allPlayers.filter(p => p.teamIdx === i);
          const maxForThis  = t.maxPlayers || DRAFT.maxPerTeam || Math.ceil(draftableCount / Math.max(1, DRAFT.teams.filter(t=>!t.locked).length));
          const pctFull     = Math.min(100, Math.round(teamPlayers.length / maxForThis * 100));
          const availableForThis = DRAFT.allPlayers.filter(p => p.teamIdx === -1);

          return `
          <div class="draft-team-row" style="border-left:3px solid ${t.color};border-radius:12px;flex-direction:column;align-items:stretch;gap:0;padding:0;overflow:hidden;${t.locked?'background:rgba(245,166,35,0.05);border:1px solid rgba(245,166,35,0.25);border-left:3px solid '+t.color+';':'' }">

            <!-- Team header bar -->
            <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:${t.color}12;flex-wrap:wrap;">
              <!-- Reorder arrows -->
              <div style="display:flex;flex-direction:column;gap:1px;flex-shrink:0;">
                <button onclick="draftMoveTeam(${i},-1)" ${i===0?'disabled':''} title="Move up"
                  style="background:none;border:none;color:${i===0?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.5)'};cursor:${i===0?'default':'pointer'};font-size:10px;padding:1px 4px;line-height:1;">▲</button>
                <button onclick="draftMoveTeam(${i},1)" ${i===DRAFT.teams.length-1?'disabled':''} title="Move down"
                  style="background:none;border:none;color:${i===DRAFT.teams.length-1?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.5)'};cursor:${i===DRAFT.teams.length-1?'default':'pointer'};font-size:10px;padding:1px 4px;line-height:1;">▼</button>
              </div>
              <div style="font-size:11px;font-weight:700;color:${t.color};min-width:18px;text-align:center;">#${i+1}</div>
              <!-- Primary color swatch -->
              <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;" title="Primary & accent colors">
                <div class="draft-color-dot" style="background:${t.color};" onclick="draftCycleColor(${i});" title="Primary color"></div>
                <div class="draft-color-dot" style="background:${t.color2||'#475569'};width:14px;height:14px;" onclick="draftCycleColor2(${i});" title="Accent color"></div>
              </div>
              <!-- Logo upload -->
              <label style="cursor:pointer;flex-shrink:0;" title="Upload team logo">
                <div style="width:32px;height:32px;border-radius:8px;overflow:hidden;border:1px dashed rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;">
                  ${t.logo ? `<img src="${t.logo}" style="width:100%;height:100%;object-fit:contain;">` : '<span style="font-size:16px;opacity:0.5;">🖼</span>'}
                </div>
                <input type="file" accept="image/*" style="display:none;" onchange="draftUploadTeamLogo(${i},this.files[0])">
              </label>
              <input type="text" class="draft-input" value="${t.name}" placeholder="Team name"
                oninput="draftSetTeamField(${i},'name',this.value)" style="font-weight:700;flex:1;background:transparent;border-color:transparent;">
              <!-- Per-team max players -->
              <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);white-space:nowrap;flex-shrink:0;" title="Max players for this team (overrides global)">
                Max
                <input type="number" min="1" max="30" value="${t.maxPlayers||''}" placeholder="—"
                  oninput="DRAFT.teams[${i}].maxPlayers=this.value?parseInt(this.value):null;renderDraftSetup();"
                  style="width:40px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);
                         padding:3px 5px;border-radius:5px;font-size:11px;font-family:'DM Sans';outline:none;text-align:center;">
              </label>
              <!-- Lock toggle -->
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;white-space:nowrap;flex-shrink:0;${t.locked?'color:var(--gold);font-weight:700;':'color:var(--text2);'}">
                <div style="width:32px;height:18px;border-radius:9px;background:${t.locked?'var(--gold)':'rgba(255,255,255,0.1)'};position:relative;cursor:pointer;transition:background .2s;"
                  onclick="DRAFT.teams[${i}].locked=!DRAFT.teams[${i}].locked;renderDraftSetup();">
                  <div style="width:14px;height:14px;border-radius:50%;background:#fff;position:absolute;top:2px;left:${t.locked?'16px':'2px'};transition:left .2s;"></div>
                </div>
                ${t.locked ? '🔒 Locked' : '🔓 Draft'}
              </label>
              ${DRAFT.teams.length > 2 ? `<button class="btn btn-danger btn-sm" onclick="draftRemoveTeam(${i})" title="Remove team" style="padding:3px 8px;">✕</button>` : '<div style="width:28px"></div>'}
            </div>

            <!-- Player count bar (uses per-team max if set) -->
            <div style="height:3px;background:rgba(255,255,255,0.07);" title="${teamPlayers.length} / ${t.maxPlayers||maxForThis} players">
              <div style="height:100%;width:${pctFull}%;background:${t.locked?'var(--gold)':t.color};transition:width .3s;"></div>
            </div>

            <!-- Coaches section -->
            <div style="padding:10px 14px;display:flex;flex-direction:column;gap:7px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-size:11px;color:var(--text2);flex-shrink:0;">👤 Head Coach</span>
                <input type="text" class="draft-input" value="${t.coach}" placeholder="Head coach name"
                  list="coachDatalist"
                  oninput="draftSetTeamField(${i},'coach',this.value)" style="flex:1;min-width:120px;">
              </div>
              ${assistants.map((a, ai) => `
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:11px;color:var(--text2);min-width:80px;">🤝 Asst. ${ai+1}</span>
                <input type="text" class="draft-input" value="${a}" placeholder="Assistant coach name"
                  list="coachDatalist"
                  oninput="draftSetAssistant(${i},${ai},this.value)" style="flex:1;">
                ${assistants.length > 2 ? `<button class="btn btn-ghost btn-sm" onclick="draftRemoveAssistantSlot(${i},${ai})" style="padding:3px 7px;font-size:11px;">✕</button>` : ''}
              </div>`).join('')}
              ${canAddAsst ? `<button class="btn btn-ghost btn-sm" onclick="draftAddAssistantSlot(${i})" style="align-self:flex-start;font-size:11px;padding:2px 10px;">+ Add Assistant</button>` : ''}
            </div>

            <!-- Player assignment section -->
            <details ${teamPlayers.length>0?'open':''} style="padding:10px 14px;">
              <summary style="cursor:pointer;font-size:12px;font-weight:700;color:${t.locked?'var(--gold)':t.color};user-select:none;list-style:none;display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span>Assigned Players</span>
                <span style="background:${t.locked?'rgba(245,166,35,0.2)':t.color+'22'};color:${t.locked?'var(--gold)':t.color};border-radius:20px;padding:1px 8px;font-size:11px;font-weight:700;">
                  ${teamPlayers.length}${(t.maxPlayers||DRAFT.maxPerTeam)?' / '+(t.maxPlayers||DRAFT.maxPerTeam):''}
                </span>
                ${t.locked ? '<span style="font-size:10px;color:var(--gold);background:rgba(245,166,35,0.15);border-radius:4px;padding:1px 6px;font-weight:600;">LOCKED — skips draft</span>' : ''}
              </summary>

              <!-- Currently assigned -->
              ${teamPlayers.length ? `
              <div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px;">
                ${teamPlayers.map(p=>`
                <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:${t.color}15;font-size:12px;">
                  <span style="font-weight:600;flex:1;">${p.player.first} ${p.player.last}</span>
                  ${p.player.city?`<span style="font-size:11px;color:var(--text2);">📍 ${p.player.city}</span>`:''}
                  
                  <button onclick="draftUnassign('${p.key}')" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:13px;padding:0 2px;line-height:1;" title="Remove">✕</button>
                </div>`).join('')}
              </div>` : ''}

              <!-- Add from available -->
              ${availableForThis.length ? `
              <div style="font-size:11px;color:var(--text2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px;">Add players:</div>
              <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:7px;background:rgba(255,255,255,0.02);">
                ${availableForThis.map(p=>`
                <label style="display:flex;align-items:center;gap:9px;padding:6px 9px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.04);transition:background .1s;"
                  onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background=''">
                  <input type="checkbox" data-team="${i}" data-key="${p.key}"
                    class="draft-assign-cb"
                    onchange="draftTogglePlayerAssign(${i},'${p.key}',this.checked)"
                    style="width:14px;height:14px;accent-color:${t.color};cursor:pointer;flex-shrink:0;">
                  <span style="font-size:12px;font-weight:600;flex:1;">${p.player.first} ${p.player.last}</span>
                  ${p.player.city?`<span style="font-size:11px;color:var(--text2);">📍 ${p.player.city}</span>`:''}
                  
                </label>`).join('')}
              </div>` : `<div style="font-size:12px;color:var(--text2);font-style:italic;">No unassigned players left.</div>`}
            </details>
          </div>`;
        }).join('')}
      </div>

      <!-- Draft options -->
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--border);align-items:center;">
        ${lockedCount ? `
        <div style="font-size:12px;color:var(--gold);background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.25);border-radius:7px;padding:5px 12px;">
          🔒 ${lockedCount} locked team${lockedCount>1?'s':''} (${lockedPlayerCount} players) will sit out the draft
        </div>` : ''}
      </div>
    </div>
  </div>`;

  // ── Save / Load + Start ──
  const unlockedTeams = DRAFT.teams.filter(t=>!t.locked).length;
  html += `
  <!-- Saved Drafts panel -->
  <div class="draft-step-card" style="margin-bottom:80px;">
    <div class="draft-step-num" style="background:rgba(255,255,255,0.06);color:var(--text2);">💾</div>
    <div class="draft-step-body">
      <div class="draft-step-title" style="margin-bottom:10px;">
        Saved Drafts
        <div style="margin-left:auto;display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="draftExportAll()" style="font-size:12px;" title="Download all drafts as one file to share with laptop">📦 Export All</button>
          <button class="btn btn-ghost btn-sm" onclick="draftSave()" style="font-size:12px;">💾 Save</button>
        </div>
      </div>
      <div id="draftSavedList"></div>
      <div id="draftSharedList" style="display:none;"></div>
    </div>
  </div>

  </div>
  <!-- Fixed footer Start Draft bar — always visible on mobile -->
  <div id="draftStartBar" style="position:fixed;bottom:0;left:0;right:0;z-index:50;
              background:linear-gradient(to top, var(--navy) 80%, transparent);
              padding:12px 16px calc(16px + env(safe-area-inset-bottom, 0px));
              pointer-events:none;">
    <div style="pointer-events:auto;">
    <button class="btn btn-gold" style="width:100%;padding:16px;font-family:'Bebas Neue';
            letter-spacing:2px;font-size:22px;border-radius:12px;
            box-shadow:0 4px 24px rgba(245,166,35,0.35);" onclick="startDraft()">
      🏆 START DRAFT — ${draftableCount} players · ${unlockedTeams} team${unlockedTeams!==1?'s':''}
      ${DRAFT.snakeDraft ? '<span style="font-size:14px;opacity:0.8;margin-left:8px;">🐍 Snake</span>' : ''}
    </button>
    </div>
  </div>`;

  document.getElementById('draftSetupContent').innerHTML = html;
  renderDraftSavedList();
  // Pull shared drafts from cloud and render
  draftPullShared().then(() => renderSharedDraftList()).catch(()=>{});
}

// ── COLOR PICKER GRID ─────────────────────────────────────────────────────
const COLOR_PALETTE = [
  // Blacks & near-blacks
  '#000000','#0a0a0a','#111111','#1a1a1a','#222222','#2d2d2d','#333333','#3d3d3d',
  // Greys
  '#444444','#555555','#666666','#777777','#888888','#999999','#aaaaaa','#bbbbbb',
  '#cccccc','#dddddd','#eeeeee','#ffffff',
  // Navy & Deep Blue
  '#0a1628','#0d1f3c','#0f2a5e','#1a3a72','#1e3a8a','#1d4ed8','#2563eb','#3b82f6',
  // True Blues
  '#1e40af','#1d4ed8','#2563eb','#3b82f6','#60a5fa','#93c5fd','#0369a1','#0284c7',
  // Royal / Dodger
  '#1e3a8a','#1d4ed8','#4169e1','#4682b4','#5b8dd9','#007fff','#005b99','#003f7f',
  // Teals & Cyans
  '#0f766e','#0d9488','#14b8a6','#06b6d4','#0891b2','#164e63','#155e75','#0e7490',
  // Greens
  '#14532d','#166534','#15803d','#16a34a','#22c55e','#4ade80','#065f46','#047857',
  // Reds
  '#7f1d1d','#991b1b','#b91c1c','#dc2626','#ef4444','#f87171','#c0392b','#e74c3c',
  // Maroons / Burgundy
  '#4a0020','#6b0031','#8b0000','#a00030','#800020','#9b1b30','#6d071a','#b22222',
  // Gold / Amber / Orange
  '#78350f','#92400e','#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a',
  // Purple
  '#3b0764','#4c1d95','#5b21b6','#6d28d9','#7c3aed','#8b5cf6','#a78bfa','#c4b5fd',
  // Silver / Steel (for uniforms)
  '#475569','#64748b','#94a3b8','#b0bec5','#cfd8dc','#eceff1','#607d8b','#546e7a',
];

function draftCycleColor(idx) {
  _draftOpenColorPicker(idx, 'color');
}

function draftCycleColor2(idx) {
  _draftOpenColorPicker(idx, 'color2');
}

function _draftOpenColorPicker(teamIdx, field) {
  // Remove any existing picker
  const existing = document.getElementById('draftColorPickerPopup');
  if (existing) existing.remove();

  const currentColor = DRAFT.teams[teamIdx][field] || '#2563eb';
  const label = field === 'color' ? 'Primary Color' : 'Accent Color';

  const popup = document.createElement('div');
  popup.id = 'draftColorPickerPopup';
  popup.style.cssText = `
    position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);
  `;

  popup.innerHTML = `
    <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:16px;
      padding:24px;max-width:440px;width:calc(100vw - 32px);box-shadow:0 24px 80px rgba(0,0,0,0.8);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font-size:15px;font-weight:700;color:#fff;letter-spacing:0.5px;">${label}</div>
        <button onclick="document.getElementById('draftColorPickerPopup').remove()"
          style="background:rgba(255,255,255,0.08);border:none;color:rgba(255,255,255,0.5);
            cursor:pointer;border-radius:6px;padding:4px 10px;font-size:16px;line-height:1;">✕</button>
      </div>
      <!-- Color grid -->
      <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:5px;margin-bottom:16px;">
        ${COLOR_PALETTE.map(hex => `
          <div onclick="_draftPickColor(${teamIdx},'${field}','${hex}')"
            style="width:100%;aspect-ratio:1;border-radius:5px;background:${hex};cursor:pointer;
              border:2px solid ${hex === currentColor ? '#60a5fa' : 'transparent'};
              box-shadow:${hex === currentColor ? '0 0 0 2px #fff' : 'inset 0 0 0 1px rgba(255,255,255,0.08)'};
              transition:transform 0.1s;"
            onmouseover="this.style.transform='scale(1.2)';this.style.zIndex='2'"
            onmouseout="this.style.transform='scale(1)';this.style.zIndex='1'">
          </div>`).join('')}
      </div>
      <!-- Custom hex input -->
      <div style="display:flex;gap:8px;align-items:center;">
        <div id="draftColorPreview" style="width:36px;height:36px;border-radius:8px;background:${currentColor};
          border:2px solid rgba(255,255,255,0.2);flex-shrink:0;"></div>
        <input id="draftColorHex" type="text" value="${currentColor}"
          maxlength="7" placeholder="#000000"
          style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);
            color:#fff;border-radius:8px;padding:8px 12px;font-family:'DM Sans';font-size:14px;outline:none;"
          oninput="
            const v=this.value;
            if(/^#[0-9a-fA-F]{6}$/.test(v)){
              document.getElementById('draftColorPreview').style.background=v;
            }
          ">
        <button onclick="
            const v=document.getElementById('draftColorHex').value;
            if(/^#[0-9a-fA-F]{6}$/.test(v)){_draftPickColor(${teamIdx},'${field}',v);}
          "
          style="background:#2563eb;border:none;color:#fff;cursor:pointer;
            border-radius:8px;padding:8px 16px;font-family:'DM Sans';font-size:13px;font-weight:700;">
          Apply
        </button>
      </div>
    </div>
  `;

  // Close on backdrop click
  popup.addEventListener('click', (e) => { if (e.target === popup) popup.remove(); });
  document.body.appendChild(popup);
}

function _draftPickColor(teamIdx, field, hex) {
  DRAFT.teams[teamIdx][field] = hex;
  document.getElementById('draftColorPickerPopup')?.remove();
  renderDraftSetup();
}

function draftUploadTeamLogo(idx, file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 120;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width-s)/2, (img.height-s)/2, s, s, 0, 0, size, size);
      DRAFT.teams[idx].logo = canvas.toDataURL('image/png', 0.9);
      renderDraftSetup();
      toast('✓ Team logo saved');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── DRAFT ANNOUNCEMENT BANNER ──────────────────────────────────────────────
// NFL-style full-screen banner that fires when a pick is confirmed.
// Shows player name, headshot, positions, team info, and chime sound.

function showDraftBanner(pObj, teamIdx) {
  const team   = DRAFT.teams[teamIdx];
  const player = pObj.player;
  const c1     = team.color  || '#1d4ed8';
  const c2     = team.color2 || '#d97706';

  // Positions
  const _manPos = (typeof USER_DATA !== 'undefined' && USER_DATA?.playerPositions)
    ? (USER_DATA.playerPositions[`${player.first}|${(player.last||'')[0]?.toUpperCase()||''}|${player.sport||''}`.toLowerCase()] || []) : [];
  const _gcPos  = (!_manPos.length && typeof gcInferPositions !== 'undefined') ? gcInferPositions(player) : [];
  const positions = (_manPos.length ? _manPos : _gcPos).slice(0, 3);

  // Pick info
  const pickNum     = DRAFT.currentPickIdx;
  const roundNum    = Math.ceil(pickNum / Math.max(1, DRAFT.teams.length));
  const pickInRound = ((pickNum - 1) % Math.max(1, DRAFT.teams.length)) + 1;

  // Logos
  const iconLogo = (typeof LYBS_LOGO_ICON_B64 !== 'undefined') ? LYBS_LOGO_ICON_B64
                 : (typeof LYBS_LOGO_B64 !== 'undefined') ? LYBS_LOGO_B64 : null;
  const teamLogo = team.logo || null;
  const ph2Logo  = teamLogo || iconLogo;

  // Dark version of c1 for gradient
  const _hex2rgb = h => { h=h.replace('#',''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; };
  const [r1,g1,b1] = _hex2rgb(c1);
  const deep = `rgb(${Math.max(0,r1-55)},${Math.max(0,g1-55)},${Math.max(0,b1-55)})`;

  document.getElementById('draftAnnounceBanner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'draftAnnounceBanner';
  banner.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:hidden;font-family:"Bebas Neue","DM Sans",Arial,sans-serif;';

  banner.innerHTML = `
  <style>
    /* ── KEYFRAMES ── */
    @keyframes dab-bg-wipe   { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0% 0 0)} }
    @keyframes dab-flare     { from{left:-80%} to{left:160%} }
    @keyframes dab-logo-drop { 0%{transform:translateY(-100px) scale(.8);opacity:0} 70%{transform:translateY(8px) scale(1.04)} 100%{transform:translateY(0) scale(1);opacity:1} }
    @keyframes dab-slam-l    { 0%{transform:translateX(-90px);opacity:0} 65%{transform:translateX(6px)} 100%{transform:translateX(0);opacity:1} }
    @keyframes dab-slam-r    { 0%{transform:translateX(90px) scaleX(1.08);opacity:0} 60%{transform:translateX(-5px) scaleX(.99)} 100%{transform:translateX(0) scaleX(1);opacity:1} }
    @keyframes dab-pop       { 0%{transform:scale(0) skewX(-4deg);opacity:0} 65%{transform:scale(1.12) skewX(-4deg)} 100%{transform:scale(1) skewX(-4deg);opacity:1} }
    @keyframes dab-shake     { 0%,100%{transform:translate(0)} 25%{transform:translate(-3px,1px)} 50%{transform:translate(2px,-1px)} 75%{transform:translate(-1px,2px)} }
    @keyframes dab-ph1in     { 0%{clip-path:inset(0 100% 0 0)} 100%{clip-path:inset(0 0% 0 0)} }
    @keyframes dab-pulse     { 0%,100%{opacity:.2} 50%{opacity:.7} }

    /* ── PHASE 1 ── */
    #draftAnnounceBanner .dab-ph1 {
      position:absolute;inset:0;background:#fff;
      display:flex;align-items:center;
      padding:clamp(28px,5vw,80px);
      transition:opacity .4s ease;
      overflow:hidden;
    }
    #draftAnnounceBanner .dab-ph1.out { opacity:0; }
    #draftAnnounceBanner .dab-ph1-text {
      font-family:'Bebas Neue',Arial;
      font-size:clamp(72px,15vw,210px);
      line-height:.82;letter-spacing:-2px;
      color:#111;
      animation:dab-ph1in .5s cubic-bezier(.16,1,.3,1) both;
    }
    #draftAnnounceBanner .dab-ph1-logo {
      position:absolute;top:clamp(20px,3vw,48px);right:clamp(24px,4vw,60px);
      width:clamp(64px,8vw,120px);
    }
    #draftAnnounceBanner .dab-ph1-logo img { width:100%;height:auto; }
    #draftAnnounceBanner .dab-ph1-bar {
      position:absolute;bottom:0;left:0;right:0;height:10px;background:${c1};
    }

    /* ── PHASE 2 ── */
    #draftAnnounceBanner .dab-ph2 {
      position:absolute;inset:0;overflow:hidden;
      opacity:0;transition:opacity .45s ease;
    }
    #draftAnnounceBanner .dab-ph2.in { opacity:1; }

    /* Full-bleed team color */
    #draftAnnounceBanner .dab-bg {
      position:absolute;inset:0;
      background:linear-gradient(125deg, ${deep} 0%, ${c1} 45%, ${deep} 100%);
      animation:dab-bg-wipe .5s cubic-bezier(.77,0,.18,1) both;
    }

    /* Grunge texture — irregular noise bands + SVG grain */
    #draftAnnounceBanner .dab-grunge {
      position:absolute;inset:0;pointer-events:none;
      background:linear-gradient(160deg, rgba(255,255,255,0.04) 0%, transparent 40%, rgba(0,0,0,0.2) 100%);
      mix-blend-mode:overlay;
    }
    #draftAnnounceBanner .dab-grain {
      position:absolute;inset:0;pointer-events:none;opacity:.06;
      background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
      background-size:180px 180px;
    }

    /* Vignette edges */
    #draftAnnounceBanner .dab-vignette {
      position:absolute;inset:0;pointer-events:none;
      background:radial-gradient(ellipse at 55% 50%, rgba(0,0,0,0) 30%, rgba(0,0,0,.55) 100%);
    }

    /* Light flare sweep */
    #draftAnnounceBanner .dab-flare {
      position:absolute;top:-20%;bottom:-20%;width:45%;
      background:linear-gradient(to right,transparent,rgba(255,255,255,.13),transparent);
      transform:skewX(-18deg);
      animation:dab-flare .9s ease .65s both;
    }

    /* Accent bar left */
    #draftAnnounceBanner .dab-accent-line {
      position:absolute;left:0;top:0;bottom:0;width:7px;
      background:linear-gradient(180deg,${c2} 0%,${c2}66 60%,transparent);
      z-index:3;
    }

    /* Content layout */
    #draftAnnounceBanner .dab-layout {
      position:relative;z-index:2;
      width:100%;height:100%;
      display:flex;align-items:center;
      gap:clamp(16px,3vw,48px);
      padding:clamp(24px,4vw,56px) clamp(28px,5vw,72px);
    }

    /* Logo column */
    #draftAnnounceBanner .dab-logo-col {
      flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
    }
    #draftAnnounceBanner .dab-logo-col img {
      width:clamp(160px,22vw,340px);height:auto;
      filter:drop-shadow(0 0 40px rgba(0,0,0,.7)) drop-shadow(0 0 80px ${c2}55);
      animation:dab-logo-drop .6s cubic-bezier(.34,1.56,.64,1) .1s both;
    }

    /* Name column */
    #draftAnnounceBanner .dab-name-col {
      flex:1;display:flex;flex-direction:column;justify-content:center;
      min-width:0;
    }
    #draftAnnounceBanner .dab-meta {
      font-size:clamp(11px,1.5vw,16px);letter-spacing:3.5px;color:rgba(255,255,255,.55);
      margin-bottom:6px;
      animation:dab-slam-l .45s cubic-bezier(.22,1,.36,1) .2s both;
    }
    #draftAnnounceBanner .dab-team-label {
      font-size:clamp(14px,2vw,22px);letter-spacing:3px;color:${c2};
      font-weight:800;margin-bottom:6px;
      animation:dab-slam-l .45s cubic-bezier(.22,1,.36,1) .26s both;
    }
    #draftAnnounceBanner .dab-first {
      font-family:'Bebas Neue',Arial;
      font-size:clamp(52px,9vw,130px);line-height:1;
      color:${c2};letter-spacing:3px;font-style:italic;
      text-shadow:0 4px 32px rgba(0,0,0,.6),0 0 60px ${c2}55;
      animation:dab-slam-l .5s cubic-bezier(.22,1,.36,1) .3s both;
    }
    #draftAnnounceBanner .dab-last {
      font-family:'Bebas Neue',Arial;
      font-size:clamp(88px,17vw,240px);line-height:.82;
      color:#fff;letter-spacing:1px;
      text-shadow:0 8px 60px rgba(0,0,0,.7),0 0 100px ${c1}55;
      animation:dab-slam-r .55s cubic-bezier(.22,1,.36,1) .22s both;
      margin-bottom:clamp(10px,1.5vw,20px);
    }
    #draftAnnounceBanner .dab-pos {
      display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;
      animation:dab-pop .45s cubic-bezier(.34,1.56,.64,1) .52s both;
    }
    #draftAnnounceBanner .dab-pos-badge {
      display:inline-block;
      background:${c2};color:#000;
      font-size:clamp(16px,3.5vw,46px);font-weight:900;letter-spacing:2px;
      padding:5px 22px;transform:skewX(-4deg);
      box-shadow:4px 4px 0 rgba(0,0,0,.3),0 8px 32px rgba(0,0,0,.4);
    }
    #draftAnnounceBanner .dab-pos-badge.hit {
      animation:dab-shake .2s ease .72s both;
    }
    #draftAnnounceBanner .dab-dismiss {
      position:absolute;bottom:16px;right:20px;z-index:5;
      font-size:11px;color:rgba(255,255,255,.2);letter-spacing:2px;
      animation:dab-pulse 2s ease-in-out .8s infinite;
      font-family:'DM Sans',sans-serif;
    }

    @media(max-width:640px){
      #draftAnnounceBanner .dab-layout { flex-direction:column; justify-content:center; }
      #draftAnnounceBanner .dab-last { font-size:clamp(52px,18vw,120px); }
    }
  </style>

  <!-- PHASE 1: THE PICK IS IN -->
  <div class="dab-ph1" id="dab-ph1">
    <div class="dab-ph1-text">THE PICK<br>IS IN</div>
    ${iconLogo ? `<div class="dab-ph1-logo"><img src="${iconLogo}" alt="LYBS"></div>` : ''}
    <div class="dab-ph1-bar"></div>
  </div>

  <!-- PHASE 2: PLAYER REVEAL -->
  <div class="dab-ph2" id="dab-ph2">
    <div class="dab-bg"></div>
    <div class="dab-grunge"></div>
    <div class="dab-grain"></div>
    <div class="dab-vignette"></div>
    <div class="dab-flare"></div>
    <div class="dab-accent-line"></div>

    <div class="dab-layout">
      ${ph2Logo ? `<div class="dab-logo-col"><img src="${ph2Logo}" alt="${team.name}"></div>` : ''}
      <div class="dab-name-col">
        <div class="dab-meta">RD ${roundNum} · PICK ${pickInRound}</div>
        <div class="dab-team-label">${team.name.toUpperCase()}</div>
        <div class="dab-first">${player.first.toUpperCase()}</div>
        <div class="dab-last">${player.last.toUpperCase()}</div>
        ${positions.length ? `<div class="dab-pos">${positions.map(p=>`<span class="dab-pos-badge hit">${p}</span>`).join('')}</div>` : ''}
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:8px;animation:dab-slam-l .4s cubic-bezier(.22,1,.36,1) .58s both;">
          
          ${player.city ? `<span style="font-family:DM Sans,sans-serif;font-size:clamp(11px,1.6vw,17px);color:rgba(255,255,255,.5);letter-spacing:1px;">📍 ${player.city}</span>` : ''}
          ${''/* eval score removed */}
        </div>
        <div class="dab-dismiss">TAP TO DISMISS</div>
      </div>
    </div>
  </div>
  `;

  banner.addEventListener('click', closeDraftBanner);
  document.body.appendChild(banner);

  banner._ph1Timer = setTimeout(() => {
    banner.querySelector('#dab-ph1').classList.add('out');
    banner.querySelector('#dab-ph2').classList.add('in');
  }, 2500);
  banner._autoDismiss = setTimeout(closeDraftBanner, 14000);
}

function closeDraftBanner() {
  const banner = document.getElementById('draftAnnounceBanner');
  if (!banner) return;
  clearTimeout(banner._autoDismiss);
  clearTimeout(banner._ph1Timer);
  banner.style.transition = 'opacity 0.4s';
  banner.style.opacity = '0';
  setTimeout(() => banner.remove(), 420);
}

function _ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10]||s[v]||s[0]);
}


// ── START DRAFT ───────────────────────────────────────────

function startDraft() {
  if (DRAFT.allPlayers.length === 0) { toast('No players found for this division', 'error'); return; }
  if (DRAFT.teams.length < 2) { toast('Need at least 2 teams', 'error'); return; }
  if (DRAFT.teams.some(t => !t.name.trim())) { toast('All teams need a name', 'error'); return; }
  const unlockedTeams = DRAFT.teams.filter(t => !t.locked);
  if (unlockedTeams.length === 0) { toast('At least one team must be unlocked to draft', 'error'); return; }

  // Apply pre-assignments to team rosters
  DRAFT.allPlayers.forEach(p => {
    if (p.preAssigned && p.teamIdx >= 0) {
      if (!DRAFT.teams[p.teamIdx].players.includes(p.key)) {
        DRAFT.teams[p.teamIdx].players.push(p.key);
      }
    }
  });

  // Build draft order — locked teams and their players are already set, skip them
  DRAFT.draftOrder = draftBuildOrder();
  DRAFT.currentPickIdx = 0;
  DRAFT.pickHistory = [];
  DRAFT.phase = 'draft';

  // ── Protect against accidental tab/window close ──────────────────────────
  window._draftCloseGuard = (e) => {
    e.preventDefault();
    e.returnValue = 'The draft is in progress — all pick data will be lost if you close this tab.';
    return e.returnValue;
  };
  window.addEventListener('beforeunload', window._draftCloseGuard);

  // ── Auto-save heartbeat every 30 seconds ─────────────────────────────────
  clearInterval(window._draftAutoSaveInterval);
  window._draftAutoSaveInterval = setInterval(() => {
    if (DRAFT.phase === 'draft' && DRAFT.pickHistory?.length) {
      saveDraftState();
    }
  }, 30000);

  showDraftPhase('draft');
  renderDraftBoard();
  startPickTimer();
}

// ── DRAFT BOARD ───────────────────────────────────────────

function renderDraftBoard() {
  _tvBroadcastChannel(); // ensure channel open to receive TV request_state
  if (typeof _tvPushFullState === 'function') setTimeout(_tvPushFullState, 100);
  renderDraftHeader();
  renderDraftOrderStrip();
  renderAvailablePlayers();
  renderDraftedPlayers();
  renderDraftRosters();
  renderTop3Available();
}

// ── Smart Draft Insights ───────────────────────────────────────────────────

function renderTop3Available() {
  const el = document.getElementById('draftTop3');
  if (!el) return;
  const available = DRAFT.allPlayers.filter(p => p.teamIdx === -1);
  const _st3 = (typeof settingsGet !== 'undefined') ? settingsGet() : {};
  if (!available.length || !_st3.showTop3Banner) { el.style.display='none'; return; }
  el.style.display = '';

  const isDone = DRAFT.currentPickIdx >= DRAFT.draftOrder.length;
  const curTeamIdx = isDone ? -1 : DRAFT.draftOrder[DRAFT.currentPickIdx];
  const curTeam = curTeamIdx >= 0 ? DRAFT.teams[curTeamIdx] : null;
  const curRoster = curTeam ? DRAFT.allPlayers.filter(p => p.teamIdx === curTeamIdx) : [];
  const rosterHasPitcher = curRoster.some(p => p.player.pitching);
  const rosterHasCatcher = curRoster.some(p => p.player.catching);
  const rosterSize = curRoster.length;

  const scored = available.map(p => ({
    p,
    score: _draftBestScore(p.player, p.meta),
    isPitcher: p.player.pitching,
    isCatcher: p.player.catching,
    actScore: (typeof computeActivityScore !== 'undefined') ? computeActivityScore(p.player) : 0,
    evalScore: (() => { const r = draftGetEvalScore(p.player); return r?.score || 0; })(),
  })).sort((a,b) => b.score - a.score);

  const top3 = scored.slice(0, 3);

  const insights = [];
  const availPitchers = scored.filter(s => s.isPitcher);
  if (availPitchers.length && !rosterHasPitcher && rosterSize > 0) {
    insights.push({ icon:'⚾', color:'#ef4444', label:'No pitcher yet',
      sub:`${availPitchers.length} available — ${availPitchers[0].p.player.first} ${availPitchers[0].p.player.last} leads`,
      player: availPitchers[0].p });
  } else if (availPitchers.length && availPitchers[0].evalScore >= 70) {
    insights.push({ icon:'🔥', color:'#f97316', label:'Elite pitcher available',
      sub:`${availPitchers[0].p.player.first} ${availPitchers[0].p.player.last} (eval ${availPitchers[0].evalScore})`,
      player: availPitchers[0].p });
  }
  const availCatchers = scored.filter(s => s.isCatcher);
  if (availCatchers.length <= 2 && !rosterHasCatcher && rosterSize > 1) {
    insights.push({ icon:'🎯', color:'#f59e0b',
      label:`Catcher scarce (${availCatchers.length} left)`,
      sub: availCatchers[0] ? `${availCatchers[0].p.player.first} ${availCatchers[0].p.player.last} available` : 'None left',
      player: availCatchers[0]?.p || null });
  }
  const highAct = scored.find(s => s.actScore >= 8 && !top3.find(t=>t.p.key===s.p.key));
  if (highAct) {
    insights.push({ icon:'🗓️', color:'#10b981', label:'Off-season standout',
      sub:`${highAct.p.player.first} ${highAct.p.player.last} +${highAct.actScore} activity pts`,
      player: highAct.p });
  }
  const posGroups = {};
  curRoster.forEach(p => (p.player.positions||[]).forEach(pos => { posGroups[pos]=(posGroups[pos]||0)+1; }));
  const overloaded = Object.entries(posGroups).find(([,n])=>n>=3);
  if (overloaded && rosterSize >= 4) {
    insights.push({ icon:'⚠️', color:'#f5a623',
      label:`Loaded at ${overloaded[0]} (${overloaded[1]})`,
      sub:'Consider balance — other positions open', player: null });
  }

  const medals = ['🥇','🥈','🥉'];
  const evalColor = s => s>=88?'#10b981':s>=70?'#60a5fa':s>=52?'#f5a623':s>=35?'#f97316':'#ef4444';

  el.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1;min-width:200px;">
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;font-weight:700;">🏅 Best Available</div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${top3.map((s,i) => {
            const scoreCol = s.evalScore ? evalColor(s.evalScore) : 'var(--text2)';
            const pb = s.isPitcher ? `<span style="font-size:9px;color:#ef4444;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);">⚾P</span>` : '';
            const cb = s.isCatcher ? `<span style="font-size:9px;color:#f59e0b;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);">🎯C</span>` : '';
            const ab = s.actScore>=6 ? `<span style="font-size:9px;color:#10b981;">+${s.actScore}</span>` : '';
            const ev = s.evalScore ? `<span style="font-family:'Bebas Neue';font-size:14px;color:${scoreCol};min-width:24px;">${s.evalScore}</span>` : '';
            return `<div style="display:flex;align-items:center;gap:5px;padding:4px 8px;border-radius:7px;background:rgba(255,255,255,0.05);cursor:pointer;" onclick="draftConfirmPick('${s.p.key}')" title="Pick ${s.p.player.first} ${s.p.player.last}">
              <span style="font-size:14px;">${medals[i]}</span>${ev}
              <span style="font-size:12px;font-weight:600;flex:1;">${s.p.player.first} ${s.p.player.last}</span>
              ${pb}${cb}${ab}
            </div>`;
          }).join('')}
        </div>
      </div>
      ${insights.length ? `<div style="flex:1;min-width:160px;">
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;font-weight:700;">
          💡 ${curTeam ? curTeam.name+' Insights' : 'Insights'}
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          ${insights.slice(0,3).map(ins => {
            const clickAttr = ins.player ? `onclick="draftConfirmPick('${ins.player.key}')"` : '';
            const cursorStyle = ins.player ? 'cursor:pointer;' : '';
            return `<div style="display:flex;align-items:flex-start;gap:6px;padding:4px 8px;border-radius:7px;background:${ins.color}12;border:1px solid ${ins.color}30;${cursorStyle}" ${clickAttr}>
              <span style="font-size:13px;flex-shrink:0;">${ins.icon}</span>
              <div>
                <div style="font-size:11px;font-weight:700;color:${ins.color};line-height:1.2;">${ins.label}</div>
                <div style="font-size:10px;color:var(--text2);line-height:1.3;">${ins.sub}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    </div>`;
}




function renderDraftHeader() {
  const isDone = DRAFT.currentPickIdx >= DRAFT.draftOrder.length;
  const teamIdx = isDone ? -1 : DRAFT.draftOrder[DRAFT.currentPickIdx];
  const team = isDone ? null : DRAFT.teams[teamIdx];
  const round = Math.floor(DRAFT.currentPickIdx / DRAFT.teams.length) + 1;
  const pick = (DRAFT.currentPickIdx % DRAFT.teams.length) + 1;
  const totalPicks = DRAFT.draftOrder.length;

  // Pre-assigned players (select team slots + coaches kids already placed)
  const preCount = DRAFT.allPlayers.filter(p => p.preAssigned && p.teamIdx >= 0).length;
  const overallPickNum = DRAFT.currentPickIdx + 1 + preCount;

  document.getElementById('draftClockTeam').innerHTML = isDone
    ? `<span style="color:var(--gold);">🏆 DRAFT COMPLETE!</span>`
    : `<span style="background:${team.color};color:#fff;padding:3px 14px;border-radius:6px;font-weight:700;">${team.name}</span> is on the clock`;

  // Show round/pick AND overall pick context with pre-assigned note
  const preNote = preCount > 0
    ? `<span style="font-size:10px;color:var(--text2);margin-left:8px;">(${preCount} pre-assigned — overall pick #${overallPickNum})</span>`
    : '';
  const pickInfoEl = document.getElementById('draftPickInfo');
  if (pickInfoEl) {
    pickInfoEl.innerHTML = isDone
      ? `All ${totalPicks} picks made`
      : `Round ${round} · Pick ${pick} of ${totalPicks}${preNote}`;
  }
  // Update NFL board on-clock label
  const boardLabel = document.getElementById('draftBoardOnClock');
  if (boardLabel) {
    boardLabel.innerHTML = isDone
      ? '<span style="color:var(--gold);">🏆 Complete</span>'
      : `<span style="font-size:12px;padding:2px 10px;border-radius:5px;background:${team.color}33;color:${team.color};font-weight:700;border:1px solid ${team.color}55;">${team.name} — Round ${round}</span>`;
  }
}

function renderDraftOrderStrip() {
  const strip = document.getElementById('draftOrderStrip');
  if (!strip) return;

  // Show current + next 5, plus a count of how many more
  const window_size = 6;
  const remaining = DRAFT.draftOrder.slice(DRAFT.currentPickIdx, DRAFT.currentPickIdx + window_size);
  const morePicks  = DRAFT.draftOrder.length - DRAFT.currentPickIdx - window_size;

  // Also show last pick (already made) greyed out for context
  const lastIdx = DRAFT.currentPickIdx - 1;
  let lastChip = '';
  if (lastIdx >= 0) {
    const t = DRAFT.teams[DRAFT.draftOrder[lastIdx]];
    lastChip = `<div style="opacity:0.3;padding:3px 8px;border-radius:12px;font-size:10px;font-weight:700;
        color:#fff;background:${t.color}44;border:1px solid ${t.color}55;white-space:nowrap;flex-shrink:0;">
      ✓ ${t.name}
    </div><div class="draft-order-arrow" style="opacity:0.3;">›</div>`;
  }

  const chips = remaining.map((tIdx, i) => {
    const t = DRAFT.teams[tIdx];
    const isCurrent = i === 0;
    return `<div class="draft-order-chip ${isCurrent?'current':''}" style="
        padding:${isCurrent?'5px 12px':'3px 8px'};
        font-size:${isCurrent?'12px':'10px'};
        background:${t.color}${isCurrent?'dd':'44'};
        border:${isCurrent?'2px':'1px'} solid ${t.color}${isCurrent?'':'77'};
        flex-shrink:0;">
      ${isCurrent ? '🎯 ' : ''}${t.name}
    </div>`;
  }).join('<div class="draft-order-arrow" style="font-size:10px;opacity:0.5;">›</div>');

  const moreTag = morePicks > 0
    ? `<div style="font-size:10px;color:var(--text2);padding:3px 6px;flex-shrink:0;">+${morePicks} more</div>`
    : '';

  strip.innerHTML = lastChip + chips + moreTag;
  // Also sync mobile dashboard strip if present
  const mobileStrip = document.getElementById('draftOrderStripMobile');
  if (mobileStrip) {
    mobileStrip.innerHTML = lastChip + chips + moreTag;
    const curM = mobileStrip.querySelector('.current');
    if (curM) curM.scrollIntoView({ inline: 'center', behavior: 'smooth' });
  }
  // Scroll current chip into view
  const cur = strip.querySelector('.current');
  if (cur) cur.scrollIntoView({ inline: 'center', behavior: 'smooth' });
}

function renderAvailablePlayers() {
  // Push state to TV display whenever board re-renders
  if (DRAFT.allPlayers.length) setTimeout(_tvPushFullState, 200);
  const available = DRAFT.allPlayers.filter(p => p.teamIdx === -1);
  const searchQ = (document.getElementById('draftSearch')?.value || '').toLowerCase();
  const filtered = searchQ ? available.filter(p =>
    `${p.player.first} ${p.player.last} ${p.player.city||''}`.toLowerCase().includes(searchQ)
  ) : available;

  const el = document.getElementById('draftAvailableGrid');
  if (!el) return;

  const countEl = document.getElementById('draftAvailableCount');
  if (countEl) countEl.textContent = available.length + ' available';

  if (filtered.length === 0 && available.length === 0) {
    el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text2);">
      All players have been drafted! 🎉
    </div>`;
    return;
  }

  // ── Hoist expensive computations outside per-card loop ──────────────
  // Pre-compute scores once for sorting, then reuse in card rendering
  const _scoredDisplay = filtered.map(p => ({
    p,
    score: _draftBestScore(p.player, p.meta)
  })).sort((a, b) => b.score - a.score);

  // Pre-compute shared values used in every card
  DRAFT._renderCache = {
    allAvailScored: _scoredDisplay.map(x => ({ key: x.p.key, score: x.score })),
    preCount: DRAFT.allPlayers.filter(q => q.preAssigned).length,
    totalRanked: _scoredDisplay.length,
  };

  const cards = [];
  for (const { p } of _scoredDisplay) {
    try {
      cards.push(draftPlayerCard(p, false));
    } catch(e) {
      console.error('[draftPlayerCard] error for', p?.player?.first, p?.player?.last, ':', e.message);
      cards.push(`<div style="padding:8px 12px;border-radius:8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);font-size:11px;color:#ef4444;margin-bottom:4px;">
        ⚠ Card error for ${p?.player?.first||'?'} ${p?.player?.last||'?'}: ${e.message}
      </div>`);
    }
  }
  el.innerHTML = cards.join('');
  // Clean up cache after render
  delete DRAFT._renderCache;
}


function _draftBestScore(player, meta) {
  const evalR = draftGetEvalScore(player);
  const evalScore = evalR ? evalR.score : 0;

  // ── Evaluated players always score above non-evaluated ──────────────
  // Base tier: 1000 = has eval, 500 = has stats only, 0 = neither
  // This ensures ordering: evaluated > stats-only > unknown
  const tier = evalScore ? 1000 : 0;

  // ── Stat-based score (0–100) ─────────────────────────────────────────
  let statScore = 0;
  if (typeof gcLookupYear !== 'undefined') {
    const recs = gcLookupYear(player).sort((a,b) => b.year - a.year);
    const r = recs[0];
    if (r) {
      const bat = r.batting  || {};
      const pit = r.pitching || {};
      const ip  = parseFloat(pit.ip_dec || 0);
      const ab  = parseInt(bat.ab   || 0);

      // ── Pitching score (highest weight) ──────────────────────────────
      let pitScore = 0;
      if (ip >= 5) {
        // K rate per inning (normalized 0-100), weighted by volume
        const kPerIP   = ip > 0 ? (pit.so || 0) / ip : 0;
        const kScore   = Math.min(100, kPerIP * 35);          // ~3K/IP = 100
        // ERA: lower is better. ≤3.00 = 100, ≥9.00 = 0
        const era      = parseFloat(pit.era || 9.99);
        const eraScore = Math.max(0, Math.min(100, (9 - era) / 6 * 100));
        // IP volume bonus — reward pitchers who throw a lot
        const ipBonus  = Math.min(20, ip / 30 * 20);
        pitScore = kScore * 0.4 + eraScore * 0.4 + ipBonus * 0.2;
      }

      // ── Hitting score ─────────────────────────────────────────────────
      let hitScore = 0;
      if (ab >= 5) {
        const avg = parseFloat(bat.avg || '0');
        const ops = parseFloat(bat.ops || '0');
        const h   = parseInt(bat.h  || 0);

        // AVG is most meaningful for youth baseball (not inflated by walks like OPS)
        const avgScore = Math.min(100, avg * 130);  // .770 avg ≈ 100

        // OPS adds power context but capped contribution
        const opsScore = Math.min(100, ops * 55);   // 1.800 OPS ≈ 99

        // Hit volume: 28 hits in a season is elite; scale accordingly
        // Also factors in AB count — reward kids getting playing time
        const hitVolumeScore = Math.min(100, (h / Math.max(1, ab)) * 100 * 0.8 + Math.min(20, h / 1.4));

        // Weight: AVG 40%, OPS 25%, hit volume 35%
        hitScore = avgScore * 0.40 + opsScore * 0.25 + hitVolumeScore * 0.35;
      }

      // ── Combined stat score ──────────────────────────────────────────
      // Pitching weighted higher than hitting for draft purposes
      if (ip >= 5 && ab >= 5) {
        statScore = pitScore * 0.55 + hitScore * 0.45;
      } else if (ip >= 5) {
        statScore = pitScore;
      } else {
        statScore = hitScore;
      }
      statScore = Math.round(Math.min(99, statScore));
    }
  }

  // ── Off-season activity bonus ────────────────────────────────────────
  const activityBonus = (typeof computeActivityScore !== 'undefined')
    ? computeActivityScore(player) : 0;

  // ── Final composite ───────────────────────────────────────────────────
  // Eval is king; stats are tiebreaker; activity is small bonus
  if (evalScore) {
    // Has eval: eval 70% + stats 20% + activity 10%
    const raw = evalScore * 0.70 + statScore * 0.20 + activityBonus * 0.10;
    return tier + Math.round(raw);
  }
  if (statScore) {
    // Stats only: add 500-tier offset so they appear below evaluated players
    return 500 + Math.round(statScore * 0.90 + activityBonus * 0.10);
  }
  // No data: sort by years in league
  return (meta?.yearsInLeague || 0) * 2 + activityBonus;
}

function renderDraftedPlayers() {
  const drafted = DRAFT.allPlayers.filter(p => p.teamIdx >= 0 && !p.preAssigned);
  const preAssigned = DRAFT.allPlayers.filter(p => p.preAssigned);
  const el = document.getElementById('draftDraftedGrid');
  if (!el) return;

  // Update count badge
  const countEl = document.getElementById('draftedCount');
  if (countEl) countEl.textContent = drafted.length + preAssigned.length;

  const all = [...drafted, ...preAssigned];
  if (all.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = all.reverse().map(p => draftPlayerCard(p, true)).join('');
}

// ── Look up a player's best eval score from saved sessions ───────────────
function draftGetEvalScore(playerObj) {
  // First check committed _evalScore (fastest path)
  if (playerObj._evalScore) {
    return { score: playerObj._evalScore, source: 'committed' };
  }
  // Scan saved eval sessions from localStorage
  try {
    const key = (typeof userKey !== 'undefined') ? userKey('evals') :
                (typeof authCurrentUser !== 'undefined' && authCurrentUser())
                  ? 'lll_' + authCurrentUser().username + '_evals'
                  : 'lll_evals';
    const sessions = JSON.parse(localStorage.getItem(key) || '[]');
    let best = null;
    // Offseason months — sessions in these months are notes only, not eval ratings
    const OFFSEASON_MONTHS = ['2025-08','2025-09','2025-10','2025-11','2025-12',
                               '2026-08','2026-09','2026-10','2026-11','2026-12'];
    sessions.forEach(session => {
      if (session.sport !== playerObj.sport) return;

      // Skip offseason-type sessions — their notes appear on the profile
      // but must NOT contribute to the eval rating score
      const sessionType = (session.evalType || 'clinic').toLowerCase();
      if (sessionType === 'offseason') return;

      // Also skip sessions whose date falls in known offseason months
      if (session.date) {
        const sessionMonth = String(session.date).slice(0, 7); // 'YYYY-MM'
        if (OFFSEASON_MONTHS.includes(sessionMonth)) return;
      }
      const sp = (session.players || []).find(ep =>
        ep.first?.toLowerCase() === playerObj.first?.toLowerCase() &&
        ep.last?.[0]?.toUpperCase() === playerObj.last?.[0]?.toUpperCase()
      );
      if (!sp) return;

      // Use stored _overall100 first (most accurate — set by evalComputeOverall when coach saves)
      if (sp._overall100) {
        if (!best || sp._overall100 > best.score) {
          best = { score: sp._overall100, coachName: session.coachName, date: session.date, source: 'session' };
        }
        return;
      }

      // Recompute using evalComputeOverall (same formula coaches see on screen)
      const hasAnyGrade =
        Object.values(sp.grades || {}).some(v => v > 0) ||
        Object.values(sp.dayGrades || {}).some(v => v > 0) ||
        Object.values(sp.drillGrades || {}).some(dg => typeof dg === 'object' && Object.values(dg).some(v => v > 0));
      if (!hasAnyGrade) return;

      const ov = (typeof evalComputeOverall !== 'undefined')
        ? evalComputeOverall(playerObj, sp)
        : (() => {
            // Minimal fallback matching evalComputeOverall's dayGrades path
            const dg = sp.dayGrades || {};
            const dgVals = Object.values(dg).filter(v => v > 0);
            if (dgVals.length) {
              const dayAvg = dgVals.reduce((a,b)=>a+b,0) / dgVals.length;
              const dayAvg10 = (dayAvg - 1) / 4 * 9 + 1;
              const raw = ((dayAvg10 - 1) / 9) * 50 + 48;
              return { score: Math.min(99, Math.max(48, Math.round(raw))) };
            }
            // Legacy grades fallback — use same scale as evalComputeOverall
            const cats = ['hitting','fielding','pitching','speed','arm','athleticism','clutch','coachability'];
            const weights = [0.22,0.18,0.16,0.12,0.08,0.10,0.08,0.06];
            let wSum = 0, wTot = 0;
            cats.forEach((c,i) => { const v = sp.grades?.[c] || 0; if (v) { wSum += v*weights[i]; wTot += weights[i]; } });
            if (!wTot) return null;
            const avg = wSum / wTot;
            const raw = ((avg - 1) / 9) * 50 + 48;
            return { score: Math.min(99, Math.max(48, Math.round(raw))) };
          })();

      if (ov?.score && (!best || ov.score > best.score)) {
        best = { score: ov.score, coachName: session.coachName, date: session.date, source: 'session' };
      }
    });
    return best;
  } catch { return null; }
}

// ── Card data registry — avoids passing complex data in HTML onclick attrs ──
var _draftCardRegistry = {};

function draftPlayerCard(p, isDrafted) {
  const _draftStatsOn = typeof canShowStats === 'function' ? canShowStats() : true;
  const team      = isDrafted && p.teamIdx >= 0 ? DRAFT.teams[p.teamIdx] : null;
  const teamColor = team ? team.color : '#475569';
  const teamName  = team ? team.name : (p.preAssigned ? 'Pre-Assigned' : '');
  const safeKey   = p.key.replace(/[^a-z0-9]/gi,'_');
  const cardId    = `dc_${safeKey}`;
  const isDone    = DRAFT.currentPickIdx >= DRAFT.draftOrder.length;

  // Score widget — eval/grade only, no GC stats
  const evalResult  = draftGetEvalScore(p.player);
  const evalScore   = evalResult?.score || 0;
  const evalCol     = evalScore>=88?'#10b981':evalScore>=70?'#60a5fa':evalScore>=52?'#f5a623':evalScore>=35?'#f97316':'#ef4444';
  const gradeResult = (_draftStatsOn && typeof gcPlayerGrade!=='undefined') ? gcPlayerGrade(p.player) : null;
  const rawGrade    = gradeResult?.grade || null;
  const adjGrade    = (rawGrade && p.meta.prevDivision && p.meta.division && typeof divAdjustedGrade!=='undefined')
    ? divAdjustedGrade(rawGrade, p.meta.prevDivision, p.meta.division) : rawGrade;
  const gradeMap    = {'A+':96,'A':84,'B+':72,'B':60,'C+':48,'C':36,'D':24};
  const gradeNum    = gradeResult?.score || (adjGrade ? (gradeMap[adjGrade]||0) : 0);
  const displayScore = evalScore || gradeNum;
  const scoreCol    = evalScore ? evalCol
    : adjGrade ? (adjGrade.startsWith('A')?'#10b981':adjGrade.startsWith('B')?'#60a5fa':adjGrade.startsWith('C')?'#f5a623':'#ef4444')
    : 'rgba(255,255,255,0.2)';

  // Registry entry (minimal — for pick confirmation)
  _draftCardRegistry[cardId] = {
    key: p.key, first: p.player.first, last: p.player.last,
    sport: p.player.sport||'Baseball', grade: adjGrade||'',
    evalScore, yearsInLeague: p.meta.yearsInLeague,
    positions: [], playerKey: p.key,
  };

    const draftBtn = (!isDrafted && !isDone) ?
    `<button data-dk="${p.key.replace(/"/g,'&quot;')}"
      onclick="event.stopPropagation();draftConfirmPick(this.dataset.dk);"
      style="width:100%;padding:8px;border-radius:8px;background:var(--gold);color:#000;
             border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:'Bebas Neue';letter-spacing:1px;margin-top:8px;">
      DRAFT
    </button>` : ''

  const cardClass = isDrafted ? 'draft-card draft-card-drafted' : 'draft-card draft-card-available';

  return `<div class="${cardClass}" id="${cardId}" style="padding:10px 12px;">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:15px;color:var(--text);line-height:1.2;">${p.player.first} ${p.player.last}</div>
        ${teamName ? `<div style="font-size:10px;color:${teamColor};font-weight:600;margin-top:2px;">${teamName}</div>` : ''}
      </div>
      ${(displayScore && (typeof canShowEvalData==='function' ? canShowEvalData() : false)) ?
        `<div style="font-family:'Bebas Neue';font-size:28px;color:${scoreCol};flex-shrink:0;">${displayScore}</div>` : ''}
    </div>
    ${draftBtn}
  </div>`;
}

// ── Card toggle — desktop expand / mobile bottom sheet ─────────────────────
function draftCardToggle(cardId) {
  // Cards are now name-only — no expand content. No-op.
}

// ── Mobile bottom sheet ─────────────────────────────────────────────────────
function _draftOpenSheet(cardId, reg) {
  // Remove any existing sheet
  const old = document.getElementById('draft-mobile-sheet-overlay');
  if (old) old.remove();

  // Build content — same as inline expand
  const overlay = document.createElement('div');
  overlay.id = 'draft-mobile-sheet-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.6);display:flex;flex-direction:column;justify-content:flex-end;';
  overlay.addEventListener('click', e => { if (e.target === overlay) _draftCloseSheet(); });

  // Get the player data from the card element
  const card = document.getElementById(cardId);
  const headerEl = card?.querySelector('[onclick]');
  const nameEl = card?.querySelector('[style*="font-weight:700;font-size:14px"]');
  const playerName = nameEl?.textContent?.trim() || '';

  // Render eval/activity from the already-rendered inline expand (clone its content)
  const inlineEx = document.getElementById(cardId + '_exp');
  const hasInlineContent = inlineEx && inlineEx.innerHTML.trim().length > 0;

  overlay.innerHTML = `
    <div id="draft-sheet-panel" style="
      background:#0d1f3c;border-radius:20px 20px 0 0;
      max-height:88vh;display:flex;flex-direction:column;
      border-top:1px solid rgba(255,255,255,0.12);
      box-shadow:0 -8px 40px rgba(0,0,0,0.8);
      animation:sheetSlideUp .28s cubic-bezier(.32,.72,0,1) both;">

      <!-- Handle + header -->
      <div style="padding:12px 16px 8px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div style="width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.2);margin:0 auto 12px;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-family:'Bebas Neue';font-size:20px;letter-spacing:.5px;">${playerName}</div>
          <button onclick="_draftCloseSheet()" style="background:rgba(255,255,255,.08);border:none;color:var(--text2);cursor:pointer;width:30px;height:30px;border-radius:50%;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
      </div>

      <!-- Scrollable content -->
      <div style="overflow-y:auto;flex:1;padding:14px 16px 24px;-webkit-overflow-scrolling:touch;">
        <div id="draft-sheet-content-${cardId}">
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:24px 0;color:var(--text2);">
            <div style="width:18px;height:18px;border:2px solid rgba(96,165,250,0.3);border-top-color:#60a5fa;border-radius:50%;animation:spin .7s linear infinite;"></div>
            <span style="font-size:12px;">Loading…</span>
          </div>
        </div>

        <!-- Big action buttons always at bottom -->
        <div id="draft-sheet-actions-${cardId}" style="display:flex;gap:10px;margin-top:16px;"></div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Populate content asynchronously
  setTimeout(() => _draftPopulateSheet(cardId, reg), 50);
}

function _draftCloseSheet() {
  const overlay = document.getElementById('draft-mobile-sheet-overlay');
  if (!overlay) return;
  const panel = document.getElementById('draft-sheet-panel');
  if (panel) {
    panel.style.animation = 'sheetSlideDown .22s cubic-bezier(.32,.72,0,1) both';
    setTimeout(() => overlay.remove(), 200);
  } else {
    overlay.remove();
  }
}

function _draftPopulateSheet(cardId, reg) {
  const contentEl = document.getElementById(`draft-sheet-content-${cardId}`);
  const actionsEl = document.getElementById(`draft-sheet-actions-${cardId}`);
  if (!contentEl) return;

  // Render stats plot into sheet
  const isDone = typeof DRAFT !== 'undefined' && DRAFT.currentPickIdx >= DRAFT.draftOrder.length;
  const hasStats = typeof gcLookup === 'function' && gcLookup({ first: reg.first, last: reg.last }).length > 0;

  // Build sheet inner content
  let html = '';

  // Eval + activity + category bars from stored registry data
  // Stats, activity, eval bars all hidden per showPlayerStats setting

  // Render a canvas for the stats chart
  html += `<canvas id="sheet_${cardId}_chart" style="width:100%;display:block;margin-bottom:2px;"></canvas>`;
  html += `<div id="sheet_${cardId}_chartLabel" style="font-size:10px;color:rgba(255,255,255,0.3);text-align:right;margin-bottom:12px;"></div>`;

  // Career block
  html += `<div id="sheet_${cardId}_career" style="margin-bottom:12px;"></div>`;

  contentEl.innerHTML = html;

  // Render charts using existing functions with sheet canvas IDs
  _draftRenderSheetChart(cardId, reg);
  _draftRenderCareerInto(`sheet_${cardId}_career`, reg);

  // Action buttons
  if (actionsEl) {
    const first = (reg.first || '').replace(/'/g, "\\'");
    const last  = (reg.last  || '').replace(/'/g, "\\'");
    const safeKey = reg.playerKey || '';
    actionsEl.innerHTML = `
      ${hasStats ? `<button onclick="_draftCloseSheet();showPlayerStats('${first}','${last}',{fromDraft:true})" style="flex:1;padding:14px;border-radius:12px;background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.3);color:var(--gold);font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans';">📊 Stats</button>` : ''}
      ${!isDone ? `<button data-dk="${p.key.replace(/"/g,'&quot;')}" onclick="_draftCloseSheet();draftConfirmPick(this.dataset.dk);" style="flex:2;padding:14px;border-radius:12px;background:var(--gold);color:#000;border:none;font-size:15px;font-weight:700;cursor:pointer;font-family:'Bebas Neue';letter-spacing:1px;">DRAFT</button>` : ''}`;
  }
}

function _draftRenderSheetChart(cardId, reg) {
  // Re-use draftRenderStatPlot but targeting the sheet canvas
  const canvas = document.getElementById(`sheet_${cardId}_chart`);
  if (!canvas || !reg.lastYearRec) { if (canvas) canvas.style.display='none'; return; }

  // Temporarily swap canvas ID so draftRenderStatPlot targets sheet canvas
  const origId = canvas.id;
  const fakeCardId = `sheet_${cardId}`;
  // Map fake card ID to same registry entry
  _draftCardRegistry[fakeCardId] = reg;
  draftRenderStatPlot(fakeCardId, reg);
}

function _draftRenderCareerInto(elId, reg) {
  const el = document.getElementById(elId);
  if (!el) return;
  _draftRenderCareer(null, reg, el);
}

// ── Rank scatter chart ────────────────────────────────────────────────────
function draftRenderStatPlot(cardId, reg) {
  const el = document.getElementById(cardId + '_plot');
  if (el) el.innerHTML = '';

  const canvas = document.getElementById(cardId + '_chart');

  // Rankings/comparisons hidden unless admin or flag enabled
  if (typeof canShowRankings === 'function' && !canShowRankings()) {
    if (canvas) canvas.style.display = 'none';
    return;
  }

  if (!canvas || !reg.lastYearRec) {
    if (canvas) canvas.style.display = 'none';
    return;
  }

  const myRec = reg.lastYearRec;
  const myBat = myRec.batting  || {};
  const myPit = myRec.pitching || {};
  const isPitcher = parseFloat(myPit.ip_dec||0) > 2;

  if (typeof gcLookupYear === 'undefined') { canvas.style.display='none'; return; }

  const allPlayers = DRAFT.allPlayers;
  const myKey  = reg.key;
  const myYear = myRec.year;
  const myTeam = (myRec.team || '').toLowerCase();

  // Level key — extract division label so we only compare same level players
  function _draftLvl(teamName) {
    const t = (teamName || '').toLowerCase();
    if (t.includes('minors black')) return 'minors black';
    if (t.includes('minors blue'))  return 'minors blue';
    if (t.includes('minors'))       return 'minors';
    if (t.includes('majors b'))     return 'majors b';
    if (t.includes('majors'))       return 'majors';
    if (t.includes('select'))       return 'select';
    if (t.includes('rookie'))       return 'rookie';
    if (t.includes('leominster'))   return 'leominster';
    if (t.includes('lunenburg'))    return 'lunenburg';
    return t.split(' ').slice(0, 2).join(' ');
  }
  const myLvl = _draftLvl(myTeam);

  const poolFor = (fn) => {
    const pts = [];
    allPlayers.forEach(dp => {
      const recs = gcLookupYear(dp.player).sort((a,b)=>b.year-a.year);
      if (!recs[0]) return;
      // Only include players whose most recent stat record is same level + same year
      const r = recs[0];
      if (r.year !== myYear || _draftLvl(r.team) !== myLvl) return;
      const v = fn(r);
      if (v > 0) pts.push({ key: dp.key, val: v, drafted: dp.teamIdx >= 0 });
    });
    return pts.sort((a,b) => b.val - a.val);
  };

  const metrics = [];

  // ── Pitching: ERA, FIP, K/BB ─────────────────────────────────────
  if (isPitcher) {
    // ERA (lower = better)
    const eraPool = poolFor(r => {
      const ip = parseFloat(r.pitching?.ip_dec||0);
      const era = parseFloat(r.pitching?.era||0);
      return ip >= 3 && era > 0 ? era : 0;
    }).sort((a,b) => a.val - b.val);
    const myERA = parseFloat(myPit.era||0);
    if (eraPool.length > 1 && myERA > 0)
      metrics.push({ label:'ERA', pool: eraPool, myVal: myERA, fmt: v => v.toFixed(2), lowerBetter: true });

    // FIP (lower = better)
    const fipPool = poolFor(r => {
      const ip = parseFloat(r.pitching?.ip_dec||0);
      if (ip < 3) return 0;
      const fip = (13*(r.pitching?.hr||0) + 3*(r.pitching?.bb||0) - 2*(r.pitching?.so||0)) / ip + 3.10;
      return fip > 0 ? fip : 0;
    }).sort((a,b) => a.val - b.val);
    const myFIP = parseFloat(myPit.ip_dec||0) >= 3
      ? (13*(myPit.hr||0) + 3*(myPit.bb||0) - 2*(myPit.so||0)) / parseFloat(myPit.ip_dec) + 3.10
      : 0;
    if (fipPool.length > 1 && myFIP > 0)
      metrics.push({ label:'FIP', pool: fipPool, myVal: myFIP, fmt: v => v.toFixed(2), lowerBetter: true });

    // K/BB — strikeouts per walk (higher = better command)
    const kbbPool = poolFor(r => {
      const ip = parseFloat(r.pitching?.ip_dec||0);
      if (ip < 3) return 0;
      const bb = r.pitching?.bb||0;
      const k  = r.pitching?.so||0;
      return bb > 0 ? Math.round((k/bb)*100)/100 : (k > 0 ? 9.99 : 0);
    });
    const myKBB = (myPit.bb||0) > 0 ? Math.round(((myPit.so||0)/(myPit.bb||1))*100)/100
                : (myPit.so||0) > 0 ? 9.99 : 0;
    if (kbbPool.length > 1 && myKBB > 0)
      metrics.push({ label:'K/BB', pool: kbbPool, myVal: myKBB, fmt: v => v === 9.99 ? '∞' : v.toFixed(2) });
  }

  // ── Hitting: OBP, RBI, H/10AB ────────────────────────────────────
  const ab = parseInt(myBat.ab||0);
  if (ab >= 5) {
    // OBP
    const obpPool = poolFor(r => parseFloat(r.batting?.obp)||0);
    const myOBP = parseFloat(myBat.obp||0);
    if (obpPool.length > 1 && myOBP > 0)
      metrics.push({ label:'OBP', pool: obpPool, myVal: myOBP, fmt: v => '.'+String(Math.round(v*1000)).padStart(3,'0') });

    // RBI
    const rbiPool = poolFor(r => parseInt(r.batting?.rbi||0));
    const myRBI = parseInt(myBat.rbi||0);
    if (rbiPool.length > 1 && myRBI > 0)
      metrics.push({ label:'RBI', pool: rbiPool, myVal: myRBI, fmt: v => Math.round(v) });

    // H per 10 AB
    const hPer10Pool = poolFor(r => {
      const a = parseInt(r.batting?.ab||0);
      const h = parseInt(r.batting?.h||0);
      return a >= 5 ? Math.round((h/a)*100)/10 : 0;
    });
    const myH10 = Math.round((parseInt(myBat.h||0)/ab)*100)/10;
    if (hPer10Pool.length > 1 && myH10 > 0)
      metrics.push({ label:'H/10AB', pool: hPer10Pool, myVal: myH10, fmt: v => v.toFixed(1) });
  }

  if (!metrics.length) { canvas.style.display='none'; return; }

  // Determine league context label from the player's record
  const leagueLabel = (() => {
    const team = myRec.team || '';
    const year = myRec.year || '';
    // Extract division keyword from team name
    if (/major/i.test(team)) return `${year} Majors`;
    if (/minor/i.test(team)) return `${year} Minors`;
    if (/rookie/i.test(team)) return `${year} Rookies`;
    if (/select/i.test(team)) return `${year} Select`;
    if (/farm/i.test(team)) return `${year} Farm`;
    return year ? `${year}` : '';
  })();

  // Populate the league label element — count same-level players with stats
  const labelEl = document.getElementById(cardId + '_chartLabel');
  if (labelEl && leagueLabel) {
    const sameLevelCount = DRAFT.allPlayers.filter(dp => {
      const recs = (typeof gcLookupYear !== 'undefined') ? gcLookupYear(dp.player).sort((a,b)=>b.year-a.year) : [];
      const r = recs[0];
      return r && r.year === myRec.year && _draftLvl(r.team) === myLvl;
    }).length;
    labelEl.textContent = `${leagueLabel} · vs. ${sameLevelCount} same-level players`;
  }

  // Show up to 6 metrics in 2 columns (3 rows each) — or 3 in a single column
  const shown = metrics.slice(0, 6);
  const twoCol = shown.length > 3;
  const rows = twoCol ? 3 : shown.length;
  canvas.style.display = 'block';

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 280;
  const H   = rows * 34 + 8; // 34px per row — more breathing room on desktop
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Two-column: left = first 3, right = next 3
  // Single column: all rows left-aligned
  const colW = twoCol ? Math.floor(W / 2) : W;
  const padL = 40, padR = twoCol ? 8 : 12, padT = 16, padB = 8;
  const chartW = colW - padL - padR;
  const rowH   = (H - padT - padB) / rows;

  // Add divider between columns
  if (twoCol) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(colW, 0); ctx.lineTo(colW, H); ctx.stroke();
  }

  shown.forEach((m, idx) => {
    const col = twoCol && idx >= 3 ? 1 : 0;
    const rowIdx = twoCol && idx >= 3 ? idx - 3 : idx;
    const xOff = col * colW;
    const n = m.pool.length;
    const y = padT + rowIdx * rowH + rowH / 2;
    const rowIdx_used = rowIdx; // keep for closure

    // Track line
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xOff + padL, y);
    ctx.lineTo(xOff + padL + chartW, y);
    ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 10px -apple-system,sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.label, xOff + padL - 6, y);

    // Other dots
    m.pool.forEach((pt, rank) => {
      if (pt.key === myKey) return;
      const x = xOff + padL + (rank / Math.max(1, n - 1)) * chartW;
      ctx.beginPath();
      ctx.arc(x, y, pt.drafted ? 3 : 4, 0, Math.PI * 2);
      ctx.fillStyle = pt.drafted ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)';
      ctx.fill();
    });

    // My dot
    const myRank = m.pool.findIndex(pt => pt.key === myKey);
    if (myRank >= 0) {
      const x = xOff + padL + (myRank / Math.max(1, n - 1)) * chartW;
      const pct = 1 - myRank / Math.max(1, n - 1);
      const dotCol = pct >= 0.75 ? '#10b981' : pct >= 0.5 ? '#60a5fa' : pct >= 0.25 ? '#f5a623' : '#ef4444';

      ctx.shadowColor = dotCol; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = dotCol; ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = 'bold 10px -apple-system,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = dotCol;
      ctx.fillText('#' + (myRank + 1), x, y - 9);

      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '9px -apple-system,sans-serif';
      ctx.fillText(m.fmt(m.myVal), x, y + 9);
    }
  });

  // (Direction hints removed — league label shown in external div below canvas)

}


// ── AI scouting report loader ──────────────────────────────────────────────
var _draftAICache = {};
async function _draftLoadAI(cardId, reg) {
  const { first, last, sport, grade, evalScore, yearsInLeague,
          catRatings, rank, totalRanked, truePickNum, positions } = reg;
  const cacheKey = `${first}|${last}|${sport}|${evalScore}`;
  const el = document.getElementById(`${cardId}_ai`);
  if (!el) return;
  if (_draftAICache[cacheKey]) { el.innerHTML = _draftAICache[cacheKey]; return; }

  const loadingHtml = `
    <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:6px;">🤖 AI Scouting Report</div>
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
      <div style="width:16px;height:16px;border:2px solid rgba(96,165,250,0.3);border-top-color:#60a5fa;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0;"></div>
      <div style="font-size:11px;color:var(--text2);">Generating scouting report…</div>
    </div>`;
  el.innerHTML = loadingHtml;

  try {
    // Build eval breakdown string
    const evalCatsStr = catRatings && catRatings.length
      ? catRatings.map(c => `${c.label}: ${c.val}/5`).join(', ')
      : null;
    const posStr = positions && positions.length ? positions.join(', ') : null;
    const _showRankAI = typeof canShowRankings === 'function' ? canShowRankings() : true;
    const rankStr = (_showRankAI && rank && totalRanked) ? `#${rank} of ${totalRanked} available players` : null;
    const preAssignedNote = truePickNum > (DRAFT.currentPickIdx + 1)
      ? `Note: ${truePickNum - (DRAFT.currentPickIdx + 1)} players were pre-assigned (select team + coaches kids) before this draft started.` : '';

    const prompt = `You are a concise youth baseball/softball draft scout. Write a brief scouting card.

PLAYER: ${first} ${last}
Sport: ${sport}
${evalScore ? `Eval score: ${evalScore}/100.` : ''}${grade ? ` Stat grade: ${grade}.` : ''}
${evalCatsStr ? `Eval breakdown — ${evalCatsStr}.` : ''}

Write TWO short paragraphs, plain text only, no headers, no bullets, no markdown:
Paragraph 1 (1–2 sentences): Player overview — what they bring, standout skills from the eval data above.
Paragraph 2 (1 sentence): Bold season prediction. Be specific and optimistic but honest.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    const text = (data.content || []).map(c => c.text || '').join('').trim();
    const parts = text.split(/\n\n+/).filter(Boolean);

    // Rank badge
    const rankBadge = rankStr
      ? `<div style="display:inline-flex;align-items:center;gap:5px;background:rgba(245,166,35,0.1);
           border:1px solid rgba(245,166,35,0.3);border-radius:6px;padding:3px 8px;margin-bottom:8px;">
           <span style="font-size:10px;font-weight:700;color:var(--gold);">📊 ${rankStr}</span>
         </div>` : '';

    // Position pills
    const posPills = posStr
      ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
           ${positions.map(pos => `<span style="font-size:10px;padding:2px 7px;border-radius:4px;
             background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.25);color:#93c5fd;">${pos}</span>`).join('')}
         </div>` : '';

    const overviewHtml = parts[0]
      ? `<div style="font-size:12px;color:var(--text);line-height:1.55;margin-bottom:8px;">${parts[0]}</div>` : '';
    const predHtml = parts[1]
      ? `<div style="display:flex;align-items:flex-start;gap:6px;padding:7px 9px;border-radius:6px;
           background:rgba(96,165,250,0.07);border:1px solid rgba(96,165,250,0.2);">
           <span style="font-size:13px;flex-shrink:0;">🔭</span>
           <div style="font-size:11px;color:#93c5fd;line-height:1.45;">${parts[1]}</div>
         </div>` : '';

    const html = `
      <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:8px;">🤖 AI Scouting Report</div>
      ${rankBadge}${posPills}${overviewHtml}${predHtml}`;

    _draftAICache[cacheKey] = html;
    if (el) el.innerHTML = html;

  } catch(e) {
    if (el) el.innerHTML = `
      <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:6px;">🤖 AI Scouting Report</div>
      <div style="font-size:11px;color:var(--text2);">Could not load — check connection.</div>`;
  }
}


// ── PLAYER COMPARISON ─────────────────────────────────────────────────────

// ── Team/division tier classifier ─────────────────────────────────────────
// Returns a numeric tier for apples-to-apples stat comparison.
// Lower = younger/easier; higher = older/harder.
function _draftTeamTier(team) {
  if (!team) return 99;
  const t = team.toLowerCase();
  if (t.includes('select'))                                         return 5; // Majors A / Select travel
  if (t.includes('leominster majors') || t.match(/\bmajors\s*b\b/)) return 4; // Majors B
  if (t.match(/\bmajors\b/))                                        return 4; // generic Majors
  if (t.includes('minors'))                                         return 3; // Minors Blue / Black
  if (t.includes('braves') || t.includes('giants') || t.includes('lunenburg giants')) return 3; // historic Minors names
  if (t.includes('rookie'))                                         return 2;
  if (t.includes('farm'))                                           return 1;
  if (t.includes('t-ball') || t.includes('tball'))                  return 0;
  return 3; // default: assume Minors level
}

// Tier label used in the UI
function _draftTierLabel(tier) {
  return ['T-Ball','Farm','Rookies','Minors','Majors B','Majors A (Select)'][tier] ?? 'League';
}

// Human-readable division name that clarifies Majors A (Select) vs Majors B
function _draftDivisionDisplayName(division) {
  if (!division) return '—';
  const d = division.toLowerCase();
  if (d.includes('select') || d.includes('majors a')) return 'Majors A (Select)';
  if (d.includes('majors')) return 'Majors B';
  return division;
}

// For a set of records, pick the best record at or near a target tier.
// Prefers exact match; falls back to closest below-tier; finally most recent.
function _draftPickRecAtTier(recs, targetTier) {
  if (!recs.length) return null;
  const withTier = recs.map(r => ({ r, tier: _draftTeamTier(r.team) }));
  // Exact match
  const exact = withTier.filter(x => x.tier === targetTier);
  if (exact.length) return exact.sort((a,b) => (b.r.year||0)-(a.r.year||0))[0].r;
  // Closest below (less competitive — still comparable)
  const below = withTier.filter(x => x.tier < targetTier).sort((a,b) => b.tier-a.tier);
  if (below.length) return below[0].r;
  // Closest above
  const above = withTier.filter(x => x.tier > targetTier).sort((a,b) => a.tier-b.tier);
  if (above.length) return above[0].r;
  // Most recent
  return recs.sort((a,b) => (b.year||0)-(a.year||0))[0];
}

function _draftComputeEdges(pData) {
  const scores = pData.map(d => {
    let total = 0;
    const ab  = parseInt(d.bat.ab||0);
    const gp  = parseInt(d.bat.gp||1)||1;
    const ip  = parseFloat(d.pit.ip_dec||0);

    // ── Eval score (highest priority — coach eyeball) ────────────
    if (d.evalScore) total += d.evalScore * 0.50; // max 50 pts

    // ── Eval category skills ─────────────────────────────────────
    const catSum = d.cats.reduce((s,c)=>s+c.val, 0);
    if (catSum) total += catSum * 2; // max ~50 pts for 5 cats rated 5

    // ── Pitching (ERA + FIP + K/IP + volume) ─────────────────────
    if (ip >= 3) {
      const era   = parseFloat(d.pit.era)||9.99;
      const so    = d.pit.so||0;
      const bb    = d.pit.bb||0;
      const hr    = d.pit.hr||0;
      const fip   = (13*hr + 3*bb - 2*so) / ip + 3.10;
      const kPerIP= so / ip;

      // ERA: 1=great, 10+=poor → 0-15 pts
      total += Math.max(0, Math.min((10 - era) / 9, 1)) * 15;
      // FIP: 1=great, 6+=poor → 0-15 pts
      total += Math.max(0, Math.min((6 - fip) / 5, 1)) * 15;
      // K/IP: 3.5=elite → 0-10 pts
      total += Math.min(kPerIP / 3.5, 1) * 10;
      // IP volume: 20+ = full credit → 0-5 pts
      total += Math.min(ip / 20, 1) * 5;
    }

    // ── Hitting ───────────────────────────────────────────────────
    if (ab >= 5) {
      const avg  = parseFloat(d.bat.avg)||0;
      const ops  = parseFloat(d.bat.ops)||0;
      const rbi  = d.bat.rbi||0;
      const sb   = d.bat.sb||0;

      // AVG most meaningful in youth (small ball) → 0-25 pts
      total += Math.max(0, Math.min((avg - 0.150) / 0.500, 1)) * 25;
      // OPS adds power/OBP context but not dominant → 0-12 pts
      total += Math.max(0, Math.min((ops - 0.400) / 1.100, 1)) * 12;
      // SB per game — speed/small-ball premium → 0-10 pts
      total += Math.min((sb/gp) / 2.0, 1) * 10;
      // RBI per game — run production → 0-10 pts
      total += Math.min((rbi/gp) / 1.5, 1) * 10;
    }

    // ── Experience + activity ─────────────────────────────────────
    total += d.years * 1.5;
    if (d.p.player.pitching) total += 5;
    if (d.p.player.catching) total += 4;
    if (d.actScore) total += d.actScore * 1.2;

    return { key: d.p.key, total, d };
  });

  scores.sort((a,b) => b.total - a.total);
  const winner = scores[0];
  const winD = winner.d;

  // Build explanation
  const name = `${winD.p.player.first} ${winD.p.player.last}`;
  const reasons = [];

  // Eval advantage
  const evalAdvantage = winD.evalScore && scores.slice(1).every(s=>s.d.evalScore < winD.evalScore);
  if (winD.evalScore && evalAdvantage) {
    reasons.push(`highest eval score (${winD.evalScore}) — reflecting coach assessment across key skills`);
  } else if (winD.evalScore) {
    reasons.push(`strong eval score of ${winD.evalScore}`);
  }

  // Top skill categories
  const topCats = winD.cats.filter(c => {
    return scores.slice(1).every(s => (s.d.cats.find(x=>x.id===c.id)?.val||0) <= c.val);
  });
  if (topCats.length) {
    reasons.push(`leads in ${topCats.map(c=>c.label.toLowerCase()).slice(0,2).join(' and ')}`);
  }

  // Stats
  const allOps = scores.map(s=>parseFloat(s.d.bat.ops)||0);
  const allAvg = scores.map(s=>parseFloat(s.d.bat.avg)||0);
  const allSB  = scores.map(s=>s.d.bat.sb||0);
  const allRBI = scores.map(s=>s.d.bat.rbi||0);
  const allIP  = scores.map(s=>parseFloat(s.d.pit.ip_dec)||0);
  const bestIP = Math.max(...allIP);

  if (parseFloat(winD.bat.avg)>0 && parseFloat(winD.bat.avg)===Math.max(...allAvg)) {
    reasons.push(`top AVG (${winD.bat.avg})`);
  }
  if ((winD.bat.sb||0)===Math.max(...allSB) && (winD.bat.sb||0)>5) {
    reasons.push(`most stolen bases (${winD.bat.sb})`);
  }
  if ((winD.bat.rbi||0)===Math.max(...allRBI) && (winD.bat.rbi||0)>0) {
    reasons.push(`most RBI (${winD.bat.rbi})`);
  }
  if (parseFloat(winD.bat.ops)>0 && parseFloat(winD.bat.ops)===Math.max(...allOps)) {
    reasons.push(`best OPS (${winD.bat.ops})`);
  }
  // Pitching edge
  const winIP = parseFloat(winD.pit.ip_dec)||0;
  if (winIP >= 3 && winIP === bestIP) {
    const fipWin = ((13*(winD.pit.hr||0) + 3*(winD.pit.bb||0) - 2*(winD.pit.so||0)) / winIP + 3.10).toFixed(2);
    const otherFIPs = scores.slice(1).map(s => {
      const ip2 = parseFloat(s.d.pit.ip_dec)||0;
      return ip2>=1 ? (13*(s.d.pit.hr||0)+3*(s.d.pit.bb||0)-2*(s.d.pit.so||0))/ip2+3.10 : 99;
    });
    if (parseFloat(fipWin) < Math.min(...otherFIPs)) {
      reasons.push(`best FIP (${fipWin}) — most efficient pitcher`);
    } else {
      reasons.push(`most innings pitched (${winD.pit.ip}) with ERA ${winD.pit.era}`);
    }
  } else if (winD.p.player.pitching && !scores.slice(1).every(s=>s.d.p.player.pitching)) {
    reasons.push(`brings pitching experience`);
  }
  if (winD.years === Math.max(...scores.map(s=>s.d.years)) && winD.years > 1) {
    reasons.push(`most experienced (${winD.years} seasons)`);
  }
  if (winD.actTots?.events > 0 && scores.slice(1).every(s=>s.d.actScore<=winD.actScore)) {
    const parts = [
      winD.actTots.seasons>0 ? winD.actTots.seasons+' off-season program'+(winD.actTots.seasons!==1?'s':'') : null,
      winD.actTots.lgClinics>0 ? winD.actTots.lgClinics+' league clinic'+(winD.actTots.lgClinics!==1?'s':'') : null,
      winD.actTots.ptClinics>0 ? winD.actTots.ptClinics+' pitching clinic'+(winD.actTots.ptClinics!==1?'s':'') : null,
    ].filter(Boolean);
    if (parts.length) reasons.push(`most off-season investment (${parts.join(', ')})`);
  }

  const explanation = reasons.length
    ? `<strong style="color:var(--gold);">${name}</strong> has the edge — ${reasons.join(', ')}. ${
        scores.length > 1
          ? `<span style="color:var(--text2);">Runner-up: ${scores[1].d.p.player.first} ${scores[1].d.p.player.last}${scores[1].d.evalScore ? ` (eval ${scores[1].d.evalScore})` : ''}.</span>`
          : ''}`
    : `<strong style="color:var(--gold);">${name}</strong> has the edge based on overall profile.`;

  return { overall: winner.key, explanation };
}

function renderDraftRosters() {
  const el = document.getElementById('draftRosters');
  if (!el) return;
  el.innerHTML = DRAFT.teams.map((t, i) => {
    const teamPlayers = DRAFT.allPlayers.filter(p => p.teamIdx === i);
    return `<div class="draft-roster-card" style="border-top:3px solid ${t.color};${t.locked?'background:rgba(245,166,35,0.04);':'' }">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <div style="width:10px;height:10px;border-radius:50%;background:${t.color};"></div>
        <div style="font-family:'Bebas Neue';font-size:16px;">${t.name}</div>
        ${t.locked ? '<span style="font-size:9px;color:var(--gold);background:rgba(245,166,35,0.15);border-radius:4px;padding:1px 5px;font-weight:700;">🔒 LOCKED</span>' : ''}
        <div style="margin-left:auto;font-size:11px;color:var(--text2);">${teamPlayers.length} players</div>
      </div>
      ${t.coach ? `<div style="font-size:11px;color:var(--text2);margin-bottom:2px;">👤 ${t.coach}</div>` : ''}
      ${(t.assistants||[]).filter(a=>a.trim()).map(a=>`<div style="font-size:11px;color:var(--text2);margin-bottom:2px;padding-left:14px;">🤝 ${a}</div>`).join('')}
      ${(t.coach || (t.assistants||[]).some(a=>a.trim())) ? '<div style="height:6px;"></div>' : ''}
      <div style="display:flex;flex-direction:column;gap:3px;">
        ${teamPlayers.map(p => `
          <div style="font-size:12px;padding:4px 6px;border-radius:5px;background:${t.color}18;display:flex;align-items:center;gap:4px;">
            <span>${p.player.first} ${p.player.last}</span>
            ${p.preAssigned ? `<span style="font-size:9px;color:var(--gold);margin-left:auto;">pre</span>` : ''}
          </div>`).join('')}
        ${teamPlayers.length===0?`<div style="color:var(--text2);font-size:11px;font-style:italic;">No players yet</div>`:''}
      </div>
    </div>`;
  }).join('');
}


// ── CONFIRM PICK ──────────────────────────────────────────

function draftConfirmPick(playerKey) {
  if (DRAFT.currentPickIdx >= DRAFT.draftOrder.length) return;
  const pObj = DRAFT.allPlayers.find(x => x.key === playerKey);
  if (!pObj || pObj.teamIdx >= 0) return;

  DRAFT.pendingPick = playerKey;
  const teamIdx = DRAFT.draftOrder[DRAFT.currentPickIdx];
  const team = DRAFT.teams[teamIdx];
  const { isReturning, yearsInLeague, prevDivision } = pObj.meta;

  document.getElementById('draftConfirmTeamName').textContent = team.name;
  document.getElementById('draftConfirmTeamName').style.background = team.color;
  document.getElementById('draftConfirmPlayerName').textContent = `${pObj.player.first} ${pObj.player.last}`;
  document.getElementById('draftConfirmBadges').innerHTML = '';
  openModal('draftConfirmModal');
}

function draftExecutePick() {
  const playerKey = DRAFT.pendingPick;
  if (!playerKey) return;
  const teamIdx = DRAFT.draftOrder[DRAFT.currentPickIdx];
  const pObj = DRAFT.allPlayers.find(x => x.key === playerKey);
  if (!pObj) return;

  const secs = DRAFT.timerSecs;
  pObj.teamIdx = teamIdx;
  DRAFT.teams[teamIdx].players.push(playerKey);
  DRAFT.pickHistory.push({
    playerKey, teamIdx,
    round: Math.floor(DRAFT.currentPickIdx / DRAFT.teams.length) + 1,
    pick: DRAFT.currentPickIdx + 1, secs
  });
  DRAFT.currentPickIdx++;
  DRAFT.pendingPick = null;
  closeModal('draftConfirmModal');
  saveDraftState();

  // 🎵 Play draft pick sound + show announcement banner
  if (typeof showDraftBanner !== 'undefined') showDraftBanner(pObj, teamIdx);
  // Also broadcast pick to TV display
  const _tvRound2 = Math.floor((DRAFT.currentPickIdx - 1) / Math.max(1, DRAFT.teams.length)) + 1;
  _tvBroadcastPick(playerKey, teamIdx, DRAFT.currentPickIdx, _tvRound2);

  // Reset timer for next pick
  DRAFT.timerSecs = 0;
  if (document.getElementById('draftTimerDisplay')) {
    document.getElementById('draftTimerDisplay').textContent = '0:00';
  }

  // Check if all available players are drafted
  const stillAvailable = DRAFT.allPlayers.filter(p => p.teamIdx === -1).length;
  if (stillAvailable === 0 || DRAFT.currentPickIdx >= DRAFT.draftOrder.length) {
    completeDraft();
    return;
  }

  renderDraftBoard();
  toast(`Pick confirmed! ${DRAFT.teams[teamIdx].name} selects ${pObj.player.first} ${pObj.player.last}`);
}

function draftSkipPlayer() {
  // Move to next pick without selecting
  DRAFT.currentPickIdx++;
  DRAFT.timerSecs = 0;
  closeModal('draftConfirmModal');
  renderDraftBoard();
}

function draftUndoPick() {
  if (!DRAFT.pickHistory.length) { toast('No picks to undo', 'error'); return; }
  const last = DRAFT.pickHistory[DRAFT.pickHistory.length - 1];
  const pObj = DRAFT.allPlayers.find(x => x.key === last.playerKey);
  if (!pObj) return;

  // Revert player assignment
  pObj.teamIdx = -1;
  pObj.preAssigned = false;

  // Remove from team players list
  const team = DRAFT.teams[last.teamIdx];
  if (team?.players) team.players = team.players.filter(k => k !== last.playerKey);

  // Roll back history and pick index
  DRAFT.pickHistory.pop();
  DRAFT.currentPickIdx = Math.max(0, DRAFT.currentPickIdx - 1);
  DRAFT.pendingPick = null;

  // If draft was marked complete, reopen it
  if (DRAFT.phase === 'complete') {
    DRAFT.phase = 'draft';
    showDraftPhase('draft');
  }

  DRAFT.timerSecs = 0;
  saveDraftState();
  renderDraftBoard();
  toast('\u21a9 Undid pick: ' + pObj.player.first + ' ' + pObj.player.last + ' returned to available');
}

// ── TIMER ─────────────────────────────────────────────────

function startPickTimer() {
  clearInterval(DRAFT.timerInterval);
  DRAFT.timerSecs = 0;
  DRAFT.timerInterval = setInterval(() => {
    DRAFT.timerSecs++;
    const el = document.getElementById('draftTimerDisplay');
    if (el) el.textContent = draftTimerFmt(DRAFT.timerSecs);
  }, 1000);
}

function stopPickTimer() {
  clearInterval(DRAFT.timerInterval);
}

// ── COMPLETE ──────────────────────────────────────────────

function completeDraft() {
  stopPickTimer();
  DRAFT.phase = 'complete';

  // Draft is done — safe to close the tab now, remove the close guard
  if (window._draftCloseGuard) {
    window.removeEventListener('beforeunload', window._draftCloseGuard);
    window._draftCloseGuard = null;
  }
  clearInterval(window._draftAutoSaveInterval);

  // Final save
  saveDraftState();

  showDraftPhase('complete');
  renderDraftResults();
}

function renderDraftResults() {
  // Rosters
  let rostersHtml = DRAFT.teams.map(t => {
    const teamPlayers = DRAFT.allPlayers.filter(p => p.teamIdx === DRAFT.teams.indexOf(t));
    return `<div class="draft-result-roster" style="border-top:3px solid ${t.color};">
      <div style="font-family:'Bebas Neue';font-size:20px;margin-bottom:4px;">${t.name}${t.locked?' <span style="font-size:11px;color:var(--gold);font-family:\'DM Sans\';font-weight:700;">🔒 Locked</span>':''}</div>
      ${t.coach ? `<div style="font-size:12px;color:var(--text2);margin-bottom:2px;">Head Coach: ${t.coach}</div>` : ''}
      ${(t.assistants||[]).filter(a=>a.trim()).map(a=>`<div style="font-size:12px;color:var(--text2);margin-bottom:2px;padding-left:12px;">Asst: ${a}</div>`).join('')}
      ${(t.coach || (t.assistants||[]).some(a=>a.trim())) ? '<div style="height:8px;"></div>' : ''}
      <div style="display:flex;flex-direction:column;gap:3px;">
        ${teamPlayers.map(p => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;background:${t.color}15;font-size:13px;">
            <span style="font-weight:600;">${p.player.first} ${p.player.last}</span>
            
          </div>`).join('')}
        ${teamPlayers.length===0?`<div style="color:var(--text2);font-size:12px;font-style:italic;">No players drafted</div>`:''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('draftResultRosters').innerHTML = rostersHtml;

  // Stats
  const totalPicks = DRAFT.pickHistory.length;
  const avgSecs = totalPicks ? Math.round(DRAFT.pickHistory.reduce((s,p)=>s+p.secs,0)/totalPicks) : 0;
  document.getElementById('draftResultStats').innerHTML = `
    <div class="info-row"><span class="ir-label">Total Players Drafted</span><span class="ir-val">${DRAFT.allPlayers.filter(p=>p.teamIdx>=0).length}</span></div>
    <div class="info-row"><span class="ir-label">Draft Picks Made</span><span class="ir-val">${totalPicks}</span></div>
    <div class="info-row"><span class="ir-label">Pre-Assignments</span><span class="ir-val">${DRAFT.allPlayers.filter(p=>p.preAssigned).length}</span></div>
    <div class="info-row" style="border-bottom:none;"><span class="ir-label">Avg. Time per Pick</span><span class="ir-val">${draftTimerFmt(avgSecs)}</span></div>
  `;
}

// ── EXPORT & CONFIRM ──────────────────────────────────────

function exportDraftCSV() {
  const rows = [['Team', 'Head Coach', 'Assistant Coaches', 'First', 'Last', 'Division', 'City', 'Years In League', 'Status', 'Pre-Assigned']];
  DRAFT.teams.forEach(t => {
    const teamPlayers = DRAFT.allPlayers.filter(p => p.teamIdx === DRAFT.teams.indexOf(t));
    teamPlayers.forEach(p => {
      const asstStr = (t.assistants||[]).filter(a=>a.trim()).join('; ');
      rows.push([
        t.name, t.coach || '', asstStr, p.player.first, p.player.last,
        p.player.division, p.player.city || '',
        p.meta.yearsInLeague,
        '',
        p.preAssigned ? 'Yes' : 'No'
      ]);
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `LYBS_Draft_${DRAFT.sport}_${DRAFT.division}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Draft roster CSV downloaded!');
}

function printDraftRosters() {
  const win = window.open('', '_blank', 'width=900,height=700');
  const teams = DRAFT.teams;
  let html = `<!DOCTYPE html><html><head><title>LYBS Draft - ${DRAFT.sport} ${DRAFT.division}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; background: white; color: #000; }
    h1 { text-align: center; font-size: 24px; margin-bottom: 4px; }
    .subtitle { text-align: center; color: #666; font-size: 14px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .roster { border: 2px solid; border-radius: 8px; padding: 12px; break-inside: avoid; }
    .roster h2 { font-size: 16px; margin: 0 0 4px; }
    .coach { font-size: 11px; color: #666; margin-bottom: 10px; }
    .player { font-size: 12px; padding: 3px 6px; margin: 2px 0; border-radius: 4px; }
    @media print { body { padding: 10px; } }
  </style></head><body>
  <h1>LYBS Draft Results</h1>
  <div class="subtitle">${DRAFT.sport} · ${DRAFT.division} · ${new Date().toLocaleDateString()}</div>
  <div class="grid">`;
  teams.forEach(t => {
    const tp = DRAFT.allPlayers.filter(p => p.teamIdx === teams.indexOf(t));
    html += `<div class="roster" style="border-color:${t.color};">
      <h2 style="color:${t.color};">${t.name}</h2>
      ${t.coach ? `<div class="coach">Coach: ${t.coach}</div>` : ''}
      ${tp.map(p => `<div class="player" style="background:${t.color}22;">${p.player.first} ${p.player.last}</div>`).join('')}
    </div>`;
  });
  html += `</div></body></html>`;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function confirmAndUpdateTeams() {
  let updated = 0;
  const latestYr = DRAFT.year || (years()[years().length - 1] || 2026);
  DRAFT.allPlayers.forEach(dp => {
    if (dp.teamIdx >= 0) {
      const team = DRAFT.teams[dp.teamIdx];
      const rec = players.find(p =>
        p.year === latestYr &&
        p.sport === DRAFT.sport &&
        draftPlayerKey(p) === dp.key
      );
      if (rec) { rec.team = team.name; updated++; }
    }
  });
  save();
  refreshAll();
  toast(`✓ Updated team names for ${updated} players in the roster!`);
}

// ── UI HELPERS ────────────────────────────────────────────

function toggleDraftDashboard() {
  const drawer = document.getElementById('draftDashboardDrawer');
  if (!drawer) return;
  const isOpen = drawer.style.display !== 'none';
  drawer.style.display = isOpen ? 'none' : 'block';
  // Sync strip when opening
  if (!isOpen) {
    const mobileStrip = document.getElementById('draftOrderStripMobile');
    const mainStrip = document.getElementById('draftOrderStrip');
    if (mobileStrip && mainStrip) mobileStrip.innerHTML = mainStrip.innerHTML;
  }
}

function showDraftPhase(phase) {
  ['setup', 'draft', 'complete'].forEach(p => {
    const el = document.getElementById(`draftPhase_${p}`);
    if (el) el.style.display = p === phase ? 'block' : 'none';
  });
}

function resetDraft() {
  if (!confirm('Reset the draft? All picks will be lost.')) return;
  stopPickTimer();
  initDraft();
}

// Called when Draft tab is first opened
function onDraftTabOpen() {
  if (DRAFT.phase === 'setup' && DRAFT.teams.length === 0) {
    initDraft();
  } else if (DRAFT.phase === 'setup') {
    draftUpdateSportDiv();
    renderDraftSetup();
  } else if (DRAFT.phase === 'draft') {
    renderDraftBoard();
  } else if (DRAFT.phase === 'complete') {
    renderDraftResults();
  }
}

// ── PHOTO CROP SYSTEM ─────────────────────────────────────────────────────

let _cropState = {
  playerObj: null,  // the player p object
  imgSrc: null,
  img: null,
  // Pan + zoom state
  x: 0, y: 0, scale: 1,
  dragging: false, lastX: 0, lastY: 0,
  stageW: 0, stageH: 0,
};

function openPhotoForCurrentPlayer() {
  // Called from the journey modal headshot — opens crop tool for the currently-viewed player
  if (typeof _msPlayerIdx === 'undefined' || _msPlayerIdx == null) return;
  const p = (typeof players !== 'undefined') ? players[_msPlayerIdx] : null;
  if (!p) return;
  _cropState.playerObj = p;
  _cropState.playerKey = (typeof headshotKey === 'function') ? headshotKey(p) : p.first.toLowerCase()+'|'+(p.last[0]||'').toUpperCase()+'|'+(p.sport||'');
  // Reset UI state
  const areas = ['photoCropUploadArea','photoCropEditor','photoCropPreview'];
  const show = ['photoCropUploadArea'];
  areas.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = show.includes(id) ? '' : 'none';
  });
  const inp = document.getElementById('photoCropFileInput');
  if (inp) inp.value = '';
  openModal('photoCropModal');
}

function openPhotoCrop(playerKey) {
  // Find the player from DRAFT or players global
  let p = null;
  if (typeof DRAFT !== 'undefined') {
    const dp = DRAFT.allPlayers.find(d => d.key === playerKey);
    if (dp) p = dp.player;
  }
  if (!p && typeof players !== 'undefined') {
    p = players.find(pl => headshotKey && headshotKey(pl) === playerKey
      || `${(pl.first||'').toLowerCase()}|${(pl.last||'')[0]?.toUpperCase()||''}|${pl.sport||''}` === playerKey);
  }
  _cropState.playerObj = p;
  _cropState.playerKey = playerKey;

  // Reset UI
  document.getElementById('photoCropUploadArea').style.display = '';
  document.getElementById('photoCropEditor').style.display = 'none';
  document.getElementById('photoCropPreview').style.display = 'none';
  document.getElementById('photoCropFileInput').value = '';

  openModal('photoCropModal');
}

function photoCropLoadFile(input) {
  const file = input.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      _cropState.img = img;
      _cropState.imgSrc = ev.target.result;

      const stage = document.getElementById('photoCropStage');
      const sw = stage.offsetWidth || 340;
      const sh = stage.offsetHeight || 340;
      _cropState.stageW = sw;
      _cropState.stageH = sh;

      // Fit image to stage
      const fitScale = Math.max(sw / img.width, sh / img.height);
      _cropState.scale = fitScale;
      _cropState.x = (sw - img.width * fitScale) / 2;
      _cropState.y = (sh - img.height * fitScale) / 2;

      const el = document.getElementById('photoCropImg');
      el.src = ev.target.result;

      document.getElementById('photoCropUploadArea').style.display = 'none';
      document.getElementById('photoCropEditor').style.display = '';
      document.getElementById('photoCropPreview').style.display = 'none';

      photoCropDraw();
      photoCropBindEvents();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function photoCropDraw() {
  const cs = _cropState;
  const el = document.getElementById('photoCropImg');
  if (!el || !cs.img) return;

  el.style.width = cs.img.width * cs.scale + 'px';
  el.style.height = cs.img.height * cs.scale + 'px';
  el.style.transform = `translate(${cs.x}px, ${cs.y}px)`;

  // Draw mask canvas
  const canvas = document.getElementById('photoCropMask');
  const stage = document.getElementById('photoCropStage');
  const sw = stage.offsetWidth || 340;
  const sh = stage.offsetHeight || 340;
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, sw, sh);

  const rPct = parseInt(document.getElementById('photoCropRadius')?.value || 40);
  const r = Math.min(sw, sh) * rPct / 100;
  const cx = sw / 2;
  const cy = sh / 2;

  // Dark overlay with circle cutout
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, sw, sh);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Circle border
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function photoCropBindEvents() {
  const stage = document.getElementById('photoCropStage');
  if (stage._cropBound) return;
  stage._cropBound = true;

  // Mouse drag
  stage.addEventListener('mousedown', e => {
    _cropState.dragging = true;
    _cropState.lastX = e.clientX;
    _cropState.lastY = e.clientY;
    stage.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!_cropState.dragging) return;
    _cropState.x += e.clientX - _cropState.lastX;
    _cropState.y += e.clientY - _cropState.lastY;
    _cropState.lastX = e.clientX;
    _cropState.lastY = e.clientY;
    photoCropDraw();
  });
  window.addEventListener('mouseup', () => {
    _cropState.dragging = false;
    stage.style.cursor = 'grab';
  });

  // Touch drag + pinch
  let lastTouches = null;
  stage.addEventListener('touchstart', e => {
    e.preventDefault();
    lastTouches = e.touches;
  }, { passive: false });
  stage.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && lastTouches?.length === 1) {
      _cropState.x += e.touches[0].clientX - lastTouches[0].clientX;
      _cropState.y += e.touches[0].clientY - lastTouches[0].clientY;
    } else if (e.touches.length === 2 && lastTouches?.length === 2) {
      const d1 = Math.hypot(lastTouches[0].clientX - lastTouches[1].clientX, lastTouches[0].clientY - lastTouches[1].clientY);
      const d2 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const factor = d2 / d1;
      const stageRect = stage.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - stageRect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - stageRect.top;
      _cropState.x = midX - (midX - _cropState.x) * factor;
      _cropState.y = midY - (midY - _cropState.y) * factor;
      _cropState.scale *= factor;
    }
    lastTouches = e.touches;
    photoCropDraw();
  }, { passive: false });

  // Scroll to zoom
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.93;
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    _cropState.x = mx - (mx - _cropState.x) * factor;
    _cropState.y = my - (my - _cropState.y) * factor;
    _cropState.scale *= factor;
    photoCropDraw();
  }, { passive: false });
}

function photoCropSave() {
  const cs = _cropState;
  if (!cs.img) return;

  const stage = document.getElementById('photoCropStage');
  const sw = stage.offsetWidth || 340;
  const sh = stage.offsetHeight || 340;
  const rPct = parseInt(document.getElementById('photoCropRadius')?.value || 40);
  const r = Math.min(sw, sh) * rPct / 100;
  const cx = sw / 2, cy = sh / 2;

  // ── 1. Circle crop for headshot (200×200) ───────────────────────────
  const circleCanvas = document.createElement('canvas');
  circleCanvas.width = circleCanvas.height = 200;
  const cCtx = circleCanvas.getContext('2d');
  // Source rect in image coords
  const srcX = (cx - r - cs.x) / cs.scale;
  const srcY = (cy - r - cs.y) / cs.scale;
  const srcW = (r * 2) / cs.scale;
  cCtx.drawImage(cs.img, srcX, srcY, srcW, srcW, 0, 0, 200, 200);
  const circleDataUrl = circleCanvas.toDataURL('image/jpeg', 0.85);

  // ── 2. Full image for banner (store original, cropped to portrait ratio) ──
  // Use the portion of the image visible in the stage as a tall crop
  const bannerH = 400, bannerW = 300;
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = bannerW;
  bannerCanvas.height = bannerH;
  const bCtx = bannerCanvas.getContext('2d');
  // Center on the circle, use portrait aspect
  const bSrcW = bannerW / cs.scale;
  const bSrcH = bannerH / cs.scale;
  const bSrcX = (cx - bannerW / 2 - cs.x) / cs.scale;
  const bSrcY = (cy - bannerH * 0.4 - cs.y) / cs.scale;  // Show more above circle center (head)
  bCtx.drawImage(cs.img, bSrcX, bSrcY, bSrcW, bSrcH, 0, 0, bannerW, bannerH);
  const fullDataUrl = bannerCanvas.toDataURL('image/jpeg', 0.88);

  // Save both
  const p = cs.playerObj;
  if (p) {
    if (typeof setHeadshot === 'function') setHeadshot(p, circleDataUrl);
    if (typeof setFullPhoto === 'function') setFullPhoto(p, fullDataUrl);
  } else if (cs.playerKey) {
    // Fallback: save by key directly
    if (!USER_DATA.playerHeadshots) USER_DATA.playerHeadshots = {};
    if (!USER_DATA.playerFullPhotos) USER_DATA.playerFullPhotos = {};
    USER_DATA.playerHeadshots[cs.playerKey] = circleDataUrl;
    USER_DATA.playerFullPhotos[cs.playerKey] = fullDataUrl;
    if (typeof saveUserData === 'function') saveUserData();
  }

  // Show preview
  document.getElementById('photoCropEditor').style.display = 'none';
  document.getElementById('photoCropPreview').style.display = '';
  document.getElementById('photoCropThumb').src = circleDataUrl;
  document.getElementById('photoCropFull').src = fullDataUrl;

  // Refresh draft cards if open
  if (typeof renderAvailablePlayers === 'function') renderAvailablePlayers();
  if (typeof renderDraftedPlayers === 'function') renderDraftedPlayers();
  // Also refresh any currently-expanded card for this player
  if (p) {
    const key = typeof draftPlayerKey === 'function' ? draftPlayerKey(p) : null;
    if (key) {
      const safeKey = key.replace(/[^a-z0-9]/gi,'_');
      const bigImg = document.querySelector(`#dc_${safeKey}_exp img[src]`);
      if (bigImg && bigImg.style.borderRadius === '10px') bigImg.src = circleDataUrl;
    }
  }

  // Refresh journey modal headshot if it's showing this player
  if (p && typeof _msPlayerIdx !== 'undefined' && _msPlayerIdx != null) {
    const journeyP = players[_msPlayerIdx];
    if (journeyP && journeyP.first === p.first && journeyP.last?.[0] === p.last?.[0]) {
      const hsImg = document.getElementById('journeyHeadshotImg');
      if (hsImg) hsImg.innerHTML = `<img src="${circleDataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
    }
  }

  toast('✓ Photo saved for ' + (p ? p.first + ' ' + p.last : 'player'));
}

function photoCropEditAgain() {
  document.getElementById('photoCropPreview').style.display = 'none';
  document.getElementById('photoCropEditor').style.display = '';
}

// ── Score widget + reveal system ──────────────────────────────────────────

function _draftScoreWidget(cardId, displayScore, evalScore, scoreCol) {
  // Feature flag: hide all eval/grade info from non-admin users unless enabled
  const _evalVisible = (typeof canShowEvalData === 'function') ? canShowEvalData() : true;
  if (!_evalVisible) {
    return `<div style="font-size:22px;color:rgba(255,255,255,0.1);">—</div>`;
  }

  const showScores = (typeof settingsGet === 'function') && settingsGet().showScores;

  // Scores unlocked: show number directly
  if (showScores && displayScore) {
    const label = evalScore ? 'EVAL' : 'GRADE';
    return `<div style="font-family:'Bebas Neue';font-size:34px;line-height:1;color:${scoreCol};">${displayScore}</div>`
         + `<div style="font-size:9px;color:${scoreCol};opacity:.6;letter-spacing:.5px;">${label}</div>`;
  }

  // Has an eval but scores are locked: show colored dot circle (click/hold to reveal)
  if (evalScore) {
    return `<div id="scoreBtn_${cardId}" style="width:32px;height:32px;border-radius:50%;border:2px solid ${scoreCol};`
         + `display:flex;align-items:center;justify-content:center;flex-shrink:0;">`
         + `<div style="width:8px;height:8px;border-radius:50%;background:${scoreCol};"></div></div>`;
  }

  // No eval, no score
  return `<div style="font-size:22px;color:rgba(255,255,255,0.15);">—</div>`;
}

let _holdTimer = null;
let _holdRevealed = null; // cardId currently revealed

function _draftRevealScore(cardId, score, col) {
  if (!score) return;
  const btn = document.getElementById('scoreBtn_' + cardId);
  if (!btn) return;
  _holdRevealed = cardId;
  btn.innerHTML = `<div style="font-family:'Bebas Neue';font-size:20px;color:${col};line-height:1;">${score}</div>`;
  btn.style.background = col + '22';
  btn.style.width = '38px';
  btn.style.height = '38px';
}

function _draftHideScore(cardId, col) {
  const btn = document.getElementById('scoreBtn_' + cardId);
  if (!btn) return;
  _holdRevealed = null;
  btn.innerHTML = `<div style="width:8px;height:8px;border-radius:50%;background:${col};"></div>`;
  btn.style.background = '';
  btn.style.width = '32px';
  btn.style.height = '32px';
}

function _draftHoldStart(cardId, score, col) {
  clearTimeout(_holdTimer);
  _holdTimer = setTimeout(() => _draftRevealScore(cardId, score, col), 400);
}

function _draftHoldEnd(cardId, score, col) {
  clearTimeout(_holdTimer);
  if (_holdRevealed === cardId) {
    // Was showing — hide on release
    setTimeout(() => _draftHideScore(cardId, col), 120);
  }
}

function _draftHoldCancel() {
  clearTimeout(_holdTimer);
}

// ── Career stats block ────────────────────────────────────────────────────
function _draftCareerTotals(gcRecs) {
  let totAB=0,totH=0,totGP=0,totRBI=0,totSB=0,totK=0,totIP=0,totER=0;
  gcRecs.forEach(r => {
    const b=r.batting||{}, p=r.pitching||{};
    totAB  += parseInt(b.ab||0);
    totH   += parseInt(b.h||0);
    totGP  += parseInt(b.gp||0);
    totRBI += parseInt(b.rbi||0);
    totSB  += parseInt(b.sb||0);
    totK   += p.so||0;
    totIP  += parseFloat(p.ip_dec||0);
    totER  += p.er||0;
  });
  return { totAB, totH, totGP, totRBI, totSB, totK, totIP, totER, seasons: gcRecs.length };
}

function _draftRenderCareer(cardId, reg, targetEl) {
  const el = targetEl || (cardId ? document.getElementById(cardId + '_career') : null);
  if (!el) return;

  const { allRecs, lastYearRec } = reg;
  if (!allRecs || !allRecs.length) { el.innerHTML = ''; return; }

  const { totAB, totH, totGP, totRBI, totSB, totK, totIP, totER, seasons } = _draftCareerTotals(allRecs);
  const careerAVGnum = totAB > 0 ? totH/totAB : 0;
  const careerAVG    = totAB > 0 ? '.' + String(Math.round(careerAVGnum*1000)).padStart(3,'0') : null;
  const careerERAnum = totIP >= 3 ? totER/totIP*9 : null;
  const careerERA    = careerERAnum !== null ? careerERAnum.toFixed(2) : null;

  // Build stat list with raw numeric values for ranking
  const stats = [];
  if (careerAVG) stats.push({ val: careerAVG, raw: careerAVGnum, label: 'AVG', col: '#60a5fa', rankKey: 'avg', higherBetter: true });
  if (totRBI > 0) stats.push({ val: totRBI,  raw: totRBI,       label: 'RBI', col: '#f5a623', rankKey: 'rbi', higherBetter: true });
  if (totSB > 0)  stats.push({ val: totSB,   raw: totSB,        label: 'SB',  col: '#a78bfa', rankKey: 'sb',  higherBetter: true });
  if (careerERA)  stats.push({ val: careerERA, raw: careerERAnum, label: 'ERA', col: '#10b981', rankKey: 'era', higherBetter: false });
  if (totK > 0)   stats.push({ val: totK,    raw: totK,         label: 'Ks',  col: '#34d399', rankKey: 'k',   higherBetter: true });
  if (seasons > 1) stats.push({ val: seasons, raw: seasons,     label: 'Seasons', col: '#94a3b8', rankKey: null });
  else if (totGP > 0) stats.push({ val: totGP, raw: totGP,     label: 'Games',   col: '#94a3b8', rankKey: null });

  if (!stats.length) { el.innerHTML = ''; return; }

  // Compute peer rankings across all players in this draft
  const peerMap = { avg: [], rbi: [], sb: [], era: [], k: [] };
  if (typeof DRAFT !== 'undefined' && DRAFT.allPlayers) {
    DRAFT.allPlayers.forEach(dp => {
      const recs = typeof gcLookup === 'function' ? gcLookup(dp.player) : [];
      if (!recs.length) return;
      const t = _draftCareerTotals(recs);
      if (t.totAB > 5)  peerMap.avg.push(t.totH/t.totAB);
      if (t.totRBI > 0) peerMap.rbi.push(t.totRBI);
      if (t.totSB > 0)  peerMap.sb.push(t.totSB);
      if (t.totIP >= 3) peerMap.era.push(t.totER/t.totIP*9);
      if (t.totK > 0)   peerMap.k.push(t.totK);
    });
    // Sort: higher=better desc, ERA asc
    peerMap.avg.sort((a,b)=>b-a); peerMap.rbi.sort((a,b)=>b-a);
    peerMap.sb.sort((a,b)=>b-a);  peerMap.era.sort((a,b)=>a-b);
    peerMap.k.sort((a,b)=>b-a);
  }

  const rankBadge = (stat) => {
    if (typeof canShowRankings === 'function' && !canShowRankings()) return '';
    if (!stat.rankKey || !peerMap[stat.rankKey]?.length) return '';
    const list = peerMap[stat.rankKey];
    const rank = list.findIndex(v => stat.higherBetter ? v <= stat.raw : v >= stat.raw) + 1;
    if (rank === 1) return '<div style="font-size:13px;line-height:1;margin-bottom:1px;">🥇</div>';
    if (rank === 2) return '<div style="font-size:13px;line-height:1;margin-bottom:1px;">🥈</div>';
    if (rank === 3) return '<div style="font-size:13px;line-height:1;margin-bottom:1px;">🥉</div>';
    return '';
  };

  const shown = stats.slice(0, 6);
  const cols = Math.min(shown.length, 3);
  el.innerHTML =
    '<div style="margin-bottom:8px;">'
    + '<div style="font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:6px;">📊 Career'
    + (seasons > 1 ? ' · ' + seasons + ' Seasons' : '') + '</div>'
    + '<div style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:5px;">'
    + shown.map(s => {
        const badge = rankBadge(s);
        return '<div style="text-align:center;padding:5px 4px 6px;border-radius:7px;background:' + s.col + '10;border:1px solid ' + s.col + (badge ? '3a' : '20') + ';position:relative;">'
          + badge
          + '<div style="font-family:Bebas Neue;font-size:18px;line-height:1;color:' + s.col + ';">' + s.val + '</div>'
          + '<div style="font-size:8px;color:var(--text2);margin-top:1px;white-space:nowrap;letter-spacing:.3px;">' + s.label + '</div>'
          + '</div>';
      }).join('')
    + '</div></div>';
}
