#!/usr/bin/env python3
"""Music analysis service (PHASE 1) — deterministic MIR, no LLM.

Audio in -> rich structured <song>.analysis.json out. Everything time-aligned to
milliseconds, sampled on a fixed grid (default 100ms) AND summarized per-section.

Usage:
  python scripts/analyze_music.py <audio_file> [-o out.analysis.json] [--bpm N]
                                  [--grid-ms 100] [--meter 4] [--sections K]
                                  [--plot out.png] [--validate]

Output schema: docs/analysis-schema.json (use --validate to check, jsonschema required).

Design notes / honesty:
  - Beats: percussive-onset beat tracker (same approach as detect_beats.py). --bpm
    is passed as a HARD tempo to librosa.beat_track(bpm=...), which fixes octave /
    ambiguous-tempo lock (see docs/beat-detection-variable-bpm.md); without it the
    tracker can lock to half/double time.
  - Downbeats: no madmom in this env, so we estimate the meter (default 4/4) bar
    phase by maximizing LOW-BAND onset strength (kicks land on the bar) on every
    Nth beat, and emit a downbeatConfidence. This is a HEURISTIC: for uniform
    four-on-the-floor (every beat kicks) there is little bar contrast, so confidence
    is low and the phase may be off — trust the confidence, not the phase.
  - Sections: librosa agglomerative segmentation over BEAT-SYNCHRONOUS chroma+MFCC
    (boundaries snap to beats); k from duration. Labels (intro/build/drop/breakdown/
    chorus/verse/outro) are a transparent HEURISTIC over per-section energy / onset /
    spectral features with an absolute-level floor and a confidence; raw features are
    exposed so Phase 2/the human can re-label. Labels are a first draft, not truth.
  - Levels: curves are shape-normalized to a robust 99th-percentile reference (not the
    max, so one transient can't crush the song); absolute level is preserved in
    audio.peakDbfs / audio.rmsDbfs so cross-song intensity is recoverable.
"""
import sys
import json
import math
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Any

import numpy as np
import librosa

HOP_LENGTH = 512
N_FFT = 2048
SCHEMA_VERSION = 2

