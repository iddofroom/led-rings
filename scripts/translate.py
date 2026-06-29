#!/usr/bin/env python3
"""Translation layer (PHASE 3) — deterministic rules-only path (--no-llm default).

analysis.json + taste/rules.yaml (+ taste/learned-patterns.json) -> first-draft
canonical {song, timeframes} JSON. Emits ONLY Phase-0 SAFE-list effects (no movement,
no cycleBeats, no rainbow, no phase-on-effects), beat-aligned to the analyzed sections,
with _source provenance on every timeframe.

This is the deterministic backbone the plan calls for. An LLM path (claude-sonnet-4-6)
can layer nuance on top later; it needs the Anthropic SDK + ANTHROPIC_API_KEY (absent
here), so --llm is stubbed to fail loudly rather than pretend.

Usage:
  python scripts/translate.py <analysis.json> -o out.song.json
        [--rules taste/rules.yaml] [--learned taste/learned-patterns.json]
        [--section IDX] [--explain] [--name NAME]

Output validates: every effectKey is on the SAFE list; load it straight into the
Timeline UI or run generateSequenceTs on it — it round-trips (Phase 0 contract).
"""
import sys
import json
import math
import bisect
import argparse
from pathlib import Path

import yaml

# Phase-0 SAFE list (docs/round-trip-contract.md section 4)
SAFE_BRIGHTNESS = {"brightness", "fadeIn", "fadeOut", "fadeInOut", "fadeOutIn", "blink", "pulse", "fade"}
SAFE_HUE = {"staticHueShift", "hueShiftStartToEnd", "hueShiftSin"}
SAFE_MOTION = {"snake", "snakeHeadMove", "staticSnake", "snakeHeadSin", "snakeHeadSteps",
               "snakeSlowFast", "snakeTailShrinkGrow", "snakeInOut", "snakeFillGrow"}
SAFE_EFFECTS = SAFE_BRIGHTNESS | SAFE_HUE | SAFE_MOTION
SAFE_MAPPING = {"all", "arc", "ind", "b1", "b2", "centric", "updown", "rand"}
RINGS_ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

MOTION_DEFAULTS = {
    "snake": {"tailLength": 0.5, "cyclic": True},
    "snakeFillGrow": {},
    "snakeHeadSin": {"tailLength": 0.5, "cyclic": True},
    "snakeInOut": {},
    "snakeHeadMove": {"start": 0.0, "end": 1.0, "tail": 0.5},
    "staticSnake": {"start": 1.0, "end": 0.5},
    "snakeHeadSteps": {"steps": 6, "tailLength": 0.5},
    "snakeSlowFast": {"tailLength": 0.5},
    "snakeTailShrinkGrow": {},
}


def hsv_to_hex(h, s, v):
    h = h % 1.0
    i = int(h * 6)
    f = h * 6 - i
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r, g, b = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i % 6]
    return "#" + "".join(f"{round(c * 255):02x}" for c in (r, g, b))


def merge(base, over):
    out = dict(base or {})
    for k, val in (over or {}).items():
        out[k] = val
    return out


def resolve_color(rule, palette):
    cr = rule.get("color") or {}
    pal_name = cr.get("palette", "cool")
    pal = (palette or {}).get(pal_name, {"hue_range": [0.6, 0.6], "sat": 0.85, "val": 1.0})
    hr = pal.get("hue_range", [0.6, 0.6])
    hue = float(hr[0])
    sat = 1.0 if cr.get("saturation") == "max" else float(pal.get("sat", 1.0))
    val = float(pal.get("val", 1.0))
    return hsv_to_hex(hue, sat, val)


