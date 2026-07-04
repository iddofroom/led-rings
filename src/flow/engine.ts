/**
 * Installation flow engine (control-server side).
 *
 * Subscribes to the sensor MQTT topics and runs the user's flow rules: on an RFID scan
 * (`sensors/rfid/<box>/chip` → `{ color }`), find the first matching rule and execute its action
 * (play a song, fire a trigger, set brightness, stop). Rules are authored in the browser, saved to
 * the cloud library, and pushed to the Pi via `POST /api/flow/apply`; they are also persisted to a
 * local file so they survive a control-server restart.
 *
 * Mirrors the MQTT-client pattern in mqtt-things.ts / mqtt-brightness.ts.
 */
import mqtt from "mqtt";
import fs from "fs";
import path from "path";
import * as dotenv from "dotenv";
import { startSong, stop, trigger } from "../services/trigger";
import { setBrightness } from "../mqtt-brightness";
dotenv.config();

const BROKER_IP = process.env.MQTT_BROKER || "";
const BROKER_URL = BROKER_IP ? `mqtt://${BROKER_IP}` : "";
const STORE = path.resolve(process.cwd(), ".flow-rules.json");

export interface FlowRule {
  id: string;
  when: { box?: string; color?: string };
  then: { action: "playSong" | "trigger" | "brightness" | "stop"; song?: string; trigger?: string; brightness?: number };
}

let rules: FlowRule[] = [];
let client: mqtt.MqttClient | null = null;
let connected = false;

/** Pure: the first rule whose `when` matches (an empty field is a wildcard). Exported for testing. */
export function matchRule(rs: FlowRule[], box: string, color: string): FlowRule | null {
  for (const r of rs) {
    const w = r.when || {};
    if (w.box && w.box !== box) continue;
    if (w.color && w.color.toLowerCase() !== (color || "").toLowerCase()) continue;
    return r;
  }
  return null;
}

async function execute(rule: FlowRule) {
  const t = rule.then || ({} as FlowRule["then"]);
  try {
    switch (t.action) {
      case "playSong":
        if (t.song) await startSong(t.song);
        break;
      case "trigger":
        if (t.trigger) await trigger(t.trigger);
        break;
      case "brightness":
        if (typeof t.brightness === "number") setBrightness(t.brightness);
        break;
      case "stop":
        await stop();
        break;
    }
  } catch (e) {
    console.error("[flow] action failed:", e);
  }
}

export function getRules(): FlowRule[] {
  return rules;
}

export function applyFlow(newRules: FlowRule[]) {
  rules = Array.isArray(newRules) ? newRules : [];
  try {
    fs.writeFileSync(STORE, JSON.stringify({ rules }), "utf8");
  } catch (e) {
    console.error("[flow] persist failed:", e);
  }
}

function loadPersisted() {
  try {
    if (fs.existsSync(STORE)) {
      const j = JSON.parse(fs.readFileSync(STORE, "utf8"));
      if (Array.isArray(j.rules)) rules = j.rules;
    }
  } catch {
    /* corrupt store → start empty */
  }
}

export function getFlowState(): { connected: boolean; ruleCount: number } {
  return { connected, ruleCount: rules.length };
}

export function initFlowEngine() {
  loadPersisted();
  if (!BROKER_URL) {
    console.warn("[flow] MQTT_BROKER not set — flow engine disabled");
    return;
  }
  client = mqtt.connect(BROKER_URL, {
    clientId: `led-rings-flow-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5000,
    connectTimeout: 4000,
  });
  client.on("connect", () => {
    connected = true;
    console.log(`[flow] Connected to MQTT broker at ${BROKER_URL} (${rules.length} rules)`);
    client!.subscribe("sensors/#", { qos: 0 }, (err) => {
      if (err) console.error("[flow] Subscribe error:", err.message);
    });
  });
  client.on("message", (topic: string, payload: Buffer) => {
    // sensors/rfid/<box>/chip → { color }
    const m = topic.match(/^sensors\/rfid\/([^/]+)\/chip$/);
    if (!m) return;
    const box = m[1];
    let color = "";
    try {
      color = String(JSON.parse(payload.toString()).color || "");
    } catch {
      /* non-JSON payload → no colour */
    }
    const rule = matchRule(rules, box, color);
    if (rule) {
      console.log(`[flow] rfid ${box}/${color || "*"} → ${rule.then?.action}`);
      execute(rule);
    }
  });
  client.on("offline", () => {
    connected = false;
    console.warn("[flow] MQTT broker offline");
  });
  client.on("error", (e: Error) => {
    connected = false;
    console.error("[flow] MQTT error:", e.message);
  });
}
