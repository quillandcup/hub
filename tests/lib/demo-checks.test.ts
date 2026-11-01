import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boxFindingToFinding, consoleKey, knownKeys, stableTarget, withoutIds } from "@/demo/checks";
import { buildBaseline } from "@/demo/baseline";

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

describe("knownKeys", () => {
  const baseline = {
    "desktop-light": { "s/01-a": ["k1", "k2"] },
    "tablet-light": { "s/01-a": ["k2", "k3"] },
    "phone-dark": { "s/01-a": ["d1"], "s/02-b": ["d2"] },
  };

  it("counts a finding known at any size in the same theme as known", () => {
    expect([...knownKeys(baseline, "phone-light", "s/01-a")].sort()).toEqual(["k1", "k2", "k3"]);
  });

  it("keeps the themes apart: a light finding is not known in dark, or the other way round", () => {
    expect([...knownKeys(baseline, "desktop-dark", "s/01-a")]).toEqual(["d1"]);
    expect(knownKeys(baseline, "desktop-light", "s/01-a").has("d1")).toBe(false);
  });

  it("is per step, and empty for a step or theme with nothing known", () => {
    expect([...knownKeys(baseline, "phone-dark", "s/02-b")]).toEqual(["d2"]);
    expect(knownKeys(baseline, "phone-light", "s/02-b").size).toBe(0);
    expect(knownKeys({}, "phone-light", "s/01-a").size).toBe(0);
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

describe("consoleKey", () => {
  it("is the same for the same error with different urls, numbers and ids", () => {
    const a = consoleKey("Failed to load https://x.example/a?id=123 after 450ms (req 9f8e7d6c5b)");
    const b = consoleKey("Failed to load https://y.example/b?id=999 after 12ms (req 1a2b3c4d5e)");
    expect(a).toBe(b);
    expect(a.startsWith("console:")).toBe(true);
  });

  it("keeps different errors apart and is bounded in length", () => {
    expect(consoleKey("Hydration failed")).not.toBe(consoleKey("Network error"));
    expect(consoleKey("x".repeat(500)).length).toBeLessThanOrEqual("console:".length + 120);
  });
});

describe("buildBaseline", () => {
  let out: string;
  const put = (scene: string, project: string, file: string, content: unknown) => {
    mkdirSync(path.join(out, scene, project), { recursive: true });
    writeFileSync(path.join(out, scene, project, file), typeof content === "string" ? content : JSON.stringify(content));
  };
  beforeEach(() => {
    out = mkdtempSync(path.join(tmpdir(), "demo-baseline-"));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  it("lists each step's finding keys by size and theme, sorted and without duplicates, skipping clean steps", () => {
    put("scene-a", "desktop-light", "01-first.findings.json", [{ key: "b" }, { key: "a" }, { key: "a" }]);
    put("scene-a", "desktop-light", "02-clean.findings.json", []);
    put("scene-a", "phone-dark", "01-first.findings.json", [{ key: "c" }]);
    expect(buildBaseline(out)).toEqual({
      "desktop-light": { "scene-a/01-first": ["a", "b"] },
      "phone-dark": { "scene-a/01-first": ["c"] },
    });
  });

  it("ignores screenshots, hidden folders and stray files next to the scenes", () => {
    put("scene-a", "desktop-light", "01-first.png", "not json");
    put(".playwright", "x", "01.findings.json", [{ key: "z" }]);
    writeFileSync(path.join(out, "stray.png"), "x");
    expect(buildBaseline(out)).toEqual({});
  });

  it("orders everything the same way every time, so the committed file's diff shows only real changes", () => {
    put("b-scene", "phone-light", "01-x.findings.json", [{ key: "k" }]);
    put("a-scene", "desktop-light", "01-x.findings.json", [{ key: "k" }]);
    expect(Object.keys(buildBaseline(out))).toEqual(["desktop-light", "phone-light"]);
  });
});