BANDS = {"sub": (20, 60), "low": (60, 250), "mid": (250, 2000), "high": (2000, 8000)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _finite(x, default=0.0):
    x = float(x)
    return x if math.isfinite(x) else default


def norm_robust(a, pct=99.0):
    """Shape-normalize to a robust percentile reference, clipped to [0,1]."""
    a = np.asarray(a, dtype=float)
    if a.size == 0:
        return a
    ref = float(np.percentile(a, pct))
    if ref <= 0:
        mx = float(a.max())
        ref = mx if mx > 0 else 1.0
    return np.clip(a / ref, 0.0, 1.0)


def frame_times(n_frames, sr):
    return librosa.frames_to_time(np.arange(n_frames), sr=sr, hop_length=HOP_LENGTH)


def resample_to_grid(values, src_times, grid_times):
    values = np.asarray(values, dtype=float)
    if values.size == 0 or len(src_times) == 0:
        return np.zeros(len(grid_times))
    return np.interp(grid_times, src_times, values)


def dbfs(x):
    x = float(x)
    return round(20.0 * math.log10(x), 2) if x > 1e-9 else -120.0


def sanitize(obj):
    """Recursively replace non-finite floats with 0.0 so output is valid JSON."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else 0.0
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Low-level features
# ---------------------------------------------------------------------------

def _onset_envelope_percussive(y, sr, fmax=8000, n_mels=128):
    y_perc = librosa.effects.percussive(y, margin=3.0)
    return librosa.onset.onset_strength(
        y=y_perc, sr=sr, hop_length=HOP_LENGTH, aggregate=np.median, fmax=fmax, n_mels=n_mels,
    )


def detect_beats(y, sr, bpm_hint=None, tightness=80):
    """Beat grid via percussive onset + beat_track.

    Returns (beat_times_s [np.ndarray], tempo [float], oenv [np.ndarray]).
    --bpm is passed as a HARD tempo (librosa bpm=) to fix octave/ambiguous lock.
    """
    oenv = _onset_envelope_percussive(y, sr)
    kwargs = dict(onset_envelope=oenv, sr=sr, hop_length=HOP_LENGTH, units="frames", tightness=tightness)
    if bpm_hint and bpm_hint > 0:
        kwargs["bpm"] = float(bpm_hint)  # hard tempo (constrains the grid; fixes octave errors)
    tempo, beat_frames = librosa.beat.beat_track(**kwargs)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP_LENGTH)
    tempo_val = float(np.median(tempo)) if hasattr(tempo, "__iter__") else float(tempo)
    return np.asarray(beat_times, dtype=float), tempo_val, oenv


def estimate_downbeats(beat_times, oenv_low, sr, meter=4):
    """Estimate bar phase by maximizing LOW-BAND onset strength on every meter-th beat.

    Returns (downbeat_indices, confidence). Confidence = (best-second)/best of the
    per-phase scores; ~0 means no bar contrast (e.g. uniform four-on-the-floor) and
    the phase is unreliable. HEURISTIC; assumes a constant meter.
    """
    meter = max(1, int(meter))
    n = len(beat_times)
    if n == 0:
        return [], 0.0
    if n < meter:
        return [0], 0.0
    beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=HOP_LENGTH)
    beat_frames = np.clip(beat_frames, 0, len(oenv_low) - 1)
    strengths = oenv_low[beat_frames]
    scores = [float(np.sum(strengths[phase::meter])) for phase in range(meter)]
    order = np.argsort(scores)[::-1]
    best_phase = int(order[0])
    best, second = scores[order[0]], (scores[order[1]] if len(order) > 1 else 0.0)
    conf = round(_finite((best - second) / best) if best > 0 else 0.0, 3)
    return list(range(best_phase, n, meter)), max(0.0, min(1.0, conf))


def band_energy_frames(y, sr):
    """Per-frame MEAN magnitude in each band (mean, not sum, so bin-count/bandwidth
    does not bias wide bands; keeps the bass/kick channels readable for LEDs)."""
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    out = {}
    for name, (lo, hi) in BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        out[name] = S[mask, :].mean(axis=0) if mask.any() else np.zeros(S.shape[1])
    return out, S.shape[1]


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------

def segment_sections(y, sr, duration_s, beat_times, k_override=None):
    """Agglomerative segmentation over BEAT-SYNC chroma+MFCC; boundaries snap to beats.
    Returns boundary times (s). Robust to very short / few-frame audio."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP_LENGTH)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP_LENGTH, n_mfcc=13)
    feat = np.vstack([librosa.util.normalize(chroma, axis=0), librosa.util.normalize(mfcc, axis=0)])

    beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=HOP_LENGTH) if len(beat_times) else np.array([], dtype=int)
    beat_frames = beat_frames[(beat_frames >= 0) & (beat_frames < feat.shape[1])]

    k = int(k_override) if k_override else int(np.clip(round(duration_s / 12.0), 4, 16))

    # Beat-synchronous segmentation when we have enough beats (boundaries land on beats).
    if len(beat_frames) >= 4:
        feat_sync = librosa.util.sync(feat, beat_frames, aggregate=np.mean)
        n_units = feat_sync.shape[1]
        kk = max(2, min(k, n_units - 1))
        if n_units < 2:
            return [0.0, float(duration_s)]
        try:
            bounds = librosa.segment.agglomerative(feat_sync, kk)
        except Exception:
            return [0.0, float(duration_s)]
        # bounds index into beat-synced units; map unit i to its starting beat frame
        seg_starts = np.concatenate([[0], beat_frames])  # unit boundaries in frames
        bound_frames = [int(seg_starts[min(b, len(seg_starts) - 1)]) for b in bounds]
        bound_times = librosa.frames_to_time(np.array(bound_frames), sr=sr, hop_length=HOP_LENGTH)
    else:
        if feat.shape[1] < 2:
            return [0.0, float(duration_s)]
        kk = max(2, min(k, feat.shape[1] - 1))
        try:
            bounds = librosa.segment.agglomerative(feat, kk)
        except Exception:
            return [0.0, float(duration_s)]
        bound_times = librosa.frames_to_time(bounds, sr=sr, hop_length=HOP_LENGTH)

    times = sorted(set([0.0] + [float(t) for t in bound_times] + [float(duration_s)]))
    return times


