import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KAJABI_COURSES_URL, KAJABI_SITE_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { mapKajabiPage } from "@/lib/landing/kajabi-import";
import { importKajabiExport, inspectKajabiExport } from "@/lib/landing/kajabi-import-service";
import {
  defaultLookupFetchers,
  findCountdownDate,
  offerLinksFrom,
  parseEventTime,
  resolveReferences,
  validOriginalPath,
  type KajabiLookups,
  type LookupFetchers,
} from "@/lib/landing/kajabi-lookups";
import { setNetHooks, type Transport } from "@/lib/net/safe-fetch";
import { block, exportSettings, exportZip } from "@/tests/helpers/kajabi-export";
import { useFakeClock } from "@/tests/helpers/fake-clock";

/** Everything here is made up: ids, paths, offer codes and dates. Nothing was read from a real page or account. */

const OPTIONS = { siteUrl: "https://kajabi.example.test", coursesUrl: "https://courses.example.test", cdnBase: "https://cdn.example.test/prefix", year: 2031 };
type Puck = { type: string; props: Record<string, unknown> };

describe("parseEventTime", () => {
  it("reads an ISO time with its offset, with Z, and with seconds or without", () => {
    expect(parseEventTime("2031-07-19T07:00:00-05:00")).toBe("2031-07-19T12:00:00.000Z");
    expect(parseEventTime("2031-07-19T07:00:00+0200")).toBe("2031-07-19T05:00:00.000Z");
    expect(parseEventTime("2031-07-19T07:00Z")).toBe("2031-07-19T07:00:00.000Z");
  });

  it("reads the ordinal-day form the live page carries (day 200 of 2031 is July 19)", () => {
    expect(parseEventTime("2031-200T07:00:00-05:00")).toBe("2031-07-19T12:00:00.000Z");
    expect(parseEventTime("2032-366T00:00:00Z")).toBe("2032-12-31T00:00:00.000Z"); // a leap year has a 366th day
  });

  it("takes a time with no offset as the organization's time, either side of the daylight saving change", () => {
    expect(parseEventTime("2031-01-10T09:00")).toBe("2031-01-10T14:00:00.000Z"); // EST, UTC-5
    expect(parseEventTime("2031-07-10T09:00")).toBe("2031-07-10T13:00:00.000Z"); // EDT, UTC-4
    expect(parseEventTime("2031-03-09T01:30")).toBe("2031-03-09T06:30:00.000Z"); // the Sunday the clocks go forward, before 2:00
    expect(parseEventTime("2031-03-09T12:00")).toBe("2031-03-09T16:00:00.000Z"); // and after
  });

  it("refuses what is not a real time", () => {
    for (const bad of ["", "tomorrow", "2031-02-30T07:00:00Z", "2031-13-01T07:00Z", "2031-366T07:00Z", "2031-000T07:00Z", "2031-07-19T25:00Z", "1999-01-01T00:00Z", "2031-07-19"]) expect(parseEventTime(bad), bad).toBeNull();
  });
});

const PAGE = (event: string, extra = "") => `<html><body><div class="x"><div class="event" kjb-settings-id="sections_S1_blocks_B1_settings_event"
  data-event-time="${event}"
  data-offset-number="${extra}"
  data-offset-period="">
  <div class="countdown"></div></div></div></body></html>`;

describe("findCountdownDate", () => {
  it("reads the date of the countdown block with the given ids", () => {
    expect(findCountdownDate(PAGE("2031-200T07:00:00-05:00"), "S1", "B1")).toEqual({ at: "2031-07-19T12:00:00.000Z" });
  });

  it("says why it cannot: another page, an offset, no date, a date it can't read, ids that aren't ids", () => {
    expect(findCountdownDate(PAGE("2031-07-19T07:00Z"), "S1", "OTHER")).toEqual({ problem: expect.stringContaining("no countdown like this one") });
    expect(findCountdownDate(PAGE("2031-07-19T07:00Z", "3"), "S1", "B1")).toEqual({ problem: expect.stringContaining("relative to another time") });
    expect(findCountdownDate(PAGE(""), "S1", "B1")).toEqual({ problem: expect.stringContaining("has no date") });
    expect(findCountdownDate(PAGE("soon"), "S1", "B1")).toEqual({ problem: expect.stringContaining("isn't in a form we can read") });
    expect(findCountdownDate(PAGE("2031-07-19T07:00Z"), 'S1"', "B1")).toEqual({ problem: expect.stringContaining("not ones the live page uses") });
  });
});

