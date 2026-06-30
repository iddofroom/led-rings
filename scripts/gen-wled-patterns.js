/*
 * gen-wled-patterns.js — generate new ring presets inspired by WLED & xLights effects,
 * translated to the 12-ring "tunnel" geometry (12 rings × 144 px; segment maps
 * all / arc / ind / centric / rand / b1 / b2).
 *
 * Each preset is a 30 s loop in the exact runtime schema used by presets/<category>/*.json
 * (const_color / brightness.mult_factor / hue.offset_factor / snake + camelCase
 * tailLength/constValue). Drop-in: the UI auto-loads presets via a Vite glob, and
 * `yarn play <category>/<name>` plays them on the rig.
 *
 * Run:  node scripts/gen-wled-patterns.js
 */
const fs = require('fs');
const path = require('path');

const DUR = 30000;
const RINGS = 12;

// ── effect-layer builders (mirror the proven preset conventions) ───────────────
const cfg = (segments, extra = {}) => ({ segments, start_time: 0, end_time: DUR, ...extra });
const rep = (repeat_num) => ({ repeat_num, repeat_start: 0, repeat_end: 1 });

const constColor = (hue, sat, val, segments = 'all') => ({
  effect_config: cfg(segments), const_color: { color: { hue, sat, val } },
});
const brightSin = (min, max, phase, repeat_num, segments = 'all') => ({
  effect_config: cfg(segments, rep(repeat_num)),
  brightness: { mult_factor: { sin: { min, max, phase, repeats: 1 } } },
});
const hueSin = (min, max, phase, repeat_num, segments = 'all') => ({
  effect_config: cfg(segments, rep(repeat_num)),
  hue: { offset_factor: { sin: { min, max, phase, repeats: 1 } } },
});
const hueLinear = (start, end, repeat_num, segments = 'all') => ({
  effect_config: cfg(segments, rep(repeat_num)),
  hue: { offset_factor: { linear: { start, end } } },
});
const snakeLinear = (start, end, tail, repeat_num, segments, cyclic = true) => ({
  effect_config: cfg(segments, rep(repeat_num)),
  snake: { head: { linear: { start, end } }, tailLength: { constValue: { value: tail } }, cyclic },
});
const snakeSin = (min, max, phase, tail, repeat_num, segments) => ({
  effect_config: cfg(segments, rep(repeat_num)),
  snake: { head: { sin: { min, max, phase, repeats: 1 } }, tailLength: { constValue: { value: tail } } },
});
const snakeSteps = (num_steps, first, tail, repeat_num, segments) => ({
  effect_config: cfg(segments, rep(repeat_num)),
  snake: { head: { steps: { num_steps, diff_per_step: 1 / num_steps, first_step_value: first } }, tailLength: { constValue: { value: tail } }, cyclic: true },
});
// 0.5 s fade in / out, matching every existing preset.
const fadeIn = () => ({ effect_config: cfg('all', { repeat_num: 1, repeat_start: 0, repeat_end: 0.016666666666666666 }), brightness: { mult_factor: { linear: { start: 0, end: 1 } } } });
const fadeOut = () => ({ effect_config: cfg('all', { repeat_num: 1, repeat_start: 0.9833333333333333, repeat_end: 1 }), brightness: { mult_factor: { linear: { start: 1, end: 0 } } } });

const ringSeq = (effects) => ({ effects, duration_ms: DUR, num_repeats: 0 });

/** Build {ring1..ring12} by calling perRing(i) for i = 0..11. */
function build(perRing) {
  const out = {};
  for (let i = 0; i < RINGS; i++) out[`ring${i + 1}`] = ringSeq(perRing(i));
  return out;
}

