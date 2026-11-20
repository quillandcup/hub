import { describe, it, expect } from "vitest";
import { normalizeLandingData } from "@/lib/landing/data";
import { LANDING_SCHEMA_VERSION } from "@/lib/landing/migrations";
import {
  LANDING_EXPORT_FORMAT,
  MAX_LANDING_BYTES,
  buildLandingExport,
  countBlocks,
  exportFilename,
  parseLandingImport,
  pruneToKnownBlocks,
} from "@/lib/landing/json-transfer";
import { LANDING_STARTERS, STARTER_KEYS, starterData } from "@/lib/landing/starters";

const heading = { type: "Heading", props: { id: "h1", text: "Welcome", level: "h1", align: "center" } };
const doc = (...blocks: unknown[]) => ({ content: [heading, ...blocks], root: { props: { showHeader: true } } });
const NOW = new Date("2026-11-21T03:30:00Z");

describe("exportFilename", () => {
  it("names the file from the address, which copy and the day in the org's zone, not UTC", () => {
    // 03:30 UTC on the 21st is the evening of the 20th in Eastern time.
    expect(exportFilename("home", "draft", NOW)).toBe("home-draft-2026-11-20.json");
    expect(exportFilename("home", "published", new Date("2026-11-21T06:00:00Z"))).toBe("home-published-2026-11-21.json");
  });

  it("keeps odd characters out of the name", () => {
    expect(exportFilename("../a b/c", "draft", NOW)).toBe("a-b-c-draft-2026-11-20.json");
    expect(exportFilename("", "draft", NOW)).toBe("page-draft-2026-11-20.json");
  });
});

describe("buildLandingExport", () => {
  it("wraps the document with what it is, and holds nothing else", () => {
    const result = buildLandingExport({ slug: "home", title: "Home", kind: "draft", data: { ...doc(), zones: { z: [] }, extra: "x" }, now: NOW });
    if (!result.ok) throw new Error(result.error);
    const file = JSON.parse(result.json);
    expect(Object.keys(file).sort()).toEqual(["data", "exportedAt", "format", "kind", "slug", "title", "version"]);
    expect(file).toMatchObject({ format: LANDING_EXPORT_FORMAT, version: 1, slug: "home", title: "Home", kind: "draft", exportedAt: NOW.toISOString() });
    expect(Object.keys(file.data).sort()).toEqual(["content", "root", "schemaVersion"]);
    expect(file.data.schemaVersion).toBe(LANDING_SCHEMA_VERSION);
    expect(file.data.content).toEqual(doc().content);
    expect(result.filename).toBe("home-draft-2026-11-20.json");
    // Pretty-printed.
    expect(result.json).toContain('\n  "format"');
  });

  it("marks a published copy as published and brings old props up to date, as normalizeLandingData does", () => {
    const old = { content: [{ type: "JourneyMap", props: { id: "j", offer: { title: "Offer", text: "x" }, stages: [{ name: "A", current: true }] } }], root: {} };
    const result = buildLandingExport({ slug: "home", title: "Home", kind: "published", data: old, now: NOW });
    if (!result.ok) throw new Error(result.error);
    const file = JSON.parse(result.json);
    expect(file.kind).toBe("published");
    expect(file.data).toEqual(normalizeLandingData(old));
    expect(JSON.stringify(file.data)).not.toContain('"offer":{');
  });

  it("copes with an empty or missing document", () => {
    const result = buildLandingExport({ slug: "home", title: "Home", kind: "draft", data: null, now: NOW });
    if (!result.ok) throw new Error(result.error);
    expect(JSON.parse(result.json).data.content).toEqual([]);
  });

  it("refuses a page over the cap with a plain message", () => {
    const big = doc({ type: "RichText", props: { id: "r", html: `<p>${"x".repeat(MAX_LANDING_BYTES)}</p>` } });
    expect(buildLandingExport({ slug: "home", title: "Home", kind: "draft", data: big, now: NOW })).toEqual({ ok: false, error: expect.stringContaining("2 MB") });
  });

  it("refuses a page that is under the cap until it is indented", () => {
    const text = "x".repeat(MAX_LANDING_BYTES - 200);
    const data = { content: [{ type: "RichText", props: { id: "r", html: text } }], root: {} };
    expect(JSON.stringify(normalizeLandingData(data)).length).toBeLessThan(MAX_LANDING_BYTES);
    expect(buildLandingExport({ slug: "home", title: "Home", kind: "draft", data, now: NOW }).ok).toBe(false);
  });
});

