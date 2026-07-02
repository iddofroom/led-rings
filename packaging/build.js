'use strict'
/**
 * Builds standalone packages for Windows and Mac: vite-builds the UI, strips any local
 * audio test assets out of the build (they're gitignored but vite still copies whatever's
 * sitting in ui/public on disk), then embeds the build into packaging/static-server.js
 * via pkg's asset snapshot, producing self-contained binaries — nothing else to ship.
 *
 * Outputs to release/:
 *   kivsee-time-simulator-win.exe   — Windows x64
 *   kivsee-time-simulator-mac-arm64 — macOS Apple Silicon (M1/M2/M3)
 *   kivsee-time-simulator-mac-x64   — macOS Intel
 *
 * Cross-compilation works: pkg downloads the appropriate Node runtime per target, so
 * you can produce Mac binaries from Windows and vice-versa.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const UI_DIR = path.join(ROOT, 'ui')
const UI_DIST = path.join(UI_DIR, 'dist')
const PACKAGING_DIR = __dirname
const PACKAGING_DIST = path.join(PACKAGING_DIR, 'dist')
const RELEASE_DIR = path.join(ROOT, 'release')

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aac'])

const ALL_PLATFORMS = [
  { target: 'node22-win-x64',   output: 'kivsee-time-simulator-win.exe',    os: 'win32'  },
  { target: 'node22-mac-arm64', output: 'kivsee-time-simulator-mac-arm64',  os: 'darwin' },
  { target: 'node22-mac-x64',   output: 'kivsee-time-simulator-mac-x64',    os: 'darwin' },
]

// By default build only targets that match the current OS (cross-compile doesn't work —
// pkg's fabrication step requires native system tools). Pass --all in CI where each job
// runs on the matching OS and explicitly sets KIVSEE_BUILD_ALL=1.
const buildAll = process.argv.includes('--all') || process.env.KIVSEE_BUILD_ALL === '1'
const PLATFORMS = buildAll ? ALL_PLATFORMS : ALL_PLATFORMS.filter(p => p.os === process.platform)

function run(cmd, cwd) {
  console.log(`> ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function stripAudioAssets(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      stripAudioAssets(full)
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      console.log(`Stripping audio asset from package: ${path.relative(ROOT, full)}`)
      fs.unlinkSync(full)
    }
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

console.log('--- Building UI (vite build) ---')
run('npm run build', UI_DIR)

console.log('--- Stripping audio assets (kept out of the packaged app on purpose) ---')
stripAudioAssets(UI_DIST)

console.log('--- Staging build for embedding ---')
fs.rmSync(PACKAGING_DIST, { recursive: true, force: true })
copyDir(UI_DIST, PACKAGING_DIST)

// Invoke the locally-installed devDependency directly rather than via `npx`, which
// doesn't reliably find it from packaging/'s own package.json and re-fetches it instead.
const pkgBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'pkg.cmd' : 'pkg')
fs.mkdirSync(RELEASE_DIR, { recursive: true })

try {
  for (const { target, output } of PLATFORMS) {
    console.log(`\n--- Packaging ${output} (${target}) ---`)
    const outPath = path.join(RELEASE_DIR, output)
    run(`"${pkgBin}" . --targets ${target} --output "${outPath}"`, PACKAGING_DIR)
  }
} finally {
  fs.rmSync(PACKAGING_DIST, { recursive: true, force: true })
}

console.log('\nDone. Outputs in release/:')
for (const { output } of PLATFORMS) {
  console.log(`  ${output}`)
}
console.log('\nNote: Mac binaries require "right-click → Open" on first launch to bypass Gatekeeper.')
