// coaching_tools.js — Field Coaching Tools v2
// Around the Horn Timer · Stopwatch · ATH Leaderboard
// Mobile-first. Touch-optimized. Confetti celebrations.

;(function(global){
'use strict';

// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

function $id(id){ return document.getElementById(id); }

function ctFmt(ms){
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2);
  return m ? m + ':' + sec.padStart(5,'0') : sec + 's';
}
function ctFmtShort(ms){ return (ms/1000).toFixed(2)+'s'; }
function ctFmtNum(ms){ return (ms/1000).toFixed(2); }

const CT_GOLD = '#f5a623', CT_GREEN = '#10b981', CT_RED = '#ef4444', CT_BLUE = '#60a5fa';

function ctBtn(label, onclick, opts){
  const { bg='transparent', color='var(--text)', border='1px solid var(--border)',
          size=20, pad='14px', extra='' } = opts||{};
  return `<button onclick="${onclick}"
    style="padding:${pad};border-radius:12px;font-family:Bebas Neue;font-size:${size}px;
           border:${border};background:${bg};color:${color};cursor:pointer;width:100%;
           transition:opacity .1s;${extra}"
    ontouchstart="this.style.opacity='.65'" ontouchend="this.style.opacity='1'">${label}</button>`;
}

// ═══════════════════════════════════════════════════════════════════
// CONFETTI ENGINE
// ═══════════════════════════════════════════════════════════════════

function ctConfetti(duration=3000){
  const canvas = document.createElement('canvas');
  canvas.id = 'ct-confetti-canvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;pointer-events:none;';
  document.body.appendChild(canvas);
  const W = canvas.width = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  const colors = ['#f5a623','#10b981','#60a5fa','#ef4444','#a78bfa','#f97316','#fff'];
  const pieces = Array.from({length:120}, () => ({
    x: Math.random()*W, y: -20 - Math.random()*200,
    w: 8+Math.random()*8, h: 4+Math.random()*4,
    color: colors[Math.floor(Math.random()*colors.length)],
    rot: Math.random()*360,
    vx: (Math.random()-0.5)*4,
    vy: 3+Math.random()*4,
    vr: (Math.random()-0.5)*8,
    opacity: 1
  }));

  const end = performance.now() + duration;
  let raf;
  function draw(now){
    ctx.clearRect(0,0,W,H);
    pieces.forEach(p => {
      const remaining = (end - now) / duration;
      p.opacity = Math.min(1, remaining * 3);
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI/180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if(p.y > H) { p.y=-20; p.x=Math.random()*W; }
    });
    if(now < end) raf = requestAnimationFrame(draw);
    else { canvas.remove(); }
  }
  raf = requestAnimationFrame(draw);
}

function ctShowBanner(text, sub, duration=2800){
  document.getElementById('ct-leader-banner')?.remove();
  const div = document.createElement('div');
  div.id = 'ct-leader-banner';
  div.innerHTML = `<div style="font-family:Bebas Neue;font-size:clamp(28px,8vw,52px);letter-spacing:2px;color:${CT_GOLD};line-height:1;">${text}</div>
    <div style="font-size:14px;color:#fff;margin-top:4px;font-weight:700;">${sub}</div>`;
  div.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.4);
    z-index:100000;text-align:center;background:rgba(0,0,0,.85);padding:28px 40px;
    border-radius:20px;border:2px solid ${CT_GOLD};box-shadow:0 0 60px ${CT_GOLD}66;
    transition:transform .25s cubic-bezier(.175,.885,.32,1.275);pointer-events:none;`;
  document.body.appendChild(div);
  requestAnimationFrame(()=>{ div.style.transform='translate(-50%,-50%) scale(1)'; });
  setTimeout(()=>{
    div.style.transition='opacity .4s,transform .4s';
    div.style.opacity='0'; div.style.transform='translate(-50%,-60%) scale(0.8)';
    setTimeout(()=>div.remove(), 400);
  }, duration);
}

// ═══════════════════════════════════════════════════════════════════
// LEADERBOARD STORAGE
// ═══════════════════════════════════════════════════════════════════

function athLbKey(){ return (typeof userKey !== 'undefined') ? userKey('ath_leaderboard') : 'ath_leaderboard'; }

function athLbLoad(){
  // Try cloud USER_DATA first, then localStorage
  if(typeof USER_DATA !== 'undefined' && USER_DATA.ath_leaderboard){
    return USER_DATA.ath_leaderboard;
  }
  try {
    const raw = localStorage.getItem(athLbKey());
    return raw ? JSON.parse(raw) : [];
  } catch(e){ return []; }
}

function athLbSave(entries){
  if(typeof USER_DATA !== 'undefined'){
    USER_DATA.ath_leaderboard = entries;
    if(typeof saveUserData === 'function') saveUserData();
  }
  try { localStorage.setItem(athLbKey(), JSON.stringify(entries)); } catch(e){}
}

function athLbAddResult(teamName, division, timeMs, players, date){
  const entries = athLbLoad();
  entries.unshift({ teamName, division, timeMs, players, date, id: Date.now() });
  // Keep top 200
  entries.sort((a,b)=>a.timeMs-b.timeMs);
  if(entries.length > 200) entries.splice(200);
  athLbSave(entries);
  return entries;
}

function athLbClear(){
  if(!confirm('Clear ALL leaderboard entries?')) return;
  athLbSave([]);
  athRefreshLeaderboard();
}

// ═══════════════════════════════════════════════════════════════════
// AROUND THE HORN STATE
// ═══════════════════════════════════════════════════════════════════

const ATH = {
  state: 'setup',
  startTs: 0,
  elapsedMs: 0,
  raf: null,
  groups: [],    // [{name, attempts:[ms], bestMs, players:[{name,key}]}]
  current: 0,
  containerId: null,
  sessionBestMs: null,  // best time across all groups this session
  newRecord: false,
};

function athG(){ return ATH.groups[ATH.current] || {}; }

function athSessionBest(){
  const bests = ATH.groups.filter(g=>g.bestMs!=null).map(g=>g.bestMs);
  return bests.length ? Math.min(...bests) : null;
}

function athInit(n, names){
  ATH.groups = Array.from({length:n}, (_,i) => ({
    name: (names&&names[i]) ? names[i] : 'Team '+(i+1),
    attempts: [], bestMs: null, players: []
  }));
  ATH.current = 0;
  ATH.state = 'idle';
  ATH.elapsedMs = 0;
  ATH.sessionBestMs = null;
  ATH.newRecord = false;
}

function athTick(){
  if(ATH.state !== 'running') return;
  ATH.elapsedMs = performance.now() - ATH.startTs;
  const el = $id('ct-ath-time');
  if(el) el.textContent = ctFmt(ATH.elapsedMs);
  ATH.raf = requestAnimationFrame(athTick);
}

function athStart(){
  ATH.startTs = performance.now() - ATH.elapsedMs;
  ATH.state = 'running';
  ATH.newRecord = false;
  ATH.raf = requestAnimationFrame(athTick);
  athRefresh();
}

function athStop(){
  if(ATH.state !== 'running') return;
  cancelAnimationFrame(ATH.raf);
  ATH.elapsedMs = performance.now() - ATH.startTs;
  ATH.state = 'stopped';
  const el = $id('ct-ath-time');
  if(el) el.textContent = ctFmt(ATH.elapsedMs);
  athRefresh();
}

function athAccept(){
  const g = ATH.groups[ATH.current];
  const prevBest = g.bestMs;
  g.attempts.push(ATH.elapsedMs);
  g.bestMs = Math.min(...g.attempts);

  // Check for new session/global record
  const prevSessionBest = ATH.sessionBestMs;
  ATH.sessionBestMs = athSessionBest();
  ATH.newRecord = (prevSessionBest === null || ATH.elapsedMs < prevSessionBest) && g.bestMs === ATH.elapsedMs;

  ATH.elapsedMs = 0;
  ATH.state = 'accepted';

  if(ATH.newRecord){
    ctConfetti(3000);
    ctShowBanner('🏆 NEW LEADER!', `${g.name}: ${ctFmtShort(g.bestMs)}`);
  }
  athRefresh();
}

function athRedo(){
  ATH.elapsedMs = 0;
  ATH.state = 'idle';
  const el = $id('ct-ath-time');
  if(el) el.textContent = '0.00s';
  athRefresh();
}

function athNextGroup(){
  ATH.current++;
  ATH.elapsedMs = 0;
  if(ATH.current >= ATH.groups.length){
    ATH.state = 'complete';
  } else {
    ATH.state = 'idle';
    const el = $id('ct-ath-time');
    if(el) el.textContent = '0.00s';
  }
  ATH.newRecord = false;
  athRefresh();
}

function athSetGroups(n){
  let names = null;
  if(typeof EVAL_SESSION !== 'undefined' && EVAL_SESSION.players){
    const teams = [...new Set(EVAL_SESSION.players
      .filter(p => p.present && p.team && p.team !== 'nan')
      .map(p => p.team))];
    if(teams.length >= n) names = teams.slice(0,n);
  }
  athInit(n, names);
  ATH.state = 'assigning'; // go to player-assignment screen first
  athRefresh();
}

function athProceedFromAssign(){
  ATH.state = 'idle';
  ATH.elapsedMs = 0;
  const el = document.getElementById('ct-ath-time');
  if(el) el.textContent = '0.00s';
  athRefresh();
}

// Player management — takes {name, key}
function athTogglePlayer(gi, name, key){
  const g = ATH.groups[gi];
  // Remove from all groups first
  ATH.groups.forEach(gr => { gr.players = gr.players.filter(p => p.key !== key); });
  const idx = g.players.findIndex(p=>p.key===key);
  if(idx < 0) g.players.push({name, key});
  athRefresh();
}

function athRenameGroup(gi){
  const g = ATH.groups[gi];
  const name = prompt('Rename group:', g.name);
  if(name && name.trim()) { g.name = name.trim(); athRefresh(); }
}

// Free-text add player to group
function athAddFreePlayer(gi){
  const inp = $id(`ct-free-${gi}`);
  if(!inp) return;
  const name = inp.value.trim();
  if(!name) return;
  const key = 'free_' + name.toLowerCase().replace(/\s+/g,'_');
  ATH.groups.forEach(gr => { gr.players = gr.players.filter(p => p.key !== key); });
  ATH.groups[gi].players.push({name, key});
  inp.value = '';
  athRefresh();
}

function athRemoveFreePlayer(gi, key){
  ATH.groups[gi].players = ATH.groups[gi].players.filter(p=>p.key!==key);
  athRefresh();
}

function athSaveToLeaderboard(){
  const sport = (typeof EVAL_SESSION!=='undefined'&&EVAL_SESSION.sport)||'';
  const division = (typeof EVAL_SESSION!=='undefined'&&EVAL_SESSION.division)||'';
  const date = new Date().toISOString().split('T')[0];
  let count = 0;

  ATH.groups.filter(g=>g.bestMs).forEach(g => {
    athLbAddResult(
      g.name,
      sport ? `${sport}${division?' · '+division:''}` : 'General',
      g.bestMs,
      g.players.map(p=>p.name),
      date
    );
    count++;
  });

  if(typeof toast === 'function') toast(`✓ ${count} result${count!==1?'s':''} posted to leaderboard!`);

  // Update the Post to Board button inline
  const btn = document.querySelector('[onclick="athSaveToLeaderboard()"]');
  if(btn){
    btn.textContent = '✓ Posted!';
    btn.style.background = '#10b981';
    btn.disabled = true;
  }
}

function athSaveAndClear(){
  const session = {
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    type: 'ath',
    sport: (typeof EVAL_SESSION!=='undefined'&&EVAL_SESSION.sport)||'',
    division: (typeof EVAL_SESSION!=='undefined'&&EVAL_SESSION.division)||'',
    groups: ATH.groups.map(g => ({
      name: g.name, bestMs: g.bestMs,
      attempts: g.attempts.map(ctFmtShort),
      players: g.players.map(p=>p.name)
    })),
  };
  if(typeof saveCoachingSession === 'function') saveCoachingSession(session);
  if(typeof toast === 'function') toast('✓ Session saved');
  ATH.state = 'setup'; ATH.elapsedMs = 0;
  athRefresh();
}

// ── ATH Renderers ─────────────────────────────────────────────────


// Build/refresh the player autocomplete datalist for ATH free-text inputs
function athBuildDatalist() {
  // Remove stale datalist
  const old = document.getElementById('ath-player-datalist');
  if (old && typeof old.remove === 'function') old.remove();
  else if (old && old.parentNode) old.parentNode.removeChild(old);
  // Gather current-year players from the main players array
  const dl = document.createElement('datalist');
  dl.id = 'ath-player-datalist';
  if (typeof players !== 'undefined' && players.length) {
    const latestYr = Math.max(...players.map(p => p.year || 0));
    const names = [...new Set(
      players
        .filter(p => p.year === latestYr)
        .map(p => `${p.first} ${p.last}`)
    )].sort();
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      dl.appendChild(opt);
    });
  }
  document.body.appendChild(dl);
}

function athRefresh(){
  const c = $id(ATH.containerId);
  if(!c) return;
  c.innerHTML = ATH.state === 'setup'     ? _athSetup()
    : ATH.state === 'assigning' ? _athAssign()
    : ATH.state === 'complete'  ? _athComplete()
    : _athMain();
  athBuildDatalist();
}

function _athSetup(){
  return `
  <div style="text-align:center;padding:8px 0 16px;">
    <div style="font-size:28px;margin-bottom:4px;">⚾</div>
    <div style="font-family:Bebas Neue;font-size:22px;letter-spacing:1px;color:${CT_GOLD};margin-bottom:4px;">Around the Horn</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:22px;line-height:1.5;">
      Time how fast each team throws around the infield.<br>
      Choose groups to begin.
    </div>
    <div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Number of Groups</div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
      ${[1,2,3,4,5,6].map(n=>`
        <button onclick="athSetGroups(${n})"
          style="width:56px;height:56px;border-radius:14px;font-family:Bebas Neue;font-size:28px;
                 border:2px solid var(--border);background:rgba(255,255,255,.04);color:var(--text2);cursor:pointer;transition:all .15s;"
          onmouseenter="this.style.borderColor='${CT_GOLD}';this.style.color='${CT_GOLD}'"
          onmouseleave="this.style.borderColor='var(--border)';this.style.color='var(--text2)'">${n}</button>`).join('')}
    </div>
  </div>`;
}

function _athAssign(){
  // Get present eval players as the available pool
  const evalPs = (typeof EVAL_SESSION!=='undefined' && EVAL_SESSION.players)
    ? EVAL_SESSION.players.filter(p=>p.present) : [];

  // Build group assignment UI
  const groupsHtml = ATH.groups.map((g, gi) => {
    // Players currently assigned to this group
    const assigned = g.players;
    // Available = all evalPs not already in any group
    const allAssigned = new Set(ATH.groups.flatMap(gr => gr.players.map(p=>p.key)));
    const available = evalPs.filter(p => !allAssigned.has(p.key));

    const assignedChips = assigned.map(p => {
      const ek = (p.key||'').replace(/'/g,"\\'");
      const en = p.name.replace(/'/g,"\\'");
      return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;
                border-radius:7px;font-size:11px;font-weight:600;
                background:${CT_GOLD}22;border:1px solid ${CT_GOLD}55;color:${CT_GOLD};">
        ${p.name}
        <button onclick="athTogglePlayer(${gi},'${en}','${ek}')"
          style="background:none;border:none;color:${CT_GOLD};cursor:pointer;font-size:12px;padding:0;line-height:1;">✕</button>
      </span>`;
    }).join('');

    return `<div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="font-family:Bebas Neue;font-size:16px;color:${CT_GOLD};flex:1;">${g.name}</div>
        <button onclick="athRenameGroup(${gi})"
          style="font-size:10px;background:none;border:1px solid var(--border);color:var(--text2);
                 border-radius:5px;padding:2px 7px;cursor:pointer;">Rename</button>
      </div>
      ${assigned.length ? `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">${assignedChips}</div>` : ''}
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">
        ${evalPs.map(p=>{
          const inThisGrp = g.players.some(x=>x.key===p.key);
          const inOtherGrp = !inThisGrp && allAssigned.has(p.key);
          const ek = (p.key||'').replace(/'/g,"\\'");
          const en = (p.first+' '+p.last).replace(/'/g,"\\'");
          return `<button onclick="athTogglePlayer(${gi},'${en}','${ek}')"
            style="padding:4px 9px;border-radius:7px;font-size:11px;cursor:pointer;transition:all .1s;
                   background:${inThisGrp?CT_GOLD+'22':inOtherGrp?'rgba(255,255,255,.02)':'rgba(255,255,255,.05)'};
                   border:1px solid ${inThisGrp?CT_GOLD:inOtherGrp?'rgba(255,255,255,.06)':'var(--border)'};
                   color:${inThisGrp?CT_GOLD:inOtherGrp?'rgba(255,255,255,.25)':'var(--text2)'};"
            ${inOtherGrp?'title="Already in another group"':''}
            >${p.first} ${p.last[0]}.</button>`;
        }).join('')}
        ${!evalPs.length ? `<div style="font-size:11px;color:var(--text2);padding:4px 0;">No active session players — add names below</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;">
        <input id="ct-free-${gi}" type="text" placeholder="Add player name…"
          list="ath-player-datalist" autocomplete="off"
          style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;
                 padding:7px 10px;color:var(--text);font-family:DM Sans;font-size:12px;"
          onkeydown="if(event.key==='Enter')athAddFreePlayer(${gi})">
        <button onclick="athAddFreePlayer(${gi})"
          style="padding:7px 12px;border-radius:8px;border:1px solid ${CT_BLUE};background:${CT_BLUE}22;
                 color:${CT_BLUE};font-family:Bebas Neue;font-size:14px;cursor:pointer;">ADD</button>
      </div>
    </div>`;
  }).join('');

  const totalAssigned = ATH.groups.reduce((s,g)=>s+g.players.length,0);

  return `
  <div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
      <button onclick="ATH.state='setup';ATH.elapsedMs=0;athRefresh();"
        style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:18px;padding:4px 8px;">←</button>
      <div style="font-family:Bebas Neue;font-size:18px;letter-spacing:.5px;flex:1;">Assign Players</div>
      <div style="font-size:11px;color:var(--text2);">${ATH.groups.length} group${ATH.groups.length!==1?'s':''}</div>
    </div>

    <div style="font-size:11px;color:var(--text2);margin-bottom:12px;">
      Tap a name to assign them to a group. You can also skip this step.
    </div>

    ${groupsHtml}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
      <button onclick="athProceedFromAssign()"
        style="padding:16px;border-radius:12px;font-family:Bebas Neue;font-size:22px;
               border:none;background:${CT_GREEN};color:#000;cursor:pointer;letter-spacing:1px;
               box-shadow:0 4px 20px ${CT_GREEN}44;">
        ${totalAssigned > 0 ? '▶ START' : '▶ START'}
      </button>
      <button onclick="athProceedFromAssign()"
        style="padding:16px;border-radius:12px;font-family:Bebas Neue;font-size:18px;
               border:2px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;">
        Skip →
      </button>
    </div>
    ${totalAssigned > 0 ? `<div style="text-align:center;font-size:11px;color:${CT_GREEN};margin-top:8px;">${totalAssigned} player${totalAssigned!==1?'s':''} assigned</div>` : ''}
  </div>`;
}

