import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { LONG, SCREEN_LONG, SCREEN_SHORT, SHORT, LINE_IDS } from "./script";

/**
 * The sheet a person reads the narration from: how to record, how to say the names, and every line with its number,
 * when it comes in the video, how long it takes to say, and what is on screen. Written to
 * demo/out/video/reading-script.pdf (and .html). The times come from the last recording (`pnpm demo:video` writes
 * overview-long.timing.json and overview-short.timing.json next to the videos); the video re-times itself to the
 * readings, so they are a guide, not a deadline.
 *
 *   pnpm demo:reading:sheet
 */
const VIDEO_DIR = path.join("demo", "out", "video");

interface Timing {
  id: string | null;
  text: string;
  startSeconds: number;
  lengthSeconds: number;
}

function timings(cut: "long" | "short"): Map<string, Timing> {
  const file = path.join(VIDEO_DIR, `overview-${cut}.timing.json`);
  if (!existsSync(file)) {
    console.warn(`No ${file}: run \`pnpm demo:video\` first for the times; the sheet will leave them blank.`);
    return new Map();
  }
  return new Map((JSON.parse(readFileSync(file, "utf8")) as Timing[]).map((t) => [t.text, t]));
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function table(cut: "long" | "short"): string {
  const lines = cut === "long" ? LONG : SHORT;
  const screen = (cut === "long" ? SCREEN_LONG : SCREEN_SHORT) as Record<string, string>;
  const timing = timings(cut);
  const rows = Object.entries(lines).map(([key, text]) => {
    const t = timing.get(text);
    return `<tr>
      <td class="id">${LINE_IDS.get(text)}</td>
      <td class="when">${t ? clock(t.startSeconds) : ""}</td>
      <td class="line">${escape(text)}${text.endsWith(",") ? '<div class="note">This sentence goes on in the next line: read it as one sentence. Still pause after this line so I can cut them apart; the video joins them.</div>' : ""}</td>
      <td class="len">${t ? `${t.lengthSeconds.toFixed(0)} s` : ""}</td>
      <td class="screen">${escape(screen[key] ?? "")}</td>
    </tr>`;
  });
  return `<table><thead><tr><th>#</th><th>In the video</th><th>Read this</th><th>About</th><th>On screen</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

const html = `<!doctype html><meta charset="utf-8"><title>Hedgie Hub overview videos: reading script</title>
<style>
  @page { size: Letter; margin: 0.7in 0.6in; }
  body { font: 11pt/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #231a26; }
  h1 { font: 700 22pt Georgia, serif; margin: 0 0 4pt; color: #6b2b52; }
  h2 { font: 700 14pt Georgia, serif; margin: 20pt 0 6pt; color: #6b2b52; }
  .sub { color: #6b5a70; margin: 0 0 12pt; }
  .tips { background: #f6eef3; border-radius: 8pt; padding: 10pt 14pt; }
  .tips ul { margin: 4pt 0 0; padding-left: 16pt; }
  .tips li { margin: 3pt 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 6pt; }
  th { text-align: left; font-size: 9pt; color: #6b5a70; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1.5pt solid #d8c3d0; padding: 3pt 6pt; }
  td { vertical-align: top; padding: 7pt 6pt; border-bottom: .5pt solid #e7d9e1; }
  tr { break-inside: avoid; }
  td.id { font-weight: 700; color: #6b2b52; white-space: nowrap; }
  td.when, td.len { white-space: nowrap; color: #6b5a70; }
  td.line { font: 13pt/1.45 Georgia, serif; width: 46%; }
  .note { font: italic 9pt -apple-system, Arial, sans-serif; color: #6b5a70; margin-top: 3pt; }
  td.screen { font-size: 9.5pt; color: #6b5a70; width: 24%; }
  .pagebreak { break-before: page; }
  code { font: 10pt Menlo, monospace; }
</style>

<h1>Hedgie Hub: reading script</h1>
<p class="sub">Two short videos about Hedgie Hub for Quill &amp; Cup members: one about 2 minutes, one about 30 seconds. Thank you for reading them!</p>

<div class="tips">
  <b>How to read it</b>
  <ul>
    <li><b>Sound like yourself telling a friend about something you love.</b> Warm and easy, smiling a little. Not an announcer, not a sales pitch.</li>
    <li><b>Take your time.</b> A normal, unhurried pace, and a real pause at each full stop. The video follows <i>your</i> timing, so there is nothing to fit into: the times below are only a guide.</li>
    <li><b>Where to record:</b> a quiet room (turn off fans and notifications). A phone's voice memo is fine: hold it about a hand's width from your mouth and keep it there. Soft furnishings help; bare walls echo.</li>
    <li><b>How:</b> read each video's lines <b>in order, straight through, with a pause of about two seconds between lines</b> (the pause is what lets me cut them apart). Do the 2-minute one first, then the 30-second one: two recordings.</li>
    <li><b>If you stumble</b>, just keep going. At the end, read that line again on its own as a separate short recording, and tell me its number (for example <b>L07</b>). I'll use the new one.</li>
    <li><b>Send me</b> the audio files as they are (m4a or wav is great).</li>
  </ul>
</div>

<h2>Saying the names</h2>
<ul>
  <li><b>Prickle</b>: PRIK-ul (like "pickle" with an R). <b>Prickles</b>: PRIK-ulz.</li>
  <li><b>Hedgie</b>: HEJ-ee. <b>Hedgies</b>: HEJ-eez. <b>Hedgie Hub</b>, <b>Hedgie Help</b>, <b>Hedgie House</b>.</li>
  <li><b>Quill and Cup</b>: say "and" (the sheet writes it out so you don't have to decide).</li>
  <li><b>Zoom</b>, <b>Slack</b>, <b>Google</b>, <b>Apple</b>, <b>Outlook</b>: as usual.</li>
</ul>

<h2 class="pagebreak">The 2-minute video (lines L01 to L20)</h2>
<p class="sub">Read these in order. "In the video" is roughly when each line starts.</p>
${table("long")}

<h2 class="pagebreak">The 30-second video (lines S01 to S07)</h2>
<p class="sub">Read these in order, as a separate recording. This one is quick and bright: it is short, so a little more energy.</p>
${table("short")}
`;

async function main() {
  mkdirSync(VIDEO_DIR, { recursive: true });
  const htmlFile = path.join(VIDEO_DIR, "reading-script.html");
  const pdfFile = path.join(VIDEO_DIR, "reading-script.pdf");
  writeFileSync(htmlFile, html);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: pdfFile, format: "Letter", printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log(`Wrote ${pdfFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
