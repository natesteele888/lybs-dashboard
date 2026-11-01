/**
 * LYBS Draft Relay Server
 * ────────────────────────────────────────────────────────
 * Run this on the admin's laptop:  node draft_relay.js
 *
 * Then give coaches this URL (replace with your laptop's WiFi IP):
 *   http://YOUR_LAPTOP_IP:3001
 *
 * Find your laptop IP:
 *   Mac:     System Settings → WiFi → Details → IP Address
 *   Windows: ipconfig → "IPv4 Address" under your WiFi adapter
 *
 * The draft dashboard pushes state to this server automatically.
 * Coaches open the URL on their phones — no app install needed.
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const PORT = 3001;

let latestState = null;      // most recent full draft state
let latestPick  = null;      // most recent pick announcement
const sseClients = new Set(); // connected SSE listeners

// ── Utility ──────────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function broadcast(eventName, data) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch (_) { sseClients.delete(client); }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(res);

  // Preflight
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  // ── POST /state  (from draft dashboard) ──────────────────────────────────
  if (req.method === 'POST' && url === '/state') {
    try {
      const body = await readBody(req);
      latestState = body.state ?? body;
      latestPick  = null; // clear pick flash on full-state push
      broadcast('state', latestState);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } catch (e) {
      res.writeHead(400); res.end('bad json');
    }
    return;
  }

  // ── POST /pick  (from draft dashboard — pick announcement) ───────────────
  if (req.method === 'POST' && url === '/pick') {
    try {
      const body = await readBody(req);
      latestPick  = body.pick;
      latestState = body.state ?? latestState;
      broadcast('pick', { pick: latestPick, state: latestState });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } catch (e) {
      res.writeHead(400); res.end('bad json');
    }
    return;
  }

  // ── GET /events  (SSE stream for mobile clients) ─────────────────────────
  if (req.method === 'GET' && url === '/events') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Immediately send current state if available
    if (latestState) {
      res.write(`event: state\ndata: ${JSON.stringify(latestState)}\n\n`);
    }

    // Heartbeat every 25s to keep connection alive through proxies
    const hb = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(hb); }
    }, 25000);

    sseClients.add(res);
    req.on('close', () => { sseClients.delete(res); clearInterval(hb); });
    return;
  }

  // ── GET /status  (health check / show connected clients) ─────────────────
  if (req.method === 'GET' && url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      connected: sseClients.size,
      hasState: !!latestState,
    }));
    return;
  }

  // ── Static: serve draft_mobile.html as root ───────────────────────────────
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    serveFile(res, path.join(__dirname, 'draft_mobile.html'), 'text/html');
    return;
  }
  if (req.method === 'GET' && url === '/draft_mobile.html') {
    serveFile(res, path.join(__dirname, 'draft_mobile.html'), 'text/html');
    return;
  }
  if (req.method === 'GET' && url.startsWith('/draft_tv_mobile.html')) {
    serveFile(res, path.join(__dirname, 'draft_tv_mobile.html'), 'text/html');
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  // Print local IPs so the admin knows what URL to share
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }

  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   LYBS Draft Relay  —  running on port', PORT, '    ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log('║  Share one of these URLs with coaches:         ║');
  ips.forEach(ip => {
    const url = `http://${ip}:${PORT}`;
    console.log(`║  ${url.padEnd(46)}║`);
  });
  console.log('║                                                ║');
  console.log('║  Make sure everyone is on the same WiFi.      ║');
  console.log('╚════════════════════════════════════════════════╝\n');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} is already in use. Either:\n   • Stop the other process\n   • Change PORT at the top of this file\n`);
  } else {
    console.error('Server error:', e);
  }
  process.exit(1);
});