def label_sections(sections, abs_peak_rms):
    """Heuristic labels over per-section features. Uses an ABSOLUTE energy floor so
    flat/quiet tracks don't all collapse to 'drop', and damps confidence when there
    are too few sections to establish contrast."""
    n = len(sections)
    if n == 0:
        return
    E = norm_robust([s["summary"]["energy"] for s in sections], pct=100)
    O = norm_robust([s["summary"]["onsetDensity"] for s in sections], pct=100)
    SUB = norm_robust([s["summary"]["bandEnergy"]["sub"] for s in sections], pct=100)
    peak = float(E.max()) if n else 0.0
    contrast_damp = 1.0 if n >= 3 else 0.6  # few sections -> less trustworthy labels
    # absolute floor: a "drop"/"chorus" needs real loudness, not just relative
    abs_energy = [float(s["summary"]["energyAbs"]) for s in sections]
    abs_ref = max(abs_energy) if abs_energy else 0.0
    loud_enough = [(abs_ref > 0 and ae >= 0.45 * abs_ref) for ae in abs_energy]

    for i, s in enumerate(sections):
        e, o, sub = float(E[i]), float(O[i]), float(SUB[i])
        prev_e = float(E[i - 1]) if i > 0 else 0.0
        is_high = e >= 0.75 * peak and loud_enough[i]
        rising = e > prev_e + 0.15
        falling = e < prev_e - 0.2
        if i == 0 and e < 0.5 * peak:
            label, conf = "intro", 0.6 + 0.4 * (1 - e)
        elif i == n - 1 and e < 0.5 * peak:
            label, conf = "outro", 0.6 + 0.4 * (1 - e)
        elif is_high and o >= 0.6 and sub >= 0.5:
            label, conf = "drop", 0.5 + 0.5 * min(o, sub)
        elif rising and not is_high:
            label, conf = "build", 0.5 + 0.5 * min(1.0, (e - prev_e) / max(prev_e, 0.2))
        elif falling and prev_e >= 0.6 * peak:
            label, conf = "breakdown", 0.5 + 0.5 * min(1.0, (prev_e - e))
        elif is_high:
            label, conf = "chorus", 0.45 + 0.3 * e
        else:
            label, conf = ("verse" if e < 0.6 * peak else "chorus"), 0.35
        s["label"] = label
        s["confidence"] = round(float(np.clip(conf * contrast_damp, 0.0, 1.0)), 3)
        s["features"] = {"energyN": round(e, 3), "onsetDensityN": round(o, 3),
                         "subN": round(sub, 3), "loudEnough": bool(loud_enough[i])}


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze(audio_path, grid_ms=100, bpm_hint=None, meter=4, sections_k=None):
    if grid_ms <= 0:
        raise ValueError("grid_ms must be > 0")
    meter = max(1, int(meter))
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration_s = float(len(y) / sr) if sr else 0.0
    duration_ms = int(round(duration_s * 1000))

    beat_times, tempo, oenv = detect_beats(y, sr, bpm_hint=bpm_hint)
    beat_ms = [int(round(t * 1000)) for t in beat_times]

    # Low-band onset envelope drives downbeat phase (kicks land on the bar).
    # n_mels kept small: few FFT bins exist below 250 Hz, so more mels = empty filters.
    oenv_low = _onset_envelope_percussive(y, sr, fmax=250, n_mels=8)
    db_idx, db_conf = estimate_downbeats(beat_times, oenv_low, sr, meter=meter)
    downbeat_ms = [int(round(beat_times[i] * 1000)) for i in db_idx if i < len(beat_times)]

    # Frame-rate curves
    rms = librosa.feature.rms(y=y, hop_length=HOP_LENGTH)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP_LENGTH)[0]
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)
    bands, n_frames = band_energy_frames(y, sr)

    ft = frame_times(len(rms), sr)
    oft = frame_times(len(onset_env), sr)
    bft = frame_times(n_frames, sr)
    grid_times = np.arange(0, duration_s + 1e-9, grid_ms / 1000.0)
    grid_ms_list = [int(round(t * 1000)) for t in grid_times]

    rms_g_abs = resample_to_grid(rms, ft, grid_times)
    energy_g = norm_robust(rms_g_abs)
    onset_g = norm_robust(resample_to_grid(onset_env, oft, grid_times))
    centroid_g = resample_to_grid(centroid, ft, grid_times)
    band_g = {name: resample_to_grid(vals, bft, grid_times) for name, vals in bands.items()}
    band_max = max((float(v.max()) for v in band_g.values() if v.size), default=1.0) or 1.0
    band_g_n = {name: (vals / band_max) for name, vals in band_g.items()}

    # Genuinely local tempo (dynamic), independent of the global beat grid.
    try:
        dtempo = librosa.feature.rhythm.tempo(onset_envelope=onset_env, sr=sr, hop_length=HOP_LENGTH, aggregate=None)
        local_bpm = resample_to_grid(dtempo, frame_times(len(dtempo)), grid_times)
    except Exception:
        if len(beat_times) >= 2:
            ibi = np.diff(beat_times)
            local_bpm = resample_to_grid(60.0 / np.clip(ibi, 1e-3, None), beat_times[:-1] + ibi / 2.0, grid_times)
        else:
            local_bpm = np.zeros(len(grid_times))

    # Sections
    bound_times = segment_sections(y, sr, duration_s, beat_times, k_override=sections_k)
    sections: List[Dict[str, Any]] = []
    for idx, (a, b) in enumerate(zip(bound_times[:-1], bound_times[1:])):
        if b - a < 0.5:
            continue
        last = idx == len(bound_times) - 2
        m = (grid_times >= a) & (grid_times <= b) if last else (grid_times >= a) & (grid_times < b)
        if not m.any():
            continue
        sec_beats = [t for t in beat_times if a <= t < b]
        sec_bpm = round(60.0 / float(np.median(np.diff(sec_beats))), 2) if len(sec_beats) >= 2 else 0.0
        # energy-weighted centroid so silent frames don't drag brightness to 0
        w = rms_g_abs[m]
        cw = centroid_g[m]
        centroid_mean = float(np.average(cw, weights=w)) if w.sum() > 0 else float(cw.mean() if cw.size else 0.0)
        sections.append({
            "startMs": int(round(a * 1000)), "endMs": int(round(b * 1000)),
            "label": "", "confidence": 0.0, "bpm": sec_bpm,
            "summary": {
                "energy": round(float(energy_g[m].mean()), 4),
                "energyAbs": round(float(rms_g_abs[m].mean()), 6),
                "onsetDensity": round(float(onset_g[m].mean()), 4),
                "spectralCentroid": round(centroid_mean, 1),
                "bandEnergy": {name: round(float(band_g_n[name][m].mean()), 4) for name in BANDS},
            },
        })
    label_sections(sections, float(np.max(np.abs(y))) if len(y) else 0.0)

    result = {
        "schemaVersion": SCHEMA_VERSION,
        "audio": {
            "path": str(audio_path), "sampleRate": int(sr), "durationMs": duration_ms,
            "peakDbfs": dbfs(float(np.max(np.abs(y))) if len(y) else 0.0),
            "rmsDbfs": dbfs(float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0),
        },
        "grid": {"stepMs": grid_ms, "count": len(grid_ms_list)},
        "bpmGlobal": round(float(tempo), 2),
        "meter": meter,
        "beatTimestampsMs": beat_ms,
        "downbeatTimestampsMs": downbeat_ms,
        "downbeatConfidence": round(float(db_conf), 3),
        "sections": sections,
        "curves": {
            "timeMs": grid_ms_list,
            "energy": [round(float(v), 4) for v in energy_g],
            "onsetDensity": [round(float(v), 4) for v in onset_g],
            "spectralCentroid": [round(float(v), 1) for v in centroid_g],
            "localBpm": [round(float(v), 2) for v in local_bpm],
            "bandEnergy": {name: [round(float(v), 4) for v in band_g_n[name]] for name in BANDS},
        },
    }
    return sanitize(result)