describe("validOriginalPath", () => {
  it("accepts a plain path on the site and nothing that could go elsewhere", () => {
    expect(validOriginalPath(" /example-program ")).toBe("/example-program");
    expect(validOriginalPath("/a/b_c-1")).toBe("/a/b_c-1");
    for (const bad of ["", "example", "//evil.test/x", "https://evil.test/x", "/a//b", "/a?x=1", "/a#b", "/..", "/resource_redirect/landing_pages/1", "/api/x", "/a b", `/${"a".repeat(130)}`]) expect(validOriginalPath(bad), bad).toBeNull();
  });
});

describe("offerLinksFrom", () => {
  const offer = (checkout: unknown) => ({ data: { attributes: { checkout_url: checkout } } });
  it("takes the checkout address of the offers asked for, whose address ends in their code", () => {
    const links = offerLinksFrom([offer("https://kajabi.example.test/offers/AbC123"), offer("https://kajabi.example.test/offers/OTHER1"), offer("https://kajabi.example.test/elsewhere/AbC123"), offer(null), offer("not a link"), { data: null }, offer("http://kajabi.example.test/offers/Plain1")], ["AbC123", "Plain1"]);
    expect(links).toEqual({ AbC123: "https://kajabi.example.test/offers/AbC123" }); // http is not kept
  });
});

