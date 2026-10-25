import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * The narration. Each line of the script (`script.ts`) is spoken by macOS's own text-to-speech (`say`), so nothing
 * is sent to a service and the voice is the same on every machine that has it. The default is Samantha, the neutral
 * American female voice that ships with macOS; `DEMO_VOICE` and `DEMO_VOICE_RATE` override it (a Premium voice such
 * as "Ava (Premium)" sounds noticeably more natural: System Settings > Accessibility > Spoken Content > Manage
 * Voices). A line is synthesized once and kept by a hash of the voice, rate and text, so re-recording is quick and
 * an edited line is the only one that is spoken again. Clips are 48 kHz mono WAV files under demo/out/video/vo/.
 */
export const VOICE = process.env.DEMO_VOICE ?? "Samantha";
export const RATE = Number(process.env.DEMO_VOICE_RATE ?? 175);

const DIR = path.join("demo", "out", "video", "vo");

export interface Clip {
  file: string;
  durationMs: number;
}

export function synthesize(text: string): Clip {
  mkdirSync(DIR, { recursive: true });
  const key = createHash("sha1").update(`${VOICE}|${RATE}|${text}`).digest("hex").slice(0, 16);
  const wav = path.join(DIR, `${key}.wav`);
  if (!existsSync(wav)) {
    const aiff = path.join(DIR, `${key}.aiff`);
    execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", aiff, text]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", aiff, "-ar", "48000", "-ac", "1", wav]);
    rmSync(aiff);
  }
  const seconds = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", wav]).toString();
  return { file: wav, durationMs: Math.round(parseFloat(seconds) * 1000) };
}
