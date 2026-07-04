/**
 * Client for the KivSee led-object-service (geometry authority).
 *
 * An object ("thing") owns one flat LED buffer of `numberOfPixels` pixels and a
 * list of named segments; each segment pixel is `{index, relPos}` (index into
 * the buffer, relPos = 1-D position along the segment). Same shape used by
 * src/lilum/segments.ts and src/ring-segments. The mapping stage reads a
 * controller's current geometry (to back it up), writes single-pixel segments
 * for the sweep, and later writes back the original or a derived geometry.
 *
 * NOTE: a PUT here makes object-service publish `obj/<thing>/guid`, which makes
 * the ESP re-download its config and REBOOT. Use sparingly (setup-time only).
 */
import axios from "axios";
import { LEDS_OBJECT_SERVICE_IP, LEDS_OBJECT_SERVICE_PORT } from "../sys-config/sys-config";

export interface Pixel {
  index: number;
  relPos: number;
}
export interface Segment {
  name: string;
  pixels: Pixel[];
}
export interface ThingSegments {
  guid?: number; // recomputed server-side on write; ignored on PUT
  numberOfPixels: number;
  segments: Segment[];
}

const base = () => `http://${LEDS_OBJECT_SERVICE_IP}:${LEDS_OBJECT_SERVICE_PORT}`;

export async function getThingConfig(thing: string): Promise<ThingSegments> {
  const res = await axios.get(`${base()}/thing/${thing}`, {
    timeout: 5000,
    headers: { Accept: "application/json" },
  });
  return res.data as ThingSegments;
}

export async function putThingConfig(thing: string, config: ThingSegments): Promise<number> {
  const res = await axios.put(`${base()}/thing/${thing}`, config, { timeout: 8000 });
  return res.status;
}
