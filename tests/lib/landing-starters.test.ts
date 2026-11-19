import { describe, it, expect } from "vitest";
import { BLOCK_DEFAULTS } from "@/components/landing/config";
import { checkLandingPage } from "@/lib/landing/a11y";
import { collectAssetIds, normalizeLandingData } from "@/lib/landing/data";
import { sanitizeLandingData } from "@/lib/landing/sanitize";
import { LANDING_STARTERS, STARTER_KEYS, isStarterKey, starterData } from "@/lib/landing/starters";
import { isValidSlug } from "@/lib/landing/slug";

type Node = { type: string; props: Record<string, unknown> };

function blocks(content: unknown[]): Node[] {
  return content.flatMap((raw) => {
    const node = raw as Node;
    const kids = Array.isArray(node.props.content) ? blocks(node.props.content) : [];
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
      for (const prop of Object.keys(block.props)) expect(prop === "id" || prop === "content" || prop in defaults, `${block.type}.${prop}`).toBe(true);
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

  it("builds the reviewed homepage: the strip first, then the hero, and each new block once", () => {
    const content = starterData("home").content as Node[];
    expect(content[0].type).toBe("AnnouncementStrip");
    expect(content[1].type).toBe("Hero");
    const types = blocks(content).map((b) => b.type);
    for (const type of ["SchedulePanel", "OutcomeNumbers", "FinisherCards", "Timeline", "WeekStrip", "FinishLineCards", "PlanPhases", "JourneyMap", "ComingUp", "OptInForm"]) {
      expect(types.filter((t) => t === type), type).toHaveLength(1);
    }
  });

  it("keeps the owner's words: no running jargon, no FAQ, no old slogan, and small sample joiner counts", () => {
    const json = JSON.stringify(starterData("home"));
    expect(json).not.toMatch(/spark to shelf|\bbib\b|race weekend|lace up|jog|sprint\b|too slow/i);
    expect(blocks(starterData("home").content).map((b) => b.type)).not.toContain("Faq");
    expect([...json.matchAll(/(\d+) (?:writers )?joining/g)].every((m) => Number(m[1]) <= 5)).toBe(true);
  });

  it("links the member sign-in and the three trust pages from paths on this site", () => {
    const json = JSON.stringify(starterData("home"));
    for (const path of ["/login", "/privacy", "/security", "/compliance"]) expect(json).toContain(`"${path}"`);
    expect(json).not.toMatch(/https?:\/\//);
  });
});

describe("isStarterKey", () => {
  it("accepts a known key only", () => {
    expect(isStarterKey("home")).toBe(true);
    expect(isStarterKey("nope")).toBe(false);
    expect(isStarterKey(undefined)).toBe(false);
  });
});
