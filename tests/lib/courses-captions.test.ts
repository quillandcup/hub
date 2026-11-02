import { describe, expect, it } from "vitest";
import { CAPTION_LANGUAGES, MAX_CAPTION_CHARS, MAX_CAPTION_LABEL, captionFormatOf, captionLanguageName, isCaptionLanguage, parseCaptionUpload } from "@/lib/courses/captions";

const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello Hedgies\n";
const VTT_SHORT = "WEBVTT\n\n00:01.000 --> 00:03.500\nHello\n";
const SRT = "1\n00:00:01,000 --> 00:00:03,500\nHello Hedgies\n\n2\n00:00:04,000 --> 00:00:05,000\nBye\n";

describe("captionFormatOf", () => {
  it("knows WebVTT, with or without hours in its timings, and SubRip, with a byte order mark or Windows line endings", () => {
    expect(captionFormatOf(VTT)).toBe("vtt");
    expect(captionFormatOf(VTT_SHORT)).toBe("vtt");
    expect(captionFormatOf(SRT)).toBe("srt");
    expect(captionFormatOf(`﻿${VTT}`)).toBe("vtt");
    expect(captionFormatOf(SRT.replace(/\n/g, "\r\n"))).toBe("srt");
  });

  it("is null for anything else: a header with no cues, numbered text with no timings, plain text", () => {
    expect(captionFormatOf("WEBVTT\n\nNOTE nothing here\n")).toBeNull();
    expect(captionFormatOf("1\nHello\n")).toBeNull();
    expect(captionFormatOf("Just some words.")).toBeNull();
    expect(captionFormatOf("")).toBeNull();
  });
});

describe("languages", () => {
  it("offers the languages Mux can write subtitles for, English first, and names them", () => {
    expect(CAPTION_LANGUAGES[0]).toEqual({ code: "en", name: "English" });
    expect(isCaptionLanguage("es")).toBe(true);
    expect(isCaptionLanguage("xx")).toBe(false);
    expect(isCaptionLanguage(undefined)).toBe(false);
    expect(captionLanguageName("fr")).toBe("French");
    expect(captionLanguageName("zz")).toBe("zz");
  });
});

describe("parseCaptionUpload", () => {
  it("accepts a WebVTT or SubRip file, naming the track after the language when no name is given", () => {
    expect(parseCaptionUpload({ language: "en", label: "", text: VTT })).toEqual({ ok: true, format: "vtt", text: VTT, language: "en", label: "English" });
    expect(parseCaptionUpload({ language: "es", label: "  Español  ", text: SRT })).toEqual({ ok: true, format: "srt", text: SRT, language: "es", label: "Español" });
  });

  it("drops a byte order mark from what it keeps", () => {
    expect(parseCaptionUpload({ language: "en", label: "", text: `﻿${VTT}` })).toMatchObject({ ok: true, text: VTT });
  });

  it("refuses a language that isn't offered, a name that is too long, an empty file, one too large, and one that isn't captions", () => {
    expect(parseCaptionUpload({ language: "xx", label: "", text: VTT })).toEqual({ ok: false, error: "Choose a language." });
    expect(parseCaptionUpload({ language: "en", label: "x".repeat(MAX_CAPTION_LABEL + 1), text: VTT })).toMatchObject({ ok: false, error: expect.stringMatching(/at most 40/) });
    expect(parseCaptionUpload({ language: "en", label: "", text: "  \n " })).toEqual({ ok: false, error: "That file is empty." });
    expect(parseCaptionUpload({ language: "en", label: "", text: 5 })).toEqual({ ok: false, error: "That file is empty." });
    expect(parseCaptionUpload({ language: "en", label: "", text: `${VTT}${"x".repeat(MAX_CAPTION_CHARS)}` })).toEqual({ ok: false, error: "That file is too large for captions." });
    expect(parseCaptionUpload({ language: "en", label: "", text: "Hello there" })).toMatchObject({ ok: false, error: expect.stringMatching(/WebVTT \(\.vtt\) or SubRip \(\.srt\)/) });
  });
});