// ── patterns ───────────────────────────────────────────────────────────────
// Each entry: { category, name, build(i) }. The per-ring phase offset is what turns a
// single-ring effect into motion travelling DOWN the tunnel (ring 1 → ring 12).
const PATTERNS = [
  // WLED "Comet"/"Chase": a coloured comet races down the tunnel; the head also spins in-ring.
  { category: 'party', name: 'comet_tunnel', build: (i) => [
    constColor(0.55 + i * 0.035, 1, 1),
    brightSin(0.0, 1.0, i / RINGS, 6),            // travelling brightness head (one comet spans the tunnel, 6 passes / 30 s)
    snakeLinear(0, 1, 0.35, 30, 'ind', true),     // in-ring spin texture (12 chunky blocks)
    hueSin(0, 0.05, 0, 3),
    fadeIn(), fadeOut(),
  ] },

  // WLED "Strobe Rainbow": the whole tunnel hard-flashes while the colour cycles.
  { category: 'party', name: 'strobe_rainbow', build: () => [
    constColor(0, 1, 1),
    hueSin(0, 1, 0, 12),                          // colour cycles 12× over the loop
    brightSin(0.0, 1.0, 0, 150),                  // ~5 Hz strobe, all rings in unison
    fadeIn(), fadeOut(),
  ] },

  // WLED "Theater"/xLights "Marquee": every 3rd pixel lit, dots chasing around each ring.
  { category: 'party', name: 'theater_chase', build: (i) => [
    constColor(0.08 + i * 0.02, 1, 1, 'b1'),      // warm dots on the b1 comb
    constColor(0, 0, 0, 'b2'),                    // b2 dark
    snakeLinear(0, 1, 0.15, 20, 'ind', true),     // running brightness → marquee chase
    fadeIn(), fadeOut(),
  ] },

  // WLED/xLights "Plasma": liquid organic colour, per-ring phase-shifted waves.
  { category: 'psychedelic', name: 'plasma', build: (i) => [
    constColor(0.7 + i * 0.06, 0.9, 1),
    hueSin(0, 0.4, i * 0.5, 4),                   // hue wobble, staggered per ring
    brightSin(0.4, 1.0, i * 0.5, 5, 'arc'),       // brightness waves on the arc map
    brightSin(0.5, 1.0, i * 0.33, 3),             // slow global swell
    fadeIn(), fadeOut(),
  ] },

  // WLED "DNA" / xLights "Spirals": two counter-rotating snakes per ring → double helix.
  { category: 'psychedelic', name: 'dna_helix', build: (i) => [
    constColor(0.33, 1, 1, 'b1'),                 // green strand
    constColor(0.92, 1, 1, 'b2'),                 // magenta strand
    snakeLinear(i * 0.25, i * 0.25 + 1, 0.3, 24, 'all', true),         // forward helix (phase offset per ring)
    snakeLinear(i * 0.25 + 1, i * 0.25, 0.3, 24, 'all', true),         // reverse helix
    hueSin(0, 0.12, 0, 2),
    fadeIn(), fadeOut(),
  ] },

  // xLights "Pinwheel"/"Spirals": full rainbow per ring + spinning arcs, helixing down the tunnel.
  { category: 'psychedelic', name: 'rainbow_spiral', build: (i) => [
    constColor(0, 1, 1),
    hueLinear(0, 1, 1, 'all'),                    // one rainbow wrapped around each ring
    snakeSteps(4, i * 0.25, 0.5, 30, 'arc'),      // 4 spinning arc spokes, phase-offset per ring
    brightSin(0.55, 1.0, i * 0.5, 3),
    fadeIn(), fadeOut(),
  ] },

  // WLED "Aurora"/"Lake": slow pastel curtains drifting down the tunnel.
  { category: 'chill', name: 'aurora', build: (i) => [
    constColor(0.45 + i * 0.05, 0.8, 1),          // teal → blue → violet
    hueSin(0, 0.2, i * 0.5, 2),                   // slow hue drift, staggered
    brightSin(0.4, 1.0, i * 0.5, 2, 'arc'),       // gentle swelling curtains
    fadeIn(), fadeOut(),
  ] },

  // xLights "Shockwave" / WLED "Ripple": a pulse radiates from the centre rings outward to both ends.
  { category: 'mystery', name: 'shockwave', build: (i) => {
    const phase = Math.abs(i - 5.5) / 5.5;        // 0 at centre (rings 6/7) → 1 at the ends
    return [
      constColor(0.85, 1, 0.95),                  // deep magenta
      brightSin(0.05, 1.0, phase, 4),             // expanding ring of brightness
      snakeLinear(0, 1, 0.4, 12, 'arc', true),    // subtle in-ring motion
      hueSin(0, 0.1, 0, 2),
      fadeIn(), fadeOut(),
    ];
  } },

  // WLED/xLights "Twinkle": scattered sparkles over a dim base (snake over the random map).
  { category: 'mystery', name: 'twinkle', build: (i) => [
    constColor(0.6 + i * 0.03, 0.7, 0.45),        // dim base glow
    snakeSin(0.0, 1.0, i * 0.37, 0.08, 40, 'rand'),   // fine scattered sparkle
    snakeLinear(0, 1, 0.05, 60, 'rand', true),        // second, faster sparkle layer
    hueSin(0, 0.1, 0, 1),
    fadeIn(), fadeOut(),
  ] },
];

// ── emit ─────────────────────────────────────────────────────────────────────
const presetsRoot = path.join(__dirname, '..', 'presets');
let written = 0;
for (const p of PATTERNS) {
  const dir = path.join(presetsRoot, p.category);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${p.name}.json`);
  fs.writeFileSync(file, JSON.stringify(build(p.build), null, 2) + '\n');
  console.log(`  ${p.category}/${p.name}.json`);
  written++;
}
console.log(`\nWrote ${written} patterns.`);
