import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boxFindingToFinding, compareToBaseline, consoleKey, isEnvironmentNoise, pageRoute, ruleOf, stableTarget, tally, withoutIds, type Baseline } from "@/tests/demo/checks";
import { buildBaseline, checkBaseline } from "@/tests/demo/baseline";

describe("stableTarget", () => {
  it("drops row positions so a longer list today has the same identity as yesterday's", () => {
    expect(stableTarget("li:nth-child(4) > .text-xs")).toBe("li:nth-child(n) > .text-xs");
    expect(stableTarget(".row:nth-of-type(12) span")).toBe(".row:nth-child(n) span");
  });

  it("leaves a selector without positions alone", () => {
    expect(stableTarget("select[data-track=\"filter\"]")).toBe("select[data-track=\"filter\"]");
  });
});

describe("record ids in findings", () => {
  it("are replaced, so a re-seeded database doesn't make every finding new", () => {
    expect(withoutIds("a[href$=\"prkl_gB9UBSUvB7h7\"] b")).toBe("a[href$=\"<id>\"] b");
    expect(stableTarget(".min-w-0[href$=\"prkl_ZarRkjkwwE6T\"] > .text-slate-400")).toBe(".min-w-0[href$=\"<id>\"] > .text-slate-400");
    expect(consoleKey("HTTP 404 /api/mbr_AAAAAAAAAAA1/x")).toBe(consoleKey("HTTP 404 /api/mbr_BBBBBBBBBBB2/x"));
  });

  it("are only the app's ids: words with an underscore, or too short or long a tail, stay", () => {
    expect(withoutIds("data_table_rows")).toBe("data_table_rows");
    expect(withoutIds("prkl_short")).toBe("prkl_short");
    expect(withoutIds("prkl_0OIlinvalidchr")).toBe("prkl_0OIlinvalidchr");
  });
});

describe("pageRoute", () => {
  it("is the path, so a query or a hash is the same page", () => {
    expect(pageRoute("http://localhost:3100/projects?tab=past#top")).toBe("/projects");
    expect(pageRoute("/settings/notifications/")).toBe("/settings/notifications");
    expect(pageRoute("http://localhost:3100/")).toBe("/");
  });

  it("makes every record of one kind one page: app ids, numbers and uuids become :id", () => {
    expect(pageRoute("/projects/prj_gB9UBSUvB7h7")).toBe("/projects/:id");
    expect(pageRoute("/admin/members/mbr_ZarRkjkwwE6T/care")).toBe("/admin/members/:id/care");
    expect(pageRoute("/chat/12345")).toBe("/chat/:id");
    expect(pageRoute("/x/123e4567-e89b-12d3-a456-426614174000")).toBe("/x/:id");
  });

  it("keeps a slug as it is: two help articles are two pages", () => {
    expect(pageRoute("/help/join-a-prickle")).toBe("/help/join-a-prickle");
  });
});

describe("ruleOf", () => {
  it("is the check and the axe rule or box kind, whatever element it was found on", () => {
    expect(ruleOf("a11y:color-contrast:main > p.text-green-600")).toBe("a11y:color-contrast");
    expect(ruleOf("overflow:sticks-out:div > span")).toBe("overflow:sticks-out");
    expect(ruleOf("edge:dialog-cut-off:div[dialog]")).toBe("edge:dialog-cut-off");
  });

  it("is the whole identity for a console message, which has no rule of its own", () => {
    const key = consoleKey("Hydration failed", "error");
    expect(ruleOf(key)).toBe(key);
    expect(consoleKey("A thing", "warning")).not.toBe(consoleKey("A thing", "error"));
  });
});

describe("compareToBaseline", () => {
  const f = (key: string, route = "/p") => ({ key, route });
  const known = { "/p": { "a11y:color-contrast": 2 } };
  const opened = new Set(["/p"]);

  it("passes what the baseline lists, however many steps repeat it", () => {
    const seen = tally([f("a11y:color-contrast:x"), f("a11y:color-contrast:y"), f("a11y:color-contrast:x")]);
    expect(compareToBaseline(seen, known)).toEqual([]);
  });

  it("fails a finding beyond the count, a rule the page doesn't list, and a page that isn't listed", () => {
    const grown = tally([f("a11y:color-contrast:x"), f("a11y:color-contrast:y"), f("a11y:color-contrast:z")]);
    expect(compareToBaseline(grown, known)).toEqual([expect.stringContaining("/p a11y:color-contrast: 3 found, 2 known")]);
    expect(compareToBaseline(tally([f("a11y:label:x")]), known)).toEqual([expect.stringContaining("/p a11y:label: 1 found, 0 known")]);
    expect(compareToBaseline(tally([f("a11y:color-contrast:x", "/other")]), known)).toEqual([expect.stringContaining("/other a11y:color-contrast: 1 found, 0 known")]);
    expect(compareToBaseline(tally([f("a11y:color-contrast:x")]), undefined)).toHaveLength(1);
  });

  it("does not call a missing finding stale without the pages the run opened, nor on a page it never opened", () => {
    expect(compareToBaseline({}, known)).toEqual([]);
    expect(compareToBaseline({}, known, new Set(["/elsewhere"]))).toEqual([]);
  });

  it("is shrink-only: a finding that is gone from a page the run opened has to leave the baseline", () => {
    expect(compareToBaseline({}, known, opened)).toEqual([expect.stringContaining("0 found but 2 known (fixed: delete the entry")]);
    const fewer = tally([f("a11y:color-contrast:x")]);
    expect(compareToBaseline(fewer, known, opened)).toEqual([expect.stringContaining("1 found but 2 known (fixed: lower to 1 the entry")]);
  });

  it("passes a run that finds exactly the baseline, and an empty baseline for a clean run", () => {
    expect(compareToBaseline(tally([f("a11y:color-contrast:x"), f("a11y:color-contrast:y")]), known, opened)).toEqual([]);
    expect(compareToBaseline({}, {}, opened)).toEqual([]);
    expect(compareToBaseline({}, undefined, opened)).toEqual([]);
  });

  it("counts findings without a page as the home page", () => {
    expect(Object.keys(tally([{ key: "a11y:x:y" }]))).toEqual(["/"]);
  });
});

