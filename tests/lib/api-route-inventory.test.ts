import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyTable,
  classify,
  CREDENTIAL_DESCRIPTIONS,
  CREDENTIAL_KINDS,
  DOC_PATH,
  END_MARKER,
  renderTable,
  START_MARKER,
  urlPathOf,
  type RouteRow,
} from "@/scripts/api-route-inventory";

describe("API route inventory (docs/architecture/API_ROUTES.md)", () => {
  it("the committed table matches the routes (run pnpm docs:api-routes)", () => {
    const doc = readFileSync(join(process.cwd(), DOC_PATH), "utf8");
    expect(applyTable(doc, classify())).toBe(doc);
  });

  it("lists every route once, with its path", () => {
    const doc = readFileSync(join(process.cwd(), DOC_PATH), "utf8");
    for (const row of classify()) expect(doc).toContain(`| \`${row.path}\` |`);
  });

  it("describes every credential kind in the doc", () => {
    const doc = readFileSync(join(process.cwd(), DOC_PATH), "utf8");
    for (const kind of [...Object.keys(CREDENTIAL_KINDS), "public"]) {
      expect(CREDENTIAL_DESCRIPTIONS[kind], kind).toBeTruthy();
      expect(doc, kind).toContain(`| \`${kind}\` |`);
    }
  });

  it("turns a route file into its URL path", () => {
    expect(urlPathOf("src/app/api/health/route.ts")).toBe("/api/health");
    expect(urlPathOf("src/app/api/members/[id]/route.ts")).toBe("/api/members/[id]");
  });

  it("covers the route handlers outside src/app/api, each with its guard", () => {
    expect(urlPathOf("src/app/(member)/help/images/[scene]/[file]/route.ts")).toBe("/help/images/[scene]/[file]");
    expect(urlPathOf("src/app/auth/slack/route.ts")).toBe("/auth/slack");
    const kinds = Object.fromEntries(classify().map((r) => [r.path, r.kinds]));
    expect(kinds["/auth/callback"]).toEqual(["pkce-code"]);
    expect(kinds["/auth/confirm"]).toEqual(["one-time-token"]);
    expect(kinds["/auth/slack"]).toEqual(["one-time-token"]);
    expect(kinds["/courses/[slug]/lessons/[lessonId]/files/[fileId]"]).toEqual(["session"]);
    expect(kinds["/help/images/[scene]/[file]"]).toEqual(["session"]);
  });

  it("renders methods and credentials, marks public routes and flags a route with none", () => {
    const rows: RouteRow[] = [
      { file: "src/app/api/health/route.ts", path: "/api/health", methods: ["GET"], kinds: [] },
      { file: "src/app/api/x/route.ts", path: "/api/x", methods: ["GET", "POST"], kinds: ["admin", "internal-secret"] },
      { file: "src/app/api/y/route.ts", path: "/api/y", methods: [], kinds: [] },
    ];
    const out = renderTable(rows);
    expect(out).toContain("3 routes.");
    expect(out).toContain("| `/api/health` | GET | `public` |");
    expect(out).toContain("| `/api/x` | GET, POST | `admin` + `internal-secret` |");
    expect(out).toContain("| `/api/y` | none | **none** |");
  });

  it("refuses a doc without the markers", () => {
    expect(() => applyTable("no markers", [])).toThrow(/has no/);
    expect(applyTable(`a\n${START_MARKER}\nold\n${END_MARKER}\nb`, [])).toContain("0 routes.");
  });
});
