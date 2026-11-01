import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LINE_IDS } from "./script";

/**
 * The narration. Each line of the script (`script.ts`) is spoken one of three ways, in this order:
 *
 *   a recording  A person's reading of the line, if there is one in demo/out/video/reading/ named for the line's id
 *                (L07.m4a, S03.wav ...; any common audio format). The video paces itself to the take. This is the real
 *                voice; `pnpm demo:reading:sheet` makes the sheet to read from and `pnpm demo:reading:split` cuts a
 *                straight-through recording into takes (docs/OVERVIEW_VIDEO_SCRIPT.md). `DEMO_HUMAN=0` ignores them.
 *   kokoro       (default for lines without a recording, when set up) Kokoro, an open neural text-to-speech model that
 *                runs on this machine. Default voice `af_heart`; others: af_bella, af_nova, af_sarah, af_nicole ...
 *                Setup: docs/DEMO_AND_HELP.md, "Overview videos".
 *   say          macOS's built-in voices (Samantha by default): always there, but plainly synthetic.
 *
 * Nothing is sent to a service. `DEMO_TTS`, `DEMO_VOICE` and `DEMO_VOICE_RATE` (Kokoro: speed, 1 is normal; say:
 * words per minute) override the synthetic voice. A line is prepared once and kept by a hash of what made it, so
 * re-recording is quick and only an edited line is made again. Clips are 48 kHz mono WAV files under demo/out/video/vo/.
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
/** Where a person's readings go (and where `demo:reading:split` writes them). */
export const READING_DIR = process.env.DEMO_READING_DIR ?? path.join("demo", "out", "video", "reading");
const AUDIO = /\.(wav|m4a|mp3|aif|aiff|caf|aac|flac|ogg|opus)$/i;

export interface Clip {
  file: string;
  durationMs: number;
}

/** The recording of a line, if someone has made one (a file named for the line's id), else null. */
export function recordingOf(text: string): string | null {
  if (process.env.DEMO_HUMAN === "0") return null;
  const id = LINE_IDS.get(text);
  if (!id || !existsSync(READING_DIR)) return null;
  const file = readdirSync(READING_DIR).find((f) => f.startsWith(`${id}.`) && AUDIO.test(f));
  return file ? path.join(READING_DIR, file) : null;
}

function durationOf(wav: string): number {
  const seconds = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", wav]).toString();
  return Math.round(parseFloat(seconds) * 1000);
}

/** A person's reading as a clip: the silence before and after is trimmed so the video starts and moves on with the words. */
function fromRecording(source: string): Clip {
  mkdirSync(DIR, { recursive: true });
  const stat = statSync(source);
  const key = createHash("sha1").update(`take|${source}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 16);
  const wav = path.join(DIR, `${key}.wav`);
  if (!existsSync(wav)) {
    const trim = "silenceremove=start_periods=1:start_silence=0.08:start_threshold=-45dB";
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-af", `${trim},areverse,${trim},areverse`, "-ar", "48000", "-ac", "1", wav]);
  }
  return { file: wav, durationMs: durationOf(wav) };
}

export function synthesize(text: string): Clip {
  const recording = recordingOf(text);
  if (recording) return fromRecording(recording);

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
  return { file: wav, durationMs: durationOf(wav) };
}