describe("boxFindingToFinding", () => {
  it("sorts page overflow under overflow, and dialog problems under edge, with a stable key", () => {
    expect(boxFindingToFinding({ kind: "page-scrolls-sideways", selector: "html", detail: "wide" })).toEqual({ check: "overflow", key: "overflow:page-scrolls-sideways:html", detail: "wide" });
    expect(boxFindingToFinding({ kind: "dialog-near-edge", selector: "div[dialog] > p:nth-child(3)", detail: "2px" }).key).toBe("edge:dialog-near-edge:div[dialog] > p:nth-child(n)");
    expect(boxFindingToFinding({ kind: "sticks-out", selector: "x", detail: "" }).check).toBe("overflow");
    expect(boxFindingToFinding({ kind: "dialog-cut-off", selector: "x", detail: "" }).check).toBe("edge");
  });
});

describe("isEnvironmentNoise", () => {
  it("ignores Vercel's scripts that the demo's own server can't serve, wherever the message names them", () => {
    expect(isEnvironmentNoise("Refused to execute script from 'http://localhost:3100/login' because its MIME type ('text/html') is not executable.")).toBe(true);
    expect(isEnvironmentNoise("Failed to load", "http://localhost:3100/_vercel/insights/script.js")).toBe(true);
    expect(isEnvironmentNoise("x '/_vercel/speed-insights/script.js' y")).toBe(true);
  });

  it("ignores chat's live updates when the local realtime service can't be reached", () => {
    expect(isEnvironmentNoise("[chat] live updates: CHANNEL_ERROR socket closed: 1006")).toBe(true);
    expect(isEnvironmentNoise("WebSocket connection to 'ws://127.0.0.1:56321/realtime/v1/websocket?apikey=x' failed")).toBe(true);
  });

  it("keeps everything else: a hydration mismatch, an app script that failed, another websocket", () => {
    expect(isEnvironmentNoise("A tree hydrated but some attributes of the server rendered HTML didn't match")).toBe(false);
    expect(isEnvironmentNoise("Refused to execute script from 'http://localhost:3100/_next/static/chunks/app.js' because its MIME type ('text/plain') is not executable.")).toBe(false);
    expect(isEnvironmentNoise("WebSocket connection to 'ws://127.0.0.1:1/other' failed")).toBe(false);
    expect(isEnvironmentNoise("uncaught: TypeError")).toBe(false);
  });
});

describe("consoleKey", () => {
  it("is the same for the same error with different urls, numbers and ids", () => {
    const a = consoleKey("Failed to load https://x.example/a?id=123 after 450ms (req 9f8e7d6c5b)");
    const b = consoleKey("Failed to load https://y.example/b?id=999 after 12ms (req 1a2b3c4d5e)");
    expect(a).toBe(b);
    expect(a.startsWith("console:error:")).toBe(true);
  });

  it("keeps different errors apart and is bounded in length", () => {
    expect(consoleKey("Hydration failed")).not.toBe(consoleKey("Network error"));
    expect(consoleKey("x".repeat(500)).length).toBeLessThanOrEqual("console:error:".length + 120);
  });
});

