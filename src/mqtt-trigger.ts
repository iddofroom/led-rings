/**
 * MQTT trigger publisher for the control server.
 *
 * Publishes retained `{ trigger_name }` messages to the `trigger` topic so the
 * firmware switches modes directly (e.g. clock mode). Mirrors `src/clock.ts`
 * but kept connected to publish on demand from HTTP requests.
 */
import mqtt from "mqtt";
import * as dotenv from "dotenv";
dotenv.config();

const BROKER_IP = process.env.MQTT_BROKER || "";
const BROKER_URL = BROKER_IP ? `mqtt://${BROKER_IP}` : "";
const TOPIC = "trigger";

let client: mqtt.MqttClient | null = null;
let connected = false;

export function initMqttTrigger() {
  if (!BROKER_URL) {
    console.warn("[trigger] MQTT_BROKER not set — trigger MQTT disabled");
    return;
  }

  client = mqtt.connect(BROKER_URL, {
    clientId: `led-rings-trigger-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5000,
    connectTimeout: 4000,
  });

  client.on("connect", () => {
    connected = true;
    console.log(`[trigger] Connected to MQTT broker at ${BROKER_URL}`);
  });
  client.on("offline", () => {
    connected = false;
    console.warn("[trigger] MQTT broker offline");
  });
  client.on("error", (err: Error) => {
    connected = false;
    console.error("[trigger] MQTT error:", err.message);
  });
}

export function publishTrigger(triggerName: string): boolean {
  if (!client || !connected) return false;
  const payload = JSON.stringify({ trigger_name: triggerName });
  client.publish(TOPIC, payload, { retain: true, qos: 1 }, (err) => {
    if (err) console.error("[trigger] publish error:", err.message);
    else console.log(`[trigger] Published trigger_name=${triggerName}`);
  });
  return true;
}
