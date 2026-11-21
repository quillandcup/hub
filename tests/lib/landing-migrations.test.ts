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

// Step 2: the items of seven blocks became child blocks (a slot), and a page saved before holds them as plain lists.
describe("items as child blocks (step 2)", () => {
  type N = { type: string; props: Record<string, unknown> };
  const legacy: Record<string, { item: string; items: Record<string, unknown>[] }> = {
    Steps: { item: "Step", items: [{ title: "One", text: "a" }, { title: "Two", text: "b" }] },
    Stats: { item: "Stat", items: [{ value: "5", label: "books" }, { value: "7", label: "years" }] },
    FinisherCards: { item: "FinisherCard", items: [{ alt: "", name: "Ada Example", kind: "Novel", dayOne: "An idea", theEnd: "82,000 words", linkLabel: "Read", href: "", imageAssetId: "media_AAAAAAAAAAA1" }] },
    Timeline: { item: "TimelineMoment", items: [{ when: "8:00", title: "Morning", text: "Write." }, { when: "Noon", title: "Chat", text: "Talk." }] },
    WeekStrip: { item: "WeekDay", items: [{ label: "Mon", emoji: "👋", text: "Join", note: "5 min" }, { label: "Tue", emoji: "✍️", text: "Write", note: "" }] },
    FinishLineCards: { item: "FinishLineCard", items: [{ title: "A year", program: "Program A", text: "Steady.", durationLabel: "12 months", durationPercent: 100, buttonLabel: "See it", href: "/x" }] },
    PlanPhases: { item: "PlanPhase", items: [{ title: "Weeks 1 to 4", text: "Build the habit." }] },
  };
  const page = (type: string, extra: Record<string, unknown> = {}) => ({ type, props: { id: `${type}-1`, ...extra, items: legacy[type].items } });
  const kids = (n: N) => n.props.items as N[];

  it.each(Object.keys(legacy))("%s: a plain list becomes child blocks of the right type, with the same props in the same order", (type) => {
    const out = normalizeLandingData({ content: [page(type)], root: {} }) as unknown as { content: N[]; schemaVersion: number };
    const items = kids(out.content[0]);
    expect(items.map((i) => i.type)).toEqual(legacy[type].items.map(() => legacy[type].item));
    items.forEach((i, idx) => expect(i.props).toEqual({ ...legacy[type].items[idx], id: `${legacy[type].item}-${type}-1-${idx + 1}` }));
    expect(new Set(items.map((i) => i.props.id)).size).toBe(items.length);
    expect(out.schemaVersion).toBe(LANDING_SCHEMA_VERSION);
  });

  it("keeps the block's other props, and reaches blocks nested in a Section and a Columns", () => {
    const doc = { content: [{ type: "Section", props: { id: "s1", content: [page("Steps", { heading: "How" }), { type: "Columns", props: { id: "c1", count: "2", col1: [page("WeekStrip", { subtitle: "A week" })], col2: [] } }] } }], root: {} };
    const out = normalizeLandingData(doc) as unknown as { content: N[] };
    const section = out.content[0];
    const steps = (section.props.content as N[])[0];
    expect(steps.props.heading).toBe("How");
    expect(kids(steps).map((k) => k.type)).toEqual(["Step", "Step"]);
    const week = ((section.props.content as N[])[1].props.col1 as N[])[0];
    expect(week.props.subtitle).toBe("A week");
    expect(kids(week).map((k) => k.props.label)).toEqual(["Mon", "Tue"]);
  });

  it("is idempotent: running it again, or on a page already made of child blocks, changes nothing", () => {
    const once = normalizeLandingData({ content: Object.keys(legacy).map((t) => page(t)), root: {} });
    expect(normalizeLandingData(once)).toEqual(once);
    expect(normalizeLandingData({ ...(once as object), schemaVersion: 1 })).toEqual(once);
  });

  it("leaves an empty list, a block with no items and a list that is already blocks as they are", () => {
    const already = { type: "Steps", props: { id: "st", items: [{ type: "Step", props: { id: "x", title: "Done", text: "" } }] } };
    const empty = { type: "Timeline", props: { id: "t", items: [] } };
    const none = { type: "WeekStrip", props: { id: "w", subtitle: "x" } };
    const out = normalizeLandingData({ content: [already, empty, none], root: {} }) as unknown as { content: N[] };
    expect(out.content).toEqual([already, empty, none]);
  });
});

