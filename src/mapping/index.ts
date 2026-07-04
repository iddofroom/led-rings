/**
 * Mapping stage orchestration (control-server side).
 *
 * Drives the "light one LED at a time" primitive used for camera-based position
 * mapping, WITHOUT any firmware change, purely through the existing KivSee
 * services (object → sequence → trigger). See docs/plan: Approach A.
 *
 * Flow per controller:
 *   1. prepareController — back up its geometry, then push single-pixel segments
 *      p0..p{cap-1} so any index can be lit. (One ESP reboot; we await rejoin.)
 *   2. lightLed(i)      — const_color(white) on segment "p<i>", then fire the
 *      global `mapscan` trigger. The ESP re-fetches and lights only pixel i;
 *      other controllers 404 on `mapscan` and go dark (desired). No reboot.
 *   3. blank            — stop() → all controllers clear (baseline dark frame).
 *   4. finishController — restore the backed-up geometry (or publish a derived
 *      one). One reboot back to normal.
 */
import { getThingConfig, putThingConfig, ThingSegments } from "../services/object";
import { sendSequenceForThing } from "../services/sequence";
import { postTrigger, stop } from "../services/trigger";
import { waitForThing } from "../mqtt-things";
import { Sequence } from "../effects/types";

const MAP_TRIGGER = "mapscan";
const DEFAULT_CAP = 512;
const MAX_CAP = 1024;
const REJOIN_TIMEOUT_MS = 25000;

export interface Hsv {
  hue: number;
  sat: number;
  val: number;
}
const WHITE: Hsv = { hue: 0, sat: 0, val: 1 };

const pixelSegName = (i: number) => `p${i}`;
const isPixelSeg = (name: string) => /^p\d+$/.test(name);

// In-memory backup of each thing's original geometry so finish() can restore it.
// If the control server restarts mid-session, just re-run prepare.
const backups = new Map<string, ThingSegments>();

/**
 * Push single-pixel segments p0..p{cap-1} onto a controller (preserving its real
 * segments), backing up the original first. Causes one ESP reboot; awaits rejoin.
 */
export async function prepareController(thing: string, capRaw?: number, simulate = false) {
  const cap = Math.max(1, Math.min(MAX_CAP, Math.floor(capRaw || DEFAULT_CAP)));

  let existing: ThingSegments | null = null;
  if (!simulate) {
    existing = await getThingConfig(thing).catch(() => null);
    if (existing && !backups.has(thing)) backups.set(thing, existing);
  }

  // Preserve the controller's real (non-mapping) segments; index MUST stay below
  // numberOfPixels or the firmware would read out of bounds, so size to >= cap.
  const baseSegments = (existing?.segments || []).filter((s) => !isPixelSeg(s.name));
  const numberOfPixels = Math.max(cap, existing?.numberOfPixels || 0);
  const pixelSegments = Array.from({ length: cap }, (_, i) => ({
    name: pixelSegName(i),
    pixels: [{ index: i, relPos: 0 }],
  }));
  const config: ThingSegments = { numberOfPixels, segments: [...baseSegments, ...pixelSegments] };

  if (simulate) return { thing, cap, numberOfPixels, backedUp: false, rejoined: true, simulate: true };

  await putThingConfig(thing, config);
  const rejoined = await waitForThing(thing, REJOIN_TIMEOUT_MS);
  return { thing, cap, numberOfPixels, backedUp: backups.has(thing), rejoined };
}

/** Light exactly one LED (index) on a controller. No reboot — sequence swap only. */
export async function lightLed(thing: string, index: number, color: Hsv = WHITE, simulate = false) {
  const seq: Sequence = {
    effects: [
      {
        effect_config: { start_time: 0, end_time: 1000, segments: pixelSegName(index) },
        const_color: { color },
      },
    ],
    duration_ms: 1000,
    num_repeats: 0, // 0 = loop forever → the pixel stays lit until the next call
  };
  if (simulate) return { thing, index, simulate: true };
  await sendSequenceForThing(MAP_TRIGGER, thing, seq);
  await postTrigger(MAP_TRIGGER);
  return { thing, index };
}

/** Clear all controllers (baseline dark frame). */
export async function blank(simulate = false) {
  if (simulate) return { blanked: true, simulate: true };
  await stop();
  return { blanked: true };
}

/**
 * End a controller's mapping session: restore its backed-up geometry, or publish
 * a caller-supplied derived geometry (Phase M2). Either causes one reboot.
 */
export async function finishController(
  thing: string,
  action: "restore" | "publish",
  config?: ThingSegments,
  simulate = false
) {
  if (simulate) return { thing, action, simulate: true };

  if (action === "publish") {
    if (!config) throw new Error("finish publish requires a config");
    await putThingConfig(thing, config);
    backups.delete(thing);
    return { thing, action, published: true };
  }

  const backup = backups.get(thing);
  if (!backup) return { thing, action: "restore", restored: false, note: "no backup on record" };
  await putThingConfig(thing, backup);
  backups.delete(thing);
  return { thing, action: "restore", restored: true };
}
