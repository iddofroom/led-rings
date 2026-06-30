#!/usr/bin/env python3
"""Translation layer (PHASE 3) — pattern-based, beat-synced, loop.ts-inspired.

analysis.json + taste/rules.yaml -> first-draft canonical {song, timeframes} JSON.

Instead of one flat effect per section, each section is realized by a PATTERN that
emits multiple per-ring, BEAT-ALIGNED timeframes — modelled on the hand-crafted
src/songs/loop.ts (progressive ring build-ups, per-ring staggered blinks, segment
snakes, downbeat pulses). Patterns + palettes are picked RANDOMLY per run (so every
generation differs; --seed to reproduce). Per-section variants (--variants / --section)
let the UI reroll one part's pattern.

Emits ONLY Phase-0 SAFE-list effects (per-ring timeframes instead of movement; plain
cycle + cycleBeats; snake/blink/pulse/fade/hue) so the output round-trips.

Usage:
  python scripts/translate.py <analysis.json> -o out.song.json [--rules taste/rules.yaml]
        [--section IDX] [--seed N] [--variants N] [--explain] [--name NAME]
        [--llm --model gemini-2.5-flash]   # Gemini picks pattern+palette per section
"""
import sys
import json
import math
import bisect
import random
import argparse
from pathlib import Path

import yaml

SAFE_BRIGHTNESS = {"brightness", "fadeIn", "fadeOut", "fadeInOut", "fadeOutIn", "blink", "pulse", "fade"}
SAFE_HUE = {"staticHueShift", "hueShiftStartToEnd", "hueShiftSin"}
SAFE_MOTION = {"snake", "snakeHeadMove", "staticSnake", "snakeHeadSin", "snakeHeadSteps",
               "snakeSlowFast", "snakeTailShrinkGrow", "snakeInOut", "snakeFillGrow"}
SAFE_EFFECTS = SAFE_BRIGHTNESS | SAFE_HUE | SAFE_MOTION
SAFE_MAPPING = {"all", "arc", "ind", "b1", "b2", "centric", "updown", "rand"}
RINGS_ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
# Center-out ring order (rings 6,7 are center; 1,12 are edges) — for build-ups.
RINGS_CENTER_OUT = [6, 7, 5, 8, 4, 9, 3, 10, 2, 11, 1, 12]

PATTERNS = ["build_up", "accumulate", "sweep", "per_ring_blink", "snake_seg", "pulse_beat", "solid_fade"]


# ── colour ───────────────────────────────────────────────────────────────────
def hsv_to_hex(h, s, v):
    h = h % 1.0
    i = int(h * 6)
    f = h * 6 - i
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r, g, b = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i % 6]
    return "#" + "".join(f"{round(c * 255):02x}" for c in (r, g, b))


def pick(rng, value, randomness=1.0, default=None):
    """Pick from a list (random, weighted toward the first when randomness<1); pass scalars through."""
    if value is None:
        return default
    if not isinstance(value, list):
        return value
    if not value:
        return default
    if randomness <= 0 or rng.random() > randomness:
        return value[0]
    return rng.choice(value)


def num(rng, value, default):
    """A number, a {min,max} range, or a list of choices."""
    if value is None:
        return default
    if isinstance(value, dict) and "min" in value and "max" in value:
        return round(rng.uniform(value["min"], value["max"]), 3)
    if isinstance(value, list):
        return rng.choice(value)
    return value


def resolve_palette(rng, palettes, name, randomness):
    p = palettes.get(name) if isinstance(name, str) else None
    if not p:
        p = {"hueRange": [0.55, 0.7], "sat": 0.85, "val": 1.0, "hueSpread": 0.1}
    hr = p.get("hueRange", [0.6, 0.6])
    lo, hi = hr[0], hr[1]
    if hi < lo:
        hi += 1.0
    base = rng.uniform(lo, hi) % 1.0
    return {
        "hue": base,
        "sat": num(rng, p.get("sat"), 1.0),
        "val": num(rng, p.get("val"), 1.0),
        "spread": num(rng, p.get("hueSpread"), 0.12),
    }


def ring_color(pal, i, n):
    hue = (pal["hue"] + (i / max(1, n)) * pal["spread"]) % 1.0
    return hsv_to_hex(hue, pal["sat"], pal["val"])