describe("resolveReferences", () => {
  const fake = useFakeClock(() => Date.parse("2031-05-10T16:00:00.000Z"));
  const fetchers = (final: Record<string, string | null>, pages: Record<string, string | null> = {}): LookupFetchers & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      finalUrl: async (url) => (asked.push(url), final[new URL(url).pathname.split("/").pop()!] ?? null),
      html: async (url) => (asked.push(url), pages[new URL(url).pathname] ?? null),
    };
  };
  const refs = (over: Partial<Parameters<typeof resolveReferences>[0]> = {}) => ({ landingPageIds: [], offerCodes: [], countdowns: [], ...over });
  const deps = (f: LookupFetchers) => ({ fetchers: f, siteUrl: "https://kajabi.example.test" });

  it("turns a landing page id into the path its redirect ends at, only on the Kajabi site's own host (www or not)", async () => {
    const f = fetchers({ "11": "https://kajabi.example.test/example-waitlist/", "12": "https://www.kajabi.example.test/example-trial", "13": "https://evil.test/x", "14": "http://kajabi.example.test/x", "15": "https://kajabi.example.test/", "16": "https://kajabi.example.test/resource_redirect/landing_pages/9", "17": null });
    const out = await resolveReferences(refs({ landingPageIds: ["11", "12", "13", "14", "15", "16", "17", "not-a-number"] }), {}, deps(f));
    expect(out.pagePaths).toEqual({ "11": "/example-waitlist", "12": "/example-trial" });
    expect(f.asked.every((u) => u.startsWith("https://kajabi.example.test/resource_redirect/landing_pages/"))).toBe(true);
    expect(f.asked).toHaveLength(7); // the id that isn't a number is never asked for
  });

  it("asks for at most twenty pages", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => String(100 + i));
    const f = fetchers({});
    await resolveReferences(refs({ landingPageIds: ids }), {}, deps(f));
    expect(f.asked).toHaveLength(20);
  });

  it("reads the offers only when the export links to one, and survives a read that fails", async () => {
    let reads = 0;
    const offers = async () => (reads++, [{ data: { attributes: { checkout_url: "https://kajabi.example.test/offers/Code1" } } }]);
    expect((await resolveReferences(refs(), {}, { ...deps(fetchers({})), offers })).offerLinks).toEqual({});
    expect(reads).toBe(0);
    expect((await resolveReferences(refs({ offerCodes: ["Code1", "Missing"] }), {}, { ...deps(fetchers({})), offers })).offerLinks).toEqual({ Code1: "https://kajabi.example.test/offers/Code1" });
    const broken = await resolveReferences(refs({ offerCodes: ["Code1"] }), {}, { ...deps(fetchers({})), offers: async () => Promise.reject(new Error("down")) });
    expect(broken.offerLinks).toEqual({});
  });

  const countdown = { key: "S1:B1", sectionKey: "S1", blockKey: "B1", eventId: "E1" };
  it("copies a countdown's date from the page the admin named, saying when it was read and whether it has passed", async () => {
    const f = fetchers({}, { "/example-program": PAGE("2031-200T07:00:00-05:00") });
    const out = await resolveReferences(refs({ countdowns: [countdown] }), { originalPath: "/example-program" }, deps(f));
    expect(out.countdowns["S1:B1"]).toEqual({ ok: true, at: "2031-07-19T12:00:00.000Z", path: "/example-program", readOn: "May 10, 2031", past: false });
    expect(f.asked).toEqual(["https://kajabi.example.test/example-program"]);
    fake.clock.advance(100 * 86_400_000);
    const later = await resolveReferences(refs({ countdowns: [countdown] }), { originalPath: "/example-program" }, deps(fetchers({}, { "/example-program": PAGE("2031-200T07:00:00-05:00") })));
    expect(later.countdowns["S1:B1"]).toMatchObject({ ok: true, past: true });
  });

  it("falls back, with the reason, when no path was given, it is not a path, the page can't be read or has no such countdown", async () => {
    const reason = async (originalPath: string | undefined, pages: Record<string, string | null> = {}) => {
      const out = await resolveReferences(refs({ countdowns: [countdown] }), { originalPath }, deps(fetchers({}, pages)));
      const found = out.countdowns["S1:B1"];
      return found.ok ? "ok" : found.problem;
    };
    expect(await reason(undefined)).toBe("no page address was given");
    expect(await reason("https://evil.test/x")).toBe("that isn't a page address on the Kajabi site");
    expect(await reason("/gone")).toBe("the live page /gone couldn't be read");
    expect(await reason("/other", { "/other": "<html></html>" })).toContain("no countdown like this one");
  });
});

describe("the default fetchers", () => {
  const seen: string[] = [];
  const transport =
    (answer: (url: URL) => { status: number; location?: string; body?: string }): Transport =>
    async (req) => {
      seen.push(req.url.href);
      const a = answer(req.url);
      return { status: a.status, headers: { "content-type": "text/html", ...(a.location ? { location: a.location } : {}) }, body: (async function* () { yield Buffer.from(a.body ?? ""); })(), destroy: () => {} };
    };
  beforeEach(() => {
    seen.length = 0;
  });
  afterEach(() => setNetHooks());

  it("follows a redirect to where it ends without downloading the page, and gives up on an error page", async () => {
    setNetHooks({ resolve: async () => [{ address: "93.184.216.34" }], transport: transport((u) => (u.pathname.startsWith("/resource_redirect") ? { status: 302, location: "/example-page" } : { status: 200, body: "x".repeat(10) })) });
    expect(await defaultLookupFetchers.finalUrl("https://kajabi.example.test/resource_redirect/landing_pages/1")).toBe("https://kajabi.example.test/example-page");
    setNetHooks({ resolve: async () => [{ address: "93.184.216.34" }], transport: transport(() => ({ status: 404 })) });
    expect(await defaultLookupFetchers.finalUrl("https://kajabi.example.test/resource_redirect/landing_pages/2")).toBeNull();
  });

  it("reads a page's HTML, refuses a private address and plain http, and says nothing about a failure", async () => {
    setNetHooks({ resolve: async () => [{ address: "93.184.216.34" }], transport: transport(() => ({ status: 200, body: "<p>hello</p>" })) });
    expect(await defaultLookupFetchers.html("https://kajabi.example.test/example-page")).toBe("<p>hello</p>");
    expect(await defaultLookupFetchers.html("http://kajabi.example.test/example-page")).toBeNull();
    setNetHooks({ resolve: async () => [{ address: "10.0.0.5" }], transport: transport(() => ({ status: 200, body: "secret" })) });
    expect(await defaultLookupFetchers.html("https://kajabi.example.test/example-page")).toBeNull();
    expect(seen).toHaveLength(1);
  });
});

