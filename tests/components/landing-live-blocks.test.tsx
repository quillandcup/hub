// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";

// The full Puck bundle (what jsdom resolves; the server uses its lean `rsc` build) wants these browser APIs at import.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { cleanup, render, screen } from "@testing-library/react";
import { AnnouncementStrip, ComingUp, OutcomeNumbers, SchedulePanel } from "@/components/landing/homepage-blocks";
import { BLOCK_DEFAULTS } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";
import LandingRender from "@/components/landing/LandingRender";
import { checkLandingPage } from "@/lib/landing/a11y";
import { resolveLiveBlocks } from "@/lib/landing/live-data";
import { LIVE_STAT_KEYS, LIVE_STATS } from "@/lib/landing/live-stats";
import { sanitizeLandingData } from "@/lib/landing/sanitize";

afterEach(cleanup);

describe("AnnouncementStrip, live", () => {
  const base = { text: "Typed line", buttonLabel: "Drop in", href: "/join", tone: "gold" } as const;

  it("shows the server's line with the typed button, in the same markup as a typed line", () => {
    const typed = render(<AnnouncementStrip {...base} />);
    const typedHtml = typed.container.innerHTML.replace("Typed line", "LINE");
    typed.unmount();
    const { container } = render(<AnnouncementStrip {...base} source="live" live={{ text: "Your next prickle starts in 12 minutes" }} />);
    expect(screen.getByText("Your next prickle starts in 12 minutes")).toBeInTheDocument();
    expect(screen.queryByText("Typed line")).toBeNull();
    expect(screen.getByRole("link", { name: "Drop in" })).toHaveAttribute("href", "/join");
    expect(container.innerHTML.replace("Your next prickle starts in 12 minutes", "LINE")).toBe(typedHtml);
  });

  it("shows nothing when live and nothing is coming up, or its typed line when asked to", () => {
    expect(render(<AnnouncementStrip {...base} source="live" live={{ text: "" }} />).container).toBeEmptyDOMElement();
    cleanup();
    render(<AnnouncementStrip {...base} source="live" whenNone="typed" live={{ text: "" }} />);
    expect(screen.getByText("Typed line")).toBeInTheDocument();
  });

  it("shows the typed line when live data is missing (a failed load), and ignores live data on a typed strip", () => {
    render(<AnnouncementStrip {...base} source="live" />);
    expect(screen.getByText("Typed line")).toBeInTheDocument();
    cleanup();
    render(<AnnouncementStrip {...base} source="manual" live={{ text: "Planted" }} />);
    expect(screen.getByText("Typed line")).toBeInTheDocument();
    expect(screen.queryByText("Planted")).toBeNull();
  });
});

