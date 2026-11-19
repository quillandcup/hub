import { afterEach, describe, expect, it, vi } from "vitest";
import { needsLiveData, resolveLiveBlocks, type LiveLoaders } from "@/lib/landing/live-data";
import type { ScheduleSnapshot } from "@/lib/landing/live-schedule";

const NOW = new Date("2026-11-19T15:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const SNAPSHOT: ScheduleSnapshot = { prickles: [{ id: "p1", title: "Open Mic", startTime: at(30), endTime: at(90), experiencedHost: true }], writingNow: null };

const loaders = (over: Partial<LiveLoaders> = {}): LiveLoaders => ({
  stats: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, { value: "890+", caption: `caption of ${k}` }]))),
  schedule: vi.fn(async () => SNAPSHOT),
  ...over,
});

const block = (type: string, props: Record<string, unknown>) => ({ type, props: { id: `${type}-1`, ...props } });
const outcome = (items: Record<string, unknown>[], props: Record<string, unknown> = {}) => block("OutcomeNumbers", { padding: "medium", items, ...props });
const page = (...content: unknown[]) => ({ content, root: { props: {} } });
type Block = { type: string; props: Record<string, unknown> & { items?: Record<string, unknown>[] } };
const resolved = async (data: unknown, l: LiveLoaders = loaders()) => ((await resolveLiveBlocks(data, l, NOW)) as { content: Block[] }).content;

afterEach(() => vi.restoreAllMocks());

describe("what a page needs", () => {
  it("asks only for what live blocks use, each figure once", () => {
    const data = page(
      outcome([{ source: "live", stat: "words_30d", value: "1" }, { source: "live", stat: "hours_30d", value: "2" }, { source: "live", stat: "words_30d", value: "3" }, { source: "manual", stat: "writers_7d", value: "4" }]),
      block("Section", { content: [block("SchedulePanel", { source: "live" })] }),
    );
    expect(needsLiveData(data)).toEqual({ stats: ["hours_30d", "words_30d"], schedule: true });
  });

  it("needs nothing from a page of typed blocks, and loads nothing", async () => {
    const l = loaders();
    const data = page(outcome([{ source: "manual", value: "50+", label: "books", note: "" }]), block("SchedulePanel", { source: "manual", rows: [] }), block("AnnouncementStrip", { text: "Hi" }), block("Heading", { text: "x" }));
    expect(needsLiveData(data)).toEqual({ stats: [], schedule: false });
    expect(await resolveLiveBlocks(data, l, NOW)).toEqual(expect.objectContaining({ content: expect.any(Array) }));
    expect(l.stats).not.toHaveBeenCalled();
    expect(l.schedule).not.toHaveBeenCalled();
  });

  it("ignores a stat that is not in the registry", () => {
    expect(needsLiveData(page(outcome([{ source: "live", stat: "secret_member_list", value: "1" }])))).toEqual({ stats: [], schedule: false });
  });
});

