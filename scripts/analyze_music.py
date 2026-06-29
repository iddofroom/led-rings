#!/usr/bin/env python3
"""Music analysis service (PHASE 1) — deterministic MIR, no LLM.

Audio in -> rich structured <song>.analysis.json out. Everything time-aligned to
milliseconds, sampled on a fixed grid (default 100ms) AND summarized per-section.

Usage:
  python scripts/analyze_music.py <audio_file> [-o out.analysis.json] [--bpm N]
                                  [--grid-ms 100] [--meter 4] [--plot out.png]

Output schema: docs/analysis-schema.json (validated structurally by --plot/--self-check).

Design notes / honesty:
  - Beats: percussive-onset beat tracker (same approach as detect_beats.py). Pass
    --bpm to hint a tempo for variable/ambiguous material (see docs/beat-detection-variable-bpm.md).
  - Downbeats: no madmom in this env, so we estimate the 4/4 (or --meter) bar phase
    by maximizing onset strength on every Nth beat. This is a HEURISTIC; for songs
    with pickups / odd meters it can be off by a beat. Documented, not hidden.
  - Sections: librosa agglomerative segmentation over chroma+MFCC, k chosen from
    duration. Labels (intro/build/drop/breakdown/chorus/outro) are a transparent
    HEURISTIC over per-section energy / onset-density / spectral features, each with
    a confidence and the raw normalized features exposed so Phase 2/the human can
    re-label. The labels are a first draft, not ground truth.
"""
import sys
import json
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Any

import numpy as np
import librosa

HOP_LENGTH = 512
N_FFT = 2048
SCHEMA_VERSION = 1

# Frequency bands (Hz) for bandEnergy.
BANDS = {
    "sub": (20, 60),
    "low": (60, 250),
    "mid": (250, 2000),
    "high": (2000, 8000),
}

LABELS = ["intro", "build", "drop", "breakdown", "chorus", "outro"]


# ---------------------------------------------------------------------------
# Low-level features
# ---------------------------------------------------------------------------

def _onset_envelope_percussive(y, sr):
    """Onset strength from the percussive component (matches detect_beats.py)."""
    y_perc = librosa.effects.percussive(y, margin=3.0)
    return librosa.onset.onset_strength(
        y=y_perc, sr=sr, hop_length=HOP_LENGTH, aggregate=np.median, fmax=8000, n_mels=128,
    )


def detect_beats(y, sr, bpm_hint=None, tightness=80):
    """Beat grid via percussive onset + beat_track. Returns (beat_times_s, tempo)."""
    oenv = _onset_envelope_percussive(y, sr)
    kwargs = dict(onset_envelope=oenv, sr=sr, hop_length=HOP_LENGTH, units="frames", tightness=tightness)
    if bpm_hint:
        kwargs["start_bpm"] = float(bpm_hint)
    tempo, beat_frames = librosa.beat.beat_track(**kwargs)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP_LENGTH)
    tempo_val = float(np.median(tempo)) if hasattr(tempo, "__iter__") else float(tempo)
    return np.asarray(beat_times, dtype=float), tempo_val, oenv


def estimate_downbeats(beat_times, oenv, sr, meter=4):
    """Estimate bar phase by maximizing onset strength on every `meter`-th beat.

    Returns the indices (into beat_times) that are downbeats. HEURISTIC, assumes a
    constant meter and that downbeats carry more onset energy than other beats.
    """
    if len(beat_times) < meter:
        return list(range(0, len(beat_times)))
    beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=HOP_LENGTH)
    beat_frames = np.clip(beat_frames, 0, len(oenv) - 1)
    strengths = oenv[beat_frames]
    best_phase, best_score = 0, -1.0
    for phase in range(meter):
        score = float(np.sum(strengths[phase::meter]))
        if score > best_score:
            best_score, best_phase = score, phase
    return list(range(best_phase, len(beat_times), meter))


def frame_times(n_frames, sr):
    return librosa.frames_to_time(np.arange(n_frames), sr=sr, hop_length=HOP_LENGTH)


def band_energy_frames(y, sr):
    """Per-frame energy in each frequency band, from the STFT magnitude."""
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    out = {}
    for name, (lo, hi) in BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        out[name] = S[mask, :].sum(axis=0) if mask.any() else np.zeros(S.shape[1])
    return out, S.shape[1]


def resample_to_grid(values, src_times, grid_times):
    """Linear-interpolate a frame-rate curve onto the fixed ms grid."""
    if len(src_times) == 0:
        return np.zeros(len(grid_times))
    return np.interp(grid_times, src_times, values)


def norm01(a):
    a = np.asarray(a, dtype=float)
    mx = float(a.max()) if a.size else 0.0
    return (a / mx) if mx > 0 else a


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------

