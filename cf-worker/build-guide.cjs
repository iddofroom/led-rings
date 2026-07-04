#!/usr/bin/env node
// Wraps the editable guide source (cf-worker/guide.src.html) into the Worker module
// cf-worker/guide.js, which exports GUIDE_HTML — the full standalone HTML document the
// Worker serves at the public /guide route (edge, no auth, always-on).
//
// Pure Node, zero dependencies (matches build-bundle.cjs). Run:  node cf-worker/build-guide.cjs
//
// UNLIKE bundle.js, guide.js IS committed: it embeds no secrets, and committing it means the
// Worker deploys with no build step. Edit guide.src.html, re-run this, commit both.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'guide.src.html');
const OUT = path.join(__dirname, 'guide.js');

let body = fs.readFileSync(SRC, 'utf8');

// The source carries its own <title> (used by the Artifact preview's skeleton). For a standalone
// document we set the title in <head>, so drop the leading in-body <title> to avoid duplication.
body = body.replace(/^﻿?\s*<title>[\s\S]*?<\/title>\s*/i, '');

// Escape for a JS template literal: backslash, backtick, and ${ interpolation.
const esc = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const doc = [
  '<!doctype html>',
  '<html lang="he" dir="rtl">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="description" content="מדריך בניית מיצבי לדים מוזיקליים — LED Studio Build Guide (WS2812).">',
  '<title>מדריך הבנייה · LED Studio Build Guide</title>',
  '</head>',
  '<body>',
  esc,
  '</body>',
  '</html>',
  '',
].join('\n');

fs.writeFileSync(OUT, 'export const GUIDE_HTML = `' + doc + '`;\n', 'utf8');
console.log(`Built cf-worker/guide.js (${doc.length} bytes of HTML) from guide.src.html`);