describe("resolveLiveBlocks", () => {
  it("puts the figure on live outcome items only, and leaves the typed value as the fallback", async () => {
    const [out] = await resolved(page(outcome([{ source: "live", stat: "hours_30d", value: "typed", label: "", note: "" }, { source: "manual", stat: "hours_30d", value: "50+", label: "books", note: "" }])));
    expect(out.props.items![0]).toMatchObject({ value: "typed", live: { value: "890+", caption: "caption of hours_30d" } });
    expect(out.props.items![1]).not.toHaveProperty("live");
  });

  it("fills the schedule panel with rows for its own options, and the strip with its line", async () => {
    const [panel, strip] = await resolved(page(block("SchedulePanel", { source: "live", hostStyle: "experience", hoursAhead: 24, maxRows: 5, rows: [] }), block("AnnouncementStrip", { source: "live", text: "typed" })));
    expect(panel.props.live).toEqual({ rows: [{ time: "10:30 am", title: "Open Mic", status: "In 30 min", state: "soon", host: "An experienced host" }], zoneLabel: expect.stringMatching(/^Times in E[SD]?T$/) });
    expect(strip.props.live).toEqual({ text: "Your next prickle starts in 30 minutes" });
  });

  it("finds live blocks inside sections and columns, and leaves the page's other blocks alone", async () => {
    const data = page(block("Section", { content: [block("Columns", { col1: [outcome([{ source: "live", stat: "hours_30d", value: "1" }])], col2: [block("Heading", { text: "Hello" })] })] }));
    const [section] = await resolved(data);
    const columns = (section.props.content as Block[])[0];
    expect(((columns.props.col1 as Block[])[0].props.items![0] as Record<string, unknown>).live).toBeTruthy();
    expect((columns.props.col2 as Block[])[0]).toEqual({ type: "Heading", props: { id: "Heading-1", text: "Hello" } });
  });

  it("never changes the stored document: the result is a copy", async () => {
    const data = page(outcome([{ source: "live", stat: "hours_30d", value: "typed" }]), block("SchedulePanel", { source: "live", rows: [] }));
    const before = JSON.stringify(data);
    const out = await resolveLiveBlocks(data, loaders(), NOW);
    expect(JSON.stringify(data)).toBe(before);
    expect(JSON.stringify(out)).not.toBe(before);
    expect(JSON.stringify(data)).not.toContain('"live":{');
  });

  it("drops a `live` prop planted in stored data, and from a block that is not live", async () => {
    const planted = { value: "9,999,999", caption: "made up" };
    const out = await resolved(
      page(
        outcome([{ source: "manual", value: "50+", live: planted }]),
        block("SchedulePanel", { source: "manual", rows: [], live: { rows: [{ title: "Fake", time: "", status: "", state: "open", host: "" }], zoneLabel: "" } }),
        block("AnnouncementStrip", { source: "manual", text: "x", live: { text: "Planted" } }),
      ),
    );
    expect(JSON.stringify(out)).not.toMatch(/9,999,999|Planted|Fake/);
  });

  it("gives a loaded page with nothing coming up an empty line, so the block can say so", async () => {
    const [panel, strip] = await resolved(page(block("SchedulePanel", { source: "live", rows: [] }), block("AnnouncementStrip", { source: "live" })), loaders({ schedule: async () => ({ prickles: [], writingNow: null }) }));
    expect(panel.props.live).toMatchObject({ rows: [] });
    expect(strip.props.live).toEqual({ text: "" });
  });
});

describe("when a load fails", () => {
  it("logs a short code with no data, and leaves the typed values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const l = loaders({ stats: async () => Promise.reject(new Error("secret member name Ada Example")), schedule: async () => Promise.reject(new Error("db down")) });
    const out = await resolved(page(outcome([{ source: "live", stat: "hours_30d", value: "typed" }]), block("SchedulePanel", { source: "live", rows: [{ title: "Typed" }] }), block("AnnouncementStrip", { source: "live", text: "Typed line" })), l);
    expect(JSON.stringify(out)).not.toContain('"live":{');
    expect(log.mock.calls.map((c) => c[0]).sort()).toEqual(["landing_live_schedule_failed", "landing_live_stats_failed"]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Ada Example|db down/);
  });

  it("lets the figures through when only the schedule fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const [numbers, panel] = await resolved(page(outcome([{ source: "live", stat: "hours_30d", value: "typed" }]), block("SchedulePanel", { source: "live", rows: [] })), loaders({ schedule: async () => Promise.reject(new Error("x")) }));
    expect(numbers.props.items![0]).toHaveProperty("live");
    expect(panel.props).not.toHaveProperty("live");
  });

  it("tolerates a document that is not a page", async () => {
    expect(await resolveLiveBlocks(null, loaders(), NOW)).toMatchObject({ content: [] });
    expect(await resolveLiveBlocks("nonsense", loaders(), NOW)).toMatchObject({ content: [] });
  });
});
