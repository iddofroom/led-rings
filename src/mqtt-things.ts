/**
 * MQTT controller-discovery client for the control server.
 *
 * Each ESP controller publishes a retained `{ thingName, alive }` message to
 * `thing/<thing_name>/status` on connect (and an alive:false LWT on drop), so
 * subscribing to `thing/+/status` gives a live roster of controllers without
 * any per-device polling. Used by the mapping stage to (a) list controllers and
 * (b) wait for a controller to rejoin after an object-config change reboots it.
 *
 * Mirrors the persistent-client pattern in mqtt-brightness.ts / mqtt-trigger.ts.
 */
import mqtt from "mqtt";
import * as dotenv from "dotenv";
dotenv.config();

const BROKER_IP = process.env.MQTT_BROKER || "";
const BROKER_URL = BROKER_IP ? `mqtt://${BROKER_IP}` : "";
const TOPIC = "thing/+/status";

export interface ThingStatus {
  thing: string;
  alive: boolean;
  lastSeen: number; // ms epoch of the last status message for this thing
}

let client: mqtt.MqttClient | null = null;
let connected = false;
const things = new Map<string, ThingStatus>();

export function initMqttThings() {
  if (!BROKER_URL) {
    console.warn("[things] MQTT_BROKER not set — controller discovery disabled");
    return;
  }

  client = mqtt.connect(BROKER_URL, {
    clientId: `led-rings-things-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5000,
    connectTimeout: 4000,
  });

  client.on("connect", () => {
    connected = true;
    console.log(`[things] Connected to MQTT broker at ${BROKER_URL}`);
    client!.subscribe(TOPIC, { qos: 1 }, (err) => {
      if (err) console.error("[things] Subscribe error:", err.message);
    });
  });

  client.on("message", (topic: string, payload: Buffer) => {
    // topic = thing/<name>/status
    const m = topic.match(/^thing\/(.+)\/status$/);
    if (!m) return;
    const thing = m[1];
    let alive = false;
    try {
      const msg = JSON.parse(payload.toString());
      alive = !!msg.alive;
    } catch {
      return; // ignore malformed messages
    }
    things.set(thing, { thing, alive, lastSeen: Date.now() });
  });

  client.on("offline", () => {
    connected = false;
    console.warn("[things] MQTT broker offline");
  });

  client.on("error", (err: Error) => {
    connected = false;
    console.error("[things] MQTT error:", err.message);
  });
}

export function getThings(): ThingStatus[] {
  return [...things.values()].sort((a, b) => a.thing.localeCompare(b.thing, undefined, { numeric: true }));
}

export function getThingsState(): { connected: boolean; things: ThingStatus[] } {
  return { connected, things: getThings() };
}

/**
 * Wait until `thing` reports a FRESH alive=true (i.e. a status message received
 * after this call), which is how we detect a controller has finished rebooting
 * after an object-config change. Resolves true when seen alive, false on timeout.
 */
export function waitForThing(thing: string, timeoutMs = 25000): Promise<boolean> {
  const since = Date.now();
  const isFreshAlive = () => {
    const s = things.get(thing);
    return !!(s && s.alive && s.lastSeen >= since);
  };
  return new Promise((resolve) => {
    if (isFreshAlive()) {
      resolve(true);
      return;
    }
    const interval = setInterval(() => {
      if (isFreshAlive()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(true);
      }
    }, 300);
    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve(false);
    }, timeoutMs);
  });
}
