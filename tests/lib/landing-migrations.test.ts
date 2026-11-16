import { describe, it, expect } from "vitest";
import { normalizeLandingData } from "@/lib/landing/data";
import { LANDING_MIGRATIONS, LANDING_SCHEMA_VERSION, landingDataVersion, migrateLandingData, stampLandingVersion, type LandingMigration } from "@/lib/landing/migrations";

// A made-up history: v1 renames Heading.text to Heading.title and the frame's footerText to footerNote,
// v2 turns Button.full from a boolean into a width.
const STEPS: LandingMigration[] = [
  {
    version: 1,
    blocks: { Heading: ({ text, ...rest }) => ("text" in rest || text === undefined ? { text, ...rest } : { title: text, ...rest }) },
    root: ({ footerText, ...rest }) => (footerText === undefined ? rest : { footerNote: footerText, ...rest }),
  },
  { version: 2, blocks: { Button: ({ full, ...rest }) => (typeof full === "boolean" ? { width: full ? "full" : "auto", ...rest } : { full, ...rest }) } },
];

const old = () => ({
  root: { props: { footerText: "Bye" } },
  content: [
    { type: "Heading", props: { id: "h1", text: "Hi" } },
    { type: "Section", props: { id: "s1", content: [{ type: "Button", props: { id: "b1", label: "Go", full: true } }, { type: "Heading", props: { id: "h2", text: "Nested" } }] } },
  ],
  zones: { "s1:extra": [{ type: "Heading", props: { id: "h3", text: "Zone" } }] },
});

describe("landing data migrations", () => {
  it("has no steps yet, so the current version is 0 and unmarked data stays as it is", () => {
    expect(LANDING_SCHEMA_VERSION).toBe(LANDING_MIGRATIONS.length);
    const data = { content: [{ type: "Heading", props: { text: "Hi" } }], root: {} };
    expect(normalizeLandingData(data)).toEqual({ ...data, schemaVersion: LANDING_SCHEMA_VERSION });
    expect(normalizeLandingData(null)).toEqual({ content: [], root: {}, schemaVersion: LANDING_SCHEMA_VERSION });
  });

  it("runs every step on unmarked data, including blocks inside a slot and in a zone, and the page frame", () => {
    const out = migrateLandingData({ ...old() }, STEPS) as any;
    expect(out.schemaVersion).toBe(2);
    expect(out.root.props).toEqual({ footerNote: "Bye" });
    expect(out.content[0].props).toEqual({ id: "h1", title: "Hi" });
    expect(out.content[1].props.content[0].props).toEqual({ id: "b1", label: "Go", width: "full" });
    expect(out.content[1].props.content[1].props).toEqual({ id: "h2", title: "Nested" });
    expect(out.zones["s1:extra"][0].props).toEqual({ id: "h3", title: "Zone" });
  });

  it("runs only the steps above the document's version", () => {
    const out = migrateLandingData({ ...old(), schemaVersion: 1 }, STEPS) as any;
    expect(out.content[0].props).toEqual({ id: "h1", text: "Hi" });
    expect(out.content[1].props.content[0].props.width).toBe("full");
    expect(out.schemaVersion).toBe(2);
  });

  it("leaves a current document alone, and is stable when run twice", () => {
    const once = migrateLandingData(old(), STEPS);
    expect(migrateLandingData(once, STEPS)).toEqual(once);
  });

  it("does not change the input", () => {
    const input = old();
    migrateLandingData(input, STEPS);
    expect(input).toEqual(old());
  });

  it("tolerates a frame without props and arrays that are not blocks", () => {
    const out = migrateLandingData({ root: {}, content: [{ type: "List", props: { items: [{ text: "a" }, 5] } }, "junk"] }, STEPS) as any;
    expect(out.root).toEqual({});
    expect(out.content[0].props.items).toEqual([{ text: "a" }, 5]);
    expect(out.content[1]).toBe("junk");
  });

  it("ignores a block type that is a prototype method name instead of calling it", () => {
    const content = ["constructor", "toString", "__proto__", "hasOwnProperty"].map((type) => ({ type, props: { id: type, text: "x" } }));
    const out = migrateLandingData({ root: {}, content }, STEPS) as any;
    expect(out.content.map((n: any) => n.props)).toEqual(content.map((n) => n.props));
  });

  it("reads the version marker defensively", () => {
    expect(landingDataVersion({ schemaVersion: 3 })).toBe(3);
    for (const bad of [{}, { schemaVersion: "2" }, { schemaVersion: -1 }, { schemaVersion: 1.5 }, null, []]) expect(landingDataVersion(bad)).toBe(0);
  });

  it("stamps what the editor sends as current, and passes non-objects through", () => {
    expect(stampLandingVersion({ content: [], root: {} })).toEqual({ content: [], root: {}, schemaVersion: LANDING_SCHEMA_VERSION });
    expect(stampLandingVersion(null)).toBeNull();
  });
});