# ── effect builders (SAFE only) ──────────────────────────────────────────────
def eff_fadeIn():        return {"effectKey": "fadeIn"}
def eff_fadeOut():       return {"effectKey": "fadeOut"}
def eff_blink(low):      return {"effectKey": "blink", "params": {"low": round(low, 3)}}
def eff_pulse(low):      return {"effectKey": "pulse", "params": {"low": round(low, 3), "staticPhase": 0}}
def eff_fadeInOut(h):    return {"effectKey": "fadeInOut", "params": {"high": round(h, 3)}}
def eff_fadeOutIn(low):  return {"effectKey": "fadeOutIn", "params": {"low": round(low, 3)}}
def eff_snake(tl, cyc):  return {"effectKey": "snake", "params": {"tailLength": round(tl, 3), "cyclic": bool(cyc)}}
def eff_snakeSin(tl):    return {"effectKey": "snakeHeadSin", "params": {"tailLength": round(tl, 3), "cyclic": True}}
def eff_hueShift(end):   return {"effectKey": "hueShiftStartToEnd", "params": {"start": 0.0, "end": round(end, 3)}}


# ── pattern generators — each returns a list of timeframe dicts for one section ──
# ctx = dict(start, end, rng, pal, randomness, downbeats, label)
def _span(ctx):
    return max(1, ctx["end"] - ctx["start"])


def pat_solid_fade(ctx):
    """One solid colour across all rings with a fade envelope. Good for intros/breakdowns."""
    pal, rng = ctx["pal"], ctx["rng"]
    env = pick(rng, ["fadeInOut", "fadeIn", "fadeOutIn"], 1.0)
    eff = {"fadeInOut": eff_fadeInOut(num(rng, {"min": 0.7, "max": 1.0}, 1.0)),
           "fadeIn": eff_fadeIn(),
           "fadeOutIn": eff_fadeOutIn(num(rng, {"min": 0.0, "max": 0.3}, 0.1))}[env]
    return [dict(rings=list(RINGS_ALL), start=ctx["start"], end=ctx["end"],
                 color=hsv_to_hex(pal["hue"], pal["sat"], pal["val"]), mapping="all", effects=[eff])]


def pat_build_up(ctx):
    """Rings light up ONE BY ONE on beats and stay on, building over the section
    (modelled on loop.ts's expanding intro). Hue gradient across rings."""
    rng, pal = ctx["rng"], ctx["pal"]
    order = RINGS_CENTER_OUT if rng.random() < 0.5 else list(RINGS_ALL)
    n = len(order)
    dur = _span(ctx)
    build_frac = num(rng, {"min": 0.45, "max": 0.85}, 0.6)  # build over this fraction, then hold
    stagger = max(1, (dur * build_frac) / n)
    tfs = []
    for i, r in enumerate(order):
        s = min(ctx["end"] - 1, round(ctx["start"] + i * stagger))
        tfs.append(dict(rings=[r], start=s, end=ctx["end"], color=ring_color(pal, i, n),
                        mapping="all", effects=[eff_fadeIn()]))
    return tfs


def pat_accumulate(ctx):
    """Like build_up but each ring pulses once it joins — energy keeps rising."""
    rng, pal = ctx["rng"], ctx["pal"]
    n = len(RINGS_ALL)
    dur = _span(ctx)
    stagger = max(1, (dur * 0.7) / n)
    low = num(rng, {"min": 0.3, "max": 0.55}, 0.4)
    tfs = []
    for i, r in enumerate(RINGS_ALL):
        s = min(ctx["end"] - 1, round(ctx["start"] + i * stagger))
        tfs.append(dict(rings=[r], start=s, end=ctx["end"], color=ring_color(pal, i, n),
                        mapping="all", effects=[eff_fadeIn(), eff_pulse(low)],
                        cycles=[{"type": "cycle", "beatsInCycle": float(pick(rng, [2, 4], 1.0))}]))
    return tfs


def pat_sweep(ctx):
    """A lit ring sweeps across, one at a time, repeating to fill the section."""
    rng, pal = ctx["rng"], ctx["pal"]
    n = len(RINGS_ALL)
    dur = _span(ctx)
    per = max(1, round(dur / n)) if dur <= n * 3 else max(1, round(num(rng, [1, 2], 1)))
    tfs = []
    t = ctx["start"]
    i = 0
    while t < ctx["end"]:
        r = RINGS_ALL[i % n]
        e = min(ctx["end"], t + per)
        tfs.append(dict(rings=[r], start=t, end=e, color=ring_color(pal, i % n, n),
                        mapping="all", effects=[eff_fadeIn(), eff_fadeOut()]))
        t = e
        i += 1
    return tfs


