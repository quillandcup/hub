/**
 * Caption and subtitle files for a lesson's video (docs/COURSES.md, "Video"): which languages the editor offers, and what a
 * file has to look like before it is kept and handed to Mux. Pure, so the browser form and the server action share it.
 */

/** The languages offered: the ones Mux can write subtitles for itself, which also covers what a person is likely to upload. */
export const CAPTION_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "ru", name: "Russian" },
  { code: "tr", name: "Turkish" },
  { code: "sv", name: "Swedish" },
  { code: "no", name: "Norwegian" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "el", name: "Greek" },
  { code: "cs", name: "Czech" },
  { code: "sk", name: "Slovak" },
  { code: "uk", name: "Ukrainian" },
  { code: "ca", name: "Catalan" },
  { code: "hr", name: "Croatian" },
  { code: "ro", name: "Romanian" },
  { code: "bg", name: "Bulgarian" },
] as const;

export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number]["code"];

export const isCaptionLanguage = (value: unknown): value is CaptionLanguage => CAPTION_LANGUAGES.some((l) => l.code === value);
export const captionLanguageName = (code: string): string => CAPTION_LANGUAGES.find((l) => l.code === code)?.name ?? code;

/** A caption file is a few hundred KB at most; this also keeps it inside a server action's request size. */
export const MAX_CAPTION_CHARS = 800_000;
export const MAX_CAPTION_LABEL = 40;

// "00:00:01,000 --> 00:00:03,500" (SRT) or "00:01.000 --> 00:03.500" (WebVTT, hours optional).
const CUE = /\d{1,2}:\d{2}(?::\d{2})?[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?[,.]\d{3}/;

export type CaptionFormat = "vtt" | "srt";

/** What an uploaded file is, from its text: WebVTT starts with "WEBVTT"; SubRip has numbered cues with timings. Null for anything else. */
export function captionFormatOf(text: string): CaptionFormat | null {
  const body = text.replace(/^﻿/, "").trimStart();
  if (body.startsWith("WEBVTT")) return CUE.test(body) ? "vtt" : null;
  return /^\d+\s*\r?\n/.test(body) && CUE.test(body) ? "srt" : null;
}

export type ParsedCaptionUpload = { ok: true; format: CaptionFormat; text: string; language: CaptionLanguage; label: string } | { ok: false; error: string };

/** Checks an upload: a language the editor offers, a label of its own or the language's name, and text that is a WebVTT or SubRip file. */
export function parseCaptionUpload(input: { language: unknown; label: unknown; text: unknown }): ParsedCaptionUpload {
  if (!isCaptionLanguage(input.language)) return { ok: false, error: "Choose a language." };
  const label = (typeof input.label === "string" ? input.label.trim() : "") || captionLanguageName(input.language);
  if (label.length > MAX_CAPTION_LABEL) return { ok: false, error: `The name can be at most ${MAX_CAPTION_LABEL} characters.` };
  if (typeof input.text !== "string" || !input.text.trim()) return { ok: false, error: "That file is empty." };
  if (input.text.length > MAX_CAPTION_CHARS) return { ok: false, error: "That file is too large for captions." };
  const text = input.text.replace(/^﻿/, "");
  const format = captionFormatOf(text);
  if (!format) return { ok: false, error: "That doesn't look like a caption file. Use a WebVTT (.vtt) or SubRip (.srt) file." };
  return { ok: true, format, text, language: input.language, label };
}
