'use strict'
/**
 * Standalone static file server for the packaged Timeline UI. No backend, no ts-node,
 * no Node-API dependencies — just serves the Vite build output and opens a browser tab.
 * Compiled into a single .exe with pkg; the UI build is embedded into the binary itself
 * (pkg's "assets" snapshot), so there's nothing else to ship alongside it.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')

const PORT = parseInt(process.env.KIVSEE_UI_PORT || '4173', 10)
// Under pkg, __dirname resolves into the embedded snapshot; running plain `node
// static-server.js` for local testing, it resolves to this file's real directory.
const DIST_DIR = path.join(__dirname, 'dist')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function serveIndex(res) {
  fs.readFile(path.join(DIST_DIR, 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500)
      res.end('Build not found next to this executable — expected a "dist" folder alongside it.')
      return
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] })
    res.end(data)
  })
}

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0])
  const resolved = path.normalize(path.join(DIST_DIR, reqPath))
  if (!resolved.startsWith(DIST_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  if (reqPath === '/') {
    serveIndex(res)
    return
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      serveIndex(res)
      return
    }
    const ext = path.extname(resolved).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`
  console.log(`KivSee Time Simulator running at ${url}`)
  console.log('Close this window to stop the app.')
  const openCmd =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(openCmd, () => {})
})