def pat_per_ring_blink(ctx):
    """Every ring blinks, each on its own staggered cycle (loop.ts cycleBeats feel)."""
    rng, pal = ctx["rng"], ctx["pal"]
    n = len(RINGS_ALL)
    bic = float(pick(rng, [2, 4], 1.0))
    low = num(rng, {"min": 0.0, "max": 0.3}, 0.0)
    color = hsv_to_hex(pal["hue"], pal["sat"], pal["val"])
    tfs = []
    for i, r in enumerate(RINGS_ALL):
        off = round(min(ctx["end"] - 1, ctx["start"] + i))  # 1-beat per-ring offset
        tfs.append(dict(rings=[r], start=off, end=ctx["end"], color=ring_color(pal, i, n),
                        mapping="all", effects=[eff_blink(low)],
                        cycles=[{"type": "cycle", "beatsInCycle": bic}]))
    return tfs


def pat_snake_seg(ctx):
    """All rings, a snake running around a segment on a cycle (loop.ts segment snakes)."""
    rng, pal = ctx["rng"], ctx["pal"]
    seg = pick(rng, ["centric", "arc", "rand", "ind", "updown"], 1.0)
    bic = float(pick(rng, [4, 6, 8], 1.0))
    tl = num(rng, {"min": 0.3, "max": 0.6}, 0.5)
    color = hsv_to_hex(pal["hue"], pal["sat"], pal["val"])
    effs = [eff_snake(tl, True)]
    if rng.random() < 0.4:
        effs.append(eff_hueShift(num(rng, {"min": 0.1, "max": 0.5}, 0.3)))
    return [dict(rings=list(RINGS_ALL), start=ctx["start"], end=ctx["end"], color=color,
                 mapping=seg, effects=effs, cycles=[{"type": "cycle", "beatsInCycle": bic}])]


def pat_pulse_beat(ctx):
    """All rings pulse on the beat — bright, driving (drops/choruses)."""
    rng, pal = ctx["rng"], ctx["pal"]
    bic = float(pick(rng, [1, 2], 1.0))
    low = num(rng, {"min": 0.2, "max": 0.5}, 0.35)
    color = hsv_to_hex(pal["hue"], pal["sat"], pal["val"])
    effs = [eff_pulse(low)]
    if rng.random() < 0.5:
        effs.append(eff_snakeSin(num(rng, {"min": 0.3, "max": 0.6}, 0.4)))
    return [dict(rings=list(RINGS_ALL), start=ctx["start"], end=ctx["end"], color=color,
                 mapping=pick(rng, ["all", "centric"], 1.0), effects=effs,
                 cycles=[{"type": "cycle", "beatsInCycle": bic}])]


PATTERN_FN = {
    "build_up": pat_build_up, "accumulate": pat_accumulate, "sweep": pat_sweep,
    "per_ring_blink": pat_per_ring_blink, "snake_seg": pat_snake_seg,
    "pulse_beat": pat_pulse_beat, "solid_fade": pat_solid_fade,
}


# ── SAFE validation ──────────────────────────────────────────────────────────
def sanitize_tf(tf, sidx, vidx, counter):
    effects = []
    for e in tf.get("effects") or []:
        k = e.get("effectKey")
        if k not in SAFE_EFFECTS:
            continue
        ne = {"id": f"s{sidx}v{vidx}e{counter[0]}", "effectKey": k}
        counter[0] += 1
        if isinstance(e.get("params"), dict):
            ne["params"] = {pk: pv for pk, pv in e["params"].items() if isinstance(pv, (int, float, bool))}
        effects.append(ne)
    mapping = tf.get("mapping", "all")
    if mapping not in SAFE_MAPPING:
        mapping = "all"
    start, end = int(round(tf["start"])), int(round(tf["end"]))
    if end <= start:
        end = start + 1
    out = {
        "id": f"s{sidx}v{vidx}-{counter[0]}",
        "startTime": start, "endTime": end,
        "label": tf.get("label", ""),
        "color": tf.get("color", "#3b82f6"), "hasExplicitColor": True,
        "rings": [r for r in tf.get("rings", RINGS_ALL) if isinstance(r, int) and 1 <= r <= 12] or [1],
        "mapping": mapping, "effects": effects,
    }
    counter[0] += 1
    if tf.get("cycles"):
        out["cycles"] = tf["cycles"]
    return out


