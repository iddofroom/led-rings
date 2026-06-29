/**
 * Reusable song parser: executes a .ts song file with recording instrumentation
 * and returns the UI's { song, timeframes } JSON structure.
 */
import * as path from "path";
import { recorder } from "./recorder";
import { setRecordingMode } from "../effects/effect";
import { Animation } from "../animation/animation";

export async function parseSongFile(absolutePath: string) {
  // Mock network services to prevent HTTP calls
  const seqModule = require("../services/sequence");
  const trigModule = require("../services/trigger");
  const origSend = seqModule.sendSequence;
  const origStart = trigModule.startSong;
  const origTrigger = trigModule.trigger;
  const origStop = trigModule.stop;
  seqModule.sendSequence = async () => {};
  trigModule.startSong = async () => {};
  trigModule.trigger = async () => {};
  trigModule.stop = async () => {};

  // Capture Animation metadata by patching sync()
  let songMeta: { name: string; bpm: number; lengthSeconds: number; startOffsetMs: number; beatTimestampsMs?: number[] } | null = null;
  const originalSync = Animation.prototype.sync;
  Animation.prototype.sync = function (cb: Function) {
    songMeta = {
      name: this.name,
      bpm: this.bpm,
      lengthSeconds: this.totalTimeSeconds,
      startOffsetMs: this.startOffsetMs,
      beatTimestampsMs: this.beatTimestampsMs,
    };
    recorder.setBpm(this.bpm, this.startOffsetMs, this.beatTimestampsMs);
    return originalSync.call(this, cb);
  };

  // Enable recording and run the song
  setRecordingMode(true);
  recorder.reset();

  try {
    // Clear require cache so re-parsing works
    delete require.cache[require.resolve(absolutePath)];
    require(absolutePath);
    // Wait for async IIFE to complete
    await new Promise((resolve) => setTimeout(resolve, 200));
  } catch (err: any) {
    // Ignore network errors from any unmocked paths
    if (!err.message?.includes("ECONNREFUSED")) {
      throw err;
    }
  }

  // Restore everything
  setRecordingMode(false);
  Animation.prototype.sync = originalSync;
  seqModule.sendSequence = origSend;
  trigModule.startSong = origStart;
  trigModule.trigger = origTrigger;
  trigModule.stop = origStop;

  if (!songMeta) {
    throw new Error("No Animation was created. Check the song file.");
  }

  return recorder.getResult(songMeta);
}
