import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { LINE_IDS, LONG, SHORT } from "./script";
import { READING_DIR } from "./voiceover";

/**
 * Cuts one straight-through reading of a cut into a take per line, by the pauses between them.
 *
 *   pnpm demo:reading:split long  path/to/long-reading.m4a
 *   pnpm demo:reading:split short path/to/short-reading.m4a
 *
 * The lines are read in script order with a pause of a second or two between them (the reading sheet says so). Each take
 * is written to demo/out/video/reading/<id>.wav (L01 ... L20, S01 ... S07), which is where the recording looks for it.
 * If the number of pieces isn't the number of lines, nothing is written: the pieces found are listed so a pause that
 * was too short (or a breath that was taken for one) can be sorted out with `--gap=` (the shortest pause that counts,
 * in seconds; default 0.9) and `--noise=` (what counts as silence, in dB; default -38), or the odd line re-read and
 * saved by hand as <id>.m4a, which wins over a split take.
 */
const [cut, file, ...flags] = process.argv.slice(2);
if ((cut !== "long" && cut !== "short") || !file) {
  console.error("Usage: pnpm demo:reading:split <long|short> <recording> [--gap=0.9] [--noise=-38]");
  process.exit(2);
}
const flag = (name: string, fallback: number) => {
  const found = flags.find((f) => f.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
};
const gap = flag("gap", 0.9);
const noise = flag("noise", -38);

const lines = Object.values(cut === "long" ? LONG : SHORT);
const ids = lines.map((text) => LINE_IDS.get(text) as string);

const total = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString());
const detect = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", `silencedetect=noise=${noise}dB:d=${gap}`, "-f", "null", "-"], { encoding: "utf8" });
const starts = [...detect.stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
const ends = [...detect.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));

// Speech is what lies between one silence's end and the next one's start.
const pieces: { start: number; end: number }[] = [];
let from = 0;
starts.forEach((silenceStart, i) => {
  if (silenceStart - from > 0.25) pieces.push({ start: from, end: silenceStart });
  from = ends[i] ?? total;
});
if (total - from > 0.25) pieces.push({ start: from, end: total });

if (pieces.length !== ids.length) {
  console.error(`Found ${pieces.length} pieces of speech, but the ${cut} cut has ${ids.length} lines. Nothing written.`);
  pieces.forEach((p, i) => console.error(`  ${String(i + 1).padStart(2)}  ${p.start.toFixed(1)}s to ${p.end.toFixed(1)}s  (${(p.end - p.start).toFixed(1)}s)`));
  console.error("Try --gap= a little shorter (pauses between lines were short) or longer (a breath was counted), or --noise= (-30 is more sensitive to quiet gaps).");
  process.exit(1);
}

mkdirSync(READING_DIR, { recursive: true });
pieces.forEach((piece, i) => {
  const out = path.join(READING_DIR, `${ids[i]}.wav`);
  const start = Math.max(0, piece.start - 0.12);
  const length = piece.end - start + 0.12;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", String(start), "-t", String(length), "-i", file, "-ar", "48000", "-ac", "1", out]);
  console.log(`${ids[i]}  ${(piece.end - piece.start).toFixed(1)}s  ${lines[i].slice(0, 60)}`);
});
console.log(`Wrote ${ids.length} takes to ${READING_DIR}`);