def build_brightness(rule):
    b = rule.get("brightness") or {}
    env = b.get("envelope")
    if env == "fadeIn":
        return {"effectKey": "fadeIn"}
    if env == "fadeOut":
        return {"effectKey": "fadeOut"}
    if env == "pulse":
        return {"effectKey": "pulse", "params": {"low": float(b.get("low", 0.5)), "staticPhase": 0}}
    if env == "blink":
        return {"effectKey": "blink", "params": {"low": float(b.get("low", 0.5))}}
    if env == "fadeOutIn":
        return {"effectKey": "fadeOutIn", "params": {"low": float(b.get("low", 0.0))}}
    if env == "fadeInOut":
        return {"effectKey": "fadeInOut", "params": {"high": float(b.get("high", 1.0))}}
    if b.get("base") == "brightness":
        return {"effectKey": "brightness", "params": {"value": float(b.get("value", 1.0))}}
    return None


def build_hue(rule):
    h = rule.get("hue") or {}
    eff = h.get("effect")
    if eff == "hueShiftStartToEnd":
        return {"effectKey": "hueShiftStartToEnd", "params": {"start": float(h.get("start", 0.0)), "end": float(h.get("end", 0.5))}}
    if eff == "staticHueShift":
        return {"effectKey": "staticHueShift", "params": {"value": float(h.get("value", 0.0))}}
    if eff == "hueShiftSin":
        return {"effectKey": "hueShiftSin", "params": {"amount": float(h.get("amount", 0.5))}}
    return None


def build_motion(rule):
    out = []
    for name in (rule.get("motion") or []):
        if name not in SAFE_MOTION:
            sys.stderr.write(f"[translate] WARN: motion '{name}' not on SAFE list; skipped.\n")
            continue
        params = dict(MOTION_DEFAULTS.get(name, {}))
        out.append({"effectKey": name, "params": params} if params else {"effectKey": name})
    return out


def section_rule(rules, label):
    sections = rules.get("sections") or {}
    return merge(rules.get("defaults"), sections.get(label) or {})


def beat_indexer(beat_ms):
    def ms_to_beat(ms):
        if not beat_ms:
            return None
        i = bisect.bisect_left(beat_ms, ms)
        cands = [j for j in (i - 1, i) if 0 <= j < len(beat_ms)]
        return min(cands, key=lambda j: abs(beat_ms[j] - ms)) if cands else 0
    return ms_to_beat


def translate(analysis, rules, only_section=None):
    beat_ms = analysis.get("beatTimestampsMs") or []
    downbeats = analysis.get("downbeatTimestampsMs") or []
    bpm = float(analysis.get("bpmGlobal") or 120.0)
    dur_ms = int(analysis.get("audio", {}).get("durationMs", 0))
    palette = rules.get("palette") or {}
    ms_to_beat = beat_indexer(beat_ms)

    def start_beat(ms):
        # snap a section start to the nearest detected downbeat (bar), else nearest beat
        if downbeats:
            dms = min(downbeats, key=lambda d: abs(d - ms))
            if abs(dms - ms) <= 60000.0 / max(bpm, 1) * 2:  # within ~2 beats
                return ms_to_beat(dms)
        return ms_to_beat(ms)

    secs = analysis.get("sections") or []
    # Precompute bar-aligned start beats; end = next section's start (contiguous)
    starts = []
    for s in secs:
        sb = start_beat(s["startMs"])
        starts.append(sb if sb is not None else 0)
    total_beats = (ms_to_beat(dur_ms) if beat_ms else int(dur_ms / 1000.0 / 60.0 * bpm))

    timeframes = []
    eff_counter = 0
    for idx, s in enumerate(secs):
        if only_section is not None and idx != only_section:
            continue
        label = s.get("label", "verse")
        rule = section_rule(rules, label)
        start_b = starts[idx]
        end_b = starts[idx + 1] if idx + 1 < len(starts) else total_beats
        if end_b is None or end_b <= start_b:
            end_b = (start_b + max(1, ms_to_beat(s["endMs"]) - start_b)) if beat_ms else start_b + 4
        effects = []
        for builder in (build_brightness, build_hue):
            e = builder(rule)
            if e:
                effects.append(e)
        effects.extend(build_motion(rule))
        # tag + validate
        clean = []
        for e in effects:
            if e["effectKey"] not in SAFE_EFFECTS:
                sys.stderr.write(f"[translate] WARN: effect '{e['effectKey']}' off SAFE list; dropped.\n")
                continue
            e = dict(e, id=f"s{idx}-e{eff_counter}")
            eff_counter += 1
            clean.append(e)
        mapping = rule.get("mapping", "all")
        if mapping not in SAFE_MAPPING:
            sys.stderr.write(f"[translate] WARN: mapping '{mapping}' invalid; using 'all'.\n")
            mapping = "all"
        tf = {
            "id": f"s{idx}-{label}",
            "startTime": int(start_b),
            "endTime": int(end_b),
            "label": f"{label} ({rule.get('intent','')})".strip(),
            "color": resolve_color(rule, palette),
            "hasExplicitColor": True,
            "rings": list(RINGS_ALL),
            "mapping": mapping,
            "effects": clean,
            "_source": f"rule:{label}",
        }
        cyc = rule.get("cycle")
        if cyc and cyc.get("beatsInCycle"):
            tf["cycles"] = [{"type": "cycle", "beatsInCycle": float(cyc["beatsInCycle"])}]
        timeframes.append(tf)

    audio_path = analysis.get("audio", {}).get("path", "song")
    name = Path(audio_path).stem
    song = {
        "name": name,
        "lengthSeconds": round(dur_ms / 1000.0, 2),
        "bpm": round(bpm, 2),
        "startOffsetMs": 0,
        "animationType": "song",
        "audioFilePath": Path(audio_path).name,
    }
    if beat_ms:
        song["beatTimestampsMs"] = beat_ms
    return {"song": song, "timeframes": timeframes}