describe("the baseline", () => {
  let out: string;
  const put = (scene: string, project: string, file: string, content: unknown, opened: string[] = []) => {
    mkdirSync(path.join(out, scene, project), { recursive: true });
    const findings = Array.isArray(content) ? (content as { route: string }[]) : null;
    const routes = [...new Set([...opened, ...(findings ?? []).map((x) => x.route)])];
    writeFileSync(path.join(out, scene, project, file), findings ? JSON.stringify({ routes, findings }) : String(content));
  };
  const finding = (key: string, route: string) => ({ check: "a11y", key, detail: "", route });
  beforeEach(() => {
    out = mkdtempSync(path.join(tmpdir(), "demo-baseline-"));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  it("counts each page's distinct findings per rule across every step and scene, skipping clean steps", () => {
    put("scene-a", "desktop-light", "01-first.findings.json", [finding("a11y:color-contrast:b", "/p"), finding("a11y:color-contrast:a", "/p"), finding("a11y:color-contrast:a", "/p")]);
    put("scene-a", "desktop-light", "02-clean.findings.json", []);
    put("scene-b", "desktop-light", "01-other.findings.json", [finding("a11y:color-contrast:c", "/p"), finding("a11y:label:z", "/q")]);
    put("scene-a", "phone-dark", "01-first.findings.json", [finding("overflow:sticks-out:c", "/p")]);
    expect(buildBaseline(out)).toEqual({
      "desktop-light": { "/p": { "a11y:color-contrast": 3 }, "/q": { "a11y:label": 1 } },
      "phone-dark": { "/p": { "overflow:sticks-out": 1 } },
    });
  });

  it("ignores screenshots, hidden folders and stray files next to the scenes", () => {
    put("scene-a", "desktop-light", "01-first.png", "not json");
    put(".playwright", "x", "01.findings.json", [finding("a11y:z:z", "/p")]);
    writeFileSync(path.join(out, "stray.png"), "x");
    expect(buildBaseline(out)).toEqual({});
  });

  it("orders everything the same way every time, so the committed file's diff shows only real changes", () => {
    put("b-scene", "phone-light", "01-x.findings.json", [finding("a11y:y:k", "/z"), finding("a11y:x:k", "/z"), finding("a11y:x:k", "/a")]);
    put("a-scene", "desktop-light", "01-x.findings.json", [finding("a11y:x:k", "/a")]);
    const built = buildBaseline(out);
    expect(Object.keys(built)).toEqual(["desktop-light", "phone-light"]);
    expect(Object.keys(built["phone-light"])).toEqual(["/a", "/z"]);
    expect(Object.keys(built["phone-light"]["/z"])).toEqual(["a11y:x", "a11y:y"]);
  });

  it("replaces what the last capture saw and keeps the rest: pages it never opened, and sizes it never ran", () => {
    put("scene-a", "phone-light", "01-x.findings.json", [finding("a11y:x:k", "/p")], ["/p", "/fixed"]);
    const existing: Baseline = { "phone-light": { "/old": { "a11y:old": 4 }, "/p": { "a11y:x": 3 }, "/fixed": { "a11y:y": 1 } }, "tablet-dark": { "/t": { "a11y:t": 1 } } };
    expect(buildBaseline(out, existing)).toEqual({ "phone-light": { "/old": { "a11y:old": 4 }, "/p": { "a11y:x": 1 } }, "tablet-dark": { "/t": { "a11y:t": 1 } } });
  });

  it("drops a size that has nothing left", () => {
    put("scene-a", "phone-light", "01-x.findings.json", [], ["/p"]);
    expect(buildBaseline(out, { "phone-light": { "/p": { "a11y:x": 1 } }, "tablet-dark": { "/t": { "a11y:t": 1 } } })).toEqual({ "tablet-dark": { "/t": { "a11y:t": 1 } } });
  });

  it("is checked both ways against a capture, for the projects it ran only", () => {
    put("scene-a", "phone-light", "01-x.findings.json", [finding("a11y:x:k", "/p"), finding("a11y:new:k", "/p")], ["/gone"]);
    put("scene-a", "desktop-light", "01-x.findings.json", [], ["/d"]);
    const baseline: Baseline = {
      "phone-light": { "/p": { "a11y:x": 1 }, "/gone": { "a11y:y": 1 }, "/not-opened": { "a11y:z": 1 } },
      "desktop-light": { "/d": { "a11y:d": 2 } },
      "tablet-dark": { "/t": { "a11y:t": 1 } },
    };
    const problems = checkBaseline(out, baseline).sort();
    expect(problems).toEqual([
      expect.stringContaining("desktop-light /d a11y:d: 0 found but 2 known"),
      expect.stringContaining("phone-light /gone a11y:y: 0 found but 1 known"),
      expect.stringContaining("phone-light /p a11y:new: 1 found, 0 known"),
    ]);
  });
});

describe("tests/demo/baseline.json", () => {
  const baseline = JSON.parse(readFileSync(path.join(process.cwd(), "tests", "demo", "baseline.json"), "utf8")) as Baseline;

  it("is only ever made smaller: every entry is a whole number of 1 or more, on a normalised page, in a known project and in order", () => {
    const projects = ["phone", "tablet-portrait", "tablet-landscape", "desktop"].flatMap((s) => [`${s}-light`, `${s}-dark`]);
    expect(Object.keys(baseline)).toEqual(Object.keys(baseline).sort());
    for (const [project, pages] of Object.entries(baseline)) {
      expect(projects, project).toContain(project);
      expect(Object.keys(pages), project).toEqual(Object.keys(pages).sort());
      for (const [route, rules] of Object.entries(pages)) {
        expect(pageRoute(route), `${project} ${route} is not a normalised page`).toBe(route);
        for (const [rule, count] of Object.entries(rules)) {
          expect(Number.isInteger(count) && count >= 1, `${project} ${route} ${rule}`).toBe(true);
          expect(ruleOf(rule), `${project} ${route} ${rule} is not a rule`).toBe(rule);
        }
      }
    }
  });
});
