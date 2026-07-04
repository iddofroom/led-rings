#!/usr/bin/env node
// Wraps each editable source page (cf-worker/*.src.html) into a Worker module that exports the
// full standalone HTML document the Worker serves:
//   guide.src.html -> guide.js (GUIDE_HTML)  → served at /guide
//   wled.src.html  -> wled.js  (WLED_HTML)   → served at /guide/wled
//
// Pure Node, zero dependencies (matches build-bundle.cjs). Run:  node cf-worker/build-guide.cjs
//
// UNLIKE bundle.js, these outputs ARE committed: they embed no secrets, and committing them means
// the Worker deploys with no build step. Edit the *.src.html, re-run this, commit both.
const fs = require('fs');
const path = require('path');

const PAGES = [
  { src: 'guide.src.html', out: 'guide.js', name: 'GUIDE_HTML',
    title: 'מדריך הבנייה · LED Studio Build Guide',
    desc: 'מדריך בניית מיצבי לדים מוזיקליים — LED Studio Build Guide (WS2812).' },
  { src: 'wled.src.html', out: 'wled.js', name: 'WLED_HTML',
    title: 'WLED · LED Studio',
    desc: 'התקנת WLED לשליטה בלדים בלי סנכרון למוזיקה — WLED install for non-synced LED setups.' },
];

for (const page of PAGES) {
  let body = fs.readFileSync(path.join(__dirname, page.src), 'utf8');

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
    '<meta name="description" content="' + page.desc + '">',
    '<title>' + page.title + '</title>',
    '</head>',
    '<body>',
    esc,
    '</body>',
    '</html>',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(__dirname, page.out),
    'export const ' + page.name + ' = `' + doc + '`;\n', 'utf8');
  console.log('Built cf-worker/' + page.out + ' (' + doc.length + ' bytes) from ' + page.src);
}