def explain(result, analysis):
    print(f"\n{'#':>2} {'label':<10} {'beats':>11} {'mapping':<8} effects")
    secs = {i: s for i, s in enumerate(analysis.get("sections", []))}
    for i, tf in enumerate(result["timeframes"]):
        fx = ", ".join(e["effectKey"] for e in tf.get("effects", [])) or "(color only)"
        print(f"{i:>2} {tf['_source'].split(':')[1]:<10} {str(tf['startTime'])+'-'+str(tf['endTime']):>11} {tf['mapping']:<8} {fx}")


def main():
    p = argparse.ArgumentParser(description="Translate analysis + taste rules -> canonical song JSON.")
    p.add_argument("analysis", help="Path to <song>.analysis.json")
    p.add_argument("--output", "-o", default=None)
    p.add_argument("--rules", default=str(Path(__file__).resolve().parent.parent / "taste" / "rules.yaml"))
    p.add_argument("--learned", default=str(Path(__file__).resolve().parent.parent / "taste" / "learned-patterns.json"))
    p.add_argument("--section", type=int, default=None, help="Regenerate only this section index")
    p.add_argument("--explain", action="store_true")
    p.add_argument("--name", default=None, help="Override song name")
    p.add_argument("--llm", action="store_true", help="(stub) LLM path needs Anthropic SDK + ANTHROPIC_API_KEY")
    args = p.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    if args.llm:
        sys.stderr.write("[translate] --llm not available: no Anthropic SDK / ANTHROPIC_API_KEY in this env. "
                         "Use the deterministic default; wire the LLM path when credentials exist.\n")
        sys.exit(2)

    analysis = json.loads(Path(args.analysis).read_text(encoding="utf-8"))
    rules = yaml.safe_load(Path(args.rules).read_text(encoding="utf-8")) or {}

    result = translate(analysis, rules, only_section=args.section)
    if args.name:
        result["song"]["name"] = args.name

    out_path = args.output or (str(Path(args.analysis).with_suffix("")).replace(".analysis", "") + ".song.json")
    Path(out_path).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}  ({len(result['timeframes'])} timeframes, "
          f"{len(result['song'].get('beatTimestampsMs', []))} beats)")
    if args.explain:
        explain(result, analysis)


if __name__ == "__main__":
    main()
