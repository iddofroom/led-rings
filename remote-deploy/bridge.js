// Single-origin bridge for led-rings remote access.
// Serves the built Timeline UI (ui/dist) and proxies /api/* to the control server.
// One public origin (via the tunnel) then covers both UI and API.
// Pure Node, zero dependencies. Run from the repo root: node bridge.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.BRIDGE_PORT || '8088', 10);
const CONTROL = process.env.CONTROL_URL || 'http://127.0.0.1:3080';
const DIST = process.env.UI_DIST ? path.resolve(process.env.UI_DIST) : path.resolve(__dirname, 'ui', 'dist');
const control = new URL(CONTROL);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  // Proxy API calls to the control server.
  if (pathname.startsWith('/api/')) {
    const opts = {
      hostname: control.hostname,
      port: control.port || 80,
      path: url,
      method: req.method,
      headers: req.headers,
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'control server unreachable', detail: String(e) }));
    });
    req.pipe(proxyReq);
    return;
  }

  // Otherwise serve the static UI (with SPA fallback to index.html).
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  let file = path.resolve(DIST, rel);
  if (!file.startsWith(DIST) || rel === '' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Did you build the UI (yarn build in ui/)?');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`[bridge] http://localhost:${PORT}  ->  UI: ${DIST}  |  /api -> ${CONTROL}`);
});