// ---- the mapper with what was looked up ------------------------------------------------------------------------

const lookups = (over: Partial<KajabiLookups> = {}): KajabiLookups => ({ pagePaths: {}, offerLinks: {}, countdowns: {}, ...over });

/** A page whose one extra section holds these blocks. Returns the blocks of that section and the result. */
function page(blocks: Record<string, ReturnType<typeof block>>, found?: KajabiLookups) {
  const settings = exportSettings({ order: ["more"], sections: { more: { type: "section", settings: {}, block_order: Object.keys(blocks), blocks } } });
  const result = mapKajabiPage(settings, { ...OPTIONS, lookups: found });
  if (!result.ok) throw new Error(result.error);
  const section = result.data.content.at(-1) as Puck;
  // The header's picture opens the first section; it is not what these tests look at.
  return { result, inner: (section.props.content as Puck[]).filter((b) => b.type !== "Image"), notes: result.notes };
}
const has = (notes: { kind: string; text: string }[], kind: string, text: string) => notes.some((n) => n.kind === kind && n.text.includes(text));
const cta = (label: string, action: string) => block("cta", { btn_text: label, btn_action: action });

describe("links to Kajabi pages", () => {
  const blocks = { a: cta("Join", "/resource_redirect/landing_pages/11"), b: cta("Again", "/resource_redirect/landing_pages/11"), c: cta("Trial", "/resource_redirect/landing_pages/12") };

  it("lists the pages it would like looked up, without looking anything up itself", () => {
    const { result, inner, notes } = page(blocks);
    expect(result.references.landingPageIds).toEqual(["11", "12"]);
    expect(inner.map((b) => b.props.href)).toEqual(["https://kajabi.example.test/resource_redirect/landing_pages/11", "https://kajabi.example.test/resource_redirect/landing_pages/11", "https://kajabi.example.test/resource_redirect/landing_pages/12"]);
    expect(has(notes, "approximated", "goes to a Kajabi path")).toBe(true); // today's note, as before
  });

  it("links to the address the lookup found, and keeps today's link and note for one it did not find", () => {
    const { inner, notes } = page(blocks, lookups({ pagePaths: { "11": "/example-waitlist" } }));
    expect(inner.map((b) => b.props.href)).toEqual(["/example-waitlist", "/example-waitlist", "https://kajabi.example.test/resource_redirect/landing_pages/12"]);
    expect(has(notes, "approximated", "now go to the address Kajabi sends them to: /example-waitlist (2 links)")).toBe(true);
    expect(has(notes, "approximated", 'Button "Trial" goes to a Kajabi path')).toBe(true);
    expect(has(notes, "approximated", 'Button "Join" goes to a Kajabi path')).toBe(false);
  });
});

