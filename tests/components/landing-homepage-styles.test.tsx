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

import { renderToString } from "react-dom/server";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { JourneyMap } from "@/components/landing/homepage-blocks";
import { ComingUp } from "@/modules/events/page-blocks/blocks";
import { BLOCK_DEFAULTS } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";
import { checkLandingPage } from "@/lib/landing/a11y";
import { featuredOfferIndex } from "@/lib/landing/journey";

afterEach(cleanup);

const offer = (title: string, extra: Record<string, unknown> = {}) => ({ status: "open" as const, statusLabel: "", title, text: `About ${title}`, buttonLabel: `See ${title}`, href: `/${title.toLowerCase().replace(/\W+/g, "-")}`, ...extra });
const compare = { label: "", href: "" };

describe("Journey map: a featured offer and an 'Also for' list", () => {
  const drafting = (offers: ReturnType<typeof offer>[]) => [{ name: "Drafting", helps: "", current: true, offers }];

  it("leads with the first offer when none is marked (a page saved before the option), the rest as links", () => {
    render(<JourneyMap stages={drafting([offer("Ready Writer"), offer("The 180"), offer("Feedback Friends")])} compare={compare} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { level: 3, name: "Ready Writer" })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "See Ready Writer" })).toHaveAttribute("href", "/ready-writer");
    // The others are plain rows with a short line and a "See it" link, not headings or cards.
    expect(within(panel).queryByRole("heading", { name: "The 180" })).toBeNull();
    expect(within(panel).getByText("Also for Drafting")).toBeInTheDocument();
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("The 180");
    expect(rows[0]).toHaveTextContent("About The 180");
    expect(within(rows[0]).getByRole("link", { name: "See it The 180"})).toHaveAttribute("href", "/the-180");
    expect(within(rows[1]).getByRole("link", { name: /Feedback Friends/ })).toHaveAttribute("href", "/feedback-friends");
  });

  it("leads with the offer marked featured, wherever it is in the list, and lists the first one beside it", () => {
    render(<JourneyMap stages={drafting([offer("The 180"), offer("Ready Writer", { featured: true, status: "waitlist" })])} compare={compare} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { level: 3, name: "Ready Writer" })).toBeInTheDocument();
    expect(within(panel).getByText("Waitlist")).toBeInTheDocument();
    expect(within(panel).getByRole("listitem")).toHaveTextContent("The 180");
    expect(featuredOfferIndex([{}, { featured: true }, { featured: true }])).toBe(1);
    expect(featuredOfferIndex([{ featured: false }, {}])).toBe(0);
    expect(featuredOfferIndex([{ featured: "yes" }, {}])).toBe(0);
  });

  it("has no 'Also for' list for a stage with one offer, and the same offer may be typed under two stages", () => {
    const stages = [
      { name: "Idea", helps: "", current: true, offers: [offer("Membership")] },
      { name: "Drafting", helps: "", current: false, offers: [offer("Ready Writer"), offer("Feedback Friends")] },
      { name: "Revising", helps: "", current: false, offers: [offer("Academy", { featured: true }), offer("Feedback Friends")] },
    ];
    render(<JourneyMap stages={stages} compare={compare} />);
    expect(within(screen.getByRole("tabpanel")).queryByText(/Also for/)).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("About Membership");
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(within(screen.getByRole("tabpanel")).getByText("Also for Drafting")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(within(screen.getByRole("tabpanel")).getByText("Also for Revising")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Feedback Friends");
  });

  it("draws the panel as one container with a left rail, attached to the stepper, not a stack of bordered cards", () => {
    render(<JourneyMap stages={drafting([offer("Ready Writer"), offer("The 180")])} compare={compare} />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.className).toContain("border-l-8");
    expect(panel.className).toContain("border-t-0");
    expect(panel.querySelectorAll(".shadow-md, .border-t-4")).toHaveLength(0);
  });

  it("has every stage's panel, featured and list, in the HTML a visitor without script (or a crawler) gets", () => {
    const html = renderToString(
      <JourneyMap
        stages={[
          { name: "Drafting", helps: "", current: false, offers: [offer("Ready Writer", { featured: true }), offer("The 180")] },
          { name: "Revising", helps: "", current: true, offers: [offer("Academy"), offer("Feedback Friends")] },
        ]}
        compare={compare}
      />,
    );
    for (const text of ["Ready Writer", "The 180", "Academy", "Feedback Friends", "Also for Drafting", "Also for Revising", "See it"]) expect(html).toContain(text);
    expect(html).not.toContain("<button");
  });

  it("shows no 'See it' link without a safe address, and the featured button disabled", () => {
    render(<JourneyMap stages={drafting([offer("Ready Writer", { href: "" }), offer("The 180", { href: "javascript:x" })])} compare={compare} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("See Ready Writer")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("The 180")).toBeInTheDocument();
  });
});

