import { describe, it, expect } from "vitest";
import { BLOCK_DEFAULTS } from "@/components/landing/config";
import { checkLandingPage } from "@/lib/landing/a11y";
import { collectAssetIds, normalizeLandingData } from "@/lib/landing/data";
import { normalizePadding, PADDING_DEFAULT_DESKTOP, presetOf } from "@/lib/landing/layout";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { FEATURED_COURSE } from "@/lib/config";
import { LANDING_STARTERS, STARTER_KEYS, isStarterKey, starterData } from "@/lib/landing/starters";
import { isValidSlug } from "@/lib/landing/slug";

type Node = { type: string; props: Record<string, unknown> };

function blocks(content: unknown[]): Node[] {
  return content.flatMap((raw) => {
    const node = raw as Node;
    // Blocks sit in any slot: a Section's `content`, a Columns' `col1` to `col3`.
    const kids = Object.values(node.props).flatMap((v) => (Array.isArray(v) && v.length > 0 && v.every((k) => k && typeof k === "object" && "type" in k && "props" in k) ? blocks(v) : []));
    return [node, ...kids];
  });
}

describe.each(STARTER_KEYS)("the %s starter", (key) => {
  const data = starterData(key);
  const all = blocks(data.content);

  it("has a valid address and a title", () => {
    expect(isValidSlug(LANDING_STARTERS[key].slug)).toBe(true);
    expect(LANDING_STARTERS[key].title.trim()).not.toBe("");
  });

  it("uses only blocks and props the builder has, with a unique id on each", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const block of all) {
      const defaults = BLOCK_DEFAULTS[block.type as keyof typeof BLOCK_DEFAULTS];
      expect(defaults, `unknown block ${block.type}`).toBeDefined();
      for (const prop of Object.keys(block.props)) expect(prop === "id" || prop === "content" || /^col[123]$/.test(prop) || prop in defaults, `${block.type}.${prop}`).toBe(true);
    }
    const ids = all.map((b) => b.props.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is unchanged by the sanitizer and the schema migrations, so it is stored as written", () => {
    expect(sanitizeLandingData(data)).toEqual(normalizeLandingData(data));
  });

  it("holds no picture, so nothing is invented and no asset is made public", () => {
    expect(collectAssetIds(data)).toEqual([]);
  });

  it("has exactly one h1", () => {
    const h1 = all.filter((b) => (b.type === "Hero" || b.type === "Heading") && b.props.level === "h1");
    expect(h1).toHaveLength(1);
  });

  it("is a fresh copy each time", () => {
    expect(starterData(key)).toEqual(data);
    expect(starterData(key)).not.toBe(data);
  });
});

