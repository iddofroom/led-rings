import axios from "axios";
import { TRIGGER_SERVICE_IP, TRIGGER_SERVICE_PORT } from "../sys-config/sys-config";
import { Sequence } from "../effects/types";
import { ThingName } from "../objects/types";

export type SequencePerThing = Record<ThingName, Sequence>;

const triggerUrlBase = `http://${TRIGGER_SERVICE_IP}:${TRIGGER_SERVICE_PORT}`;

export const stop = async () => {
    try {
        const res = await axios.post(`${triggerUrlBase}/stop`, {
            timeout: 1000
        });
        console.log(`Trigger stopped, http status: ${res.status}`);
    } catch (err) {
        console.log('Error while stopping trigger');
        console.error(err);
    }
};

export const startSong = async (songName: string, startOffsetSeconds?: number) => {
    try {
        const res = await axios.post(`${triggerUrlBase}/song/${songName}/play`, {
            timeout: 1000,
            start_offset_ms: startOffsetSeconds ? startOffsetSeconds * 1000 : 0,
        });
        console.log(`Song ${songName} started, http status: ${res.status}`);
    } catch (err) {
        console.log('Error while starting song', { songName });
        console.error(err);
    }
}

export const trigger = async (triggerName: string, startOffsetSeconds?: number) => {
    try {
        const res = await axios.post(`${triggerUrlBase}/trigger/${triggerName}`, {
            timeout: 1000,
            start_offset_ms: startOffsetSeconds ? startOffsetSeconds * 1000 : 0,
        });
        console.log(`Trigger ${triggerName} started, http status: ${res.status}`);
    } catch (err) {
        console.log('Error while starting trigger', { triggerName });
        console.error(err);
    }
};

/**
 * Fire a trigger to play NOW, THROWING on failure (unlike `trigger` which logs
 * and swallows). Used by the mapping stage's tight per-LED loop so a failed
 * publish surfaces to the UI. No start offset — playback starts immediately.
 */
export const postTrigger = async (triggerName: string): Promise<number> => {
    const res = await axios.post(`${triggerUrlBase}/trigger/${triggerName}`, {}, { timeout: 3000 });
    return res.status;
};
