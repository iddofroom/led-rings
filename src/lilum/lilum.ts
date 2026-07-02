// PUT a sequence to led-sequence-service and POST a trigger so the Lilum
// pendant plays the "portal" pattern (ported from the standalone firmware):
// each of the 3 rings is a solid colour whose brightness pulses as a sine
// wave, with the rings phase-offset by 1/3 of the cycle so the glow sweeps
// inner -> middle -> outer. A slow hue drift rotates the colours over time.

import axios from "axios";
import {
    SEQUENCE_SERVICE_IP, SEQUENCE_SERVICE_PORT,
    TRIGGER_SERVICE_IP,  TRIGGER_SERVICE_PORT,
} from "../sys-config/sys-config";

// Both pendants play the same sequence off the single "lilum" trigger.
const THING_NAMES  = ["lilum1", "lilum2"];
const TRIGGER_NAME = "lilum";

// One brightness-pulse cycle. Slowed down from the firmware's ~1700 ms for a
// calmer breathing sweep.
const CYCLE_MS = 4500;

// Lowest brightness each ring dips to at the trough. Firmware clamps anything
// below ~40/255 to 0, so 0.0 reproduces the rings going fully dark.
const PULSE_LOW = 0.0;

// Peak hue drift at mid-loop (rings drift out to base+HUE_DRIFT then back).
// Kept small so no ring's base + drift crosses the 1.0 hue wrap.
const HUE_DRIFT = 0.15;

// Glow sweeps inner -> middle -> outer. Higher phase peaks earlier, so inner
// gets the largest phase. They are bunched closer than 1/3 apart (0.36, 0.18,
// 0) so adjacent rings stay lit at the same time and their pulses overlap
// rather than handing off cleanly.
const RING_CONFIGS = [
    { segment: "inner",  hue: 0.00, phase: 0.36 },
    { segment: "middle", hue: 0.33, phase: 0.18 },
    { segment: "outer",  hue: 0.67, phase: 0.00 },
] as const;

interface Effect {
    effect_config: { start_time: number; end_time: number; segments: string };
    const_color?: { color: { hue: number; sat: number; val: number } };
    timed_brightness?: {
        mult_factor_decrease: {
            sin: { min: number; max: number; phase: number; repeats: number };
        };
    };
    timed_hue?: {
        offset_factor: {
            half: {
                f1: { linear: { start: number; end: number } };
                f2: { linear: { start: number; end: number } };
            };
        };
    };
}

// One ring of the portal: solid base colour, a sine brightness pulse (phase
// offset per ring), and a slow linear hue drift.
const portalRing = (segment: string, hue: number, phase: number): Effect[] => {
    const cfg = { start_time: 0, end_time: CYCLE_MS, segments: segment };
    return [
        { effect_config: cfg, const_color: { color: { hue, sat: 1.0, val: 1.0 } } },
        {
            effect_config: cfg,
            timed_brightness: {
                mult_factor_decrease: {
                    sin: { min: PULSE_LOW, max: 1.0, phase, repeats: 1 },
                },
            },
        },
        {
            // Round-trip hue drift: 0 -> HUE_DRIFT over the first half, back to
            // 0 over the second half, so it returns smoothly with no loop seam.
            effect_config: cfg,
            timed_hue: {
                offset_factor: {
                    half: {
                        f1: { linear: { start: 0, end: HUE_DRIFT } },
                        f2: { linear: { start: HUE_DRIFT, end: 0 } },
                    },
                },
            },
        },
    ];
};

const buildSequence = () => {
    const effects: Effect[] = [];
    for (const { segment, hue, phase } of RING_CONFIGS) {
        effects.push(...portalRing(segment, hue, phase));
    }
    const thingSeq = {
        effects,
        duration_ms: CYCLE_MS,
        num_repeats: 0,    // 0 = loop forever
    };
    return Object.fromEntries(THING_NAMES.map((thing) => [thing, thingSeq]));
};

(async () => {
    const seqUrl     = `http://${SEQUENCE_SERVICE_IP}:${SEQUENCE_SERVICE_PORT}/triggers/${TRIGGER_NAME}`;
    const triggerUrl = `http://${TRIGGER_SERVICE_IP}:${TRIGGER_SERVICE_PORT}/trigger/${TRIGGER_NAME}`;
    try {
        const seqRes = await axios.put(seqUrl, buildSequence(), { timeout: 5000 });
        console.log(`Sequence "${TRIGGER_NAME}" sent -> ${seqUrl}, status: ${seqRes.status}`);

        const trigRes = await axios.post(triggerUrl, { start_offset_ms: 0 }, { timeout: 5000 });
        console.log(`Trigger "${TRIGGER_NAME}" fired -> ${triggerUrl}, status: ${trigRes.status}`);
    } catch (err) {
        console.error("Error sending Lilum trigger:", err);
        process.exit(1);
    }
})();