function _athMain(){
  const g = ATH.groups[ATH.current];
  const s = ATH.state;
  const isIdle = s==='idle', isRun = s==='running',
        isStop = s==='stopped', isAcc = s==='accepted';
  const timeStr = ATH.elapsedMs ? ctFmt(ATH.elapsedMs) : '0.00s';
  const timeColor = isRun?CT_GOLD : isStop?CT_RED : isAcc?CT_GREEN : 'var(--text)';

  // Progress pills
  const pills = ATH.groups.map((gr,i) => {
    const done = i < ATH.current, cur = i === ATH.current;
    const col = done?CT_GREEN : cur?CT_GOLD : 'rgba(255,255,255,.12)';
    const lbl = gr.bestMs ? ctFmtShort(gr.bestMs) : (cur?'●':'—');
    return `<button onclick="athRenameGroup(${i})" title="Tap to rename"
      style="padding:4px 10px;border-radius:99px;font-size:10px;font-weight:700;cursor:pointer;
             background:${col}1a;color:${col};border:1px solid ${col}55;">${gr.name}: ${lbl}</button>`;
  }).join('');

  // Session best banner - show who holds it
  const sessBest = athSessionBest();
  const bestHolder = sessBest ? ATH.groups.find(g => g.bestMs === sessBest) : null;
  const bestBanner = sessBest ? `
    <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px;">
      <span style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">Best so far</span>
      <span style="font-family:Bebas Neue;font-size:16px;color:${CT_GOLD};">🏆 ${ctFmtShort(sessBest)}</span>
      ${bestHolder ? `<span style="font-size:10px;color:var(--text2);">${bestHolder.name}</span>` : ''}
    </div>` : '';

  // Previous attempts for current group
  const prev = g.attempts.length ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:6px;">
      ${g.attempts.map((t,i)=>`
        <span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;
          background:${t===g.bestMs?CT_GREEN+'22':'rgba(255,255,255,.05)'};
          color:${t===g.bestMs?CT_GREEN:'var(--text2)'};">
          ${ctFmtShort(t)}${t===g.bestMs?' ⭐':''}
        </span>`).join('')}
    </div>` : '';

  // Controls
  let controls = '';
  if(isIdle || isAcc){
    controls = `
      <div>
        ${ctBtn(isAcc?'GO AGAIN':'START','athStart()',
          {bg:CT_GREEN,color:'#000',border:'none',size:34,pad:'22px',
           extra:`letter-spacing:2px;box-shadow:0 4px 24px ${CT_GREEN}44;`})}
        ${g.attempts.length ? `<div style="margin-top:10px;">${ctBtn(
          ATH.current < ATH.groups.length-1 ? 'NEXT GROUP &nbsp;→' : 'FINISH &nbsp;✓',
          'athNextGroup()',
          {border:`2px solid ${CT_GOLD}`,color:CT_GOLD,size:22,pad:'16px'})}</div>` : ''}
      </div>`;
  } else if(isRun){
    controls = ctBtn('STOP','athStop()',
      {bg:CT_RED,color:'#fff',border:'none',size:34,pad:'22px',
       extra:`letter-spacing:2px;box-shadow:0 4px 24px ${CT_RED}44;animation:ct-pulse .7s infinite alternate;`});
  } else if(isStop){
    controls = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${ctBtn('↩ REDO','athRedo()',{border:`2px solid ${CT_RED}`,color:CT_RED,size:24,pad:'18px'})}
      ${ctBtn('✓ ACCEPT','athAccept()',{bg:CT_GREEN,color:'#000',border:'none',size:24,pad:'18px',
        extra:`box-shadow:0 4px 16px ${CT_GREEN}44;`})}
    </div>`;
  }

  return `
  <div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <button onclick="if(!ATH.groups.some(g=>g.attempts.length)||confirm('Cancel session?')){ATH.state='setup';ATH.elapsedMs=0;athRefresh();}"
        style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:18px;padding:4px 8px;">←</button>
      <div style="font-family:Bebas Neue;font-size:18px;letter-spacing:.5px;">
        ${g.name}
        <span style="color:var(--text2);font-size:14px;font-weight:400;margin-left:4px;">(${ATH.current+1}/${ATH.groups.length})</span>
      </div>
      <div style="margin-left:auto;font-size:11px;color:var(--text2);">${g.attempts.length} attempt${g.attempts.length!==1?'s':''}</div>
    </div>

    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px;">${pills}</div>

    <div style="text-align:center;padding:18px 12px 14px;background:rgba(255,255,255,.03);
                border-radius:18px;margin-bottom:14px;border:1px solid var(--border);">
      <div id="ct-ath-time" style="font-family:Bebas Neue;font-size:80px;line-height:1;
           color:${timeColor};transition:color .15s;letter-spacing:1px;">${timeStr}</div>
      ${isAcc?`<div style="font-size:12px;color:${ATH.newRecord?CT_GOLD:CT_GREEN};margin-top:4px;font-weight:700;">
        ${ATH.newRecord?'🏆 NEW LEADER! ':'✓ Saved — '}best: ${ctFmtShort(g.bestMs)}</div>`:''}
      ${bestBanner}
      ${prev}
    </div>

    ${controls}
  </div>`;
}

function _athComplete(){
  const sorted = [...ATH.groups].sort((a,b)=>(a.bestMs||Infinity)-(b.bestMs||Infinity));
  const medals = ['🥇','🥈','🥉'];

  const board = sorted.map((g,i) => {
    const isFirst = i===0;
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;
        background:${isFirst?CT_GOLD+'12':'rgba(255,255,255,.03)'};margin-bottom:6px;
        border:1px solid ${isFirst?CT_GOLD+'44':'var(--border)'};">
      <span style="font-size:22px;width:30px;text-align:center;">${medals[i]||''}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:13px;">${g.name}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:2px;">
          ${g.attempts.map(t=>ctFmtShort(t)).join(' · ') || 'No attempts'}
        </div>
        ${g.players.length?`<div style="font-size:10px;color:var(--text2);margin-top:2px;">👥 ${g.players.map(p=>p.name).join(', ')}</div>`:''}
      </div>
      <div style="font-family:Bebas Neue;font-size:26px;color:${isFirst?CT_GOLD:'var(--text)'};">
        ${g.bestMs ? ctFmtShort(g.bestMs) : '—'}
      </div>
    </div>`;
  }).join('');

  // Player assignment — eval players + free-text
  const evalPs = (typeof EVAL_SESSION!=='undefined'&&EVAL_SESSION.players)
    ? EVAL_SESSION.players.filter(p=>p.present) : [];

  const assignHtml = `
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="font-family:Bebas Neue;font-size:16px;letter-spacing:.5px;margin-bottom:4px;">
        Assign Players to Groups
      </div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:12px;">Tap a name to assign · Tap again to remove</div>
      ${ATH.groups.map((g,gi)=>`
        <div style="margin-bottom:14px;">
          <div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;
                      letter-spacing:.4px;margin-bottom:6px;">${g.name}
            ${g.players.length ? `<span style="color:${CT_GOLD};margin-left:6px;">${g.players.map(p=>p.name).join(', ')}</span>` : ''}
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px;">
            ${evalPs.map(p=>{
              const inGrp = g.players.some(x=>x.key===p.key);
              const ek = (p.key||'').replace(/'/g,"\\'");
              const en = (p.first+' '+p.last).replace(/'/g,"\\'");
              return `<button onclick="athTogglePlayer(${gi},'${en}','${ek}')"
                style="padding:5px 10px;border-radius:7px;font-size:11px;cursor:pointer;
                       background:${inGrp?CT_GOLD+'22':'rgba(255,255,255,.04)'};
                       border:1px solid ${inGrp?CT_GOLD:'var(--border)'};
                       color:${inGrp?CT_GOLD:'var(--text2)'};">${p.first} ${p.last[0]}.</button>`;
            }).join('')}
            ${g.players.filter(p=>p.key.startsWith('free_')).map(p=>`
              <span style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px;
                           border-radius:7px;font-size:11px;background:${CT_BLUE}22;
                           border:1px solid ${CT_BLUE}55;color:${CT_BLUE};">
                ${p.name}
                <button onclick="athRemoveFreePlayer(${gi},'${p.key.replace(/'/g,"\\'")}')"
                  style="background:none;border:none;color:${CT_BLUE};cursor:pointer;font-size:12px;padding:0;">✕</button>
              </span>`).join('')}
          </div>
          <div style="display:flex;gap:6px;">
            <input id="ct-free-${gi}" type="text" placeholder="Add player name…"
              list="ath-player-datalist"
              autocomplete="off"
              style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;
                     padding:7px 10px;color:var(--text);font-family:DM Sans;font-size:12px;"
              onkeydown="if(event.key==='Enter')athAddFreePlayer(${gi})">
            <button onclick="athAddFreePlayer(${gi})"
              style="padding:7px 12px;border-radius:8px;border:1px solid ${CT_BLUE};background:${CT_BLUE}22;
                     color:${CT_BLUE};font-family:Bebas Neue;font-size:14px;cursor:pointer;">ADD</button>
          </div>
        </div>`).join('')}
    </div>`;

  return `
  <div>
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:32px;">🏁</div>
      <div style="font-family:Bebas Neue;font-size:22px;letter-spacing:1px;color:${CT_GOLD};">Session Complete!</div>
      <div style="font-size:11px;color:var(--text2);">${ATH.groups.length} groups · ${ATH.groups.reduce((s,g)=>s+g.attempts.length,0)} total attempts</div>
    </div>
    ${board}
    ${assignHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px;">
      ${ctBtn('🏆 Post to Board','athSaveToLeaderboard()',
        {bg:CT_GOLD,color:'#000',border:'none',size:19,pad:'14px'})}
      ${ctBtn('💾 Save Session','athSaveAndClear()',
        {bg:CT_GREEN,color:'#000',border:'none',size:19,pad:'14px'})}
    </div>
    <div style="margin-top:8px;">
      ${ctBtn('🔄 New Session','ATH.state=\'setup\';ATH.elapsedMs=0;athRefresh();',
        {border:'2px solid var(--border)',color:'var(--text)',size:19,pad:'12px'})}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// ATH LEADERBOARD RENDERER
// ═══════════════════════════════════════════════════════════════════

function athRefreshLeaderboard(){
  const c = $id(ATH.containerId);
  if(!c) return;
  c.innerHTML = _athLeaderboard();
}

function _athLeaderboard(){
  const entries = athLbLoad();
  const medals = ['🥇','🥈','🥉'];

  const rows = entries.slice(0,50).map((e,i)=>{
    const date = e.date || '';
    const players = (e.players||[]).join(', ');
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;
        background:${i===0?CT_GOLD+'10':i<3?'rgba(255,255,255,.04)':'rgba(255,255,255,.02)'};
        margin-bottom:4px;border:1px solid ${i===0?CT_GOLD+'33':'var(--border)'};">
      <span style="font-size:16px;width:26px;text-align:center;">${medals[i]||'#'+(i+1)}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:13px;">${e.teamName}</div>
        <div style="font-size:10px;color:var(--text2);">${e.division||''}${players?' · '+players:''}</div>
        <div style="font-size:10px;color:var(--text2);">${date}</div>
      </div>
      <div style="font-family:Bebas Neue;font-size:24px;color:${i===0?CT_GOLD:'var(--text)'};">
        ${ctFmtShort(e.timeMs)}
      </div>
      <button onclick="athLbDeleteEntry(${i})"
        style="background:none;border:none;color:rgba(255,255,255,.2);cursor:pointer;font-size:13px;padding:2px 4px;">✕</button>
    </div>`;
  }).join('');

  return `
  <div>
    <div style="display:flex;align-items:center;margin-bottom:14px;">
      <div style="font-family:Bebas Neue;font-size:20px;letter-spacing:1px;flex:1;">🏆 All-Time <span style="color:${CT_GOLD};">Leaderboard</span></div>
      ${entries.length?`<button onclick="athLbClear()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:11px;">Clear all</button>`:''}
    </div>
    ${entries.length ? rows : `
      <div style="text-align:center;padding:32px 16px;color:var(--text2);">
        <div style="font-size:32px;margin-bottom:8px;">⚾</div>
        <div style="font-size:13px;">No entries yet.<br>Complete a session and tap <strong>Post to Board</strong>.</div>
      </div>`}
    ${entries.length ? `<div style="font-size:10px;color:var(--text2);text-align:center;margin-top:8px;">Showing top ${Math.min(entries.length,50)} of ${entries.length} entries</div>` : ''}
  </div>`;
}

function athLbDeleteEntry(idx){
  const entries = athLbLoad();
  entries.splice(idx,1);
  athLbSave(entries);
  athRefreshLeaderboard();
}

// ═══════════════════════════════════════════════════════════════════
// STOPWATCH STATE
// ═══════════════════════════════════════════════════════════════════

const SW = {
  state: 'idle',
  startTs: 0,
  elapsedMs: 0,
  lapTs: 0,
  raf: null,
  entries: [],
  containerId: null,
};

function swTick(){
  if(SW.state !== 'running') return;
  SW.elapsedMs = performance.now() - SW.startTs;
  const el = $id('ct-sw-time');
  if(el) el.textContent = ctFmt(SW.elapsedMs);
  SW.raf = requestAnimationFrame(swTick);
}

function swStart(){
  SW.startTs = performance.now() - SW.elapsedMs;
  if(!SW.lapTs) SW.lapTs = SW.startTs;
  SW.state = 'running';
  SW.raf = requestAnimationFrame(swTick);
  swRefresh();
}

function swStop(){
  if(SW.state !== 'running') return;
  cancelAnimationFrame(SW.raf);
  SW.elapsedMs = performance.now() - SW.startTs;
  SW.state = 'stopped';
  const el = $id('ct-sw-time');
  if(el) el.textContent = ctFmt(SW.elapsedMs);
  swRefresh();
}

function swLap(){
  if(SW.state !== 'running') return;
  const now = performance.now();
  const split = now - SW.lapTs;
  SW.lapTs = now;
  SW.entries.unshift({
    ms: split, total: now - SW.startTs,
    label: 'Lap ' + (SW.entries.filter(e=>e.isLap).length + 1),
    isLap: true
  });
  swRefresh();
}

function swSaveEntry(label){
  const lbl = (label||'').trim() || 'Time ' + (SW.entries.filter(e=>!e.isLap).length + 1);
  SW.entries.unshift({ ms: SW.elapsedMs, label: lbl, isLap: false });
  SW.elapsedMs = 0; SW.lapTs = 0; SW.state = 'idle';
  const el = $id('ct-sw-time');
  if(el) el.textContent = '0.00s';
  swRefresh();
}

function swReset(){
  cancelAnimationFrame(SW.raf);
  SW.state = 'idle'; SW.elapsedMs = 0; SW.lapTs = 0;
  const el = $id('ct-sw-time');
  if(el) el.textContent = '0.00s';
  swRefresh();
}

function swDeleteEntry(idx){ SW.entries.splice(idx,1); swRefresh(); }
function swClearAll(){ if(!SW.entries.length || confirm('Clear all saved times?')){ SW.entries=[]; swRefresh(); } }

function swPromptAssign(idx){
  const entry = SW.entries[idx];
  const name = prompt('Assign to player (or label):', entry.label);
  if(name !== null){ entry.label = name.trim() || entry.label; swRefresh(); }
}

function swShowSaveBar(){
  const area = $id('ct-sw-save-area');
  if(!area) return;
  const evalPs = (typeof EVAL_SESSION!=='undefined'&&EVAL_SESSION.players)
    ? EVAL_SESSION.players.filter(p=>p.present) : [];

  let playerOpts = evalPs.length
    ? `<select id="ct-sw-player-sel" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-family:DM Sans;font-size:12px;">
        <option value="">— assign to player —</option>
        ${evalPs.map(p=>`<option value="${p.first} ${p.last}">${p.first} ${p.last}</option>`).join('')}
       </select>`
    : `<input id="ct-sw-label-inp" type="text" placeholder="Player name or label…"
         style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;
                padding:10px 12px;color:var(--text);font-family:DM Sans;font-size:13px;"
         onkeydown="if(event.key==='Enter'){swSaveEntry(this.value);}">`;

  area.innerHTML = `
    <div style="display:flex;gap:6px;margin-top:10px;align-items:stretch;">
      ${playerOpts}
      <button onclick="swSaveEntry((document.getElementById('ct-sw-player-sel')||document.getElementById('ct-sw-label-inp')).value)"
        style="padding:10px 16px;border-radius:8px;border:none;background:${CT_GREEN};color:#000;
               font-family:Bebas Neue;font-size:18px;cursor:pointer;">SAVE</button>
      <button onclick="$id('ct-sw-save-area').innerHTML=''"
        style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;
               color:var(--text2);cursor:pointer;font-size:16px;">✕</button>
    </div>`;
  setTimeout(()=>{ const sel = $id('ct-sw-player-sel')||$id('ct-sw-label-inp'); if(sel) sel.focus(); }, 60);
}

function swRefresh(){
  const c = $id(SW.containerId);
  if(!c) return;
  c.innerHTML = _swMain();
}