// Step 3: Buttons, List, Testimonials, FAQ, Card grid, Link list, Outcome numbers and the Schedule panel's rows became child blocks too.
describe("items as child blocks (step 3)", () => {
  type N = { type: string; props: Record<string, unknown> };
  const legacy: Record<string, { item: string; items: Record<string, unknown>[]; extra?: Record<string, unknown> }> = {
    ButtonRow: { item: "RowButton", items: [{ label: "Join", href: "/join", look: "solid", color: "plum", shape: "pill" }, { label: "More", href: "", look: "outline", color: "light", shape: "rect" }] },
    List: { item: "ListItem", items: [{ text: "One", icon: "🌱" }, { text: "Two", icon: "✓" }] },
    Testimonials: { item: "Testimonial", items: [{ quote: "Lovely", name: "Ada Example", detail: "Member" }] },
    Faq: { item: "FaqItem", items: [{ question: "Why?", answer: "Because." }, { question: "How?", answer: "" }] },
    CardGrid: { item: "GridCard", items: [{ alt: "", title: "Card", price: "", buttonLabel: "", href: "", imageAssetId: "media_AAAAAAAAAAA1" }], extra: { columns: "3" } },
    OutcomeNumbers: { item: "OutcomeNumber", items: [{ source: "live", stat: "hours_30d", value: "50+", label: "", note: "" }, { source: "manual", value: "100s", label: "of Finishers", note: "" }] },
  };
  const page = (type: string) => ({ type, props: { id: `${type}-1`, ...legacy[type].extra, items: legacy[type].items } });
  const kids = (n: N) => n.props.items as N[];

  it.each(Object.keys(legacy))("%s: a plain list becomes child blocks of the right type, with the same props in the same order", (type) => {
    const out = normalizeLandingData({ content: [page(type)], root: {} }) as unknown as { content: N[]; schemaVersion: number };
    const items = kids(out.content[0]);
    expect(items.map((i) => i.type)).toEqual(legacy[type].items.map(() => legacy[type].item));
    items.forEach((i, idx) => expect(i.props).toEqual({ ...legacy[type].items[idx], id: `${legacy[type].item}-${type}-1-${idx + 1}` }));
    expect(out.schemaVersion).toBe(LANDING_SCHEMA_VERSION);
  });

  it("moves a Link list's style and colour onto each link, and keeps a link that had its own", () => {
    const out = normalizeLandingData({ content: [{ type: "LinkList", props: { id: "l", look: "outline", color: "brown", items: [{ label: "A", href: "/a" }, { label: "B", href: "/b", look: "solid" }] } }], root: {} }) as unknown as { content: N[] };
    const list = out.content[0];
    expect(list.props).not.toHaveProperty("look");
    expect(list.props).not.toHaveProperty("color");
    expect(kids(list).map((k) => [k.type, k.props.label, k.props.look, k.props.color])).toEqual([["LinkItem", "A", "outline", "brown"], ["LinkItem", "B", "solid", "brown"]]);
    const bare = normalizeLandingData({ content: [{ type: "LinkList", props: { id: "l2", items: [{ label: "A", href: "/a" }] } }], root: {} }) as unknown as { content: N[] };
    expect(kids(bare.content[0])[0].props).toMatchObject({ look: "solid", color: "plum" });
  });

  it("moves a Schedule panel's rows into its items slot, and leaves one that has items already", () => {
    const rows = [{ time: "9:00 am", title: "Morning", status: "Live", state: "live", host: "" }, { time: "10:00 am", title: "Focus", status: "", state: "open", host: "" }];
    const out = normalizeLandingData({ content: [{ type: "SchedulePanel", props: { id: "sp", title: "Today", source: "live", rows } }], root: {} }) as unknown as { content: N[] };
    const panel = out.content[0];
    expect(panel.props).not.toHaveProperty("rows");
    expect(panel.props.title).toBe("Today");
    expect(kids(panel).map((k) => [k.type, k.props.title, k.props.id])).toEqual([["ScheduleRow", "Morning", "ScheduleRow-sp-1"], ["ScheduleRow", "Focus", "ScheduleRow-sp-2"]]);
    const done = { type: "SchedulePanel", props: { id: "sp2", rows: [], items: [{ type: "ScheduleRow", props: { id: "r1", time: "", title: "Kept", status: "", state: "open", host: "" } }] } };
    const kept = normalizeLandingData({ content: [done], root: {} }) as unknown as { content: N[] };
    expect(kids(kept.content[0]).map((k) => k.props.title)).toEqual(["Kept"]);
    const none = normalizeLandingData({ content: [{ type: "SchedulePanel", props: { id: "sp3", rows: [] } }], root: {} }) as unknown as { content: N[] };
    expect(none.content[0].props.items).toEqual([]);
  });

  it("is idempotent, reaches blocks nested in a Section, and leaves empty lists and blocks already made of items alone", () => {
    const doc = { content: [{ type: "Section", props: { id: "s", content: [...Object.keys(legacy).map(page), { type: "LinkList", props: { id: "ll", look: "solid", color: "plum", items: [{ label: "A", href: "/a" }] } }, { type: "SchedulePanel", props: { id: "sp", rows: [{ time: "", title: "T", status: "", state: "open", host: "" }] } }] } }], root: {} };
    const once = normalizeLandingData(doc);
    expect(normalizeLandingData(once)).toEqual(once);
    expect(normalizeLandingData({ ...(once as object), schemaVersion: 2 })).toEqual(once);
    const section = (once as unknown as { content: N[] }).content[0];
    expect((section.props.content as N[]).every((b) => (b.props.items as N[]).every((i) => typeof i.type === "string"))).toBe(true);
    const already = { type: "Faq", props: { id: "f", items: [{ type: "FaqItem", props: { id: "x", question: "Q", answer: "" } }] } };
    const empty = { type: "List", props: { id: "e", items: [] } };
    expect((normalizeLandingData({ content: [already, empty], root: {} }) as unknown as { content: N[] }).content).toEqual([already, empty]);
  });
});