describe("Coming up: styles", () => {
  const typed = [
    { kind: "Retreat", title: "Typed Retreat", when: "June", availability: "", status: "" as const, linkLabel: "", href: "", date: "2027-06-04", time: "", soldOut: false },
    { kind: "Session", title: "Typed Session", when: "June 5 at 8 pm", availability: "", status: "" as const, linkLabel: "", href: "", date: "2027-06-05", time: "" },
  ];
  const cards = [
    { kind: "Retreat", title: "Spring Retreat", when: "Apr 7 to 11, 2027", availability: "Sold out", linkLabel: "", href: "", soldOut: true, date: "2027-04-07", time: "Apr 7 to 11, 2027", imageAssetId: "media_AAAAAAAAAAAA" },
    { kind: "Virtual retreat", title: "Online Retreat", when: "Dec 12, 10:30 am – 3 pm EST", availability: "3 spots left", linkLabel: "Sign up", href: "https://checkout.example.com/r", soldOut: false, date: "2026-12-12", time: "10:30 am – 3 pm EST", imageAssetId: "" },
  ];
  const waitlist = { label: "", href: "/waitlist" };

  describe("feature", () => {
    it("draws the cover as the tile with white words on a dark shade, and a neutral blush or cream tile without one, never green, plum or brown", () => {
      const { container } = render(<ComingUp style="feature" heading="" items={typed} source="live" live={{ cards }} waitlist={waitlist} />);
      const tiles = container.querySelectorAll("ul > li");
      expect(tiles).toHaveLength(2);
      // With a picture: the library picture at the member Events card's preset, decorative (the title is on the tile), words white over a shade.
      const img = tiles[0].querySelector("img")!;
      expect(img).toHaveAttribute("src", "/api/media/media_AAAAAAAAAAAA/event_card");
      expect(img).toHaveAttribute("alt", "");
      expect(tiles[0].className).toContain("text-white");
      expect(tiles[0].querySelector(".bg-gradient-to-t")).not.toBeNull();
      // Without: a neutral tile with the kind's symbol and dark words.
      expect(tiles[1].querySelector("img")).toBeNull();
      expect(tiles[1].className).toContain("bg-cream");
      expect(tiles[1].className).toContain("text-ink");
      expect(tiles[1].querySelector('[aria-hidden="true"]')).toHaveTextContent("🖥️");
      for (const tile of tiles) expect(tile.className).not.toMatch(/emerald|green|plum|brown/);
      expect(tiles[1].className).not.toContain("bg-cup");
    });

    it("says Sold out or how many spots are left, and a first tile without a picture is blush", () => {
      const { container } = render(<ComingUp style="feature" heading="" items={typed} source="live" live={{ cards: [{ ...cards[1], imageAssetId: "" }, { ...cards[0], imageAssetId: "" }] }} />);
      const tiles = container.querySelectorAll("ul > li");
      expect(tiles[0].className).toContain("bg-blush");
      expect(tiles[0]).toHaveTextContent("3 spots left");
      expect(tiles[1]).toHaveTextContent("Sold out");
      expect(screen.queryByText("Full")).toBeNull();
      cleanup();
      render(<ComingUp style="feature" heading="" items={typed} source="live" live={{ cards: [{ ...cards[1], availability: "1 spot left" }] }} />);
      expect(screen.getByText("1 spot left")).toBeInTheDocument();
    });

    it("shows the waitlist link only on a sold-out event and only when its address is set, with the default label", () => {
      const { rerender } = render(<ComingUp style="feature" heading="" items={typed} source="live" live={{ cards }} waitlist={waitlist} />);
      expect(screen.getAllByRole("link", { name: "Join the waitlist" })).toHaveLength(1);
      expect(screen.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", "/waitlist");
      // The open event keeps its own sign-up link.
      expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "https://checkout.example.com/r");
      rerender(<ComingUp style="feature" heading="" items={typed} source="live" live={{ cards }} waitlist={{ label: "Join the waitlist", href: "" }} />);
      expect(screen.queryByRole("link", { name: "Join the waitlist" })).toBeNull();
      rerender(<ComingUp style="feature" heading="" items={typed} source="live" live={{ cards }} waitlist={{ label: "Join the waitlist", href: "javascript:x" }} />);
      expect(screen.queryByRole("link", { name: "Join the waitlist" })).toBeNull();
      rerender(<ComingUp style="feature" heading="" items={typed} source="live" live={{ cards }} waitlist={{ label: "Get on the list", href: "/waitlist" }} />);
      expect(screen.getByRole("link", { name: "Get on the list" })).toBeInTheDocument();
      rerender(<ComingUp style="feature" heading="" items={typed} source="live" live={{ cards: [cards[1]] }} waitlist={waitlist} />);
      expect(screen.queryByRole("link", { name: "Join the waitlist" })).toBeNull();
    });

    it("draws typed tiles in the same style when nothing is live, with a picture from the library and a sold-out toggle", () => {
      const { container } = render(
        <ComingUp style="feature" heading="Big events" items={[{ ...typed[0], imageAssetId: "media_BBBBBBBBBBBB", soldOut: true }]} source="live" waitlist={waitlist} />,
      );
      expect(container.querySelector("img")).toHaveAttribute("src", "/api/media/media_BBBBBBBBBBBB/event_card");
      expect(screen.getByRole("heading", { level: 4, name: "Typed Retreat" })).toBeInTheDocument();
      // A typed tile says Sold out on its own when it is marked so and has no availability text.
      expect(screen.getByText("Sold out")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Join the waitlist" })).toBeInTheDocument();
    });

    it("is its own container, so its tiles stack in half a column", () => {
      const { container } = render(<ComingUp style="feature" heading="" items={typed} />);
      expect(container.querySelector(".\\@container")).not.toBeNull();
      expect(container.querySelector("ul")!.className).toContain("@pair:grid-cols-2");
    });
  });

  describe("list", () => {
    it("is plain rows with a date tile (a real time element), the title, the time and the kind, headed Upcoming sessions", () => {
      const live = [
        { kind: "Session", title: "Monthly Goal Review", when: "Nov 30, 8 – 9 pm EST", availability: "", linkLabel: "", href: "", date: "2026-11-30", time: "8 – 9 pm EST", soldOut: false, imageAssetId: "" },
        { kind: "Social", title: "Readers Club", when: "Dec 3", availability: "", linkLabel: "", href: "", date: "2026-12-03", time: "", soldOut: false, imageAssetId: "" },
      ];
      const { container } = render(<ComingUp style="list" items={typed} source="live" live={{ cards: live }} more={{ label: "See all events", href: "/events" }} />);
      expect(screen.getByRole("heading", { level: 3, name: "Upcoming sessions" })).toBeInTheDocument();
      const list = container.querySelector("ul")!;
      const rows = within(list).getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      // Not cards.
      expect(container.querySelector(".shadow-sm, .border-t-4, .rounded-xl")).toBeNull();
      const day = rows[0].querySelector("time")!;
      expect(day).toHaveAttribute("datetime", "2026-11-30");
      expect(day).toHaveTextContent("30");
      expect(day).toHaveTextContent("Nov");
      expect(within(rows[0]).getByRole("heading", { level: 4, name: "Monthly Goal Review" })).toBeInTheDocument();
      expect(rows[0]).toHaveTextContent("8 – 9 pm EST");
      expect(rows[0]).toHaveTextContent("Session");
      // A live event's `when` repeats the day on the tile, so a row with no time shows only the kind.
      expect(rows[1].querySelector("time")).toHaveAttribute("datetime", "2026-12-03");
      expect(rows[1]).not.toHaveTextContent("Dec 3");
      expect(screen.getByRole("link", { name: "See all events" })).toHaveAttribute("href", "/events");
    });

    it("keeps a heading cleared on purpose empty, and falls back to Upcoming sessions only when it was never set", () => {
      const { rerender } = render(<ComingUp style="list" heading="" items={typed} />);
      // No block heading, so the rows' titles are the section's own (h3).
      expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Typed Retreat", "Typed Session"]);
      rerender(<ComingUp style="list" heading="Sessions near you" items={typed} />);
      expect(screen.getByRole("heading", { level: 3, name: "Sessions near you" })).toBeInTheDocument();
      rerender(<ComingUp style="list" items={typed} />);
      expect(screen.getByRole("heading", { level: 3, name: "Upcoming sessions" })).toBeInTheDocument();
    });

    it("draws typed rows the same way, with the dates and place under the title when there is no time, and no tile without a valid day", () => {
      render(<ComingUp style="list" items={[...typed, { ...typed[0], title: "No Day", date: "soon" }, { ...typed[0], title: "Bad Month", date: "2027-13-01" }]} />);
      const rows = screen.getAllByRole("listitem");
      expect(rows[1]).toHaveTextContent("June 5 at 8 pm");
      expect(rows[1].querySelector("time")).toHaveTextContent("5");
      expect(rows[2].querySelector("time")).toBeNull();
      expect(rows[3].querySelector("time")).toBeNull();
    });

    it("links only to a safe address and ends the list with the typed link, with no link when its address is unsafe", () => {
      const { rerender } = render(<ComingUp style="list" items={[{ ...typed[1], linkLabel: "Details", href: "/s" }]} more={{ label: "See all events", href: "javascript:x" }} />);
      expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute("href", "/s");
      expect(screen.queryByRole("link", { name: "See all events" })).toBeNull();
      rerender(<ComingUp style="list" items={[{ ...typed[1], linkLabel: "Details", href: "javascript:x" }]} />);
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  describe("cards (no style)", () => {
    it("is the original look for a block saved without a style, and for an unknown one", () => {
      const item = { kind: "Retreat", title: "Cabin week", when: "June", availability: "6 spots left", status: "open" as const, linkLabel: "Details", href: "/retreat" };
      const { container } = render(<ComingUp heading="Coming up" items={[item]} />);
      const li = container.querySelector("ul > li")!;
      expect(li.className).toContain("border-t-4");
      expect(li.className).toContain("bg-card");
      expect(container.querySelector("time")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByRole("heading", { level: 4, name: "Cabin week" })).toBeInTheDocument();
      const first = container.innerHTML;
      cleanup();
      const { container: again } = render(<ComingUp heading="Coming up" items={[item]} style={"nonsense" as never} />);
      expect(again.innerHTML).toBe(first);
      cleanup();
      const { container: explicit } = render(<ComingUp heading="Coming up" items={[item]} style="cards" />);
      expect(explicit.innerHTML).toBe(first);
    });

    it("does not show a waitlist link", () => {
      render(<ComingUp heading="" items={typed} source="live" live={{ cards }} waitlist={waitlist} />);
      expect(screen.queryByRole("link", { name: "Join the waitlist" })).toBeNull();
    });
  });

  it.each(["cards", "feature", "list"] as const)("shows live events in %s, and the typed ones when live is missing, empty or off", (style) => {
    const { rerender } = render(<ComingUp style={style} heading="" items={typed} source="live" live={{ cards }} />);
    expect(screen.getByText("Spring Retreat")).toBeInTheDocument();
    expect(screen.queryByText("Typed Retreat")).toBeNull();
    rerender(<ComingUp style={style} heading="" items={typed} source="live" />);
    expect(screen.getByText("Typed Retreat")).toBeInTheDocument();
    rerender(<ComingUp style={style} heading="" items={typed} source="live" live={{ cards: [] }} />);
    expect(screen.getByText("Typed Retreat")).toBeInTheDocument();
    rerender(<ComingUp style={style} heading="" items={typed} source="manual" live={{ cards }} />);
    expect(screen.getByText("Typed Retreat")).toBeInTheDocument();
    expect(screen.queryByText("Spring Retreat")).toBeNull();
    rerender(<ComingUp style={style} heading="" items={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("the editor's fields for the new options", () => {
  type F = { type: string; label?: string; options?: { label: string; value: unknown }[]; arrayFields?: Record<string, F>; objectFields?: Record<string, F> };
  const comingUp = editorConfig.components.ComingUp.fields as unknown as Record<string, F>;
  const offers = ((editorConfig.components.JourneyMap.fields as unknown as Record<string, F>).stages.arrayFields!.offers as F).arrayFields!;

  it("labels every new field in plain words and offers the three styles", () => {
    expect(comingUp.style.label).toBeTruthy();
    expect(comingUp.style.options!.map((o) => o.value)).toEqual(["cards", "feature", "list"]);
    expect(comingUp.waitlist.label).toBeTruthy();
    expect(Object.values(comingUp.waitlist.objectFields!).every((f) => f.label)).toBe(true);
    for (const key of ["date", "time", "imageAssetId", "soldOut"]) expect(comingUp.items.arrayFields![key].label, key).toBeTruthy();
    expect(offers.featured.label).toMatch(/first leads/i);
  });

  it("starts a dropped Coming up as cards with the default waitlist label, so nothing saved changes", () => {
    expect(BLOCK_DEFAULTS.ComingUp).toMatchObject({ style: "cards", waitlist: { label: "Join the waitlist", href: "" } });
  });
});

describe("publish checks for the new options", () => {
  const page = (...blocks: unknown[]) => ({ content: [{ type: "Heading", props: { id: "h", text: "Home", level: "h1" } }, { type: "Heading", props: { id: "h2", text: "Next step", level: "h2" } }, ...blocks], root: {} });
  const map = (offers: unknown[]) => ({ type: "JourneyMap", props: { id: "m", stages: [{ name: "Drafting", offers }], compare: {} } });
  const messages = (data: unknown) => checkLandingPage(data).map((i) => `${i.severity}: ${i.message}`);

  it("counts only the featured offer's title as the stage's heading, so no heading level is skipped", () => {
    const issues = messages(page(map([{ title: "Ready Writer", buttonLabel: "See it", href: "/a" }, { title: "The 180", buttonLabel: "See it", href: "/b" }, { title: "Friends", buttonLabel: "See it", href: "/c" }])));
    expect(issues).toEqual([]);
  });

  it("still stops a publish for an offer with a button label and no usable link, featured or not", () => {
    const issues = messages(page(map([{ title: "Ready Writer", buttonLabel: "See Ready Writer", href: "/a" }, { title: "The 180", buttonLabel: "See The 180 Program", href: "" }])));
    expect(issues).toEqual([expect.stringContaining('error: The "The 180" button in Drafting')]);
  });

  it("counts a list's heading the way the block draws it, and does not ask for a waitlist link", () => {
    const list = (props: Record<string, unknown>) => ({ type: "ComingUp", props: { id: "c", style: "list", items: [{ title: "Readers Club" }], waitlist: { label: "Join the waitlist", href: "" }, ...props } });
    expect(messages(page(list({})))).toEqual([]);
    expect(messages(page(list({ heading: "" })))).toEqual([]);
    const jump = { content: [{ type: "Heading", props: { id: "h", text: "Home", level: "h1" } }, list({})], root: {} };
    // No heading before it: the never-set heading is an h3 under the page's h1, which skips a level, as it would on the page.
    expect(messages(jump).some((m) => m.includes("Upcoming sessions") && m.includes("skips a level"))).toBe(true);
  });
});