function _swMain(){
  const s = SW.state;
  const isIdle = s==='idle', isRun = s==='running', isStop = s==='stopped';
  const timeStr = SW.elapsedMs ? ctFmt(SW.elapsedMs) : '0.00s';
  const timeColor = isRun?CT_GOLD : isStop?CT_BLUE : 'var(--text)';

  const entriesHtml = SW.entries.length ? `
    <div style="margin-top:14px;">
      <div style="display:flex;align-items:center;margin-bottom:8px;">
        <div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.5px;flex:1;">
          Saved Times (${SW.entries.length})
        </div>
        ${SW.entries.length > 2 ? `<button onclick="swClearAll()" style="background:none;border:none;color:var(--text2);font-size:11px;cursor:pointer;">Clear all</button>` : ''}
      </div>
      ${SW.entries.map((e,i)=>`
        <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;
            background:rgba(255,255,255,.03);margin-bottom:4px;border:1px solid var(--border);">
          <span style="font-family:Bebas Neue;font-size:22px;min-width:66px;
                color:${e.isLap?'var(--text2)':CT_GOLD};">${ctFmtShort(e.ms)}</span>
          <span style="flex:1;font-size:12px;color:${e.isLap?'var(--text2)':'var(--text)'};">${e.label}</span>
          <button onclick="swPromptAssign(${i})" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:13px;padding:3px;">✏️</button>
          <button onclick="swDeleteEntry(${i})" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:3px;">✕</button>
        </div>`).join('')}
    </div>` : '';

  return `
  <div>
    <div style="text-align:center;padding:16px 12px;background:rgba(255,255,255,.03);
                border-radius:18px;margin-bottom:14px;border:1px solid var(--border);">
      <div id="ct-sw-time" style="font-family:Bebas Neue;font-size:80px;line-height:1;
           color:${timeColor};transition:color .15s;">${timeStr}</div>
      ${isRun?`<div style="font-size:11px;color:var(--text2);margin-top:4px;">Running… tap LAP to split</div>`:''}
    </div>
    ${isIdle ? ctBtn('START','swStart()',{bg:CT_GREEN,color:'#000',border:'none',size:34,pad:'22px',
       extra:`letter-spacing:2px;box-shadow:0 4px 24px ${CT_GREEN}44;`}) : ''}
    ${isRun ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${ctBtn('LAP','swLap()',{border:`2px solid ${CT_BLUE}`,color:CT_BLUE,size:26,pad:'20px'})}
        ${ctBtn('STOP','swStop()',{bg:CT_RED,color:'#fff',border:'none',size:26,pad:'20px',
          extra:`box-shadow:0 4px 16px ${CT_RED}44;`})}
      </div>` : ''}
    ${isStop ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        ${ctBtn('RESET','swReset()',{border:'1px solid var(--border)',color:'var(--text2)',size:17,pad:'13px'})}
        ${ctBtn('RESUME','swStart()',{border:`2px solid ${CT_GREEN}`,color:CT_GREEN,size:17,pad:'13px'})}
        ${ctBtn('SAVE ▸','swShowSaveBar()',{bg:CT_GOLD,color:'#000',border:'none',size:17,pad:'13px'})}
      </div>` : ''}
    <div id="ct-sw-save-area"></div>
    ${entriesHtml}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PANEL — 3 tabs: ATH · Stopwatch · Leaderboard
// ═══════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════
// PITCH LEADERBOARD
// ══════════════════════════════════════════════════════════════════

function pcLbLoad() {
  if (typeof USER_DATA !== 'undefined' && USER_DATA?.pitchLeaderboard)
    return JSON.parse(JSON.stringify(USER_DATA.pitchLeaderboard));
  const key = (typeof userKey !== 'undefined') ? userKey('pitch_leaderboard') : 'lll_pitch_leaderboard';
  try { const ls = localStorage.getItem(key) || localStorage.getItem('pitch_leaderboard'); if(ls) return JSON.parse(ls); } catch(e){}
  return {s10:[], s20:[], other:[]};
}

function pcLbSave(data) {
  if (typeof USER_DATA !== 'undefined') USER_DATA.pitchLeaderboard = data;
  const key = (typeof userKey !== 'undefined') ? userKey('pitch_leaderboard') : 'lll_pitch_leaderboard';
  try { localStorage.setItem(key, JSON.stringify(data)); } catch(e){}
  if (typeof saveUserData === 'function') saveUserData();
}

function pcSaveToLeaderboard() {
  const total = PC.pitches.length;
  if (!total) return;
  const strikes = PC.pitches.filter(p=>p.zone!=='ball').length;
  const withSpeed = PC.pitches.filter(p=>p.speed);
  let maxStreak=0, cur=0;
  PC.pitches.forEach(p=>{ if(p.zone!=='ball'){cur++;maxStreak=Math.max(maxStreak,cur);}else cur=0; });
  const entry = {
    id: Date.now(),
    playerName: PC.pitcher ? PC.pitcher.first+' '+PC.pitcher.last : 'Anonymous',
    strikeRate: Math.round(strikes/total*100),
    topSpeed: withSpeed.length ? Math.max(...withSpeed.map(p=>p.speed)) : null,
    avgSpeed: withSpeed.length ? Math.round(withSpeed.reduce((s,p)=>s+p.speed,0)/withSpeed.length) : null,
    maxStreak,
    pitchCount: total,
    date: new Date().toISOString().split('T')[0],
  };
  const lb = pcLbLoad();
  const cat = total<=12?'s10':total<=22?'s20':'other';
  if (!lb[cat]) lb[cat]=[];
  lb[cat].unshift(entry);
  lb[cat].sort((a,b)=>b.strikeRate-a.strikeRate);
  if (lb[cat].length>100) lb[cat].splice(100);
  pcLbSave(lb);
  const btn = document.querySelector('[onclick="pcSaveToLeaderboard()"]');
  if (btn) { btn.textContent='✓ Posted to Leaderboard!'; btn.style.background='#10b981'; btn.disabled=true; }
  if (typeof toast === 'function') toast('Posted to pitching leaderboard! 🏆');
}

function _pcLeaderboard() {
  const lb  = pcLbLoad();
  const MEDALS = ['🥇','🥈','🥉','4th','5th'];

  function section(title, entries, countLabel) {
    if (!entries || !entries.length) return `
      <div style="padding:12px 0;font-size:12px;color:var(--text2);text-align:center;">
        No ${title} sessions yet — finish a session and post it!
      </div>`;

    const byStrike = [...entries].sort((a,b)=>b.strikeRate-a.strikeRate).slice(0,5);
    const bySpeed  = [...entries].filter(e=>e.topSpeed).sort((a,b)=>b.topSpeed-a.topSpeed).slice(0,5);
    const byStreak = [...entries].sort((a,b)=>b.maxStreak-a.maxStreak).filter(e=>e.maxStreak>=2).slice(0,5);

    const row = (e,i,val,col) => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;
                  border-bottom:1px solid rgba(255,255,255,.05);">
        <span style="font-size:14px;min-width:22px;">${MEDALS[i]||''}</span>
        <span style="flex:1;font-size:12px;font-weight:600;color:var(--text);">${e.playerName}</span>
        <span style="font-family:Bebas Neue;font-size:18px;color:${col};">${val}</span>
        <span style="font-size:10px;color:var(--text2);">${e.date}</span>
      </div>`;

    return `
    <div style="margin-bottom:18px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);
                border-radius:10px;padding:12px;">
      <div style="font-family:Bebas Neue;font-size:15px;letter-spacing:.5px;color:#ef4444;margin-bottom:10px;">
        ${title} <span style="font-size:11px;font-family:'DM Sans';font-weight:400;color:var(--text2);">${countLabel}</span>
      </div>
      <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">🎯 Top Strike %</div>
      ${byStrike.map((e,i)=>row(e,i,e.strikeRate+'%','#ef4444')).join('')}
      ${bySpeed.length ? `
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 5px;">⚡ Fastest Pitch</div>
        ${bySpeed.map((e,i)=>row(e,i,e.topSpeed+' mph','#60a5fa')).join('')}` : ''}
      ${byStreak.length ? `
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 5px;">🔥 Longest Strike Streak</div>
        ${byStreak.map((e,i)=>row(e,i,e.maxStreak+' in a row','#10b981')).join('')}` : ''}
    </div>`;
  }

  return `
  <div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-family:Bebas Neue;font-size:18px;letter-spacing:1px;">
        🎯 Pitching <span style="color:#ef4444;">Leaderboard</span>
      </div>
      ${(lb.s10?.length||lb.s20?.length||lb.other?.length) ? `
      <button onclick="if(confirm('Clear all pitching leaderboard records?')){pcLbSave({s10:[],s20:[],other:[]});ctSwitchTool('board');}"
        style="font-size:10px;padding:3px 8px;border-radius:5px;border:1px solid rgba(239,68,68,.4);
               background:rgba(239,68,68,.08);color:#ef4444;cursor:pointer;">Clear</button>` : ''}
    </div>
    ${section('10-Pitch Sessions', lb.s10||[], '(±2 pitch window)')}
    ${section('20-Pitch Sessions', lb.s20||[], '(±2 pitch window)')}
    ${(lb.other||[]).length ? section('Other Sessions', lb.other||[], '') : ''}
  </div>`;
}

function startPitchSession(containerId, pitcherFirst, pitcherLast, fromJourney) {
  pcInit(containerId, pitcherFirst, pitcherLast, fromJourney);
}

let _ctCurrentTool = 'ath';

function renderCoachingToolsPanel(containerId, defaultTool){
  const c = document.getElementById(containerId);
  if(!c) return;
  // Ensure the parent section is visible (handles cases where tab activation may not have run)
  const parentSection = c.closest ? c.closest('.section') : null;
  if (parentSection && !parentSection.classList.contains('active')) {
    parentSection.classList.add('active');
  }
  _ctCurrentTool = defaultTool || 'ath';

  c.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:5px;margin-bottom:14px;" id="ct-tabs">
      ${_ctTabBtn('ath','⚾ ATH')}
      ${_ctTabBtn('sw','⏱ Watch')}
      ${_ctTabBtn('pitch','🎯 Pitch')}
      ${_ctTabBtn('board','🏆 Board')}
    </div>
    <div id="ct-tool-body"></div>`;

  _ctActivateTool(_ctCurrentTool);
}

function _ctTabBtn(id, label){
  const active = _ctCurrentTool === id;
  return `<button id="ct-tab-${id}" onclick="ctSwitchTool('${id}')"
    style="padding:9px 6px;border-radius:10px;font-family:Bebas Neue;font-size:13px;cursor:pointer;
           transition:all .15s;white-space:nowrap;overflow:hidden;
           border:2px solid ${active?CT_GOLD:'var(--border)'};
           background:${active?CT_GOLD+'1a':'transparent'};
           color:${active?CT_GOLD:'var(--text2)'};">${label}</button>`;
}

function _ctActivateTool(tool){
  if(tool === 'ath'){
    ATH.containerId = 'ct-tool-body';
    athRefresh();
  } else if(tool === 'board'){
    ATH.containerId = 'ct-tool-body';
    const boardEl = document.getElementById('ct-tool-body');
    if (!boardEl) return;
    // Render ATH leaderboard + pitch leaderboard in tabs
    boardEl.innerHTML = `
      <div style="display:flex;gap:5px;margin-bottom:12px;" id="ct-board-tabs">
        <button id="ct-btab-ath" onclick="ctBoardTab('ath')"
          style="flex:1;padding:7px;border-radius:8px;cursor:pointer;font-family:Bebas Neue;font-size:13px;
                 border:1.5px solid ${CT_GOLD};background:${CT_GOLD}1a;color:${CT_GOLD};">
          ⚾ ATH Board
        </button>
        <button id="ct-btab-pitch" onclick="ctBoardTab('pitch')"
          style="flex:1;padding:7px;border-radius:8px;cursor:pointer;font-family:Bebas Neue;font-size:13px;
                 border:1.5px solid var(--border);background:transparent;color:var(--text2);">
          🎯 Pitch Board
        </button>
      </div>
      <div id="ct-board-content"></div>`;
    ctBoardTab('ath');
  } else if(tool === 'pitch'){
    PC.containerId = 'ct-tool-body';
    if(typeof athBuildDatalist==='function') athBuildDatalist();
    pcRefresh();
  } else {
    SW.containerId = 'ct-tool-body';
    swRefresh();
  }
}


function ctBoardTab(tab) {
  ['ath','pitch'].forEach(id => {
    const btn = document.getElementById('ct-btab-'+id);
    if (!btn) return;
    const active = id === tab;
    btn.style.borderColor = active ? CT_GOLD : 'var(--border)';
    btn.style.background  = active ? CT_GOLD+'1a' : 'transparent';
    btn.style.color       = active ? CT_GOLD : 'var(--text2)';
  });
  const content = document.getElementById('ct-board-content');
  if (!content) return;
  if (tab === 'ath') {
    content.innerHTML = '';
    ATH.containerId = 'ct-board-content';
    athRefreshLeaderboard();
  } else {
    content.innerHTML = _pcLeaderboard();
  }
}

function ctSwitchTool(tool){
  _ctCurrentTool = tool;
  ['ath','sw','pitch','board'].forEach(id => {
    const btn = $id('ct-tab-'+id);
    if(!btn) return;
    const active = id === tool;
    btn.style.borderColor = active?CT_GOLD:'var(--border)';
    btn.style.background = active?CT_GOLD+'1a':'transparent';
    btn.style.color = active?CT_GOLD:'var(--text2)';
  });
  _ctActivateTool(tool);
}

// ── Bottom-sheet overlay ──────────────────────────────────────────

function ctOpenOverlay(tool){
  let ov = $id('ct-overlay');
  if(!ov){ ov = document.createElement('div'); ov.id='ct-overlay'; document.body.appendChild(ov); }
  ov.style.cssText = 'position:fixed;inset:0;z-index:8500;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;';
  ov.onclick = e => { if(e.target===ov) ctCloseOverlay(); };
  ov.innerHTML = `
    <div style="width:100%;max-height:88vh;overflow-y:auto;background:var(--navy2);
                border-radius:20px 20px 0 0;padding:16px 16px 36px;box-shadow:0 -4px 40px rgba(0,0,0,.5);">
      <div style="width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.2);margin:0 auto 14px;"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-family:Bebas Neue;font-size:20px;color:${CT_GOLD};">⏱ Coaching Tools</div>
        <button onclick="ctCloseOverlay()" style="background:rgba(255,255,255,.08);border:none;color:var(--text2);
                font-size:16px;cursor:pointer;width:32px;height:32px;border-radius:50%;">✕</button>
      </div>
      <div id="ct-overlay-body"></div>
    </div>`;
  renderCoachingToolsPanel('ct-overlay-body', tool || 'ath');
}

function ctCloseOverlay(){
  const ov = $id('ct-overlay');
  if(ov){ ov.style.display='none'; ov.innerHTML=''; }
}

function saveCoachingSession(session){
  if(typeof USER_DATA === 'undefined') return;
  const existing = USER_DATA['coaching_sessions'] || [];
  existing.unshift(session);
  if(existing.length > 50) existing.splice(50);
  USER_DATA['coaching_sessions'] = existing;
  if(typeof saveUserData === 'function') saveUserData();
}

// ═══════════════════════════════════════════════════════════════════
// CSS
// ═══════════════════════════════════════════════════════════════════