describe("links to Kajabi offers", () => {
  const blocks = { a: cta("Buy", "/resource_redirect/offers/Known1"), b: cta("Other", "/resource_redirect/offers/Unknown2"), c: cta("Plain", "https://example.com/x") };

  it("goes to the offer's checkout page when the Hub knows the offer, and to the courses site's redirect (from config) when it does not", () => {
    const { result, inner, notes } = page(blocks, lookups({ offerLinks: { Known1: "https://kajabi.example.test/offers/Known1" } }));
    expect(result.references.offerCodes).toEqual(["Known1", "Unknown2"]);
    expect(inner.map((b) => b.props.href)).toEqual(["https://kajabi.example.test/offers/Known1", "https://courses.example.test/resource_redirect/offers/Unknown2", "https://example.com/x"]);
    expect(has(notes, "approximated", "Offer links: 1 now go to the offer's checkout page")).toBe(true);
    expect(has(notes, "approximated", "Offer links: 1 go to the offer through the courses site (https://courses.example.test)")).toBe(true);
  });

  it("uses the courses site for every offer when nothing was looked up", () => {
    const { inner } = page(blocks);
    expect(inner.slice(0, 2).map((b) => b.props.href)).toEqual(["https://courses.example.test/resource_redirect/offers/Known1", "https://courses.example.test/resource_redirect/offers/Unknown2"]);
  });

  it("leaves a redirect it doesn't recognise as it was", () => {
    const { inner } = page({ a: cta("Odd", "/resource_redirect/offers/a?b=1") });
    expect(inner[0].props.href).toBe("https://kajabi.example.test/resource_redirect/offers/a?b=1");
  });
});

describe("the sign-up form", () => {
  const form = (id: unknown) => block("form", { form: id, text: "<p>Join</p>", btn_text: "Go", thank_you: "" });
  const props = (id: unknown) => page({ f: form(id) }).inner.find((b) => b.type === "OptInForm")!.props;

  it("is connected to the Kajabi form the export names", () => {
    expect(props("2148899385").kajabiFormId).toBe("2148899385");
    expect(props(2148899385).kajabiFormId).toBe("2148899385");
  });

  it("is left to choose, with the to-do, when the export names no form or one that isn't an id", () => {
    for (const id of ["", "abc", "12 34", undefined]) {
      const { inner, notes } = page({ f: form(id) });
      expect(inner.find((b) => b.type === "OptInForm")!.props.kajabiFormId, String(id)).toBe("");
      expect(has(notes, "todo", "Choose the Kajabi form")).toBe(true);
    }
  });
});

describe("a countdown with its date looked up", () => {
  const blocks = { c1: block("countdown", { event: "EV1" }) };
  const where = "more:c1";

  it("asks for the date by where the block is", () => {
    const { result } = page(blocks);
    expect(result.references.countdowns).toEqual([{ key: where, sectionKey: "more", blockKey: "c1", eventId: "EV1" }]);
  });

  it("takes the date and says where and when it came from", () => {
    const { inner, notes } = page(blocks, lookups({ countdowns: { [where]: { ok: true, at: "2031-07-19T12:00:00.000Z", path: "/example-program", readOn: "May 10, 2031", past: false } } }));
    expect(inner[0].props.targetAt).toBe("2031-07-19T12:00:00.000Z");
    expect(has(notes, "approximated", "copied from the live Kajabi page /example-program on May 10, 2031: July 19, 2031 at 8:00 AM EDT")).toBe(true);
    expect(has(notes, "todo", "Countdown")).toBe(false);
    expect(has(notes, "approximated", "has passed")).toBe(false);
  });

  it("says a date that has passed shows zeros", () => {
    const { notes } = page(blocks, lookups({ countdowns: { [where]: { ok: true, at: "2031-07-19T12:00:00.000Z", path: "/p", readOn: "August 1, 2031", past: true } } }));
    expect(has(notes, "approximated", "That time has passed, so the countdown shows zeros")).toBe(true);
  });

  it("keeps the to-do, with the reason, when the date could not be had", () => {
    const { inner, notes } = page(blocks, lookups({ countdowns: { [where]: { ok: false, problem: "no page address was given" } } }));
    expect(inner[0].props.targetAt).toBe("");
    expect(has(notes, "todo", "couldn't be copied from the live page: no page address was given")).toBe(true);
  });
});

// ---- the import service, end to end with a fake site -------------------------------------------------------------