# ── beat indexing ────────────────────────────────────────────────────────────
def beat_indexer(beat_ms):
    def ms_to_beat(ms):
        if not beat_ms:
            return None
        i = bisect.bisect_left(beat_ms, ms)
        cands = [j for j in (i - 1, i) if 0 <= j < len(beat_ms)]
        return min(cands, key=lambda j: abs(beat_ms[j] - ms)) if cands else 0
    return ms_to_beat


# ── pattern selection (deterministic-random or Gemini) ───────────────────────
def choose_pattern(rng, sec_rule, randomness):
    return pick(rng, sec_rule.get("patterns"), randomness, "solid_fade")


def gemini_pick(model, section, rule):
    """Ask Gemini to choose a pattern + palette for the section. Returns (pattern, palette) or None."""
    feats = section.get("summary", {})
    prompt = f"""Choose ONE LED pattern and ONE palette for this song section. JSON only.
SECTION {section.get('label')}: energy={feats.get('energy')}, onsetDensity={feats.get('onsetDensity')}, bandEnergy={feats.get('bandEnergy')}
ALLOWED patterns: {rule.get('patterns')}   ALLOWED palettes: {rule.get('palette')}
Higher energy -> driving patterns (pulse_beat, per_ring_blink, accumulate) and hot/neon palettes; lower energy -> build_up/solid_fade/snake_seg and cool palettes.
Return: {{"pattern":"<one allowed>","palette":"<one allowed>"}}"""
    try:
        r = model.generate_content(prompt, generation_config={"response_mime_type": "application/json", "temperature": 0.7})
        d = json.loads(r.text)
        p = d.get("pattern") if d.get("pattern") in (rule.get("patterns") or []) else None
        pal = d.get("palette") if d.get("palette") in (rule.get("palette") or []) else None
        return (p, pal)
    except Exception as e:
        sys.stderr.write(f"[translate] Gemini pick failed for '{section.get('label')}' ({e}); using rules.\n")
        return None


# ── main translation ─────────────────────────────────────────────────────────
def translate(analysis, rules, seed=0, num_variants=1, only_section=None, model=None):
    beat_ms = analysis.get("beatTimestampsMs") or []
    downbeats = analysis.get("downbeatTimestampsMs") or []
    bpm = float(analysis.get("bpmGlobal") or 120.0)
    dur_ms = int(analysis.get("audio", {}).get("durationMs", 0))
    palettes = rules.get("palettes") or {}
    randomness = float(rules.get("randomness", 0.85))
    ms_to_beat = beat_indexer(beat_ms)

    def start_beat(ms):
        if downbeats:
            dms = min(downbeats, key=lambda d: abs(d - ms))
            if abs(dms - ms) <= 60000.0 / max(bpm, 1) * 2:
                return ms_to_beat(dms)
        return ms_to_beat(ms)

    secs = analysis.get("sections") or []
    starts = [start_beat(s["startMs"]) or 0 for s in secs]
    total_beats = ms_to_beat(dur_ms) if beat_ms else int(dur_ms / 1000.0 / 60.0 * bpm)

    timeframes = []
    counter = [0]
    explain_rows = []
    for sidx, s in enumerate(secs):
        if only_section is not None and sidx != only_section:
            continue
        label = s.get("label", "verse")
        rule = merge(rules.get("defaults"), (rules.get("sections") or {}).get(label) or {})
        start_b = starts[sidx]
        end_b = starts[sidx + 1] if sidx + 1 < len(starts) else total_beats
        if end_b is None or end_b <= start_b:
            end_b = start_b + max(2, (ms_to_beat(s["endMs"]) or start_b + 4) - start_b)

        # one RNG per section+seed so reruns of a single section vary deterministically by seed
        for vidx in range(max(1, num_variants)):
            rng = random.Random((seed * 1000003) ^ (sidx * 9176) ^ (vidx * 31))
            pattern = choose_pattern(rng, rule, randomness)
            pal_name = pick(rng, rule.get("palette"), randomness, "cool")
            if model and vidx == 0:
                g = gemini_pick(model, s, rule)
                if g:
                    pattern = g[0] or pattern
                    pal_name = g[1] or pal_name
            pal = resolve_palette(rng, palettes, pal_name, randomness)
            ctx = dict(start=start_b, end=end_b, rng=rng, pal=pal, randomness=randomness,
                       downbeats=downbeats, label=label)
            raw = PATTERN_FN.get(pattern, pat_solid_fade)(ctx)
            tfs = [sanitize_tf(t, sidx, vidx, counter) for t in raw]
            for t in tfs:
                t["label"] = f"{label} · {pattern}"
                t["_source"] = f"{'llm' if (model and vidx == 0 and g) else 'rule'}:{label}:{pattern}"
                t["_section"] = sidx
            if vidx == 0:
                active = tfs
                explain_rows.append((sidx, label, pattern, pal_name, start_b, end_b, len(tfs)))
            else:
                # store alternative whole-section pattern as a variant on the FIRST active tf
                if active:
                    active[0].setdefault("_variants", []).append(
                        {"pattern": pattern, "palette": pal_name, "timeframes": tfs})
        timeframes.extend(active)

    audio_path = analysis.get("audio", {}).get("path", "song")
    song = {
        "name": Path(audio_path).stem,
        "lengthSeconds": round(dur_ms / 1000.0, 2),
        "bpm": round(bpm, 2),
        "startOffsetMs": 0,
        "animationType": "song",
        "audioFilePath": Path(audio_path).name,
    }
    if beat_ms:
        song["beatTimestampsMs"] = beat_ms
    return {"song": song, "timeframes": timeframes, "_explain": explain_rows}