(function(){
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ct-pulse {
      from { box-shadow: 0 4px 16px #ef444433; }
      to   { box-shadow: 0 4px 28px #ef4444aa; }
    }
    #ct-overlay { touch-action: pan-y; }
    #ct-overlay button, #ct-overlay input, #ct-overlay select { touch-action: manipulation; }
    #ct-confetti-canvas { pointer-events:none; }
  `;
  document.head.appendChild(style);
})();

// ═══════════════════════════════════════════════════════════════════
// EXPOSE GLOBALS
// ═══════════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════
// PITCH CHART MODULE — coaching_tools.js addition
// ═══════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────
const PC = {
  state: 'setup',    // 'setup' | 'plotting' | 'done' | 'game'
  inputMode: 'net',  // 'net' (9-pocket tap) | 'canvas' (precise plot)
  pitches: [],       // [{x,y,type,speed,zone,pocketIdx}]
  pitcher: null,     // {first,last,key} or null
  targetCount: 0,
  pendingPitch: null,// waiting for type/speed before committing
  containerId: null,
  fromJourney: false,// opened from player card
  // Game simulator state
  gameMode: 'none',  // 'none' | 'target' | 'accuracy'
  gameTarget: null,  // current target zone e.g. '1-1' or 'ball'
  gamePitches: [],   // [{target, actual, hit, distance}]
  gameCount: 10,
};

const PT_TYPES = [
  {id:'4FB', label:'4-Seam FB', color:'#ef4444'},
  {id:'2FB', label:'2-Seam FB', color:'#f97316'},
  {id:'CH',  label:'Changeup',  color:'#10b981'},
  {id:'CU',  label:'Curveball', color:'#a78bfa'},
];

const PT_ZONE_LABELS = ['High-In','High-Mid','High-Out','Mid-In','Strike Zone','Mid-Out','Low-In','Low-Mid','Low-Out','Ball'];

// Strike zone fractions (left, top, right, bottom) as fraction of canvas
// Canvas is 280×360, strikezone ~96x120 centered
const SZ = { l:0.27, t:0.12, r:0.73, b:0.76 }; // Portrait: 46% wide x 64% tall, matches real 9-pocket net

function pcGetAll() {
  try { return JSON.parse(localStorage.getItem(userKey('pitch_sessions'))||'[]'); }
  catch { return []; }
}
function pcSaveAll(arr) { localStorage.setItem(userKey('pitch_sessions'), JSON.stringify(arr)); }

function pcZoneFromXY(fx, fy) {
  const inX = fx >= SZ.l && fx <= SZ.r;
  const inY = fy >= SZ.t && fy <= SZ.b;
  if (!inX || !inY) return 'ball';
  // 3x3 grid inside strike zone
  const col = Math.floor((fx - SZ.l) / ((SZ.r - SZ.l) / 3)); // 0,1,2
  const row = Math.floor((fy - SZ.t) / ((SZ.b - SZ.t) / 3)); // 0,1,2
  return `${row}-${col}`; // "0-0" through "2-2"
}

function pcStrikeRate() {
  if (!PC.pitches.length) return 0;
  return Math.round(PC.pitches.filter(p => p.zone !== 'ball').length / PC.pitches.length * 100);
}

function pcRefresh() {
  const c = document.getElementById(PC.containerId);
  if (!c) return;
  c.innerHTML = PC.state === 'setup'   ? _pcSetup()
             :  PC.state === 'plotting' ? _pcPlot()
             :  PC.state === 'game'     ? _pcGame()
             :  _pcDone();
  if (PC.state === 'plotting' && PC.inputMode === 'canvas') _pcBindCanvas();
  if (PC.state === 'game') requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const canvas = document.getElementById('pc-canvas');
      if (canvas) { _pcDrawCanvas(canvas); _pcBindGameCanvas(); }
      _pcBindGameStatic();
    });
  });
}

// ── SETUP SCREEN ─────────────────────────────────────────────
function _pcSetup() {
  const latestYr = typeof players !== 'undefined' ? Math.max(...players.map(p=>p.year||0)) : 0;
  const pitcherOpts = latestYr ? [...new Set(
    players.filter(p=>p.year===latestYr && p.sport==='Baseball')
           .sort((a,b)=>a.last.localeCompare(b.last))
           .map(p=>`${p.first} ${p.last}`)
  )] : [];

  return `
  <div style="text-align:center;padding:8px 0 14px;">
    <div style="font-size:26px;margin-bottom:4px;">🎯</div>
    <div style="font-family:Bebas Neue;font-size:22px;letter-spacing:1px;color:#ef4444;margin-bottom:2px;">Pitch Chart</div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:20px;">Track pitch location, type & velocity</div>
  </div>

  <div style="display:flex;flex-direction:column;gap:12px;max-width:340px;margin:0 auto;">
    <div>
      <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Pitcher (optional)</div>
      <input id="pc-pitcher-inp" type="text" list="pc-pitcher-list"
        autocomplete="off" placeholder="Search player name…"
        style="width:100%;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:8px;
               padding:9px 12px;color:var(--text);font-family:'DM Sans';font-size:13px;box-sizing:border-box;">
      <datalist id="pc-pitcher-list">
        ${pitcherOpts.map(n=>`<option value="${n}">`).join('')}
      </datalist>
    </div>

    <div>
      <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Pitch Count</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${[10,15,20,25,'∞'].map(n=>`
          <button onclick="pcSetCount(${n==='∞'?999:n},this)"
            style="padding:7px 14px;border-radius:8px;border:1.5px solid var(--border);
                   background:rgba(255,255,255,.04);color:var(--text2);font-family:'DM Sans';
                   font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;" data-count="${n==='∞'?999:n}">
            ${n}
          </button>`).join('')}
      </div>
      <input id="pc-custom-count" type="number" min="1" max="200" placeholder="Custom…"
        style="margin-top:8px;width:100%;background:rgba(255,255,255,.06);border:1px solid var(--border);
               border-radius:8px;padding:8px 12px;color:var(--text);font-family:'DM Sans';font-size:13px;box-sizing:border-box;">
    </div>

    <button onclick="pcStart()"
      style="width:100%;padding:13px;border-radius:10px;border:none;background:#ef4444;
             color:#fff;font-family:'Bebas Neue';font-size:20px;letter-spacing:1.5px;cursor:pointer;
             margin-top:4px;transition:opacity .15s;"
      onmouseover="this.style.opacity='.88'" onmouseout="this.style.opacity='1'">
      START CHARTING →
    </button>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
      <button onclick="pcStartGame('target')"
        style="padding:11px 8px;border-radius:10px;border:1.5px solid rgba(96,165,250,.5);
               background:rgba(96,165,250,.08);color:#60a5fa;font-family:'Bebas Neue';
               font-size:15px;letter-spacing:.5px;cursor:pointer;transition:opacity .15s;">
        🎯 Target Game
      </button>
      <button onclick="pcStartGame('accuracy')"
        style="padding:11px 8px;border-radius:10px;border:1.5px solid rgba(167,139,250,.5);
               background:rgba(167,139,250,.08);color:#a78bfa;font-family:'Bebas Neue';
               font-size:15px;letter-spacing:.5px;cursor:pointer;transition:opacity .15s;">
        📍 Accuracy Mode
      </button>
    </div>
    <div style="font-size:10px;color:var(--text2);text-align:center;margin-top:6px;line-height:1.5;">
      <strong style="color:#60a5fa;">Target Game</strong>: Hit 10 random pocket targets<br>
      <strong style="color:#a78bfa;">Accuracy Mode</strong>: Aim for a target, score by proximity
    </div>
  </div>
  <div style="height:40px;"></div>`;
}

function pcSetCount(n, btn) {
  PC.targetCount = n;
  document.querySelectorAll('[data-count]').forEach(b => {
    const active = parseInt(b.dataset.count) === n;
    b.style.background = active ? 'rgba(239,68,68,.18)' : 'rgba(255,255,255,.04)';
    b.style.borderColor = active ? '#ef4444' : 'var(--border)';
    b.style.color = active ? '#ef4444' : 'var(--text2)';
  });
}

function pcStart() {
  // Pitcher
  const inp = document.getElementById('pc-pitcher-inp');
  const name = inp ? inp.value.trim() : '';
  if (name && typeof players !== 'undefined') {
    const parts = name.split(' ');
    const match = players.find(p => p.first.toLowerCase() === (parts[0]||'').toLowerCase()
                                  && p.last.toLowerCase()  === (parts[1]||'').toLowerCase());
    PC.pitcher = match ? {first:match.first,last:match.last,key:`${match.first}|${match.last[0]?.toUpperCase()}`} : {first:parts[0]||name,last:parts[1]||'',key:name};
  } else {
    PC.pitcher = null;
  }
  // Count
  const custom = document.getElementById('pc-custom-count');
  const customVal = custom ? parseInt(custom.value) : 0;
  if (customVal > 0) PC.targetCount = customVal;
  if (!PC.targetCount) PC.targetCount = 999;

  PC.pitches = [];
  PC.state = 'plotting';
  PC.pendingPitch = null;
  pcRefresh();
}

// ── PLOTTING SCREEN ───────────────────────────────────────────
function _pcPlot() {
  // Route to net view or canvas view based on mode
  const innerContent = PC.inputMode === 'net' ? _pcNetView() : _pcCanvasView();
  const done = PC.pitches.length;
  const target = PC.targetCount;
  const pct = target < 999 ? Math.min(done/target*100,100) : 0;
  const sr  = pcStrikeRate();
  const pitcherLabel = PC.pitcher ? `${PC.pitcher.first} ${PC.pitcher.last}` : 'No pitcher selected';

  return `
  <div>
    <!-- Header strip -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <div style="font-family:Bebas Neue;font-size:16px;color:#ef4444;letter-spacing:1px;">⚾ PITCH CHART</div>
      <div style="font-size:11px;color:var(--text2);flex:1;">${pitcherLabel}</div>
      <div style="font-family:Bebas Neue;font-size:18px;color:var(--text);">${done}${target<999?'/'+target:''}</div>
    </div>

    ${target < 999 ? `
    <div style="height:4px;border-radius:2px;background:rgba(255,255,255,.08);margin-bottom:8px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:#ef4444;border-radius:2px;transition:width .3s;"></div>
    </div>` : ''}

    <!-- Mode toggle -->
    <div style="display:flex;gap:5px;margin-bottom:10px;">
      <button onclick="pcSetMode('net')"
        style="flex:1;padding:6px 10px;border-radius:8px;cursor:pointer;font-family:Bebas Neue;font-size:13px;
               letter-spacing:.5px;transition:all .15s;
               background:${PC.inputMode==='net'?'rgba(239,68,68,.18)':'rgba(255,255,255,.04)'};
               border:1.5px solid ${PC.inputMode==='net'?'#ef4444':'var(--border)'};
               color:${PC.inputMode==='net'?'#ef4444':'var(--text2)'};">
        🎯 9-Pocket Net
      </button>
      <button onclick="pcSetMode('canvas')"
        style="flex:1;padding:6px 10px;border-radius:8px;cursor:pointer;font-family:Bebas Neue;font-size:13px;
               letter-spacing:.5px;transition:all .15s;
               background:${PC.inputMode==='canvas'?'rgba(239,68,68,.18)':'rgba(255,255,255,.04)'};
               border:1.5px solid ${PC.inputMode==='canvas'?'#ef4444':'var(--border)'};
               color:${PC.inputMode==='canvas'?'#ef4444':'var(--text2)'};">
        📍 Plot Location
      </button>
    </div>

    ${innerContent}

    <!-- Bottom actions -->
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button onclick="pcEndSession()"
        style="flex:1;padding:10px;border-radius:9px;border:1.5px solid #ef4444;
               background:rgba(239,68,68,.1);color:#ef4444;font-family:Bebas Neue;
               font-size:16px;letter-spacing:1px;cursor:pointer;">
        END SESSION
      </button>
      <button onclick="pcUndoLast()" ${!PC.pitches.length?'disabled':''}
        style="padding:10px 14px;border-radius:9px;border:1px solid var(--border);
               background:rgba(255,255,255,.04);color:var(--text2);font-family:'DM Sans';
               font-size:12px;cursor:pointer;">
        ↩ Undo
      </button>
    </div>
  </div>`;
}

function pcSetMode(mode) {
  PC.inputMode = mode;
  PC.pendingPitch = null;
  pcRefresh();
}

// ── 9-POCKET NET VIEW ─────────────────────────────────────────
function _pcNetView() {
  // Zone counts for live heatmap
  const zoneCounts = {};
  PC.pitches.forEach(p => { if(p.zone!=='ball') zoneCounts[p.zone]=(zoneCounts[p.zone]||0)+1; });
  const ballCount = PC.pitches.filter(p=>p.zone==='ball').length;
  const maxZone = Math.max(1, ...Object.values(zoneCounts));
  const sr = pcStrikeRate();

  // Zone grid: 3×3 (row 0=top, col 0=in from pitcher's view)
  const POCKET_LABELS = [
    [['High','Inside'],['High','Mid'],['High','Outside']],
    [['Mid','Inside'],['Middle',''],['Mid','Outside']],
    [['Low','Inside'],['Low','Mid'],['Low','Outside']],
  ];

  const zones = ['0-0','0-1','0-2','1-0','1-1','1-2','2-0','2-1','2-2'];

  const pocketsHtml = zones.map((z, i) => {
    const row = Math.floor(i/3), col = i%3;
    const n   = zoneCounts[z] || 0;
    const intensity = n / maxZone;
    const isHot = intensity > 0.6;
    const isMed = intensity > 0.25;
    const borderGlow = isHot ? 'box-shadow:0 0 10px rgba(239,68,68,.5);' : isMed ? 'box-shadow:0 0 6px rgba(245,166,35,.3);' : '';
    const bgAlpha = 0.04 + intensity * 0.55;
    const borderCol = isHot ? '#ef4444' : isMed ? '#f5a623' : 'rgba(255,255,255,0.15)';
    const textCol   = isHot ? '#ef4444' : isMed ? '#f5a623' : 'rgba(255,255,255,0.4)';
    const labelLines = POCKET_LABELS[row][col];

    return `<button
      onclick="pcTapPocket('${z}',${i})"
      style="display:flex;flex-direction:column;align-items:center;justify-content:center;
             padding:0;gap:2px;border-radius:6px;cursor:pointer;transition:all .1s;
             background:rgba(239,68,68,${bgAlpha});
             border:2px solid ${borderCol};
             ${borderGlow}
             min-height:72px;position:relative;">
      <div style="font-size:9px;color:${textCol};text-align:center;line-height:1.2;font-weight:600;letter-spacing:.2px;">
        ${labelLines.filter(l=>l).map(l=>`<div>${l}</div>`).join('')}
      </div>
      ${n > 0 ? `<div style="font-family:Bebas Neue;font-size:20px;color:${isHot?'#ef4444':isMed?'#f5a623':'rgba(255,255,255,0.5)'};line-height:1;">${n}</div>` : ''}
    </button>`;
  }).join('');

  // Type selector for pending pitch
  const typeHtml = PT_TYPES.map(t=>`
    <button class="pc-type-btn" data-type="${t.id}"
      onclick="pcSetPendingType('${t.id}')"
      style="padding:5px 8px;border-radius:7px;border:1.5px solid var(--border);
             background:rgba(255,255,255,.04);color:var(--text2);font-family:'DM Sans';
             font-size:11px;font-weight:700;cursor:pointer;transition:all .12s;">
      ${t.id}
    </button>`).join('');

  return `
  <!-- Net visual -->
  <div style="position:relative;margin-bottom:10px;">
    <!-- Net frame -->
    <div style="background:linear-gradient(135deg,rgba(30,58,120,0.5),rgba(15,30,70,0.6));
                border:3px solid rgba(59,130,246,0.6);border-radius:12px;
                padding:10px;position:relative;overflow:hidden;
                box-shadow:0 0 20px rgba(37,99,235,0.2),inset 0 0 30px rgba(0,0,0,0.4);">

      <!-- Corner studs -->
      <div style="position:absolute;top:6px;left:6px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.35);"></div>
      <div style="position:absolute;top:6px;right:6px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.35);"></div>
      <div style="position:absolute;bottom:6px;left:6px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.35);"></div>
      <div style="position:absolute;bottom:6px;right:6px;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.35);"></div>

      <!-- Pocket grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
        ${pocketsHtml}
      </div>
    </div>

    <!-- "Ball" button below frame -->
    <div style="display:flex;gap:6px;margin-top:6px;">
      <button onclick="pcTapPocket('ball',-1)"
        style="flex:1;padding:8px;border-radius:8px;border:1.5px solid rgba(255,255,255,.15);
               background:rgba(255,255,255,.03);color:var(--text2);font-family:Bebas Neue;
               font-size:13px;letter-spacing:.5px;cursor:pointer;transition:all .12s;">
        ⭕ BALL ${ballCount>0?'('+ballCount+')':''}
      </button>
      <div style="flex:1;text-align:center;padding:8px;border-radius:8px;
                  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);">
        <span style="font-family:Bebas Neue;font-size:18px;color:${sr>=65?'#10b981':sr>=50?'#f5a623':'#ef4444'};">${sr}%</span>
        <span style="font-size:9px;color:var(--text2);margin-left:4px;">K%</span>
      </div>
    </div>
  </div>

  <!-- Pending pitch popup -->
  ${PC.pendingPitch ? `
  <div style="background:#0f1b2d;border:1px solid rgba(239,68,68,.4);border-radius:12px;
              padding:10px 12px;margin-bottom:4px;">
    <div style="font-size:10px;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">
      ${PC.pendingPitch.zone==='ball'?'⭕ Ball — select type':'✅ '+_pcZoneLabel(PC.pendingPitch.zone)+' — select type'}
    </div>
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">${typeHtml}</div>
    <div style="display:flex;gap:6px;align-items:center;">
      <input id="pc-speed-inp" type="number" min="30" max="100" placeholder="mph"
        inputmode="numeric"
        style="width:64px;background:rgba(255,255,255,.07);border:1px solid var(--border);
               border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans';font-size:12px;">
      <button onclick="pcCommitPitch()"
        style="flex:1;padding:7px 10px;border-radius:8px;border:none;background:#ef4444;
               color:#fff;font-family:Bebas Neue;font-size:15px;cursor:pointer;letter-spacing:.5px;">
        LOG PITCH
      </button>
      <button onclick="pcCancelPending()"
        style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:none;
               color:var(--text2);font-family:'DM Sans';font-size:11px;cursor:pointer;">✕</button>
    </div>
  </div>` : ''}

  <!-- Type summary -->
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
    ${_pcTypeSummary()}
  </div>`;
}

// ── TAP A POCKET (net mode) ───────────────────────────────────
function pcTapPocket(zone, pocketIdx) {
  if (PC.pendingPitch) return;
  // Convert pocket center to fx/fy for storage compatibility
  const fxMap = {'0-0':0.27,'0-1':0.50,'0-2':0.73,'1-0':0.27,'1-1':0.50,'1-2':0.73,'2-0':0.27,'2-1':0.50,'2-2':0.73,'ball':0.5};
  const fyMap = {'0-0':0.30,'0-1':0.30,'0-2':0.30,'1-0':0.47,'1-1':0.47,'1-2':0.47,'2-0':0.63,'2-1':0.63,'2-2':0.63,'ball':0.85};
  PC.pendingPitch = {
    fx: fxMap[zone] || 0.5,
    fy: fyMap[zone] || 0.5,
    zone,
    pocketIdx
  };
  pcRefresh();
}

// ── EXISTING CANVAS VIEW (renamed from old _pcPlot body) ──────
function _pcCanvasView() {
  const typeHtml = PT_TYPES.map(t=>`
    <button class="pc-type-btn" data-type="${t.id}"
      onclick="pcSetPendingType('${t.id}')"
      style="padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);
             background:rgba(255,255,255,.04);color:var(--text2);font-family:'DM Sans';
             font-size:11px;font-weight:700;cursor:pointer;transition:all .12s;white-space:nowrap;">
      ${t.id}
    </button>`).join('');

  return `
  <div style="display:flex;justify-content:center;margin-bottom:10px;">
    <div style="position:relative;display:inline-block;">
      <canvas id="pc-canvas" width="280" height="360"
        style="border-radius:10px;background:rgba(0,0,0,.35);cursor:crosshair;
               border:1px solid rgba(255,255,255,.1);touch-action:none;display:block;">
      </canvas>
      ${PC.pendingPitch ? `
      <div id="pc-pitch-form"
        style="position:absolute;left:50%;bottom:-8px;transform:translate(-50%,100%);
               background:#0f1b2d;border:1px solid rgba(239,68,68,.5);border-radius:12px;
               padding:10px 12px;min-width:220px;z-index:10;box-shadow:0 8px 30px rgba(0,0,0,.6);">
        <div style="font-size:10px;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">
          ${PC.pendingPitch.zone === 'ball' ? '⭕ Ball' : '✅ Strike — Zone ' + _pcZoneLabel(PC.pendingPitch.zone)}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">${typeHtml}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="pc-speed-inp" type="number" min="30" max="100" placeholder="mph"
            style="width:64px;background:rgba(255,255,255,.07);border:1px solid var(--border);
                   border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans';font-size:12px;">
          <button onclick="pcCommitPitch()"
            style="flex:1;padding:6px 10px;border-radius:8px;border:none;background:#ef4444;
                   color:#fff;font-family:Bebas Neue;font-size:14px;cursor:pointer;letter-spacing:.5px;">
            LOG PITCH
          </button>
          <button onclick="pcCancelPending()"
            style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:none;
                   color:var(--text2);font-family:'DM Sans';font-size:11px;cursor:pointer;">✕</button>
        </div>
      </div>` : ''}
    </div>
  </div>
  <div style="display:flex;gap:8px;justify-content:center;margin-bottom:4px;flex-wrap:wrap;">
    ${_pcTypeSummary()}
  </div>`;
}

// ── ORIGINAL PLOTTING SCREEN (now just a shell) — REPLACED ABOVE
function _pcPlot_OLD() {
  const done = PC.pitches.length;
  const target = PC.targetCount;
  const pct = target < 999 ? Math.min(done/target*100,100) : 0;
  const sr  = pcStrikeRate();
  const pitcherLabel = PC.pitcher ? `${PC.pitcher.first} ${PC.pitcher.last}` : 'No pitcher selected';

  const typeHtml = PT_TYPES.map(t=>`
    <button class="pc-type-btn" data-type="${t.id}"
      onclick="pcSetPendingType('${t.id}')"
      style="padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);
             background:rgba(255,255,255,.04);color:var(--text2);font-family:'DM Sans';
             font-size:11px;font-weight:700;cursor:pointer;transition:all .12s;white-space:nowrap;">
      ${t.id}
    </button>`).join('');

  return `
  <div style="position:relative;">
    <!-- Header strip -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <div style="font-family:Bebas Neue;font-size:16px;color:#ef4444;letter-spacing:1px;">⚾ PITCH CHART</div>
      <div style="font-size:11px;color:var(--text2);flex:1;">${pitcherLabel}</div>
      <div style="font-family:Bebas Neue;font-size:18px;color:var(--text);">${done}${target<999?'/'+target:''}</div>
    </div>

    ${target < 999 ? `
    <div style="height:4px;border-radius:2px;background:rgba(255,255,255,.08);margin-bottom:10px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:#ef4444;border-radius:2px;transition:width .3s;"></div>
    </div>` : ''}

    <!-- Strike zone canvas -->
    <div style="display:flex;justify-content:center;margin-bottom:10px;">
      <div style="position:relative;display:inline-block;">
        <canvas id="pc-canvas" width="280" height="360"
          style="border-radius:10px;background:rgba(0,0,0,.35);cursor:crosshair;
                 border:1px solid rgba(255,255,255,.1);touch-action:none;display:block;">
        </canvas>
        ${PC.pendingPitch ? `
        <div id="pc-pitch-form"
          style="position:absolute;left:50%;bottom:-8px;transform:translate(-50%,100%);
                 background:#0f1b2d;border:1px solid rgba(239,68,68,.5);border-radius:12px;
                 padding:10px 12px;min-width:220px;z-index:10;box-shadow:0 8px 30px rgba(0,0,0,.6);">
          <div style="font-size:10px;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;">
            ${PC.pendingPitch.zone === 'ball' ? '⭕ Ball' : '✅ Strike — Zone ' + _pcZoneLabel(PC.pendingPitch.zone)}
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">
            ${typeHtml}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <input id="pc-speed-inp" type="number" min="30" max="100" placeholder="mph"
              style="width:64px;background:rgba(255,255,255,.07);border:1px solid var(--border);
                     border-radius:7px;padding:5px 8px;color:var(--text);font-family:'DM Sans';font-size:12px;">
            <button onclick="pcCommitPitch()"
              style="flex:1;padding:6px 10px;border-radius:8px;border:none;background:#ef4444;
                     color:#fff;font-family:Bebas Neue;font-size:14px;cursor:pointer;letter-spacing:.5px;">
              LOG PITCH
            </button>
            <button onclick="pcCancelPending()"
              style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:none;
                     color:var(--text2);font-family:'DM Sans';font-size:11px;cursor:pointer;">✕</button>
          </div>
        </div>` : ''}
      </div>
    </div>

    <!-- Live stats strip -->
    <div style="display:flex;gap:8px;justify-content:center;margin-bottom:12px;flex-wrap:wrap;">
      <div style="text-align:center;padding:6px 12px;background:rgba(255,255,255,.04);border-radius:8px;min-width:60px;">
        <div style="font-family:Bebas Neue;font-size:22px;color:${sr>=60?'#10b981':sr>=50?'#f5a623':'#ef4444'};">${sr}%</div>
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">Strike%</div>
      </div>
      ${_pcTypeSummary()}
    </div>

    <!-- Bottom actions -->
    <div style="display:flex;gap:8px;">
      <button onclick="pcEndSession()"
        style="flex:1;padding:10px;border-radius:9px;border:1.5px solid #ef4444;
               background:rgba(239,68,68,.1);color:#ef4444;font-family:Bebas Neue;
               font-size:16px;letter-spacing:1px;cursor:pointer;">
        END SESSION
      </button>
      <button onclick="pcUndoLast()" ${!PC.pitches.length ? 'disabled' : ''}
        style="padding:10px 14px;border-radius:9px;border:1px solid var(--border);
               background:rgba(255,255,255,.04);color:var(--text2);font-family:'DM Sans';
               font-size:12px;cursor:pointer;">
        ↩ Undo
      </button>
    </div>
  </div>`;
}

function _pcZoneLabel(zone) {
  if (zone === 'ball') return 'Ball';
  const [row, col] = zone.split('-').map(Number);
  const rows = ['High','Mid','Low'];
  const cols = ['In','Mid','Out'];
  return `${rows[row]}-${cols[col]}`;
}

function _pcTypeSummary() {
  const counts = {};
  PC.pitches.forEach(p => { counts[p.type] = (counts[p.type]||0)+1; });
  return Object.entries(counts).map(([type,n]) => {
    const t = PT_TYPES.find(x=>x.id===type) || {color:'var(--text2)'};
    return `<div style="text-align:center;padding:6px 10px;background:${t.color}15;border-radius:8px;border:1px solid ${t.color}33;">
      <div style="font-family:Bebas Neue;font-size:20px;color:${t.color};">${n}</div>
      <div style="font-size:9px;color:${t.color};opacity:.85;">${type}</div>
    </div>`;
  }).join('');
}

function _pcBindCanvas() {
  const canvas = document.getElementById('pc-canvas');
  if (!canvas) return;
  _pcDrawCanvas(canvas);

  let dragging = false, dragStartX, dragStartY;

  function getXY(e) {
    const r = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      fx: (clientX - r.left) / r.width,
      fy: (clientY - r.top)  / r.height
    };
  }

  function onDown(e) {
    e.preventDefault();
    const {fx,fy} = getXY(e);
    dragging = true; dragStartX = fx; dragStartY = fy;
  }
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
  }
  function onUp(e) {
    if (!dragging) return; dragging = false;
    e.preventDefault();
    const {fx,fy} = e.changedTouches ? (() => {
      const r = canvas.getBoundingClientRect();
      const t = e.changedTouches[0];
      return {fx:(t.clientX-r.left)/r.width, fy:(t.clientY-r.top)/r.height};
    })() : getXY(e);
    // Use release point (for slide-and-release) or down point if same
    const dx = Math.abs(fx - dragStartX), dy = Math.abs(fy - dragStartY);
    const px = dx < 0.02 && dy < 0.02 ? dragStartX : fx;
    const py = dx < 0.02 && dy < 0.02 ? dragStartY : fy;
    pcTapAt(Math.max(0,Math.min(1,px)), Math.max(0,Math.min(1,py)));
  }

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mouseup',   onUp);
  canvas.addEventListener('touchstart',onDown, {passive:false});
  canvas.addEventListener('touchend',  onUp,   {passive:false});
  canvas.addEventListener('touchmove', onMove, {passive:false});
}

function _pcDrawCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  // Background gradient — batter's box feel
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'rgba(10,20,35,0.9)');
  bg.addColorStop(1,'rgba(5,12,22,0.95)');
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,W,H);

  const szL = SZ.l * W, szT = SZ.t * H, szR = SZ.r * W, szB = SZ.b * H;
  const szW = szR - szL, szH = szB - szT;

  // Outer border glow zone hint
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.strokeRect(szL-20, szT-20, szW+40, szH+40);

  // 9-zone grid fill
  for (let row=0; row<3; row++) {
    for (let col=0; col<3; col++) {
      const x = szL + col * szW/3;
      const y = szT + row * szH/3;
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(x+1, y+1, szW/3-2, szH/3-2);
    }
  }

  // Strike zone border — white pipe look
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 3;
  ctx.strokeRect(szL, szT, szW, szH);

  // Inner grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  for (let i=1; i<3; i++) {
    const gx = szL + i * szW/3;
    ctx.beginPath(); ctx.moveTo(gx, szT); ctx.lineTo(gx, szB); ctx.stroke();
    const gy = szT + i * szH/3;
    ctx.beginPath(); ctx.moveTo(szL, gy); ctx.lineTo(szR, gy); ctx.stroke();
  }

  // Outer corner markers
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  const m = 12;
  [[szL-20,szT-20],[szR+20,szT-20],[szL-20,szB+20],[szR+20,szB+20]].forEach(([cx,cy]) => {
    const sx = cx < W/2 ? 1 : -1, sy = cy < H/2 ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+sx*m,cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy+sy*m); ctx.stroke();
  });

  // Home plate silhouette at bottom
  const py = H - 22, px = W/2;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(px-18, py-8); ctx.lineTo(px+18, py-8);
  ctx.lineTo(px+18, py);   ctx.lineTo(px, py+10);
  ctx.lineTo(px-18, py);   ctx.closePath();
  ctx.fill();

  // Labels
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = '500 9px DM Sans';
  ctx.textAlign = 'center';
  ctx.fillText('I', szL + szW/6, szT - 6);
  ctx.fillText('M', szL + szW/2, szT - 6);
  ctx.fillText('O', szL + szW*5/6, szT - 6);
  ctx.textAlign = 'left';
  ctx.fillText('HI', 4, szT + szH/6);
  ctx.fillText('MID',4, szT + szH/2);
  ctx.fillText('LO', 4, szT + szH*5/6);

  // Pitch count label (top-right)
  ctx.fillStyle = 'rgba(239,68,68,0.5)';
  ctx.font = 'bold 11px DM Sans';
  ctx.textAlign = 'right';
  ctx.fillText(PC.pitches.length + (PC.targetCount<999?' / '+PC.targetCount:''), W-6, 14);

  // Draw pitched locations
  PC.pitches.forEach((pitch, i) => {
    const cx = pitch.fx * W, cy = pitch.fy * H;
    const t = PT_TYPES.find(x=>x.id===pitch.type);
    const col = t ? t.color : '#94a3b8';
    const isStrike = pitch.zone !== 'ball';
    const seq = i + 1;

    // Shadow
    ctx.shadowColor = col; ctx.shadowBlur = isStrike ? 8 : 4;

    // Dot
    ctx.beginPath();
    ctx.arc(cx, cy, isStrike ? 10 : 8, 0, Math.PI*2);
    ctx.fillStyle = isStrike ? col+'cc' : 'rgba(150,150,180,0.4)';
    ctx.fill();
    ctx.strokeStyle = isStrike ? col : 'rgba(200,200,220,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Sequence number
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${seq >= 10 ? '7' : '8'}px DM Sans`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(seq, cx, cy);
    ctx.textBaseline = 'alphabetic';
  });

  // Pending indicator
  if (PC.pendingPitch) {
    const cx = PC.pendingPitch.fx * W, cy = PC.pendingPitch.fy * H;
    ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI*2);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([4,3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // Crosshair
    ctx.strokeStyle = 'rgba(239,68,68,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx-18,cy); ctx.lineTo(cx+18,cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy-18); ctx.lineTo(cx,cy+18); ctx.stroke();
  }

  // ── GAME OVERLAYS ──────────────────────────────────────────────────
  if (PC.state === 'game' && PC.gameTarget) {
    const tc = _pcZoneCenter(PC.gameTarget);
    const tx = tc.fx * W, ty = tc.fy * H;
    const isAccuracy = PC.gameMode === 'accuracy';
    const phase = PC.gamePhase || 'aim';
    const row = parseInt(PC.gameTarget[0]), col2 = parseInt(PC.gameTarget[2]);
    const pxCell = szL + col2 * szW/3, pyCell = szT + row * szH/3;

    if (isAccuracy) {
      // ACCURACY MODE: aim phase shows yellow target pocket; result phase shows where they threw
      if (phase === 'aim') {
        // Pre-show target in yellow before they pitch
        ctx.fillStyle = 'rgba(251,191,36,0.22)';
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.fillRect(pxCell+2, pyCell+2, szW/3-4, szH/3-4);
        ctx.strokeRect(pxCell+2, pyCell+2, szW/3-4, szH/3-4);
        // Bullseye at center in yellow
        ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 14;
        [20, 13, 7].forEach((r, i) => {
          ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI*2);
          ctx.strokeStyle = i === 2 ? '#fbbf24' : `rgba(251,191,36,${i===0?0.3:0.6})`;
          ctx.lineWidth = i === 2 ? 2.5 : 1.5; ctx.stroke();
        });
        ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI*2);
        ctx.fillStyle = '#fbbf24'; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(251,191,36,0.7)'; ctx.lineWidth = 1.5;
        [[tx-25,ty,tx-12,ty],[tx+12,ty,tx+25,ty],[tx,ty-25,tx,ty-12],[tx,ty+12,tx,ty+25]].forEach(([x1,y1,x2,y2])=>{
          ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        });
      }
      // In result phase, the actual throw is shown via PC.gameHitFx/Fy in the pitches array
    } else {
      // TARGET GAME: flash the pocket — use time-based opacity for animation effect
      const flashCycle = Math.sin(Date.now() / 280);  // oscillates -1 to 1
      const flashAlpha = 0.12 + flashCycle * 0.12;     // 0.00 to 0.24
      ctx.fillStyle = `rgba(251,191,36,${flashAlpha})`;
      ctx.strokeStyle = `rgba(251,191,36,${0.5 + flashCycle * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.fillRect(pxCell+2, pyCell+2, szW/3-4, szH/3-4);
      ctx.strokeRect(pxCell+2, pyCell+2, szW/3-4, szH/3-4);
      // Bullseye
      const gameCol = '#fbbf24';
      ctx.shadowColor = gameCol; ctx.shadowBlur = 10 + flashCycle * 6;
      [20, 13, 7].forEach((r, i) => {
        ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI*2);
        ctx.strokeStyle = i === 2 ? gameCol : `${gameCol}${i===0?'44':'88'}`;
        ctx.lineWidth = i === 2 ? 2.5 : 1.5; ctx.stroke();
      });
      ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI*2);
      ctx.fillStyle = gameCol; ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `${gameCol}cc`; ctx.lineWidth = 1.5;
      [[tx-25,ty,tx-12,ty],[tx+12,ty,tx+25,ty],[tx,ty-25,tx,ty-12],[tx,ty+12,tx,ty+25]].forEach(([x1,y1,x2,y2])=>{
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      });
    }

    // Hit marker from last pitch (when in result phase)
    const last = PC.gamePitches[PC.gamePitches.length - 1];
    if (PC.gamePhase === 'result' && last?.hitFx != null) {
      const hx = last.hitFx * W, hy = last.hitFy * H;
      // Dashed line target → hit
      ctx.setLineDash([4,3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(hx,hy); ctx.stroke();
      ctx.setLineDash([]);
      // Hit dot
      ctx.shadowColor = last.hit ? '#10b981' : '#ef4444'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI*2);
      ctx.fillStyle = last.hit ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)';
      ctx.fill();
      ctx.strokeStyle = last.hit ? '#10b981' : '#ef4444'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.shadowBlur = 0;
      // X mark
      ctx.strokeStyle = last.hit ? '#10b981' : '#ef4444'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hx-6,hy-6); ctx.lineTo(hx+6,hy+6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx+6,hy-6); ctx.lineTo(hx-6,hy+6); ctx.stroke();
    }
  }
}

function pcTapAt(fx, fy) {
  if (PC.pendingPitch) return; // already waiting for type
  const zone = pcZoneFromXY(fx, fy);
  PC.pendingPitch = {fx, fy, zone};
  pcRefresh();
  // Re-bind and draw with crosshair
  setTimeout(() => {
    const c = document.getElementById('pc-canvas');
    if (c) { _pcDrawCanvas(c); _pcBindCanvas(); }
  }, 10);
}

function pcSetPendingType(typeId) {
  document.querySelectorAll('.pc-type-btn').forEach(b => {
    const active = b.dataset.type === typeId;
    const t = PT_TYPES.find(x=>x.id===b.dataset.type);
    b.style.background = active ? (t?t.color+'22':'rgba(255,255,255,.12)') : 'rgba(255,255,255,.04)';
    b.style.borderColor = active ? (t?t.color:'var(--text)') : 'var(--border)';
    b.style.color = active ? (t?t.color:'var(--text)') : 'var(--text2)';
    if (active) b.setAttribute('data-selected','1'); else b.removeAttribute('data-selected');
  });
  if (PC.pendingPitch) PC.pendingPitch.type = typeId;
}

function pcCommitPitch() {
  if (!PC.pendingPitch) return;
  const selectedBtn = document.querySelector('.pc-type-btn[data-selected]');
  const type = PC.pendingPitch.type || (selectedBtn ? selectedBtn.dataset.type : '4FB');
  const speedInp = document.getElementById('pc-speed-inp');
  const speed = speedInp ? parseInt(speedInp.value)||null : null;
  PC.pitches.push({fx:PC.pendingPitch.fx, fy:PC.pendingPitch.fy, zone:PC.pendingPitch.zone, type, speed});
  PC.pendingPitch = null;

  // 🔥 Fire + woosh — age/division-appropriate thresholds
  if (speed) {
    const div = PC.pitcher
      ? (typeof players !== 'undefined'
          ? (players.find(p => p.first === PC.pitcher.first && p.last.startsWith(PC.pitcher.key?.split('|')[1]||''))?.division || '')
          : '')
      : '';
    // Thresholds by division: Majors 48, Minors/10U 45, Rookies/Farm 42, T-Ball 39, default 48
    const threshold = /Majors|Senior|12U/.test(div) ? 48
                    : /Minors|10U/.test(div) ? 45
                    : /Rookies|Farm/.test(div) ? 42
                    : /T-Ball/.test(div) ? 39
                    : 48;  // fallback
    if (speed >= threshold) _pcFireEffect(speed);
  }

  // Auto-end if we hit target
  if (PC.targetCount < 999 && PC.pitches.length >= PC.targetCount) {
    PC.state = 'done';
  }
  pcRefresh();
}

function _pcFireEffect(speed) {
  // Woosh sound via Web Audio API
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate;
      // Woosh: filtered noise with pitch sweep
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 5) * 0.8;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.5);
    filter.Q.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 0.6);
  } catch(e) {}

  // Fire particles
  const overlay = document.createElement('div');
  overlay.className = 'fire-overlay';
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 1300);

  const emojis = ['🔥','🔥','🔥','💨','🔥','🔥'];
  const speedLabel = speed ? ` ${speed} MPH` : '';

  emojis.forEach((em, i) => {
    const el = document.createElement('div');
    el.className = 'fire-particle';
    el.style.left = `${30 + Math.random() * 40}%`;
    el.style.animationDelay = `${i * 0.07}s`;
    el.style.fontSize = `${36 + Math.random() * 28}px`;
    el.textContent = em;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  });

  // Speed popup
  const label = document.createElement('div');
  label.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    font-family:'Bebas Neue';font-size:72px;color:#ff4400;text-shadow:0 0 30px #ff6600,0 0 60px #ff0000;
    z-index:99999;pointer-events:none;letter-spacing:2px;
    animation:flameRise 1.4s ease-out forwards;`;
  label.textContent = `🔥${speedLabel}`;
  document.body.appendChild(label);
  setTimeout(() => label.remove(), 1500);
}

function pcCancelPending() {
  PC.pendingPitch = null;
  pcRefresh();
}

function pcUndoLast() {
  PC.pitches.pop();
  pcRefresh();
}

function pcEndSession() {
  PC.state = 'done';
  pcRefresh();
}

// ── DONE SCREEN ───────────────────────────────────────────────
function _pcDone() {
  const total = PC.pitches.length;
  const strikes = PC.pitches.filter(p=>p.zone!=='ball').length;
  const balls   = total - strikes;
  const sr = total ? Math.round(strikes/total*100) : 0;
  const srColor = sr>=65?'#10b981':sr>=55?'#f5a623':'#ef4444';
  const avgSpeed = (() => {
    const withSpeed = PC.pitches.filter(p=>p.speed);
    return withSpeed.length ? Math.round(withSpeed.reduce((s,p)=>s+p.speed,0)/withSpeed.length) : null;
  })();

  // Type breakdown
  const typeCounts = {};
  PT_TYPES.forEach(t => typeCounts[t.id] = 0);
  PC.pitches.forEach(p => { if(typeCounts[p.type]!==undefined) typeCounts[p.type]++; });

  // Zone heat map counts
  const zoneCounts = {};
  PC.pitches.forEach(p => { zoneCounts[p.zone]=(zoneCounts[p.zone]||0)+1; });
  const maxZone = Math.max(1, ...Object.values(zoneCounts));

  return `
  <div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
      <div style="font-family:Bebas Neue;font-size:18px;color:#ef4444;">🎯 SESSION COMPLETE</div>
      ${PC.pitcher ? `<div style="font-size:12px;color:var(--text2);">${PC.pitcher.first} ${PC.pitcher.last}</div>` : ''}
    </div>

    <!-- Summary stats -->
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:70px;text-align:center;padding:10px 8px;background:rgba(255,255,255,.04);border-radius:8px;">
        <div style="font-family:Bebas Neue;font-size:28px;color:var(--text);">${total}</div>
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">Pitches</div>
      </div>
      <div style="flex:1;min-width:70px;text-align:center;padding:10px 8px;background:rgba(255,255,255,.04);border-radius:8px;">
        <div style="font-family:Bebas Neue;font-size:28px;color:${srColor};">${sr}%</div>
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">Strike%</div>
      </div>
      <div style="flex:1;min-width:70px;text-align:center;padding:10px 8px;background:rgba(255,255,255,.04);border-radius:8px;">
        <div style="font-family:Bebas Neue;font-size:28px;color:#10b981;">${strikes}</div>
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">Strikes</div>
      </div>
      <div style="flex:1;min-width:70px;text-align:center;padding:10px 8px;background:rgba(255,255,255,.04);border-radius:8px;">
        <div style="font-family:Bebas Neue;font-size:28px;color:var(--text);">${balls}</div>
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">Balls</div>
      </div>
      ${avgSpeed ? `<div style="flex:1;min-width:70px;text-align:center;padding:10px 8px;background:rgba(255,255,255,.04);border-radius:8px;">
        <div style="font-family:Bebas Neue;font-size:28px;color:#f5a623;">${avgSpeed}</div>
        <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">Avg MPH</div>
      </div>` : ''}
      ${(() => {
        const sp = PC.pitches.filter(p=>p.speed).map(p=>p.speed);
        const top = sp.length ? Math.max(...sp) : null;
        return top ? `<div style="flex:1;min-width:70px;text-align:center;padding:10px 8px;background:rgba(255,255,255,.04);border-radius:8px;">
          <div style="font-family:Bebas Neue;font-size:28px;color:#60a5fa;">${top}</div>
          <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">Top MPH</div>
        </div>` : '';
      })()}
      ${(() => {
        let ms=0,cs=0;
        PC.pitches.forEach(p=>{ if(p.zone!=='ball'){cs++;ms=Math.max(ms,cs);}else cs=0; });
        return ms>=2 ? `<div style="flex:1;min-width:70px;text-align:center;padding:10px 8px;background:rgba(16,185,129,.08);border-radius:8px;border:1px solid rgba(16,185,129,.2);">
          <div style="font-family:Bebas Neue;font-size:28px;color:#10b981;">${ms}</div>
          <div style="font-size:9px;color:var(--text2);text-transform:uppercase;">K Streak</div>
        </div>` : '';
      })()}
    </div>

    <!-- Type breakdown -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
      ${PT_TYPES.filter(t=>typeCounts[t.id]>0).map(t=>`
        <div style="display:flex;align-items:center;gap:6px;padding:6px 10px;
                    border-radius:8px;background:${t.color}15;border:1px solid ${t.color}33;">
          <div style="width:8px;height:8px;border-radius:50%;background:${t.color};flex-shrink:0;"></div>
          <div style="font-family:Bebas Neue;font-size:16px;color:${t.color};">${t.id}</div>
          <div style="font-size:12px;color:${t.color};">${typeCounts[t.id]}</div>
          <div style="font-size:10px;color:var(--text2);">(${total?Math.round(typeCounts[t.id]/total*100):0}%)</div>
        </div>`).join('')}
    </div>

    <!-- Mini zone heatmap -->
    <div style="margin-bottom:14px;">
      <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Zone Heat Map</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px;max-width:180px;">
        ${['0-0','0-1','0-2','1-0','1-1','1-2','2-0','2-1','2-2'].map(z => {
          const n = zoneCounts[z]||0;
          const intensity = n / maxZone;
          const bg = `rgba(239,68,68,${0.08 + intensity*0.7})`;
          return `<div style="padding:8px 4px;text-align:center;border-radius:5px;background:${bg};
                              border:1px solid rgba(255,255,255,.08);">
            <div style="font-family:Bebas Neue;font-size:16px;color:${n>0?'#ef4444':'var(--text2)'};">${n||'·'}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Save actions -->
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${PC.pitcher ? `
      <button onclick="pcSaveToPlayer()"
        style="width:100%;padding:11px;border-radius:9px;border:none;background:#ef4444;
               color:#fff;font-family:Bebas Neue;font-size:17px;letter-spacing:1px;cursor:pointer;">
        💾 SAVE TO ${(PC.pitcher.first+' '+PC.pitcher.last).toUpperCase()}'S PROFILE
      </button>` : ''}
      <button onclick="pcSaveToLeaderboard()"
        style="width:100%;padding:11px;border-radius:9px;border:1.5px solid ${CT_GOLD};
               background:rgba(245,166,35,.1);color:${CT_GOLD};font-family:Bebas Neue;
               font-size:16px;letter-spacing:1px;cursor:pointer;">
        🏆 POST TO LEADERBOARD
      </button>
      <button onclick="pcSaveSession()"
        style="width:100%;padding:10px;border-radius:9px;border:1.5px solid var(--border);
               background:rgba(255,255,255,.04);color:var(--text);font-family:Bebas Neue;
               font-size:15px;letter-spacing:1px;cursor:pointer;">
        📋 SAVE SESSION (no player)
      </button>
      <div style="display:flex;gap:8px;">
        <button onclick="pcNewSession()"
          style="flex:1;padding:10px;border-radius:9px;border:1px solid var(--border);
                 background:rgba(255,255,255,.04);color:var(--text2);font-family:Bebas Neue;
                 font-size:14px;cursor:pointer;">
          🔄 NEW SESSION
        </button>
        <button onclick="pcViewHistory()"
          style="flex:1;padding:10px;border-radius:9px;border:1px solid rgba(239,68,68,.3);
                 background:rgba(239,68,68,.08);color:#ef4444;font-family:Bebas Neue;
                 font-size:14px;cursor:pointer;">
          📈 VIEW HISTORY
        </button>
      </div>
    </div>
  </div>`;
}

function pcSaveToPlayer() {
  const session = _pcBuildSaveObject(true);
  const all = pcGetAll();
  all.unshift(session);
  pcSaveAll(all);
  if (typeof toast === 'function') toast(`✓ Pitch session saved to ${PC.pitcher.first} ${PC.pitcher.last}`);
  // Update journey modal if open
  const jc = document.getElementById('journeyContent');
  if (jc && PC.fromJourney && PC.pitcher) {
    const p = (typeof players !== 'undefined') ? players.find(pl =>
      pl.first.toLowerCase() === PC.pitcher.first.toLowerCase() &&
      pl.last.toLowerCase() === PC.pitcher.last.toLowerCase()
    ) : null;
    if (p) { const idx = players.indexOf(p); setTimeout(()=>showJourney(idx),100); }
  }
  const btn = document.querySelector('[onclick="pcSaveToPlayer()"]');
  if (btn) { btn.textContent = '✓ Saved!'; btn.style.background='#10b981'; btn.disabled=true; }
}

function pcSaveSession() {
  const session = _pcBuildSaveObject(false);
  const all = pcGetAll();
  all.unshift(session);
  pcSaveAll(all);
  if (typeof toast === 'function') toast('✓ Pitch session saved');
  const btn = document.querySelector('[onclick="pcSaveSession()"]');
  if (btn) { btn.textContent = '✓ Saved!'; btn.style.borderColor='#10b981'; btn.style.color='#10b981'; btn.disabled=true; }
}

function _pcBuildSaveObject(attachPitcher) {
  const total = PC.pitches.length;
  const strikes = PC.pitches.filter(p=>p.zone!=='ball').length;
  const withSpeed = PC.pitches.filter(p=>p.speed);
  let maxStreak=0, curStreak=0;
  PC.pitches.forEach(p=>{ if(p.zone!=='ball'){curStreak++;maxStreak=Math.max(maxStreak,curStreak);}else curStreak=0; });
  return {
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    pitcher: attachPitcher ? PC.pitcher : null,
    pitches: PC.pitches,
    total, strikes, balls: total-strikes,
    strikeRate: total ? Math.round(strikes/total*100) : 0,
    avgSpeed: withSpeed.length ? Math.round(withSpeed.reduce((s,p)=>s+p.speed,0)/withSpeed.length) : null,
    topSpeed: withSpeed.length ? Math.max(...withSpeed.map(p=>p.speed)) : null,
    maxStreak,
  };
}

function pcNewSession() {
  PC.state = 'setup'; PC.pitches = []; PC.pendingPitch = null;
  PC.pitcher = null; PC.targetCount = 0; PC.fromJourney = false;
  pcRefresh();
}

function pcViewHistory() {
  const all = pcGetAll();
  const c = document.getElementById(PC.containerId);
  if (!c) return;

  if (!all.length) {
    c.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text2);">No saved sessions yet.</div>
    <button onclick="pcNewSession()" style="width:100%;padding:10px;border-radius:9px;border:1px solid var(--border);background:none;color:var(--text2);font-family:Bebas Neue;font-size:14px;cursor:pointer;">← BACK</button>`;
    return;
  }

  c.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <button onclick="pcNewSession()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:18px;padding:0;">←</button>
      <div style="font-family:Bebas Neue;font-size:18px;color:#ef4444;">Pitch Session History</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto;">
      ${all.slice(0,20).map((s,i) => `
        <div style="padding:10px 12px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:9px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;min-width:100px;">
            <div style="font-weight:600;font-size:13px;">${s.pitcher?s.pitcher.first+' '+s.pitcher.last:'Unknown Pitcher'}</div>
            <div style="font-size:11px;color:var(--text2);">${s.date} · ${s.total} pitches</div>
          </div>
          <div style="font-family:Bebas Neue;font-size:20px;color:${s.strikeRate>=65?'#10b981':s.strikeRate>=55?'#f5a623':'#ef4444'};">${s.strikeRate}%</div>
          ${s.avgSpeed?`<div style="font-size:11px;color:var(--gold);">${s.avgSpeed} mph</div>`:''}
          <button onclick="pcDeleteSession(${i})"
            style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:14px;padding:2px 6px;">✕</button>
        </div>`).join('')}
    </div>`;
}

function pcDeleteSession(idx) {
  const all = pcGetAll();
  all.splice(idx,1);
  pcSaveAll(all);
  pcViewHistory();
}

// ── Init from coaching panel tab ─────────────────────────────
function pcInit(containerId, pitcherFirst, pitcherLast, fromJourney) {
  // Don't override containerId if ctSwitchTool will set it correctly
  PC.state = 'setup';
  PC.inputMode = 'net';
  PC.pitches = [];
  PC.pendingPitch = null;
  PC.fromJourney = !!fromJourney;
  if (pitcherFirst && pitcherLast) {
    PC.pitcher = {first:pitcherFirst, last:pitcherLast, key:`${pitcherFirst}|${pitcherLast[0]?.toUpperCase()}`};
    PC.targetCount = 20;
    PC.state = 'plotting';
  } else {
    PC.pitcher = null;
    PC.targetCount = 0;
  }
  // If a specific containerId is provided (not going through ctSwitchTool), render there
  if (containerId && containerId !== 'coachingToolsPanel') {
    PC.containerId = containerId;
    pcRefresh();
  }
  // Otherwise, let ctSwitchTool('pitch') set PC.containerId = 'ct-tool-body' and render
}

// Pitch history display in journey modal
function pcPlayerHistory(first, last) {
  const all = pcGetAll();
  const sessions = all.filter(s => s.pitcher &&
    s.pitcher.first.toLowerCase() === first.toLowerCase() &&
    s.pitcher.last.toLowerCase() === last.toLowerCase()
  );
  if (!sessions.length) return '';
  return `
  <div style="margin-top:14px;">
    <div style="font-family:Bebas Neue;font-size:16px;letter-spacing:.5px;margin-bottom:8px;">
      🎯 Pitch <span style="color:#ef4444;">History</span>
      <span style="font-family:'DM Sans';font-size:11px;font-weight:400;color:var(--text2);margin-left:6px;">${sessions.length} session${sessions.length!==1?'s':''}</span>
    </div>
    ${sessions.slice(0,5).map(s => {
      const srColor = s.strikeRate>=65?'#10b981':s.strikeRate>=55?'#f5a623':'#ef4444';
      const typeCounts = {};
      s.pitches.forEach(p => { typeCounts[p.type]=(typeCounts[p.type]||0)+1; });
      return `<div style="padding:9px 12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:9px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <div style="font-size:11px;color:var(--text2);">${s.date}</div>
          <div style="font-family:Bebas Neue;font-size:18px;color:${srColor};margin-left:auto;">${s.strikeRate}%</div>
          <div style="font-size:10px;color:var(--text2);">${s.total} pitches</div>
          ${s.avgSpeed?`<div style="font-size:10px;color:var(--gold);">avg ${s.avgSpeed}mph</div>`:''}
          ${s.topSpeed?`<div style="font-size:10px;color:#60a5fa;font-weight:700;">top ${s.topSpeed}mph</div>`:''}
          ${s.maxStreak>=2?`<div style="font-size:10px;color:#10b981;">🔥${s.maxStreak} streak</div>`:''}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          ${Object.entries(typeCounts).map(([t,n])=>{
            const pt = PT_TYPES.find(x=>x.id===t)||{color:'var(--text2)'};
            return `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:${pt.color}18;color:${pt.color};font-weight:700;">${t} ${n}</span>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
    ${sessions.length > 5 ? `<div style="font-size:11px;color:var(--text2);text-align:center;">+${sessions.length-5} more sessions</div>` : ''}
  </div>`;
}



// ══════════════════════════════════════════════════
// PITCH GAME SIMULATOR
// ══════════════════════════════════════════════════

// ── Zone definitions — 9 pockets only ────────────────────────────────
// Pocket zones: row-col (0-0 to 2-2)
const POCKET_ZONES = ['0-0','0-1','0-2','1-0','1-1','1-2','2-0','2-1','2-2'];
const GAME_ZONES   = POCKET_ZONES;  // 9-pocket game uses pockets only

const GAME_ZONE_NAMES = {
  '0-0':'High In','0-1':'High Mid','0-2':'High Out',
  '1-0':'Mid In', '1-1':'Middle',  '1-2':'Mid Out',
  '2-0':'Low In', '2-1':'Low Mid', '2-2':'Low Out',
};

// ── Random target picker ─────────────────────────────────────────────
function _pcRandomTarget() {
  return GAME_ZONES[Math.floor(Math.random() * GAME_ZONES.length)];
}

// ── Net canvas geometry (normalized 0-1) ────────────────────────────
// Net canvas: 240 wide × 300 tall (taller than wide, realistic 9-pocket net)
// Outer frame: x 0.05–0.95, y 0.06–0.94  (margin of 5% each side)
// 3×3 pocket grid fills the interior of the frame
const NET = {
  W: 240, H: 300,
  fl: 0.05, ft: 0.06, fr: 0.95, fb: 0.94,   // frame outer edges (normalized)
  get fw() { return this.fr - this.fl; },      // frame width fraction
  get fh() { return this.fb - this.ft; },      // frame height fraction
};


// ── Game start ───────────────────────────────────────────────────────
function pcStartGame(mode) {
  const custom = document.getElementById('pc-custom-count');
  const customVal = custom ? parseInt(custom.value) : 0;
  PC.gameCount = customVal > 0 ? customVal : (PC.targetCount || 10);
  if (!PC.gameCount || PC.gameCount > 999) PC.gameCount = 10;

  const inp = document.getElementById('pc-pitcher-inp');
  const name = inp ? inp.value.trim() : '';
  if (name && typeof players !== 'undefined') {
    const parts = name.split(' ');
    const match = players.find(p =>
      p.first.toLowerCase() === (parts[0]||'').toLowerCase() &&
      p.last.toLowerCase()  === (parts[1]||'').toLowerCase());
    PC.pitcher = match
      ? {first:match.first, last:match.last, key:`${match.first}|${match.last[0]?.toUpperCase()}`}
      : {first:parts[0]||name, last:parts[1]||'', key:name};
  }

  PC.gameMode    = mode;
  PC.gamePitches = [];
  PC.gameTarget  = _pcRandomTarget();
  PC.gamePhase   = 'aim';   // 'aim' | 'result' — for accuracy canvas mode
  PC.pendingSpeed = 45;     // MPH speed to save with pitch
  PC.gameHitFx   = null;    // {fx, fy} of where they clicked
  PC.state = 'game';
  pcRefresh();
}

// ── Net SVG renderer ────────────────────────────────────────────────
// Returns an SVG string showing the net with optional target & hit markers
// ── Strike zone + batter's box accuracy canvas ───────────────────────
// Canvas: 280w × 360h  — realistic pitching view aspect ratio
// Layout (all normalized 0–1):
//   Batter's box context: full canvas
//   Strike zone: center band, roughly 30% wide, 35% tall
//   Canvas is intentionally large so wild throws land visibly outside
const SZC = {
  // Strike zone bounds (normalized 0–1 on canvas)
  l: 0.30, r: 0.70,   // 40% of canvas width
  t: 0.22, b: 0.65,   // 43% of canvas height — taller than wide
  // Zone pocket dimensions
  get pw() { return (this.r - this.l) / 3; },
  get ph() { return (this.b - this.t) / 3; },
};

function _pcZoneCenter(zone) {
  if (!zone || !zone.includes('-')) return { fx: 0.5, fy: 0.5 };
  const row = parseInt(zone[0]), col = parseInt(zone[2]);
  const szW = SZ.r - SZ.l, szH = SZ.b - SZ.t;
  return {
    fx: SZ.l + (col + 0.5) * szW / 3,
    fy: SZ.t + (row + 0.5) * szH / 3,
  };
}
function _pcZoneDist(z1, z2) {
  const a = _pcZoneCenter(z1), b = _pcZoneCenter(z2);
  return Math.sqrt((a.fx - b.fx) ** 2 + (a.fy - b.fy) ** 2);
}
function _pcPointDist(ax, ay, bx, by) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}
// Max score 1000, linear falloff. Distance 0 = 1000, distance 0.40 = 0
function _pcAccuracyScore(dist) {
  return Math.max(0, Math.round(1000 * (1 - dist / 0.40)));
}

// Returns SVG of the strike zone with batter's box context
// opts: { targetZone, hitFx, hitFy, showHit }
function _pcStrikeZoneSVG(opts) {
  const W = 280, H = 360;
  const szL = SZC.l * W, szR = SZC.r * W;
  const szT = SZC.t * H, szB = SZC.b * H;
  const szW = szR - szL, szH = szB - szT;
  const pw  = szW / 3,   ph  = szH / 3;

  // Home plate shape (bottom of canvas, perspective view)
  const plateW = szW * 0.85;
  const plateCX = W / 2, plateY = H * 0.91;
  const platePoints = [
    `${plateCX - plateW/2},${plateY - 10}`,
    `${plateCX + plateW/2},${plateY - 10}`,
    `${plateCX + plateW/2},${plateY + 2}`,
    `${plateCX},${plateY + 14}`,
    `${plateCX - plateW/2},${plateY + 2}`,
  ].join(' ');

  // Batter's box outlines (perspective trapezoidal)
  const bbW = plateW * 0.65, bbH = H * 0.28;
  const bbTop = H * 0.63, bbBottom = H * 0.91;
  const shrink = 0.25; // perspective taper
  const lbbL = plateCX - plateW/2 - bbW * (1 - shrink);
  const lbbR = plateCX - plateW/2 + bbW * shrink;
  const rbbL = plateCX + plateW/2 - bbW * shrink;
  const rbbR = plateCX + plateW/2 + bbW * (1 - shrink);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"
    style="width:100%;height:100%;display:block;">
  <defs>
    <filter id="szglow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="hitglow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="bggrad" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#0f2040"/>
      <stop offset="100%" stop-color="#060e1a"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bggrad)" rx="10"/>

  <!-- Pitcher's mound hint (very faint) -->
  <ellipse cx="${W/2}" cy="${H*0.04}" rx="28" ry="8" fill="rgba(120,100,60,0.12)" stroke="rgba(180,150,80,0.08)" stroke-width="1"/>

  <!-- Batter's boxes (left and right) -->
  <polygon points="${lbbL},${bbBottom} ${lbbR},${bbBottom} ${lbbR - (lbbR-lbbL)*shrink},${bbTop} ${lbbL + (lbbR-lbbL)*shrink*0.3},${bbTop}"
    fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5" stroke-dasharray="5,4"/>
  <polygon points="${rbbL},${bbBottom} ${rbbR},${bbBottom} ${rbbR - (rbbR-rbbL)*shrink*0.3},${bbTop} ${rbbL + (rbbR-rbbL)*shrink},${bbTop}"
    fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5" stroke-dasharray="5,4"/>

  <!-- Home plate -->
  <polygon points="${platePoints}" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>

  <!-- Strike zone outer border with subtle glow -->
  <rect x="${szL}" y="${szT}" width="${szW}" height="${szH}"
    fill="rgba(37,99,235,0.06)" stroke="#3b82f6" stroke-width="2.5" rx="3"/>

  <!-- Zone grid lines (pocket dividers) -->
  ${[1,2].map(i => `
  <line x1="${szL + pw*i}" y1="${szT}" x2="${szL + pw*i}" y2="${szB}"
    stroke="rgba(96,165,250,0.3)" stroke-width="1" stroke-dasharray="4,3"/>
  <line x1="${szL}" y1="${szT + ph*i}" x2="${szR}" y2="${szT + ph*i}"
    stroke="rgba(96,165,250,0.3)" stroke-width="1" stroke-dasharray="4,3"/>`).join('')}

  <!-- Pocket labels (very faint) -->
  ${['1','2','3','4','5','6','7','8','9'].map((n, i) => {
    const r = Math.floor(i/3), c = i%3;
    const cx = szL + pw*(c+0.5), cy = szT + ph*(r+0.5);
    return `<text x="${cx}" y="${cy+5}" text-anchor="middle"
      fill="rgba(255,255,255,0.08)" font-size="20" font-family="monospace">${n}</text>`;
  }).join('')}

  <!-- Perspective lines from strike zone corners down to plate -->
  <line x1="${szL}" y1="${szB}" x2="${plateCX - plateW/2}" y2="${plateY - 10}"
    stroke="rgba(96,165,250,0.06)" stroke-width="1"/>
  <line x1="${szR}" y1="${szB}" x2="${plateCX + plateW/2}" y2="${plateY - 10}"
    stroke="rgba(96,165,250,0.06)" stroke-width="1"/>`;

  // Target bullseye
  if (opts && opts.targetZone) {
    const tc = _pcZoneCenter(opts.targetZone);
    const tx = tc.fx * W, ty = tc.fy * H;
    const row = parseInt(opts.targetZone[0]), col = parseInt(opts.targetZone[2]);

    // Highlight the target pocket cell
    svg += `<rect x="${szL + col*pw + 2}" y="${szT + row*ph + 2}"
      width="${pw - 4}" height="${ph - 4}"
      fill="rgba(251,191,36,0.12)" stroke="#fbbf24" stroke-width="1.5" rx="3"
      stroke-dasharray="5,3"/>`;

    // Bullseye rings
    svg += `
    <circle cx="${tx}" cy="${ty}" r="22" fill="none" stroke="rgba(251,191,36,0.15)" stroke-width="1.5"/>
    <circle cx="${tx}" cy="${ty}" r="14" fill="none" stroke="rgba(251,191,36,0.3)"  stroke-width="1.5"/>
    <circle cx="${tx}" cy="${ty}" r="7"  fill="rgba(251,191,36,0.2)" stroke="#fbbf24" stroke-width="2" filter="url(#szglow)"/>
    <circle cx="${tx}" cy="${ty}" r="3"  fill="#fbbf24"/>
    <!-- Crosshair lines -->
    <line x1="${tx-16}" y1="${ty}" x2="${tx-8}"  y2="${ty}" stroke="#fbbf24" stroke-width="1.5"/>
    <line x1="${tx+8}"  y1="${ty}" x2="${tx+16}" y2="${ty}" stroke="#fbbf24" stroke-width="1.5"/>
    <line x1="${tx}" y1="${ty-16}" x2="${tx}" y2="${ty-8}"  stroke="#fbbf24" stroke-width="1.5"/>
    <line x1="${tx}" y1="${ty+8}"  x2="${tx}" y2="${ty+16}" stroke="#fbbf24" stroke-width="1.5"/>`;
  }

  // Hit marker
  if (opts && opts.showHit && opts.hitFx != null) {
    const hx = opts.hitFx * W, hy = opts.hitFy * H;
    const hitColor = '#ef4444';
    svg += `
    <circle cx="${hx}" cy="${hy}" r="9" fill="rgba(239,68,68,0.25)" stroke="${hitColor}" stroke-width="2.5" filter="url(#hitglow)"/>
    <line x1="${hx-7}" y1="${hy}" x2="${hx+7}" y2="${hy}" stroke="${hitColor}" stroke-width="2.5"/>
    <line x1="${hx}" y1="${hy-7}" x2="${hx}" y2="${hy+7}" stroke="${hitColor}" stroke-width="2.5"/>`;

    // Dashed line from target to hit
    if (opts.targetZone) {
      const tc = _pcZoneCenter(opts.targetZone);
      const tx = tc.fx * W, ty = tc.fy * H;
      svg += `<line x1="${tx}" y1="${ty}" x2="${hx}" y2="${hy}"
        stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-dasharray="4,3"/>`;
    }
  }

  svg += `\n  <!-- "STRIKE ZONE" label -->
  <text x="${W/2}" y="${szT - 8}" text-anchor="middle"
    fill="rgba(96,165,250,0.4)" font-size="9" font-family="monospace" letter-spacing="2">STRIKE ZONE</text>
  <!-- "BALL" zone hint labels -->
  <text x="${szL * 0.5}" y="${szT + szH*0.5}" text-anchor="middle"
    fill="rgba(255,255,255,0.06)" font-size="9" font-family="monospace">BALL</text>
  <text x="${szR + (W-szR)*0.5}" y="${szT + szH*0.5}" text-anchor="middle"
    fill="rgba(255,255,255,0.06)" font-size="9" font-family="monospace">BALL</text>
</svg>`;

  return svg;
}


// ── GAME MODE RENDERER ───────────────────────────────────────────────────
// Both games use the same pc-canvas (280×360) as the regular plot view.
// Accuracy mode: bullseye drawn on canvas, tap anywhere, score by distance.
// Target/9-pocket mode: target pocket highlighted, tap inside = hit.

function _pcGame() {
  const done  = PC.gamePitches.length;
  const total = PC.gameCount;
  const isAccuracy = PC.gameMode === 'accuracy';
  const pct = Math.round(done / total * 100);
  const pitcherLabel = PC.pitcher ? `${PC.pitcher.first} ${PC.pitcher.last}` : '';
  const totalScore = PC.gamePitches.reduce((s, p) => s + (p.score || 0), 0);
  const hits = PC.gamePitches.filter(p => p.hit).length;
  const hitPct = done ? Math.round(hits / done * 100) : 0;
  const col = isAccuracy ? '#a78bfa' : '#60a5fa';
  const targetName = GAME_ZONE_NAMES[PC.gameTarget] || PC.gameTarget || '—';

  // Stable initial render — canvas never destroyed, dynamic sections get IDs
  return `
  <div id="pc-game-wrap">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
      <div style="font-family:'Bebas Neue';font-size:15px;color:${col};letter-spacing:.5px;">
        ${isAccuracy ? '📍 Accuracy Mode' : '🎯 9-Pocket Game'}
      </div>
      ${pitcherLabel ? `<div style="font-size:11px;color:var(--text2);">${pitcherLabel}</div>` : ''}
      <div id="pc-count-label" style="font-family:'Bebas Neue';font-size:18px;margin-left:auto;">${done}/${total}</div>
    </div>
    <div style="height:4px;border-radius:2px;background:rgba(255,255,255,.08);margin-bottom:8px;overflow:hidden;">
      <div id="pc-progress-bar" style="height:100%;width:${pct}%;background:${col};border-radius:2px;transition:width .3s;"></div>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px;">
      ${isAccuracy ? `<div style="flex:1;text-align:center;padding:6px;background:${col}18;border-radius:8px;border:1px solid ${col}33;">
        <div id="pc-score-val" style="font-family:'Bebas Neue';font-size:22px;color:${col};">${totalScore}</div>
        <div style="font-size:9px;color:var(--text2);">SCORE</div>
      </div>` : ''}
      <div style="flex:1;text-align:center;padding:6px;background:rgba(255,255,255,.04);border-radius:8px;">
        <div id="pc-hits-val" style="font-family:'Bebas Neue';font-size:22px;color:#10b981;">${hits}</div>
        <div style="font-size:9px;color:var(--text2);">HITS</div>
      </div>
      <div style="flex:1;text-align:center;padding:6px;background:rgba(255,255,255,.04);border-radius:8px;">
        <div id="pc-acc-val" style="font-family:'Bebas Neue';font-size:22px;color:${hitPct>=60?'#10b981':hitPct>=40?'#f5a623':'#ef4444'};">${done?hitPct+'%':'—'}</div>
        <div style="font-size:9px;color:var(--text2);">ACC</div>
      </div>
      <div style="flex:1;text-align:center;padding:6px;background:rgba(255,255,255,.04);border-radius:8px;">
        <div id="pc-left-val" style="font-family:'Bebas Neue';font-size:22px;color:var(--text2);">${total-done}</div>
        <div style="font-size:9px;color:var(--text2);">LEFT</div>
      </div>
    </div>
    <div id="pc-target-label" style="text-align:center;font-size:11px;color:var(--text2);margin-bottom:4px;">
      Target: <strong style="color:${col};">${targetName}</strong>
    </div>
    <div id="pc-result-card" style="display:none;"></div>
    <div id="pc-action-row" style="display:flex;gap:8px;margin-bottom:8px;">
      <div style="flex:1;text-align:center;padding:10px;color:var(--text2);font-size:12px;">Tap canvas to throw</div>
      <button id="pc-end-btn" style="padding:10px 14px;border-radius:9px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text2);font-family:DM Sans;font-size:12px;cursor:pointer;">End</button>
    </div>
    <div style="display:flex;justify-content:center;margin-top:8px;">
      <div style="position:relative;display:inline-block;">
        <canvas id="pc-canvas" width="280" height="360"
          style="border-radius:10px;background:rgba(0,0,0,.35);cursor:crosshair;
                 border:1px solid rgba(255,255,255,.1);touch-action:none;display:block;">
        </canvas>
      </div>
    </div>
  </div>`;
}

// Bind persistent buttons (End) - called once after initial render
function _pcBindGameStatic() {
  const endBtn = document.getElementById('pc-end-btn');
  if (endBtn && !endBtn._bound) { endBtn._bound = true; endBtn.addEventListener('click', pcEndGame); }
}

// ── Update game UI without touching the canvas element ───────────────────
function _pcGameUpdate() {
  const done  = PC.gamePitches.length;
  const total = PC.gameCount;
  const phase = PC.gamePhase || 'aim';
  const isAccuracy = PC.gameMode === 'accuracy';
  const col = isAccuracy ? '#a78bfa' : '#60a5fa';
  const pct = Math.round(done / total * 100);
  const totalScore = PC.gamePitches.reduce((s, p) => s + (p.score || 0), 0);
  const hits = PC.gamePitches.filter(p => p.hit).length;
  const hitPct = done ? Math.round(hits / done * 100) : 0;
  const last = PC.gamePitches[done - 1];

  // Stats
  const countEl = document.getElementById('pc-count-label');
  const barEl   = document.getElementById('pc-progress-bar');
  const hitsEl  = document.getElementById('pc-hits-val');
  const accEl   = document.getElementById('pc-acc-val');
  const leftEl  = document.getElementById('pc-left-val');
  const scoreEl = document.getElementById('pc-score-val');
  if (countEl) countEl.textContent = done + '/' + total;
  if (barEl)   barEl.style.width = pct + '%';
  if (hitsEl)  hitsEl.textContent = hits;
  if (accEl)  { accEl.textContent = done ? hitPct + '%' : '—'; accEl.style.color = hitPct>=60?'#10b981':hitPct>=40?'#f5a623':'#ef4444'; }
  if (leftEl)  leftEl.textContent = total - done;
  if (scoreEl) scoreEl.textContent = totalScore;

  const canvas   = document.getElementById('pc-canvas');
  const targetEl = document.getElementById('pc-target-label');
  const resultEl = document.getElementById('pc-result-card');
  const actionEl = document.getElementById('pc-action-row');

  if (phase === 'aim') {
    const targetName = GAME_ZONE_NAMES[PC.gameTarget] || PC.gameTarget || '—';
    if (canvas) canvas.style.cursor = 'crosshair';
    if (targetEl) targetEl.innerHTML = 'Target: <strong style="color:' + col + ';">' + targetName + '</strong>';
    if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
    if (actionEl) {
      actionEl.innerHTML =
        '<div style="flex:1;text-align:center;padding:10px;color:var(--text2);font-size:12px;">Tap canvas to throw</div>' +
        '<button id="pc-end-btn" style="padding:10px 14px;border-radius:9px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text2);font-family:DM Sans;font-size:12px;cursor:pointer;">End</button>' +
        (done > 0 ? '<button id="pc-undo-btn" style="padding:10px 14px;border-radius:9px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text2);font-family:DM Sans;font-size:12px;cursor:pointer;">↩</button>' : '');
      const eb = document.getElementById('pc-end-btn'); if (eb) eb.addEventListener('click', pcEndGame);
      const ub = document.getElementById('pc-undo-btn'); if (ub) ub.addEventListener('click', pcUndoLastGamePitch);
    }
  } else if (phase === 'result' && last) {
    const sc = last.score || 0;
    const scCol = sc >= 800 ? '#10b981' : sc >= 500 ? '#60a5fa' : sc >= 200 ? '#f5a623' : '#ef4444';
    const msg = sc >= 900 ? '🔥 Perfect!' : sc >= 700 ? '✓ Great!' : sc >= 400 ? '— Good' : '✗ Miss';
    const subText = isAccuracy
      ? 'Score: ' + sc + ' · ' + (last.distance*100).toFixed(1) + ' units off'
      : (last.hit ? 'Bullseye — ' + (GAME_ZONE_NAMES[last.target]||last.target) : (GAME_ZONE_NAMES[last.actual]||last.actual) + ' · target was ' + (GAME_ZONE_NAMES[last.target]||last.target));
    const spd = PC.pendingSpeed || 45;
    if (canvas) canvas.style.cursor = 'default';
    if (targetEl) targetEl.innerHTML = 'Threw at: <strong>' + (GAME_ZONE_NAMES[last.target]||last.target||'') + '</strong>';
    if (resultEl) {
      resultEl.style.display = '';
      resultEl.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:' + scCol + '18;border:1px solid ' + scCol + '44;margin-bottom:8px;">' +
        '<div style="font-family:Bebas Neue;font-size:38px;line-height:1;color:' + scCol + ';min-width:44px;text-align:center;">' + (last.hit ? '✓' : '✗') + '</div>' +
        '<div style="flex:1;"><div style="font-size:13px;font-weight:700;color:' + scCol + ';">' + msg + '</div>' +
        '<div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:2px;">' + subText + '</div></div>' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:0;min-width:64px;">' +
        '<button id="spd-up" style="width:36px;height:28px;border-radius:6px 6px 0 0;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;font-size:14px;cursor:pointer;line-height:1;">▲</button>' +
        '<div style="background:rgba(0,0,0,0.4);border-left:1px solid rgba(255,255,255,0.15);border-right:1px solid rgba(255,255,255,0.15);width:36px;text-align:center;padding:2px 0;">' +
        '<div id="pc-spd-display" style="font-family:Bebas Neue;font-size:20px;color:#fff;line-height:1;">' + spd + '</div>' +
        '<div style="font-size:8px;color:rgba(255,255,255,0.4);margin-top:-1px;">MPH</div></div>' +
        '<button id="spd-dn" style="width:36px;height:28px;border-radius:0 0 6px 6px;border:1px solid rgba(255,255,255,0.15);border-top:none;background:rgba(255,255,255,0.08);color:#fff;font-size:14px;cursor:pointer;line-height:1;">▼</button>' +
        '</div></div>';
      const su = document.getElementById('spd-up'), sd = document.getElementById('spd-dn'), sdsp = document.getElementById('pc-spd-display');
      if (su) su.addEventListener('click', function(e) { e.stopPropagation(); PC.pendingSpeed = Math.min(99,(PC.pendingSpeed||45)+1); if(sdsp) sdsp.textContent=PC.pendingSpeed; });
      if (sd) sd.addEventListener('click', function(e) { e.stopPropagation(); PC.pendingSpeed = Math.max(30,(PC.pendingSpeed||45)-1); if(sdsp) sdsp.textContent=PC.pendingSpeed; });
    }
    if (actionEl) {
      const isLast = done >= total;
      actionEl.innerHTML =
        '<button id="pc-next-btn" style="flex:1;padding:10px;border-radius:9px;border:1.5px solid ' + (isLast?'#10b981':col) + ';background:' + (isLast?'rgba(16,185,129,.15)':col+'22') + ';color:' + (isLast?'#10b981':col) + ';font-family:Bebas Neue;font-size:16px;cursor:pointer;">' + (isLast ? '🏁 FINISH' : 'NEXT PITCH ›') + '</button>' +
        '<button id="pc-end-btn2" style="padding:10px 14px;border-radius:9px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text2);font-family:DM Sans;font-size:12px;cursor:pointer;">End</button>';
      const nb = document.getElementById('pc-next-btn'); if (nb) nb.addEventListener('click', function(e) { e.stopPropagation(); pcGameNextWithSpeed(); });
      const eb2 = document.getElementById('pc-end-btn2'); if (eb2) eb2.addEventListener('click', pcEndGame);
    }
  }
  // Redraw canvas with updated overlays
  if (canvas) _pcDrawCanvas(canvas);
}

// ── Bind canvas for game mode ─────────────────────────────────────────────
function _pcBindGameCanvas() {
  const canvas = document.getElementById('pc-canvas');
  if (!canvas) return;

  // Remove old listeners by replacing the element only if not already bound
  if (!canvas._gameBound) {
    canvas._gameBound = true;
    _pcDrawCanvas(canvas);
  }

  // Animate the flashing pocket in target game mode
  if (PC.gameMode === 'target' && PC.gamePhase === 'aim') {
    _pcCancelAnim();
    const animate = () => {
      const cv = document.getElementById('pc-canvas');
      if (!cv || PC.gamePhase !== 'aim') { _pcCancelAnim(); return; }
      _pcDrawCanvas(cv);
      PC._animFrameId = requestAnimationFrame(animate);
    };
    PC._animFrameId = requestAnimationFrame(animate);
  }

  if (PC.gamePhase !== 'aim') return;

  // Remove existing touch/mouse listeners by cloning ONLY if not yet bound
  const bindId = '_gameClickBound';
  if (canvas[bindId]) return;
  canvas[bindId] = true;

  let dragging = false, downX, downY;
  function getXY(e) {
    const r = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { fx: (cx-r.left)/r.width, fy: (cy-r.top)/r.height };
  }
  let _lastClick = 0;
  function fireClick(fx, fy) {
    const now = Date.now();
    if (now - _lastClick < 400) return;
    _lastClick = now;
    pcGameCanvasClick(fx, fy);
  }
  canvas.addEventListener('mousedown',  function(e) { e.preventDefault(); const p=getXY(e); dragging=true; downX=p.fx; downY=p.fy; });
  canvas.addEventListener('touchstart', function(e) { e.preventDefault(); const p=getXY(e); dragging=true; downX=p.fx; downY=p.fy; }, {passive:false});
  canvas.addEventListener('mouseup', function(e) {
    if (!dragging) return; dragging=false; e.preventDefault();
    const p = getXY(e);
    const dx=Math.abs(p.fx-downX), dy=Math.abs(p.fy-downY);
    fireClick(dx<0.03&&dy<0.03 ? downX : p.fx, dx<0.03&&dy<0.03 ? downY : p.fy);
  });
  canvas.addEventListener('touchend', function(e) {
    if (!dragging) return; dragging=false; e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const t = e.changedTouches[0];
    fireClick(Math.max(0,Math.min(1,(t.clientX-r.left)/r.width)), Math.max(0,Math.min(1,(t.clientY-r.top)/r.height)));
  }, {passive:false});
  canvas.addEventListener('touchmove', function(e) { e.preventDefault(); }, {passive:false});
}

// ── Handle a canvas click in game mode ────────────────────────────────────
function pcGameCanvasClick(fx, fy) {
  if (PC.gamePhase !== 'aim') return;
  const cfx = Math.max(0, Math.min(1, fx));
  const cfy = Math.max(0, Math.min(1, fy));
  const target = PC.gameTarget;
  const actualZone = pcZoneFromXY(cfx, cfy);
  const tc = _pcZoneCenter(target);
  const dist = Math.sqrt((cfx-tc.fx)**2 + (cfy-tc.fy)**2);
  let hit, score;
  if (PC.gameMode === 'accuracy') {
    hit = actualZone === target;
    score = Math.max(0, Math.round(1000 * (1 - dist / 0.35)));
  } else {
    hit = actualZone === target;
    score = hit ? 1000 : Math.max(0, Math.round(1000 * (1 - dist / 0.35)));
  }
  PC.gamePitches.push({ target, actual: actualZone, hitFx: cfx, hitFy: cfy, hit, distance: dist, score });
  PC.gamePhase = 'result';
  _pcCancelAnim();
  _pcGameUpdate(); // targeted DOM update — canvas untouched
}

// ── Cancel any running animation frame loop ───────────────────────────────
function _pcCancelAnim() {
  if (PC._animFrameId) { cancelAnimationFrame(PC._animFrameId); PC._animFrameId = null; }
}

function pcGameNextWithSpeed() {
  const last = PC.gamePitches[PC.gamePitches.length - 1];
  if (last) last.speed = PC.pendingSpeed || 45;
  if (PC.gamePitches.length >= PC.gameCount) { pcEndGame(); return; }
  PC.pendingSpeed = 45;
  let next;
  do { next = _pcRandomTarget(); } while (next === PC.gameTarget && GAME_ZONES.length > 1);
  PC.gameTarget = next;
  PC.gamePhase  = 'aim';
  _pcCancelAnim();
  // Re-bind canvas for new aim phase (need fresh click binding)
  const canvas = document.getElementById('pc-canvas');
  if (canvas) { delete canvas._gameClickBound; }
  _pcGameUpdate();
  if (canvas) _pcBindGameCanvas();
}

function pcGameNext() {
  if (PC.gamePitches.length >= PC.gameCount) { pcEndGame(); return; }
  let next;
  do { next = _pcRandomTarget(); } while (next === PC.gameTarget && GAME_ZONES.length > 1);
  PC.gameTarget = next;
  PC.gamePhase  = 'aim';
  PC.pendingSpeed = 45;
  _pcCancelAnim();
  const canvas = document.getElementById('pc-canvas');
  if (canvas) { delete canvas._gameClickBound; }
  _pcGameUpdate();
  if (canvas) _pcBindGameCanvas();
}

function pcUndoLastGamePitch() {
  if (PC.gamePitches.length > 0) { PC.gamePitches.pop(); PC.gamePhase = 'aim'; }
  const canvas = document.getElementById('pc-canvas');
  if (canvas) { delete canvas._gameClickBound; }
  _pcGameUpdate();
  if (canvas) _pcBindGameCanvas();
}

// ── pcGameTap kept for compatibility (no-op now) ──────────────────────────
function pcGameTap(zone) {}

// ── pcAccuracyClick / pcAccuracyNext kept for compatibility ──────────────
function pcAccuracyClick(event) {}
function pcAccuracyNext() { pcGameNext(); }

// ── End game ──────────────────────────────────────────────────────────────
function pcEndGame() {
  // Save speed on the last pitch if we're ending from result phase
  const lastP = PC.gamePitches[PC.gamePitches.length - 1];
  if (lastP && !lastP.speed) lastP.speed = PC.pendingSpeed || 45;
  PC.state = 'done';
  PC.pitches = PC.gamePitches.map(g => ({
    fx: g.hitFx ?? _pcZoneCenter(g.actual).fx,
    fy: g.hitFy ?? _pcZoneCenter(g.actual).fy,
    zone: g.actual, type: '4FB', speed: null,
    gameTarget: g.target, gameHit: g.hit, gameDist: g.distance,
  }));
  pcRefresh();
  setTimeout(() => {
    const container = document.getElementById(PC.containerId);
    if (!container) return;
    const isAccuracy = PC.gameMode === 'accuracy';
    const hits = PC.gamePitches.filter(p=>p.hit).length;
    const total = PC.gamePitches.length;
    const hitPct = total ? Math.round(hits/total*100) : 0;
    const totalScore = PC.gamePitches.reduce((s,p)=>s+(p.score||0),0);
    const maxScore = total*1000;
    const scorePct = maxScore ? Math.round(totalScore/maxScore*100) : 0;
    const col = isAccuracy ? '#a78bfa' : '#60a5fa';
    const scoreColor = scorePct>=70?'#10b981':scorePct>=45?'#f5a623':'#ef4444';

    const gameBlock = `
    <div style="background:${col}14;border:1px solid ${col}44;border-radius:12px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-family:'Bebas Neue';font-size:16px;letter-spacing:.5px;margin-bottom:10px;color:${col};">
        ${isAccuracy ? '📍 Accuracy Results' : '🎯 9-Pocket Results'}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        ${isAccuracy ? `
        <div style="text-align:center;padding:8px 14px;background:${col}18;border-radius:8px;border:1px solid ${col}44;">
          <div style="font-family:'Bebas Neue';font-size:32px;color:${scoreColor};">${totalScore}</div>
          <div style="font-size:9px;color:var(--text2);">TOTAL SCORE</div>
        </div>
        <div style="text-align:center;padding:8px 14px;background:rgba(255,255,255,.04);border-radius:8px;">
          <div style="font-family:'Bebas Neue';font-size:32px;color:${scoreColor};">${scorePct}%</div>
          <div style="font-size:9px;color:var(--text2);">OF MAX</div>
        </div>` : ''}
        <div style="text-align:center;padding:8px 14px;background:rgba(255,255,255,.04);border-radius:8px;">
          <div style="font-family:'Bebas Neue';font-size:32px;color:${hitPct>=70?'#10b981':hitPct>=50?'#f5a623':'#ef4444'};">${hitPct}%</div>
          <div style="font-size:9px;color:var(--text2);">HIT RATE</div>
        </div>
        <div style="text-align:center;padding:8px 14px;background:rgba(255,255,255,.04);border-radius:8px;">
          <div style="font-family:'Bebas Neue';font-size:32px;color:#10b981;">${hits}/${total}</div>
          <div style="font-size:9px;color:var(--text2);">HITS</div>
        </div>
      </div>
      <div>
        ${PC.gamePitches.map((p,i)=>{
          const sc = p.score||0;
          const scCol = sc>=800?'#10b981':sc>=500?'#60a5fa':sc>=200?'#f5a623':'#ef4444';
          return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;
                              border-bottom:1px solid rgba(255,255,255,.05);font-size:11px;">
            <span style="min-width:20px;color:var(--text2);">#${i+1}</span>
            <span style="color:var(--text2);">→ ${GAME_ZONE_NAMES[p.target]||p.target}</span>
            <span style="flex:1;color:var(--text);">${GAME_ZONE_NAMES[p.actual]||p.actual}</span>
            <span style="font-weight:700;color:${p.hit?'#10b981':'#ef4444'};">${p.hit?'✓':'✗'}</span>
            ${isAccuracy?`<span style="color:${scCol};font-size:10px;min-width:36px;text-align:right;">${sc}pt</span>`:''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
    container.innerHTML = gameBlock + container.innerHTML;
  }, 50);
}

function pcNewGame() {
  PC.gameMode    = 'none';
  PC.gamePitches = [];
  PC.gameTarget  = null;
  PC.gamePhase   = 'aim';
  PC.gameHitFx   = null;
  PC.state = 'setup';
  PC.pitches = [];
  PC.pendingPitch = null;
  PC.pitcher = null;
  PC.targetCount = 0;
  pcRefresh();
}


// ── Self-activating tools tab listener ─────────────────────────────
// Ensures Tools tab works regardless of host app version/TAB_IDS state
(function() {
  function tryInitTools(pill) {
    const section = document.getElementById('tab-tools');
    if (!section) return;
    // Deactivate all sections, activate tools
    document.querySelectorAll('.section.active').forEach(s => s.classList.remove('active'));
    section.classList.add('active');
    // Render panel
    if (typeof renderCoachingToolsPanel === 'function') {
      renderCoachingToolsPanel('coachingToolsPanel', 'ath');
    }
  }

  function attachToolsListener() {
    document.querySelectorAll('[data-tab="tools"], [onclick*="tools"]').forEach(el => {
      if (el._ctToolsListenerAttached) return;
      el._ctToolsListenerAttached = true;
      el.addEventListener('click', function(e) {
        setTimeout(function() { tryInitTools(); }, 30);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachToolsListener);
  } else {
    setTimeout(attachToolsListener, 100);
  }
})();

Object.assign(global, {
  ATH, athStart, athStop, athAccept, athRedo, athNextGroup,
  athSetGroups, athTogglePlayer, athRenameGroup, athAddFreePlayer,
  athRemoveFreePlayer, athSaveAndClear, athSaveToLeaderboard,
  athRefresh, athRefreshLeaderboard, athLbDeleteEntry, athLbClear,
  athProceedFromAssign,
  SW, swStart, swStop, swLap, swReset, swSaveEntry, swDeleteEntry,
  swClearAll, swPromptAssign, swShowSaveBar, swRefresh,
  renderCoachingToolsPanel, ctSwitchTool, ctOpenOverlay, ctCloseOverlay,
  PC, pcInit, pcRefresh, pcStart, pcEndSession, pcSaveSession,
  pcCommitPitch, pcCancelPending, pcUndoLast, pcTapPocket, pcTapAt,
  pcSetPendingType, pcSetCount, pcSetMode, pcNewSession, pcViewHistory,
  pcDeleteSession, pcSaveToPlayer,
  startPitchSession, pcSaveToLeaderboard, pcLbLoad, pcLbSave, _pcLeaderboard,
  pcStartGame, pcGameTap, pcEndGame, pcNewGame,
  pcGameNext, pcGameNextWithSpeed, pcGameCanvasClick, pcUndoLastGamePitch,
  pcAccuracyClick, pcAccuracyNext,
  ctBoardTab,
  saveCoachingSession, ctConfetti, ctShowBanner,
});

})(window);