describe("SchedulePanel, live", () => {
  const typedRows = [{ time: "9:00 am", title: "Typed session", status: "Live", state: "live" as const, host: "" }];
  const liveRows = [
    { time: "10:00 am", title: "Open Mic", status: "3 writing now", state: "live" as const, host: "An experienced host" },
    { time: "10:30 am", title: "Free Writing Hour", status: "In 30 min", state: "soon" as const, host: "" },
  ];
  const base = { title: "Writing right now", zoneLabel: "", rows: typedRows };

  it("lists the live rows in place of the typed ones, naming the zone it was given", () => {
    render(<SchedulePanel {...base} source="live" live={{ rows: liveRows, zoneLabel: "Times in ET" }} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Open Mic")).toBeInTheDocument();
    expect(screen.getByText("3 writing now")).toBeInTheDocument();
    expect(screen.getByText("An experienced host")).toBeInTheDocument();
    expect(screen.getByText("Times in ET")).toBeInTheDocument();
    expect(screen.queryByText("Typed session")).toBeNull();
  });

  it("keeps a typed zone note over the live one", () => {
    render(<SchedulePanel {...base} zoneLabel="Eastern" source="live" live={{ rows: liveRows, zoneLabel: "Times in ET" }} />);
    expect(screen.getByText("Eastern")).toBeInTheDocument();
    expect(screen.queryByText("Times in ET")).toBeNull();
  });

  it("says so, in the editor's words, when nothing is coming up, and shows nothing without those words", () => {
    render(<SchedulePanel {...base} source="live" emptyText="No sessions just yet." live={{ rows: [], zoneLabel: "" }} />);
    expect(screen.getByText("No sessions just yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    cleanup();
    expect(render(<SchedulePanel {...base} source="live" live={{ rows: [], zoneLabel: "" }} />).container).toBeEmptyDOMElement();
  });

  it("falls back to the typed rows without live data, and ignores live rows on a typed panel", () => {
    render(<SchedulePanel {...base} source="live" />);
    expect(screen.getByText("Typed session")).toBeInTheDocument();
    cleanup();
    render(<SchedulePanel {...base} source="manual" live={{ rows: liveRows, zoneLabel: "" }} />);
    expect(screen.getByText("Typed session")).toBeInTheDocument();
    expect(screen.queryByText("Open Mic")).toBeNull();
  });
});

describe("OutcomeNumbers, live", () => {
  const items = [
    { source: "live" as const, stat: "hours_30d", value: "typed", label: "", note: "", live: { value: "890+", caption: "hours written together in prickles in the last 30 days" } },
    { source: "live" as const, stat: "words_30d", value: "50,000+", label: "words in the Hub", note: "", live: { value: "54,000+", caption: "the caption" } },
    { source: "live" as const, stat: "writers_7d", value: "40", label: "writers", note: "" }, // no live data: the typed figure
    { source: "manual" as const, value: "50+", label: "books published", note: "" },
  ];

  it("shows the live figure with the figure's own words, or the editor's label when there is one, and the typed one without live data", () => {
    const { container } = render(<OutcomeNumbers items={items} />);
    expect(screen.getByText("890+").tagName).toBe("DD");
    expect(screen.getByText(/hours written together in prickles in the last 30 days/)).toBeInTheDocument();
    expect(screen.getByText("54,000+")).toBeInTheDocument();
    expect(screen.getByText(/words in the Hub/)).toBeInTheDocument();
    expect(screen.queryByText("the caption")).toBeNull();
    expect(screen.queryByText("typed")).toBeNull();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("50+")).toBeInTheDocument();
    // The same classes as a typed figure.
    expect(screen.getByText("890+").className).toBe(screen.getByText("50+").className);
    expect(container.querySelectorAll("dd")).toHaveLength(4);
  });

  it("marks only the live figures with a small live note, which the editor can turn off; its dot pulses only where motion is allowed", () => {
    const { container, rerender } = render(<OutcomeNumbers items={items} />);
    expect(screen.getAllByText("live")).toHaveLength(2);
    const dot = screen.getAllByText("live")[0].querySelector("[aria-hidden='true']")!;
    expect(dot.className).toContain("landing-pulse");
    rerender(<OutcomeNumbers items={items} showLiveNote={false} />);
    expect(screen.queryByText("live")).toBeNull();
    expect(container.querySelectorAll("dd")).toHaveLength(4);
  });

  it("keeps a live item whose typed figure is empty", () => {
    render(<OutcomeNumbers items={[{ source: "live", stat: "hours_30d", value: "", label: "", note: "", live: { value: "12", caption: "hours" } }, { source: "manual", value: "3", label: "x", note: "" }]} />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});

describe("a live page, end to end", () => {
  const NOW = new Date("2026-11-19T15:00:00Z");
  const data = {
    content: [
      { type: "AnnouncementStrip", props: { id: "a", ...BLOCK_DEFAULTS.AnnouncementStrip, source: "live", href: "/join" } },
      { type: "OutcomeNumbers", props: { id: "b", items: [{ source: "live", stat: "hours_30d", value: "", label: "", note: "" }] } },
    ],
    root: {},
  };

  it("renders the resolved figures through the page, and the stored page still says live with nothing injected", async () => {
    const resolved = await resolveLiveBlocks(
      data,
      {
        stats: async () => ({ hours_30d: { value: "890+", caption: LIVE_STATS.hours_30d.caption } }),
        comingUp: async () => ({ events: [{ kind: "Retreat", title: "Lakeside Retreat", when: "Mar 13 to 15, 2027", availability: "3 spots left", linkLabel: "Sign up", href: "https://checkout.example.com/r", startTime: "2027-03-13T05:00:00Z" }] }),
        schedule: async () => ({ prickles: [{ id: "p", title: "Open Mic", startTime: new Date(NOW.getTime() + 600_000).toISOString(), endTime: new Date(NOW.getTime() + 4_200_000).toISOString(), experiencedHost: false }], writingNow: null }),
      },
      NOW,
    );
    render(<LandingRender data={resolved} />);
    expect(screen.getByText("Your next prickle starts in 10 minutes")).toBeInTheDocument();
    expect(screen.getByText("890+")).toBeInTheDocument();
    // What the editor saves is the page as stored: sanitizing it (what every save does) keeps no live value.
    expect(JSON.stringify(sanitizeLandingData(data))).not.toContain("890+");
  });

  it("renders every live block from its defaults with no live data, as the typed block (the editor's canvas)", () => {
    for (const name of ["AnnouncementStrip", "SchedulePanel", "OutcomeNumbers", "ComingUp"] as const) {
      const props = { id: "x", ...BLOCK_DEFAULTS[name], source: "live", ...(name === "OutcomeNumbers" ? { items: BLOCK_DEFAULTS.OutcomeNumbers.items.map((i) => ({ ...i, source: "live" })) } : {}) };
      const { container, unmount } = render(<LandingRender data={{ content: [{ type: name, props }], root: {} }} />);
      expect(container.querySelector("main")!.innerHTML, name).not.toBe("");
      unmount();
    }
  });

  it("passes the publish checks as before: a live strip still needs its button's link", () => {
    const withLink = { content: [{ type: "AnnouncementStrip", props: { id: "a", source: "live", text: "x", buttonLabel: "Drop in", href: "/join" } }], root: {} };
    expect(checkLandingPage(withLink).some((i) => /link/i.test(i.message))).toBe(false);
    const noLink = { content: [{ type: "AnnouncementStrip", props: { id: "a", source: "live", text: "x", buttonLabel: "Drop in", href: "" } }], root: {} };
    expect(checkLandingPage(noLink).some((i) => i.severity === "error" && /link/i.test(i.message))).toBe(true);
  });
});

describe("the editor's fields for live blocks", () => {
  type Field = { type: string; label?: string; options?: { label: string; value: unknown }[]; arrayFields?: Record<string, Field> };
  const fields = (block: string) => editorConfig.components[block].fields as unknown as Record<string, Field>;

  it("lets each live block choose its source in plain words, and says where live shows", () => {
    for (const [block, holder] of [["AnnouncementStrip", fields("AnnouncementStrip")], ["SchedulePanel", fields("SchedulePanel")], ["OutcomeNumbers item", fields("OutcomeNumbers").items.arrayFields!]] as const) {
      const source = holder.source;
      expect(source, block).toBeDefined();
      expect(source.options!.map((o) => o.label), block).toEqual(["Typed in by hand", "Live from the Hub"]);
      expect(source.label).toMatch(/live shows on the published page/i);
    }
  });

  it("offers every registered figure in the figure picker, by its label, and labels every new field", () => {
    const stat = fields("OutcomeNumbers").items.arrayFields!.stat;
    expect(stat.options!.map((o) => o.value)).toEqual(LIVE_STAT_KEYS);
    expect(stat.options!.map((o) => o.label)).toEqual(LIVE_STAT_KEYS.map((k) => LIVE_STATS[k].label));
    for (const f of [...Object.values(fields("SchedulePanel")), ...Object.values(fields("AnnouncementStrip")), ...Object.values(fields("OutcomeNumbers").items.arrayFields!), fields("OutcomeNumbers").showLiveNote]) {
      if (f.type !== "array" && f.type !== "slot") expect(f.label, JSON.stringify(f)).toBeTruthy();
    }
    expect(fields("SchedulePanel").hostStyle.options!.map((o) => o.value)).toEqual(["none", "experience"]); // a first-name style is not offered
  });

  it("defaults every live block to typed, so a page saved before changes nothing", () => {
    expect(BLOCK_DEFAULTS.AnnouncementStrip.source).toBe("manual");
    expect(BLOCK_DEFAULTS.SchedulePanel.source).toBe("manual");
    expect(BLOCK_DEFAULTS.SchedulePanel.hostStyle).toBe("none");
    expect(BLOCK_DEFAULTS.OutcomeNumbers.items.every((i) => i.source === "manual")).toBe(true);
    expect(BLOCK_DEFAULTS.OutcomeNumbers.showLiveNote).toBe(true);
  });
});

describe("ComingUp, live", () => {
  const typed = [{ kind: "Retreat", title: "Typed retreat", when: "June", availability: "Spots left", status: "" as const, linkLabel: "", href: "" }];
  const cards = [
    { kind: "Retreat", title: "Lakeside Retreat", when: "Mar 13 to 15, 2027", availability: "3 spots left", linkLabel: "Sign up", href: "https://checkout.example.com/r" },
    { kind: "Virtual retreat", title: "Online Week", when: "Apr 10", availability: "", linkLabel: "", href: "" },
    { kind: "Workshop", title: "Full Workshop", when: "Apr 20, 7 pm EDT", availability: "Full", linkLabel: "Sign up", href: "javascript:alert(1)" },
  ];

  it("shows the live cards instead of the typed ones, with real availability and a link only where it is safe", () => {
    render(<ComingUp heading="Coming up" items={typed} source="live" live={{ cards }} />);
    expect(screen.queryByText("Typed retreat")).toBeNull();
    expect(screen.getByRole("heading", { level: 4, name: "Lakeside Retreat" })).toBeInTheDocument();
    expect(screen.getByText("3 spots left")).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
    expect(screen.getByText("Virtual retreat")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Sign up" });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://checkout.example.com/r");
  });

  it("shows the typed cards when live data is missing, or when the block is typed (a live prop on a typed block is ignored)", () => {
    const { rerender } = render(<ComingUp heading="Coming up" items={typed} source="live" />);
    expect(screen.getByText("Typed retreat")).toBeInTheDocument();
    rerender(<ComingUp heading="Coming up" items={typed} source="live" live={{ cards: [] }} />);
    expect(screen.getByText("Typed retreat")).toBeInTheDocument();
    rerender(<ComingUp heading="Coming up" items={typed} source="manual" live={{ cards }} />);
    expect(screen.getByText("Typed retreat")).toBeInTheDocument();
    expect(screen.queryByText("Lakeside Retreat")).toBeNull();
  });

  it("shows one typed link under the cards, only with a safe address", () => {
    const { rerender } = render(<ComingUp heading="" items={typed} more={{ label: "See all events", href: "/join" }} />);
    expect(screen.getByRole("link", { name: "See all events" })).toHaveAttribute("href", "/join");
    rerender(<ComingUp heading="" items={typed} more={{ label: "See all events", href: "javascript:alert(1)" }} />);
    expect(screen.queryByRole("link", { name: "See all events" })).toBeNull();
  });

  it("renders through the page and the stored page keeps its typed cards", async () => {
    const stored = { content: [{ type: "ComingUp", props: { id: "c", ...BLOCK_DEFAULTS.ComingUp, source: "live", items: typed } }], root: {} };
    const resolved = await resolveLiveBlocks(stored, { stats: async () => ({}), schedule: async () => ({ prickles: [], writingNow: null }), comingUp: async () => ({ events: [{ ...cards[0], startTime: "2099-01-01T00:00:00Z" }] }) }, new Date("2026-11-19T15:00:00Z"));
    render(<LandingRender data={resolved} />);
    expect(screen.getByText("Lakeside Retreat")).toBeInTheDocument();
    expect(JSON.stringify(stored)).not.toContain("Lakeside");
    expect(JSON.stringify(sanitizeLandingData(stored))).not.toContain("Lakeside");
  });

  it("is typed by default, labels every field in plain words and lists every kind of event to choose from", () => {
    expect(BLOCK_DEFAULTS.ComingUp).toMatchObject({ source: "manual", kinds: [], max: 4 });
    const f = editorConfig.components.ComingUp.fields as unknown as Record<string, { type: string; label?: string; options?: { label: string }[] }>;
    expect(f.source.options!.map((o) => o.label)).toEqual(["Typed in by hand", "Live from the Hub"]);
    expect(f.source.label).toMatch(/live shows on the published page/i);
    for (const key of ["heading", "source", "kinds", "max", "more"]) expect(f[key].label, key).toBeTruthy();
    expect(f.kinds.type).toBe("custom");
  });
});