describe("parseLandingImport", () => {
  const wrapper = (over: Record<string, unknown> = {}) => JSON.stringify({ format: LANDING_EXPORT_FORMAT, version: 1, slug: "home", title: "Home", kind: "published", data: doc(), ...over });

  it("reads the wrapper and says where it came from", () => {
    const parsed = parseLandingImport(wrapper());
    expect(parsed).toMatchObject({ ok: true, source: { slug: "home", title: "Home", kind: "published" } });
    if (parsed.ok) expect(parsed.document.content).toHaveLength(1);
  });

  it("reads a bare document too, and one that starts with a byte order mark", () => {
    expect(parseLandingImport(JSON.stringify(doc()))).toMatchObject({ ok: true, source: undefined });
    expect(parseLandingImport(`﻿${JSON.stringify(doc())}`).ok).toBe(true);
  });

  it("ignores a kind it doesn't know", () => {
    expect(parseLandingImport(wrapper({ kind: "other" }))).toMatchObject({ ok: true, source: { kind: undefined } });
  });

  it.each([
    ["nothing", "   ", /Choose a file/],
    ["text that isn't JSON", "{ nope", /isn't JSON/],
    ["a list", "[1,2]", /isn't a page/],
    ["a number", "7", /isn't a page/],
    ["another kind of file", JSON.stringify({ format: "something-else", data: doc() }), /isn't a page exported/],
    ["a wrapper of another version", wrapper({ version: 2 }), /different version/],
    ["a wrapper with no data", wrapper({ data: undefined }), /no list of blocks/],
    ["a wrapper whose data is a list", wrapper({ data: [] }), /no list of blocks/],
    ["a document with no blocks list", JSON.stringify({ root: {} }), /no list of blocks/],
    ["a page from a newer builder", JSON.stringify({ ...doc(), schemaVersion: LANDING_SCHEMA_VERSION + 1 }), /newer version/],
  ])("refuses %s with a plain message", (_name, text, message) => {
    const parsed = parseLandingImport(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(message);
  });

  it("refuses text over the cap", () => {
    const parsed = parseLandingImport(" ".repeat(MAX_LANDING_BYTES + 1));
    expect(parsed).toEqual({ ok: false, error: expect.stringContaining("2 MB") });
  });
});

describe("pruneToKnownBlocks", () => {
  const prune = (value: unknown) => pruneToKnownBlocks(normalizeLandingData(value));

  it("leaves a page the builder wrote exactly as it is", () => {
    for (const key of STARTER_KEYS) {
      const data = normalizeLandingData(starterData(key));
      const pruned = pruneToKnownBlocks(data);
      expect(pruned.leftOut, LANDING_STARTERS[key].label).toEqual([]);
      expect(pruned.droppedProps, LANDING_STARTERS[key].label).toBe(0);
      expect(pruned.data).toEqual(data);
    }
  });

  it("drops blocks the builder doesn't have, at any depth, and counts them by type", () => {
    const pruned = prune({
      content: [
        heading,
        { type: "Gizmo", props: { id: "g1" } },
        { type: "Section", props: { id: "s", content: [{ type: "Gizmo", props: { id: "g2" } }, { type: "Widget", props: { id: "w" } }, { type: "Spacer", props: { id: "sp", size: "small" } }] } },
        { type: "Columns", props: { id: "c", count: "2", col1: [{ type: "Widget", props: { id: "w2" } }], col2: [{ type: "Heading", props: { id: "h2", text: "Hi", level: "h2" } }] } },
      ],
      root: {},
    });
    expect(pruned.leftOut).toEqual([
      { type: "Gizmo", count: 2 },
      { type: "Widget", count: 2 },
    ]);
    expect(countBlocks(pruned.data.content)).toBe(5);
    const section = pruned.data.content[1] as { props: { content: { type: string }[] } };
    expect(section.props.content.map((b) => b.type)).toEqual(["Spacer"]);
  });

  it("does not treat names on the object prototype as blocks", () => {
    const pruned = prune({ content: [{ type: "constructor", props: { id: "a" } }, { type: "toString", props: { id: "b" } }, { type: "__proto__", props: { id: "c" } }], root: {} });
    expect(pruned.data.content).toEqual([]);
    expect(pruned.leftOut.reduce((n, l) => n + l.count, 0)).toBe(3);
  });

  it("counts entries that are not blocks, without naming the file's contents", () => {
    const pruned = prune({ content: [null, 7, "x", { props: {} }, { type: 4, props: {} }, { type: "Heading" }, { type: "Heading", props: "no" }], root: {} });
    expect(pruned.data.content).toEqual([]);
    expect(pruned.leftOut).toEqual([{ type: "not a block", count: 7 }]);
  });

  it("drops props a block doesn't have and keeps the ones it does", () => {
    const pruned = prune({ content: [{ type: "Heading", props: { id: "h", text: "Hi", level: "h2", align: "left", onClick: "alert(1)", style: "color:red", span: 6 } }], root: {} });
    expect(pruned.data.content[0]).toEqual({ type: "Heading", props: { id: "h", text: "Hi", level: "h2", align: "left", span: 6 } });
    expect(pruned.droppedProps).toBe(2);
  });

  it("drops props the page frame doesn't have", () => {
    const pruned = prune({ content: [], root: { props: { showHeader: true, footerText: "Hi", evil: "x" }, other: 1 } });
    expect(pruned.data.root).toEqual({ props: { showHeader: true, footerText: "Hi" } });
    expect(pruned.droppedProps).toBe(1);
  });

  it("gives a block without a usable id one, and a repeated id a new one, but keeps ids it can", () => {
    const pruned = prune({
      content: [
        { type: "Heading", props: { text: "No id" } },
        { type: "Heading", props: { id: "same", text: "One" } },
        { type: "Heading", props: { id: "same", text: "Two" } },
        { type: "Heading", props: { id: 7, text: "Three" } },
      ],
      root: {},
    });
    const ids = pruned.data.content.map((b) => (b as { props: { id: string } }).props.id);
    expect(ids[1]).toBe("same");
    expect(new Set(ids).size).toBe(4);
    expect(ids.every((id) => typeof id === "string" && id)).toBe(true);
  });

  it("makes sure a container's slots are lists", () => {
    const pruned = prune({ content: [{ type: "Section", props: { id: "s", content: "nope" } }, { type: "Columns", props: { id: "c", count: "2", col1: { type: "Heading" } } }], root: {} });
    expect((pruned.data.content[0] as { props: { content: unknown } }).props.content).toEqual([]);
    expect((pruned.data.content[1] as { props: Record<string, unknown> }).props).toMatchObject({ col1: [], col2: [], col3: [] });
  });

  it("never lets a block carry a prototype key through", () => {
    const text = '{"content":[{"type":"Heading","props":{"id":"h","text":"Hi","__proto__":{"polluted":true},"constructor":"x"}}],"root":{}}';
    const pruned = prune(JSON.parse(text));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys((pruned.data.content[0] as { props: object }).props)).toEqual(["id", "text"]);
  });
});