# ---------------------------------------------------------------------------
# Visualization, validation & CLI
# ---------------------------------------------------------------------------

def plot_analysis(result, out_png):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:  # pragma: no cover
        sys.stderr.write(f"[plot] matplotlib unavailable ({e}); skipping PNG.\n")
        return False
    c = result["curves"]
    t = np.array(c["timeMs"]) / 1000.0
    fig, axes = plt.subplots(3, 1, figsize=(14, 9), sharex=True)
    axes[0].plot(t, c["energy"], label="energy", color="#e25", lw=1)
    axes[0].plot(t, c["onsetDensity"], label="onset density", color="#28e", lw=0.8, alpha=0.7)
    axes[0].set_ylabel("level (0-1)"); axes[0].legend(loc="upper right")
    for name in ["sub", "low", "mid", "high"]:
        axes[1].plot(t, c["bandEnergy"][name], label=name, lw=0.9)
    axes[1].set_ylabel("band energy"); axes[1].legend(loc="upper right", ncol=4)
    axes[2].plot(t, c["spectralCentroid"], color="#555", lw=0.8)
    axes[2].set_ylabel("centroid (Hz)"); axes[2].set_xlabel("time (s)")
    colors = {"intro": "#9cf", "build": "#fd6", "drop": "#f66", "breakdown": "#6cf",
              "chorus": "#fa6", "verse": "#ccc", "outro": "#aaa"}
    for s in result["sections"]:
        x0, x1 = s["startMs"] / 1000.0, s["endMs"] / 1000.0
        for ax in axes:
            ax.axvspan(x0, x1, color=colors.get(s["label"], "#ddd"), alpha=0.15)
            ax.axvline(x0, color="k", lw=0.4, alpha=0.4)
        axes[0].text(x0 + 0.1, 0.92, f"{s['label']}\n{s['confidence']:.2f}", fontsize=7, va="top")
    for db in result["downbeatTimestampsMs"]:
        axes[0].axvline(db / 1000.0, color="green", lw=0.3, alpha=0.3)
    fig.suptitle(f"{Path(result['audio']['path']).name}  —  {result['bpmGlobal']} BPM, "
                 f"{len(result['beatTimestampsMs'])} beats, {len(result['sections'])} sections, "
                 f"downbeat conf {result['downbeatConfidence']}")
    fig.tight_layout(); fig.savefig(out_png, dpi=110); plt.close(fig)
    return True


