import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { APP_URL, KAJABI_SITE_URL, SITE_URL } from "@/lib/config";
import { decideRoute } from "@/lib/root-routing";
import { ROOT_HOST } from "@/lib/config";
import { expectedFor, formatTable, parseArgs, parseUrlList, rowOk, sameLocation, type Row } from "@/scripts/root-redirect-check";

const LIST = path.resolve(__dirname, "../../scripts/data/redirect-check-urls.txt");

describe("parseUrlList", () => {
  it("reads path and expectation, skipping comments and blank lines", () => {
    expect(parseUrlList("# c\n\n/a?x=1 kajabi\n  /b   hub  \n")).toEqual([
      { path: "/a?x=1", expect: "kajabi" },
      { path: "/b", expect: "hub" },
    ]);
  });

  it("names the line it cannot read", () => {
    expect(() => parseUrlList("/a kajabi\nnope kajabi")).toThrow(/Line 2/);
    expect(() => parseUrlList("/a sideways")).toThrow(/Line 1/);
    expect(() => parseUrlList("/a")).toThrow(/Line 1/);
  });
});

describe("expectedFor", () => {
  it("builds the outcomes from the configured hosts", () => {
    expect(expectedFor({ path: "/Offers/X/?c=1", expect: "kajabi" })).toEqual({ status: 307, location: `${KAJABI_SITE_URL}/Offers/X/?c=1` });
    expect(expectedFor({ path: "/dashboard", expect: "hub" })).toEqual({ status: 307, location: `${APP_URL}/dashboard` });
    expect(expectedFor({ path: "/login?a=1&b=2", expect: "login" })).toEqual({ status: 307, location: `${APP_URL}/login?a=1&b=2` });
    expect(expectedFor({ path: "/privacy", expect: "serve" })).toEqual({ status: 200, location: null });
  });
});

describe("the committed list", () => {
  const entries = parseUrlList(readFileSync(LIST, "utf8"));

  it("covers the Kajabi path shapes with deep links and query strings", () => {
    const paths = entries.map((e) => e.path);
    for (const shape of ["/login", "/library", "/library/categories/example", "/products/example-course", "/products/example-course/categories/123/posts/456", "/offers/ExAmPlE/checkout", "/offers/ExAmPlE", "/pages/example-landing-page", "/blog", "/blog/example-post", "/resource_redirect/landing_pages/123", "/forms/example", "/waitlist"]) {
      expect(paths).toContain(shape);
    }
    expect(paths.some((p) => p.includes("utm_source=instagram&utm_medium=social"))).toBe(true);
    expect(paths.some((p) => p.includes("coupon=EXAMPLE20"))).toBe(true);
    expect(paths.some((p) => /%[0-9A-F]{2}/.test(p))).toBe(true);
  });

  it("agrees with the routing logic for every entry (the list and the code say the same)", () => {
    for (const entry of entries) {
      const [pathname, ...q] = entry.path.split("?");
      const decision = decideRoute({ host: ROOT_HOST, method: "GET", pathname, search: q.length ? `?${q.join("?")}` : "" });
      const expected = expectedFor(entry);
      if (expected.location === null) expect(decision.action, entry.path).toBe("pass");
      else expect(decision, entry.path).toEqual({ action: "redirect", location: expected.location, status: expected.status });
    }
  });
});

describe("results", () => {
  const ok: Row = { path: "/a", expected: { status: 307, location: "https://x.example/a" }, actual: { status: 307, location: "https://x.example/a" } };
  const wrongStatus: Row = { ...ok, path: "/b", actual: { status: 308, location: "https://x.example/a" } };
  const wrongPlace: Row = { ...ok, path: "/c", actual: { status: 307, location: "https://y.example/a" } };
  const failed: Row = { ...ok, path: "/d", actual: { error: "fetch failed" } };

  it("compares status and location", () => {
    expect([ok, wrongStatus, wrongPlace, failed].map(rowOk)).toEqual([true, false, false, false]);
  });

  it("prints a table that says which differ", () => {
    const table = formatTable([ok, wrongStatus, failed]);
    expect(table).toContain("ok");
    expect(table).toContain("MISMATCH  |  /b  |  expected 307 -> https://x.example/a  |  actual 308 -> https://x.example/a");
    expect(table).toContain("ERROR fetch failed");
    expect(table).toContain("2 of 3 URLs do not behave as expected.");
    expect(formatTable([ok])).toContain("All 1 URLs behave as expected.");
  });
});

describe("sameLocation", () => {
  it("reads the query as parameters, since Next rewrites its spelling, but the path exactly", () => {
    expect(sameLocation("https://x.example/a?n=a%20b&e=%2f", "https://x.example/a?n=a+b&e=%2F")).toBe(true);
    expect(sameLocation("https://x.example/a?n=1", "https://x.example/a?n=2")).toBe(false);
    expect(sameLocation("https://x.example/A", "https://x.example/a")).toBe(false);
    expect(sameLocation("https://x.example/a/", "https://x.example/a")).toBe(false);
    expect(sameLocation("https://x.example/a", "https://y.example/a")).toBe(false);
    expect(sameLocation(null, null)).toBe(true);
    expect(sameLocation(null, "https://x.example/")).toBe(false);
    expect(sameLocation("not a url", "not a url")).toBe(true);
  });
});

describe("parseArgs", () => {
  it("defaults to the public site and the committed list", () => {
    expect(parseArgs([], "list.txt")).toEqual({ base: SITE_URL, file: "list.txt", host: null });
  });

  it("takes a base URL, a list and a Host header", () => {
    expect(parseArgs(["https://preview.example/", "--file", "x.txt", "--host", "quillandcup.test"], "list.txt")).toEqual({ base: "https://preview.example", file: "x.txt", host: "quillandcup.test" });
  });
});