def merge(base, over):
    out = dict(base or {})
    for k, v in (over or {}).items():
        out[k] = v
    return out


def make_gemini_model(model_name):
    import os
    import warnings
    warnings.filterwarnings("ignore", category=FutureWarning)
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY (or GOOGLE_API_KEY) not set in the environment.")
    try:
        import google.generativeai as genai
    except Exception:
        raise RuntimeError("google-generativeai not installed. Run: pip install google-generativeai")
    genai.configure(api_key=key)
    return genai.GenerativeModel(model_name)


def main():
    p = argparse.ArgumentParser(description="Translate analysis + taste rules -> beat-synced canonical song JSON.")
    p.add_argument("analysis")
    p.add_argument("--output", "-o", default=None)
    p.add_argument("--rules", default=str(Path(__file__).resolve().parent.parent / "taste" / "rules.yaml"))
    p.add_argument("--section", type=int, default=None, help="Regenerate only this section index")
    p.add_argument("--seed", type=int, default=0, help="Random seed (same seed = same output)")
    p.add_argument("--variants", type=int, default=1, help="Alternative patterns to attach per section (for the UI reroll)")
    p.add_argument("--explain", action="store_true")
    p.add_argument("--name", default=None)
    p.add_argument("--llm", action="store_true", help="Let Gemini pick the pattern+palette per section")
    p.add_argument("--model", default="gemini-2.5-flash")
    args = p.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    model = None
    if args.llm:
        try:
            model = make_gemini_model(args.model)
        except Exception as e:
            sys.stderr.write(f"[translate] --llm unavailable: {e}\n")
            sys.exit(2)

    if args.seed == 0:
        # vary each run unless a seed is given (sum of analysis bytes is stable per file but we want variety)
        import time
        args.seed = int(time.time() * 1000) & 0x7fffffff

    analysis = json.loads(Path(args.analysis).read_text(encoding="utf-8"))
    rules = yaml.safe_load(Path(args.rules).read_text(encoding="utf-8")) or {}

    result = translate(analysis, rules, seed=args.seed, num_variants=args.variants,
                       only_section=args.section, model=model)
    rows = result.pop("_explain", [])
    if args.name:
        result["song"]["name"] = args.name

    out_path = args.output or (str(Path(args.analysis).with_suffix("")).replace(".analysis", "") + ".song.json")
    Path(out_path).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}  ({len(result['timeframes'])} timeframes from {len(rows)} sections, seed {args.seed})")
    if args.explain:
        print(f"\n{'#':>2} {'label':<10} {'pattern':<14} {'palette':<8} {'beats':>11} {'tfs':>4}")
        for sidx, label, pat, pal, sb, eb, ntf in rows:
            print(f"{sidx:>2} {label:<10} {pat:<14} {str(pal):<8} {str(sb)+'-'+str(eb):>11} {ntf:>4}")


if __name__ == "__main__":
    main()