def validate_against_schema(result):
    try:
        import jsonschema
    except Exception:
        sys.stderr.write("[validate] jsonschema not installed; skipping.\n")
        return None
    schema_path = Path(__file__).resolve().parent.parent / "docs" / "analysis-schema.json"
    schema = json.loads(schema_path.read_text())
    jsonschema.validate(result, schema)
    n = result["grid"]["count"]
    c = result["curves"]
    assert all(len(c[k]) == n for k in ["timeMs", "energy", "onsetDensity", "spectralCentroid", "localBpm"])
    assert all(len(v) == n for v in c["bandEnergy"].values())
    return True


def print_summary(result):
    a = result["audio"]
    print(f"\n=== {Path(a['path']).name} ===")
    print(f"duration {a['durationMs']/1000:.1f}s  global {result['bpmGlobal']} BPM  peak {a['peakDbfs']}dBFS  "
          f"{len(result['beatTimestampsMs'])} beats  {len(result['downbeatTimestampsMs'])} downbeats "
          f"(conf {result['downbeatConfidence']})")
    print(f"{'section':<10} {'start':>7} {'end':>7} {'bpm':>6} {'energy':>7} {'onset':>6} {'conf':>5}")
    for s in result["sections"]:
        print(f"{s['label']:<10} {s['startMs']/1000:>6.1f}s {s['endMs']/1000:>6.1f}s {s['bpm']:>6} "
              f"{s['summary']['energy']:>7} {s['summary']['onsetDensity']:>6} {s['confidence']:>5}")
    ramp = " .:-=+*#%@"
    e = result["curves"]["energy"]
    step = max(1, len(e) // 100)
    spark = "".join(ramp[min(len(ramp) - 1, int(v * (len(ramp) - 1)))] for v in e[::step])
    print(f"energy: |{spark}|")


def main():
    p = argparse.ArgumentParser(description="Analyze an audio file into structured MIR JSON.")
    p.add_argument("audio_file")
    p.add_argument("--output", "-o", default=None, help="Output JSON path (default: <stem>.analysis.json)")
    p.add_argument("--bpm", type=float, default=None, help="Hard BPM for beat tracking (fixes octave/ambiguous tempo)")
    p.add_argument("--grid-ms", type=int, default=100, help="Curve sampling grid in ms (default 100)")
    p.add_argument("--meter", type=int, default=4, help="Beats per bar for downbeat estimation (default 4)")
    p.add_argument("--sections", type=int, default=None, help="Force number of sections (default: adaptive ~duration/12s)")
    p.add_argument("--plot", default=None, help="Write a PNG visualization to this path")
    p.add_argument("--validate", action="store_true", help="Validate output against docs/analysis-schema.json")
    args = p.parse_args()

    if args.grid_ms <= 0:
        p.error("--grid-ms must be > 0")
    if args.meter < 1:
        p.error("--meter must be >= 1")
    if args.sections is not None and args.sections < 2:
        p.error("--sections must be >= 2")

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    result = analyze(args.audio_file, grid_ms=args.grid_ms, bpm_hint=args.bpm,
                     meter=args.meter, sections_k=args.sections)

    if args.validate:
        validate_against_schema(result)
        print("[validate] schema OK")

    out_path = args.output or str(Path(args.audio_file).with_suffix("")) + ".analysis.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2, allow_nan=False)
    print(f"Wrote {out_path}  ({len(result['sections'])} sections, {result['grid']['count']} grid points)")
    if args.plot and plot_analysis(result, args.plot):
        print(f"Wrote plot {args.plot}")
    print_summary(result)


if __name__ == "__main__":
    main()