describe("the homepage starter", () => {
  it("leaves the buttons' links and the Kajabi form empty, so the publish check asks for them, and has no other error", () => {
    const issues = checkLandingPage(starterData("home"));
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    // Only an empty link or address, or the sign-up form's empty Kajabi form id (the owner picks the form in the editor).
    expect(errors.every((e) => /has no link|no address|no Kajabi form chosen/i.test(e.message))).toBe(true);
    expect(errors.some((e) => e.block === "Sign-up form")).toBe(true);
    expect(issues.filter((i) => i.severity === "warning")).toEqual([]);
  });

  it("gives each Journey map stage its programs, one of them featured, with the current stage Revising and no block-level offer", () => {
    const map = blocks(starterData("home").content).find((b) => b.type === "JourneyMap")!;
    expect("offer" in map.props).toBe(false);
    type Offer = { title: string; status: string; statusLabel: string; text: string; buttonLabel: string; href: string; featured: boolean };
    const stages = map.props.stages as { name: string; current: boolean; note: string; offers: Offer[] }[];
    expect(stages.map((s) => [s.name, s.offers.map((o) => o.title)])).toEqual([
      ["Idea", ["Membership"]],
      ["Drafting", ["The Ready Writer", "The 180 Program (Accelerated)", "Best Feedback Friends"]],
      ["Revising", ["Self-Editing Academy", "Best Feedback Friends"]],
      ["Sharing", ["Retreats and Virtual Retreats"]],
      ["Published", []],
    ]);
    // The lead program of each stage is marked; the others are the "Also for" list.
    expect(stages.map((s) => s.offers.filter((o) => o.featured).map((o) => o.title))).toEqual([["Membership"], ["The Ready Writer"], ["Self-Editing Academy"], ["Retreats and Virtual Retreats"], []]);
    expect(stages.filter((s) => s.current).map((s) => s.name)).toEqual(["Revising"]);
    expect(stages[4].note).toBe("When you type THE END, you become a Finisher, and the whole house celebrates.");
    const offers = stages.flatMap((s) => s.offers);
    expect(stages[0].offers[0].status).toBe("open");
    expect(stages[1].offers[0]).toMatchObject({ status: "waitlist", href: FEATURED_COURSE.offerUrl });
    // The rest are open, with no status text; only the Ready Writer has a link, so the publish check asks for the others.
    expect(offers.filter((o) => o.title !== "The Ready Writer").every((o) => o.status === "open" && o.statusLabel === "")).toBe(true);
    expect(offers.filter((o) => o.href).map((o) => o.title)).toEqual(["The Ready Writer"]);
    // Written copy and buttons that say what happens: no placeholders left.
    for (const o of offers) {
      expect(o.text.length, o.title).toBeGreaterThan(20);
      expect(o.buttonLabel, o.title).toMatch(/^See /);
    }
    expect(JSON.stringify(map.props)).not.toMatch(/\[Status\]|\[One-line|\bFull\b/);
    // A program typed under two stages reads the same under both.
    const friends = offers.filter((o) => o.title === "Best Feedback Friends");
    expect(friends).toHaveLength(2);
    expect(friends[0].text).toBe(friends[1].text);
    // No prices, dates or invented facts in the copy.
    expect(offers.map((o) => o.text).join(" ")).not.toMatch(/\$|\d{4}|weekend|guarantee|best|#1/i);
  });

  it("says membership is included only for the programs that include it", () => {
    const map = blocks(starterData("home").content).find((b) => b.type === "JourneyMap")!;
    const offers = (map.props.stages as { offers: { title: string; text: string }[] }[]).flatMap((s) => s.offers);
    const text = (title: string) => offers.find((o) => o.title === title)!.text;
    expect(text("The Ready Writer")).toMatch(/membership is included/i);
    expect(text("The 180 Program (Accelerated)")).toMatch(/membership included/i);
    expect(text("Self-Editing Academy")).not.toMatch(/membership/i);
  });


  it("opens with the strip, then a plum band with the pitch beside the schedule, and builds each new block once", () => {
    const content = starterData("home").content as Node[];
    expect(content[0].type).toBe("AnnouncementStrip");
    const band = content[1];
    expect(band.type).toBe("Section");
    expect(band.props.background).toBe("plum");
    const [columns] = band.props.content as Node[];
    expect(columns.type).toBe("Columns");
    expect(columns.props.count).toBe("2");
    expect((columns.props.col1 as Node[]).map((b) => b.type)).toEqual(["Heading", "RichText", "ButtonRow", "RichText"]);
    expect((columns.props.col1 as Node[])[0].props.level).toBe("h1");
    expect((columns.props.col2 as Node[]).map((b) => b.type)).toEqual(["SchedulePanel"]);
    expect(columns.props.col3).toEqual([]);
    expect(blocks(content).map((b) => b.type)).not.toContain("Hero");
    const types = blocks(content).map((b) => b.type);
    for (const type of ["SchedulePanel", "OutcomeNumbers", "FinisherCards", "Timeline", "WeekStrip", "FinishLineCards", "PlanPhases", "JourneyMap", "OptInForm"]) {
      expect(types.filter((t) => t === type), type).toHaveLength(1);
    }
    // Coming up sits on a white band, not a dark one, in two columns: big events as feature tiles, sessions as a list. Both live from the Hub.
    const lists = blocks(content).filter((b) => b.type === "ComingUp");
    expect(lists).toHaveLength(2);
    const eventsBand = (content as Node[]).find((b) => b.type === "Section" && blocks([b]).some((n) => n.type === "ComingUp"))!;
    expect(eventsBand.props.background).toBe("white");
    const [columnsOfBand] = (eventsBand.props.content as Node[]).filter((n) => n.type === "Columns");
    expect((columnsOfBand.props.col1 as Node[]).map((b) => [b.type, b.props.style])).toEqual([["ComingUp", "feature"]]);
    expect((columnsOfBand.props.col2 as Node[]).map((b) => [b.type, b.props.style])).toEqual([["ComingUp", "list"]]);
    const [feature, list] = lists;
    expect(feature.props).toMatchObject({ kinds: ["in_person_retreat", "virtual_retreat", "workshop"], max: 2, waitlist: { label: "Join the waitlist", href: "" }, source: "live" });
    expect(list.props).toMatchObject({ heading: "Upcoming sessions", kinds: ["session", "social", "book_launch", "educational", "other"], max: 4, more: { label: "See all events", href: "" }, source: "live" });
    // No kind is in both, and the sold-out word is "Sold out".
    expect((feature.props.kinds as string[]).filter((k) => (list.props.kinds as string[]).includes(k))).toEqual([]);
    expect(JSON.stringify(lists)).not.toContain('"Full"');
    // No dark band anywhere around the events, and the journey map keeps its cream.
    const journey = (content as Node[]).find((b) => b.type === "Section" && blocks([b]).some((n) => n.type === "JourneyMap"))!;
    expect(journey.props.background).toBe("cream");
    expect(["brown", "brownMid", "charcoal", "plum"]).not.toContain(eventsBand.props.background);
  });

  it("keeps the owner's first-week order: courage, write, goal, hello, streak", () => {
    const week = blocks(starterData("home").content as Node[]).find((b) => b.type === "WeekStrip")!;
    expect((week.props.items as { type: string; props: { label: string; text: string } }[]).map((d) => `${d.type} ${d.props.label}: ${d.props.text}`)).toEqual([
      "WeekDay Mon: Drop into a prickle",
      "WeekDay Tue: Write & log progress",
      "WeekDay Wed: Set one small goal",
      "WeekDay Thu: Say hello in chat",
      "WeekDay Fri: Your first streak day",
    ]);
  });

  it("keeps the sections tight: Medium space, with only the closing sign-up airy", () => {
    const sections = (starterData("home").content as Node[]).filter((b) => b.type === "Section");
    const preset = (s: Node) => presetOf(normalizePadding(s.props.paddingDesktop, PADDING_DEFAULT_DESKTOP), "desktop");
    expect(sections.filter((s) => preset(s) === "large")).toHaveLength(1);
    expect(sections.every((s) => preset(s) === "medium" || preset(s) === "large")).toBe(true);
  });

  it("keeps the owner's words: no running jargon, no FAQ, no old slogan, and no joiner counts", () => {
    const json = JSON.stringify(starterData("home"));
    expect(json).not.toMatch(/spark to shelf|\bbib\b|race weekend|lace up|jog|sprint\b|too slow/i);
    expect(blocks(starterData("home").content).map((b) => b.type)).not.toContain("Faq");
    // Typical attendance is small, so a count is neither accurate nor welcoming: never "N joining" or "N writing", never "be the first".
    expect(json).not.toMatch(/\d+ (?:writers |writing |people )?(?:joining|writing)|be the first/i);
    const strip = blocks(starterData("home").content).find((b) => b.type === "AnnouncementStrip")!;
    expect(strip.props.text).toBe("Your next prickle starts in 42 minutes");
  });

  it("links the member sign-in and the three trust pages from paths on this site", () => {
    const json = JSON.stringify(starterData("home"));
    for (const path of ["/login", "/privacy", "/security", "/compliance"]) expect(json).toContain(`"${path}"`);
    // The one address on another site is the featured course's waitlist, read from config, not typed into the starter.
    expect(json.split(FEATURED_COURSE.offerUrl).join("")).not.toMatch(/https?:\/\//);
    expect(json).toContain(FEATURED_COURSE.offerUrl);
  });
});

describe("isStarterKey", () => {
  it("accepts a known key only", () => {
    expect(isStarterKey("home")).toBe(true);
    expect(isStarterKey("nope")).toBe(false);
    expect(isStarterKey(undefined)).toBe(false);
  });
});
