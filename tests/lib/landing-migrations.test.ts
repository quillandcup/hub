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
  it("stamps the current version and leaves content with nothing to migrate as it is", () => {
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

describe("the Journey map step (one offer under the stepper becomes a stage's offers)", () => {
  const offer = { status: "waitlist", statusLabel: "", title: "Academy", text: "About it", buttonLabel: "See Academy", href: "/academy" };
  const stage = (name: string, current = false) => ({ name, helps: "", current });
  const map = (props: Record<string, unknown>) => ({ type: "JourneyMap", props: { id: "j", compare: { label: "Compare", href: "/compare" }, ...props } });
  const run = (...content: unknown[]) => migrateLandingData({ root: {}, content }, LANDING_MIGRATIONS) as any;

  it("moves the offer to the stage marked current, keeps the compare link and drops the old prop", () => {
    const out = run(map({ stages: [stage("Idea"), stage("Revising", true), stage("Sharing")], offer }));
    const props = out.content[0].props;
    expect(props.offer).toBeUndefined();
    expect(props.compare).toEqual({ label: "Compare", href: "/compare" });
    expect(props.stages.map((s: any) => s.offers?.length ?? 0)).toEqual([0, 1, 0]);
    expect(props.stages[1].offers[0]).toEqual(offer);
    expect(out.schemaVersion).toBe(LANDING_SCHEMA_VERSION);
  });

  it("uses the first named stage when none is current, and puts the offer before offers the stage already has", () => {
    const out = run(map({ stages: [stage(""), { ...stage("Idea"), offers: [{ title: "Existing" }] }, stage("Drafting")], offer }));
    const stages = out.content[0].props.stages;
    expect(stages[0].offers).toBeUndefined();
    expect(stages[1].offers.map((o: any) => o.title)).toEqual(["Academy", "Existing"]);
  });

  it("drops an empty offer, and keeps the stages when there is nowhere to put it", () => {
    const empty = { status: "open", statusLabel: "", title: "", text: "", buttonLabel: "", href: "" };
    expect(run(map({ stages: [stage("Idea", true)], offer: empty })).content[0].props).toEqual({ id: "j", compare: { label: "Compare", href: "/compare" }, stages: [stage("Idea", true)] });
    expect(run(map({ stages: [], offer })).content[0].props.stages).toEqual([]);
    expect(run(map({ offer })).content[0].props.offer).toBeUndefined();
  });

  it("is idempotent, and leaves a block that has no offer prop alone", () => {
    const once = run(map({ stages: [stage("Idea", true)], offer }));
    expect(migrateLandingData({ ...once }, LANDING_MIGRATIONS)).toEqual(once);
    // Even forced through the step again (a document marked 0), nothing more changes.
    const again = migrateLandingData({ ...once, schemaVersion: 0 }, LANDING_MIGRATIONS) as any;
    expect(again.content).toEqual(once.content);
    const fresh = { stages: [{ ...stage("Idea", true), offers: [offer] }], compare: {} };
    expect(run(map(fresh)).content[0].props).toEqual({ id: "j", ...fresh });
  });

  it("migrates blocks inside a Section, in Columns and in zones", () => {
    const block = () => map({ stages: [stage("Idea", true)], offer });
    const out = run({ type: "Section", props: { id: "s", content: [block()] } }, { type: "Columns", props: { id: "c", col1: [block()], col2: [] } });
    expect(out.content[0].props.content[0].props.stages[0].offers).toEqual([offer]);
    expect(out.content[1].props.col1[0].props.stages[0].offers).toEqual([offer]);
    const zoned = migrateLandingData({ root: {}, content: [], zones: { "x:slot": [block()] } }, LANDING_MIGRATIONS) as any;
    expect(zoned.zones["x:slot"][0].props.stages[0].offers).toEqual([offer]);
  });

  it("normalizes a stored page on read, as the editor and the public page do", () => {
    const out = normalizeLandingData({ content: [map({ stages: [stage("Idea", true)], offer })], root: {} }) as any;
    expect(out.content[0].props.stages[0].offers).toEqual([offer]);
    expect(out.schemaVersion).toBe(LANDING_MIGRATIONS.length);
  });
});
