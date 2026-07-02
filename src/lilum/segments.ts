// Push the Lilum object's segment definitions to led-object-service.
// Lilum thing has 27 animation pixels in 3 concentric rings of 9. Data line
// starts at the outer ring (verified empirically with yarn lilum-diag):
//   outer  = indices 0..8
//   middle = indices 9..17
//   inner  = indices 18..26
// Pixel 0 of the physical strip is a status LED and is NOT part of these
// indices (the firmware already strips it before exposing the buffer).
//
// Besides the geometric segments (all/outer/middle/inner), we also define
// alias segments named identically to the rings' segments (centric/ind/arc/
// rand/updown/b1/b2). Songs reference these names, so defining them here lets
// a lilum pendant mirror a ring's animation (see Animation.mirrorToLilum) and
// have its position-based effects resolve instead of silently no-op'ing. The
// semantics match src/ring-segments/segments.json, recomputed for lilum's
// 3-rings-of-9 geometry.

import axios from "axios";
import { LEDS_OBJECT_SERVICE_IP, LEDS_OBJECT_SERVICE_PORT } from "../sys-config/sys-config";

// Two pendants with identical hardware/segments, named to mirror their ring.
const THING_NAMES = ["lilum1", "lilum2"];
const NUM_RINGS = 3;
const PIXELS_PER_RING = 9;
const NUM_PIXELS = NUM_RINGS * PIXELS_PER_RING; // 27

interface Pixel { index: number; relPos: number; }
interface Segment { name: string; pixels: Pixel[]; }

// Index i belongs to ring floor(i / PIXELS_PER_RING) (0=outer,1=middle,2=inner)
// at within-ring position i % PIXELS_PER_RING.
const ringOf = (i: number) => Math.floor(i / PIXELS_PER_RING);
const posInRing = (i: number) => i % PIXELS_PER_RING;

const segmentFrom = (name: string, relPosOf: (i: number) => number): Segment => {
    const pixels: Pixel[] = [];
    for (let i = 0; i < NUM_PIXELS; i++) pixels.push({ index: i, relPos: relPosOf(i) });
    return { name, pixels };
};

const ringSegment = (name: string, first: number, last: number): Segment => {
    const span = last - first;
    const pixels: Pixel[] = [];
    for (let i = first; i <= last; i++) {
        pixels.push({ index: i, relPos: span === 0 ? 0 : (i - first) / span });
    }
    return { name, pixels };
};

// all: relPos increases continuously 0..1 across all pixels.
const allSegment = () => segmentFrom("all", (i) => i / (NUM_PIXELS - 1));

// centric: relPos repeats 0..(n-1)/n within each ring — concentric pattern.
const centricSegment = () =>
    segmentFrom("centric", (i) => posInRing(i) / PIXELS_PER_RING);

// ind: one value per ring, ring k -> k/NUM_RINGS.
const indSegment = () => segmentFrom("ind", (i) => ringOf(i) / NUM_RINGS);

// arc: triangle wave within each ring, peaking at the middle pixel.
const arcSegment = () =>
    segmentFrom("arc", (i) => {
        const p = posInRing(i);
        const half = (PIXELS_PER_RING - 1) / 2;
        return (half - Math.abs(p - half)) / half;
    });

// updown: like centric but each successive ring is offset by one position,
// so the pattern spirals across rings rather than aligning.
const updownSegment = () =>
    segmentFrom("updown", (i) => ((posInRing(i) + ringOf(i)) % PIXELS_PER_RING) / PIXELS_PER_RING);

// b1 / b2: two interleaved buckets (every other pixel), all relPos 0. Used as
// static masks; b1 = even indices, b2 = odd indices.
const bucketSegment = (name: string, parity: number): Segment => {
    const pixels: Pixel[] = [];
    for (let i = 0; i < NUM_PIXELS; i++) if (i % 2 === parity) pixels.push({ index: i, relPos: 0 });
    return { name, pixels };
};

// rand: deterministic shuffle of relPos values so the pattern is reproducible
// across syncs. Mulberry32 PRNG seeded with a constant.
const randSegment = (): Segment => {
    let s = 0x9e3779b9;
    const rng = () => {
        s |= 0; s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pixels: Pixel[] = [];
    for (let i = 0; i < NUM_PIXELS; i++) pixels.push({ index: i, relPos: Math.round(rng() * 100) / 100 });
    return { name: "rand", pixels };
};

const payload = {
    numberOfPixels: NUM_PIXELS,
    segments: [
        allSegment(),
        ringSegment("outer",  0,  8),
        ringSegment("middle", 9, 17),
        ringSegment("inner", 18, 26),
        centricSegment(),
        indSegment(),
        arcSegment(),
        updownSegment(),
        bucketSegment("b1", 0),
        bucketSegment("b2", 1),
        randSegment(),
    ],
};

(async () => {
    for (const thing of THING_NAMES) {
        const url = `http://${LEDS_OBJECT_SERVICE_IP}:${LEDS_OBJECT_SERVICE_PORT}/thing/${thing}`;
        try {
            const res = await axios.put(url, payload, { timeout: 5000 });
            console.log(`Lilum segments synced -> ${url}, status: ${res.status}`);
        } catch (err) {
            console.error(`Error syncing segments for ${thing}:`, err);
            process.exit(1);
        }
    }
})();