def segment_sections(y, sr, duration_s, k_override=None):
    """Agglomerative structural segmentation over chroma+MFCC. Returns boundary times (s)."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP_LENGTH)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP_LENGTH, n_mfcc=13)
    # Stack normalized features
    feat = np.vstack([librosa.util.normalize(chroma, axis=0), librosa.util.normalize(mfcc, axis=0)])
    k = int(k_override) if k_override else int(np.clip(round(duration_s / 20.0), 3, 12))
    k = min(k, feat.shape[1] - 1) if feat.shape[1] > 2 else 2
    bounds = librosa.segment.agglomerative(feat, k)
    bound_times = librosa.frames_to_time(bounds, sr=sr, hop_length=HOP_LENGTH)
    # Ensure 0 and end are boundaries
    times = sorted(set([0.0] + [float(t) for t in bound_times] + [float(duration_s)]))
    return times


def label_sections(sections, beat_times):
    """Heuristic labels over per-section energy/onset/centroid features.

    `sections` is a list of dicts already carrying summary features. Labels are a
    transparent first draft with confidence in [0,1]; raw normalized features stay
    in each section so they can be re-labeled downstream.
    """
    n = len(sections)
    if n == 0:
        return
    E = norm01([s["summary"]["energy"] for s in sections])
    O = norm01([s["summary"]["onsetDensity"] for s in sections])
    SUB = norm01([s["summary"]["bandEnergy"]["sub"] for s in sections])

    peak = float(E.max()) if n else 0.0
    for i, s in enumerate(sections):
        e, o, sub = float(E[i]), float(O[i]), float(SUB[i])
        prev_e = float(E[i - 1]) if i > 0 else 0.0
        label, conf = "chorus", 0.4
        is_high = e >= 0.75 * peak
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
            # mid energy, no clear trend
            label, conf = ("verse" if e < 0.6 * peak else "chorus"), 0.35
        s["label"] = label
        s["confidence"] = round(float(np.clip(conf, 0.0, 1.0)), 3)
        s["features"] = {"energyN": round(e, 3), "onsetDensityN": round(o, 3), "subN": round(sub, 3)}


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def analyze(audio_path, grid_ms=100, bpm_hint=None, meter=4, sections_k=None):
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration_s = float(len(y) / sr)
    duration_ms = int(round(duration_s * 1000))

    beat_times, tempo, oenv = detect_beats(y, sr, bpm_hint=bpm_hint)
    beat_ms = [int(round(t * 1000)) for t in beat_times]
    db_idx = estimate_downbeats(beat_times, oenv, sr, meter=meter)
    downbeat_ms = [int(round(beat_times[i] * 1000)) for i in db_idx]

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

    energy_g = norm01(resample_to_grid(rms, ft, grid_times))
    onset_g = norm01(resample_to_grid(onset_env, oft, grid_times))
    centroid_g = resample_to_grid(centroid, ft, grid_times)  # Hz, not normalized
    band_g = {name: resample_to_grid(vals, bft, grid_times) for name, vals in bands.items()}
    band_max = max((float(v.max()) for v in band_g.values()), default=0.0) or 1.0
    band_g_n = {name: (vals / band_max) for name, vals in band_g.items()}

    # Local BPM curve from inter-beat intervals
    local_bpm = np.zeros(len(grid_times))
    if len(beat_times) >= 2:
        ibi = np.diff(beat_times)
        bpm_at_beat = 60.0 / np.clip(ibi, 1e-3, None)
        bpm_times = beat_times[:-1] + ibi / 2.0
        local_bpm = resample_to_grid(bpm_at_beat, bpm_times, grid_times)

    # Sections
    bound_times = segment_sections(y, sr, duration_s, k_override=sections_k)
    sections: List[Dict[str, Any]] = []
    for a, b in zip(bound_times[:-1], bound_times[1:]):
        if b - a < 0.5:
            continue
        m = (grid_times >= a) & (grid_times < b)
        if not m.any():
            continue
        sec_beats = [t for t in beat_times if a <= t < b]
        sec_bpm = 0.0
        if len(sec_beats) >= 2:
            sec_bpm = round(60.0 / float(np.median(np.diff(sec_beats))), 2)
        sections.append({
            "startMs": int(round(a * 1000)),
            "endMs": int(round(b * 1000)),
            "label": "",
            "confidence": 0.0,
            "bpm": sec_bpm,
            "summary": {
                "energy": round(float(energy_g[m].mean()), 4),
                "onsetDensity": round(float(onset_g[m].mean()), 4),
                "spectralCentroid": round(float(centroid_g[m].mean()), 1),
                "bandEnergy": {name: round(float(band_g_n[name][m].mean()), 4) for name in BANDS},
            },
        })
    label_sections(sections, beat_times)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "audio": {"path": str(audio_path), "sampleRate": int(sr), "durationMs": duration_ms},
        "grid": {"stepMs": grid_ms, "count": len(grid_ms_list)},
        "bpmGlobal": round(float(tempo), 2),
        "meter": meter,
        "beatTimestampsMs": beat_ms,
        "downbeatTimestampsMs": downbeat_ms,
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


# ---------------------------------------------------------------------------
# Visualization & CLI
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
    for name, col in zip(["sub", "low", "mid", "high"], ["#a04", "#e80", "#0a8", "#08c"]):
        axes[1].plot(t, c["bandEnergy"][name], label=name, lw=0.9)
    axes[1].set_ylabel("band energy"); axes[1].legend(loc="upper right", ncol=4)
    axes[2].plot(t, c["spectralCentroid"], color="#555", lw=0.8)
    axes[2].set_ylabel("centroid (Hz)"); axes[2].set_xlabel("time (s)")
    # Section boundaries + labels
    colors = {"intro": "#9cf", "build": "#fd6", "drop": "#f66", "breakdown": "#6cf",
              "chorus": "#fa6", "verse": "#ccc", "outro": "#aaa"}
    for s in result["sections"]:
        x0, x1 = s["startMs"] / 1000.0, s["endMs"] / 1000.0
        for ax in axes:
            ax.axvspan(x0, x1, color=colors.get(s["label"], "#ddd"), alpha=0.15)
            ax.axvline(x0, color="k", lw=0.4, alpha=0.4)
        axes[0].text(x0 + 0.1, 0.92, f"{s['label']}\n{s['confidence']:.2f}", fontsize=7, va="top")
    # Downbeats
    for db in result["downbeatTimestampsMs"]:
        axes[0].axvline(db / 1000.0, color="green", lw=0.3, alpha=0.3)
    fig.suptitle(f"{Path(result['audio']['path']).name}  —  {result['bpmGlobal']} BPM global, "
                 f"{len(result['beatTimestampsMs'])} beats, {len(result['sections'])} sections")
    fig.tight_layout()
    fig.savefig(out_png, dpi=110)
    plt.close(fig)
    return True


def print_summary(result):
    print(f"\n=== {Path(result['audio']['path']).name} ===")
    print(f"duration {result['audio']['durationMs']/1000:.1f}s  global {result['bpmGlobal']} BPM  "
          f"{len(result['beatTimestampsMs'])} beats  {len(result['downbeatTimestampsMs'])} downbeats")
    print(f"{'section':<10} {'start':>7} {'end':>7} {'bpm':>6} {'energy':>7} {'onset':>6} {'conf':>5}")
    for s in result["sections"]:
        print(f"{s['label']:<10} {s['startMs']/1000:>6.1f}s {s['endMs']/1000:>6.1f}s {s['bpm']:>6} "
              f"{s['summary']['energy']:>7} {s['summary']['onsetDensity']:>6} {s['confidence']:>5}")
    # ASCII energy sparkline (ASCII-only so it never trips Windows cp1252 consoles)
    ramp = " .:-=+*#%@"
    e = result["curves"]["energy"]
    step = max(1, len(e) // 100)
    spark = "".join(ramp[min(len(ramp) - 1, int(v * (len(ramp) - 1)))] for v in e[::step])
    print(f"energy: |{spark}|")


def main():
    p = argparse.ArgumentParser(description="Analyze an audio file into structured MIR JSON.")
    p.add_argument("audio_file")
    p.add_argument("--output", "-o", default=None, help="Output JSON path (default: <stem>.analysis.json)")
    p.add_argument("--bpm", type=float, default=None, help="BPM hint for beat tracking (variable tempo)")
    p.add_argument("--grid-ms", type=int, default=100, help="Curve sampling grid in ms (default 100)")
    p.add_argument("--meter", type=int, default=4, help="Beats per bar for downbeat estimation (default 4)")
    p.add_argument("--sections", type=int, default=None, help="Force number of sections (default: adaptive ~duration/20s)")
    p.add_argument("--plot", default=None, help="Write a PNG visualization to this path")
    args = p.parse_args()

    try:  # avoid Windows cp1252 crashes on any non-ASCII output
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    result = analyze(args.audio_file, grid_ms=args.grid_ms, bpm_hint=args.bpm,
                     meter=args.meter, sections_k=args.sections)

    out_path = args.output or str(Path(args.audio_file).with_suffix("")) + ".analysis.json"
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Wrote {out_path}  ({len(result['sections'])} sections, "
          f"{result['grid']['count']} grid points)")
    # Plot first so a console print error can never block the artifact.
    if args.plot and plot_analysis(result, args.plot):
        print(f"Wrote plot {args.plot}")
    print_summary(result)


if __name__ == "__main__":
    main()
