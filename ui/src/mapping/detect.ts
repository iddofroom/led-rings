/**
 * Pure camera-frame math for the mapping stage. No DOM/React here so it can be
 * unit-tested in node against synthetic frames.
 *
 * Pipeline per lit LED:
 *   frameLuma = lumaFromRgba(canvas pixels)
 *   d         = diff(frameLuma, baselineLuma)   // baseline = averaged dark frames
 *   det       = detectBlob(d, w, h)             // brightest blob centroid + peak
 * A single LED is lit at a time, so the brightest blob in the difference image is
 * that LED. Baseline subtraction cancels ambient light and fixed reflections.
 */

export interface DetectOptions {
  /** Min diff (0..255) for a pixel to count as "lit". */
  threshold?: number;
  /** Include pixels >= peak*relFloor in the centroid (isolates the dominant blob). */
  relFloor?: number;
  /** Reject detections with fewer than this many bright pixels (noise). */
  minArea?: number;
  /** Reject if the bright area exceeds this fraction of the image (ambient/global change). */
  maxAreaFrac?: number;
}

export interface Detection {
  found: boolean;
  x: number; // normalized 0..1 (centroid)
  y: number; // normalized 0..1
  b: number; // peak brightness 0..1
  area: number; // count of bright pixels
}

const DEFAULTS: Required<DetectOptions> = {
  threshold: 40,
  relFloor: 0.6,
  minArea: 2,
  maxAreaFrac: 0.2,
};

/** Per-pixel brightness (max RGB channel — robust to LED color) from packed RGBA. */
export function lumaFromRgba(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    out[i] = r > g ? (r > b ? r : b) : g > b ? g : b;
  }
  return out;
}

/** Element-wise max(0, frame - baseline). */
export function diff(frame: Float32Array, baseline: Float32Array): Float32Array {
  const n = Math.min(frame.length, baseline.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = frame[i] - baseline[i];
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

/** Average several luma frames (for a stable baseline). */
export function averageLuma(frames: Float32Array[]): Float32Array {
  if (frames.length === 0) return new Float32Array(0);
  const n = frames[0].length;
  const out = new Float32Array(n);
  for (const f of frames) for (let i = 0; i < n; i++) out[i] += f[i];
  const inv = 1 / frames.length;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

/**
 * Find the brightest blob in a difference image and return its normalized centroid.
 * Centroid is intensity-weighted over pixels near the peak → sub-pixel accuracy.
 */
export function detectBlob(d: Float32Array, w: number, h: number, opts: DetectOptions = {}): Detection {
  const { threshold, relFloor, minArea, maxAreaFrac } = { ...DEFAULTS, ...opts };

  let peak = 0;
  for (let i = 0; i < d.length; i++) if (d[i] > peak) peak = d[i];
  if (peak < threshold) return { found: false, x: 0, y: 0, b: peak / 255, area: 0 };

  const floor = Math.max(threshold, peak * relFloor);
  let sx = 0, sy = 0, sw = 0, area = 0;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (v >= floor) {
      const px = i % w;
      const py = (i / w) | 0;
      sx += px * v;
      sy += py * v;
      sw += v;
      area++;
    }
  }
  if (area < minArea) return { found: false, x: 0, y: 0, b: peak / 255, area };
  if (area > maxAreaFrac * w * h) return { found: false, x: 0, y: 0, b: peak / 255, area };
  return { found: true, x: sx / sw / w, y: sy / sw / h, b: peak / 255, area };
}