describe("importKajabiExport looks up what the export names", () => {
  const storage = { from: () => ({ upload: async () => ({ error: null }) }) } as never;
  const zip = () =>
    exportZip(
      exportSettings({
        order: ["more"],
        sections: {
          more: {
            type: "section",
            settings: {},
            block_order: ["c1", "b1", "b2", "b3", "f1"],
            blocks: {
              c1: block("countdown", { event: "EV1" }),
              b1: cta("Join", "/resource_redirect/landing_pages/11"),
              b2: cta("Buy", "/resource_redirect/offers/Known1"),
              b3: cta("Buy more", "/resource_redirect/offers/Unknown2"),
              f1: block("form", { form: "555", text: "<p>Hi</p>", btn_text: "Go", thank_you: "" }),
            },
          },
        },
      }),
    );
  const site: LookupFetchers & { asked: string[] } = {
    asked: [],
    finalUrl: async (url) => {
      site.asked.push(url);
      return url.endsWith("/11") ? `${KAJABI_SITE_URL}/example-waitlist` : null;
    },
    html: async (url) => (site.asked.push(url), PAGE("2031-07-19T07:00:00-05:00").replace("S1", "more").replace("B1", "c1")),
  };
  const billing = { kajabiOfferRows: async () => [{ data: { attributes: { checkout_url: `${KAJABI_SITE_URL}/offers/Known1` } } }] as never };

  const run = async (originalPath?: string, over: { lookupFetchers?: LookupFetchers } = {}) => {
    const repos = createInMemoryRepos(new InMemoryDataset());
    const outcome = await importKajabiExport({ pages: repos.landingPages, media: repos.media, storage, billing, lookupFetchers: over.lookupFetchers ?? site }, { archive: zip(), title: "Example", target: { kind: "new" }, userId: null, year: 2031, originalPath });
    const saved = await repos.landingPages.bySlug("example");
    return { outcome, text: JSON.stringify(saved?.draft_data ?? null) };
  };

  it("makes links, offers, the form and the countdown date from the lookups, and says so in the report", async () => {
    site.asked.length = 0;
    const { outcome, text } = await run("/example-program");
    if (outcome.status !== "imported") throw new Error(JSON.stringify(outcome));
    expect(text).toContain(`"href":"${KAJABI_SITE_URL}/offers/Known1"`);
    expect(text).toContain(`"href":"${KAJABI_COURSES_URL}/resource_redirect/offers/Unknown2"`);
    expect(text).toContain('"href":"/example-waitlist"');
    expect(text).toContain('"kajabiFormId":"555"');
    expect(text).toContain('"targetAt":"2031-07-19T12:00:00.000Z"');
    expect(outcome.notes.some((n) => n.text.includes("copied from the live Kajabi page /example-program"))).toBe(true);
    expect(site.asked.some((u) => u.endsWith("/resource_redirect/landing_pages/11"))).toBe(true);
    expect(site.asked.some((u) => u.endsWith("/example-program"))).toBe(true);
  });

  it("keeps the old behaviour, with notes, when nothing can be looked up", async () => {
    const dead: LookupFetchers = { finalUrl: async () => null, html: async () => null };
    const { outcome, text } = await run("/example-program", { lookupFetchers: dead });
    if (outcome.status !== "imported") throw new Error(JSON.stringify(outcome));
    expect(text).toContain(`"href":"${KAJABI_SITE_URL}/resource_redirect/landing_pages/11"`);
    expect(text).toContain('"targetAt":""');
    expect(outcome.notes.some((n) => n.kind === "todo" && n.text.includes("the live page /example-program couldn't be read"))).toBe(true);
  });

  it("does not read the live site for a countdown when no page address is given", async () => {
    site.asked.length = 0;
    const { outcome } = await run();
    if (outcome.status !== "imported") throw new Error("expected an import");
    expect(site.asked.every((u) => u.includes("/resource_redirect/"))).toBe(true);
    expect(outcome.notes.some((n) => n.kind === "todo" && n.text.includes("no page address was given"))).toBe(true);
  });

  it("is read without any request when the export is only inspected, and says how many countdowns it has", async () => {
    site.asked.length = 0;
    const repos = createInMemoryRepos(new InMemoryDataset());
    const outcome = await inspectKajabiExport({ pages: repos.landingPages }, { archive: zip(), year: 2031 });
    expect(outcome).toMatchObject({ status: "inspected", countdowns: 1 });
    expect(site.asked).toEqual([]);
  });
});
