import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The narration. Each line of the script (`script.ts`) is spoken on this machine, so nothing is sent to a service:
 *
 *   kokoro  (default when set up) Kokoro, an open neural text-to-speech model: natural, with a choice of voices.
 *           The default voice is `af_heart`, an American woman; others to try: af_bella, af_nova, af_sarah, af_nicole,
 *           af_kore, af_sky. Setup (a Python 3.12 environment, two packages, two model files): docs/DEMO_AND_HELP.md,
 *           "Overview videos".
 *   say     macOS's built-in voices (Samantha by default): always there, but plainly synthetic.
 *
 * `DEMO_TTS`, `DEMO_VOICE` and `DEMO_VOICE_RATE` (Kokoro: speed, 1 is normal; say: words per minute) override these.
 * A line is synthesized once and kept by a hash of the engine, voice, rate and text, so re-recording is quick and an
 * edited line is the only one that is spoken again. Clips are 48 kHz mono WAV files under demo/out/video/vo/.
 */
const KOKORO_HOME = process.env.DEMO_KOKORO_DIR ?? path.join(os.homedir(), ".cache", "hedgie-demo-tts");
const KOKORO_PYTHON = path.join(KOKORO_HOME, "venv", "bin", "python");
const KOKORO_MODELS = path.join(KOKORO_HOME, "models");
const KOKORO_SCRIPT = path.join("demo", "video", "kokoro_tts.py");

const fullModel = existsSync(path.join(KOKORO_MODELS, "kokoro-v1.0.onnx"));
const kokoroReady = existsSync(KOKORO_PYTHON) && (fullModel || existsSync(path.join(KOKORO_MODELS, "kokoro-v1.0.int8.onnx"))) && existsSync(path.join(KOKORO_MODELS, "voices-v1.0.bin"));

export const ENGINE: "kokoro" | "say" = process.env.DEMO_TTS === "say" ? "say" : process.env.DEMO_TTS === "kokoro" || kokoroReady ? "kokoro" : "say";
export const VOICE = process.env.DEMO_VOICE ?? (ENGINE === "kokoro" ? "af_heart" : "Samantha");
export const RATE = Number(process.env.DEMO_VOICE_RATE ?? (ENGINE === "kokoro" ? 1 : 175));

const DIR = path.join("demo", "out", "video", "vo");

export interface Clip {
  file: string;
  durationMs: number;
}

export function synthesize(text: string): Clip {
  mkdirSync(DIR, { recursive: true });
  const key = createHash("sha1").update(`${ENGINE}${ENGINE === "kokoro" ? (fullModel ? "-full" : "-int8") : ""}|${VOICE}|${RATE}|${text}`).digest("hex").slice(0, 16);
  const wav = path.join(DIR, `${key}.wav`);
  if (!existsSync(wav)) {
    const raw = path.join(DIR, `${key}.raw.${ENGINE === "say" ? "aiff" : "wav"}`);
    if (ENGINE === "kokoro") {
      // `-I`: the interpreter ignores the environment and the current directory, since it reads downloaded model files.
      execFileSync(KOKORO_PYTHON, ["-I", KOKORO_SCRIPT, KOKORO_MODELS, VOICE, String(RATE), raw], { input: text, stdio: ["pipe", "inherit", "inherit"] });
    } else {
      execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", raw, text]);
    }
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", raw, "-ar", "48000", "-ac", "1", wav]);
    rmSync(raw);
  }
  const seconds = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", wav]).toString();
  return { file: wav, durationMs: Math.round(parseFloat(seconds) * 1000) };
}
