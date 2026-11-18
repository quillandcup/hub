import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactQuery, redactUrl, scrubBreadcrumb, scrubEvent } from "@/lib/sentry-scrub";
import { KajabiClient } from "@/lib/kajabi/client";

const SECRET = "live-credential-value-0123456789";

describe("the Kajabi OAuth failure log", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never writes a credential from the response body to the logs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ refresh_token: SECRET, error: "odd" }), { status: 200 })));
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map((a) => JSON.stringify(a) ?? String(a)).join(" "))),
    );
    try {
      await expect(new KajabiClient("id", "client-secret-value", "site").submitForm("1", {})).rejects.toThrow("missing access_token");
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain(SECRET);
    expect(logged.join("\n")).not.toContain("client-secret-value");
  });
});

describe("Sentry events carry no credential from an address", () => {
  it("redacts the calendar feed token in the path", () => {
    expect(redactUrl(`https://hub.example/api/calendar/feed/${SECRET}`)).toBe("https://hub.example/api/calendar/feed/[redacted]");
    expect(redactUrl(`/api/calendar/feed/${SECRET}/extra?x=1`)).toBe("/api/calendar/feed/[redacted]/extra?x=1");
  });

  it("redacts sign-in, unsubscribe and token query values, keeping the rest", () => {
    expect(redactUrl(`https://hub.example/auth/slack?token=${SECRET}&next=%2Fhome`)).toBe("https://hub.example/auth/slack?token=[redacted]&next=%2Fhome");
    expect(redactQuery(`code=${SECRET}&page=2&token_hash=${SECRET}&t=${SECRET}`)).toBe("code=[redacted]&page=2&token_hash=[redacted]&t=[redacted]");
    expect(redactUrl(`https://hub.example/x#access_token=${SECRET}&type=recovery`)).toBe("https://hub.example/x#access_token=[redacted]&type=recovery");
  });

  it("leaves an ordinary address alone", () => {
    expect(redactUrl("https://hub.example/events?month=2026-11")).toBe("https://hub.example/events?month=2026-11");
  });

  it("scrubs an event's request address, its query string and its breadcrumbs", () => {
    const event = scrubEvent({
      request: { url: `https://hub.example/api/calendar/feed/${SECRET}`, query_string: `token=${SECRET}` },
      breadcrumbs: [{ data: { url: `/auth/slack?token=${SECRET}`, from: "/a", to: `/b?code=${SECRET}` } }],
    });
    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(scrubBreadcrumb({ data: { url: `/x?t=${SECRET}` } }).data?.url).toBe("/x?t=[redacted]");
    expect(scrubEvent({})).toEqual({});
  });

  it("is wired into every Sentry.init", () => {
    for (const file of ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"]) {
      const source = fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8");
      expect(source, file).toMatch(/beforeSend: scrubEvent/);
      expect(source, file).toMatch(/beforeSendTransaction: scrubEvent/);
      expect(source, file).toMatch(/beforeBreadcrumb: scrubBreadcrumb/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Guard: logging calls that are always wrong. Parses the source like tests/lib/outbound-user-agent.test.ts.
// ---------------------------------------------------------------------------------------------------------------
const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = ["app", "lib"]
  .flatMap((dir) => sourceFiles(path.join(root, dir)))
  .map((file) => ({ file: path.relative(root, file), source: fs.readFileSync(file, "utf8") }));

/** A logging or error-reporting call, to the end of its line. */
const LOG_CALL = /(?:console\.\w+|Sentry\.(?:captureException|captureMessage|addBreadcrumb|setContext|setExtra|setExtras)|logger\.\w+)\([^\n]*/g;

/** Arguments that put a whole credential-bearing object in the log: every header of a request, or the environment. */
const ALWAYS_WRONG: [string, RegExp][] = [
  ["a whole headers object", /(?:^|[(,\s{])(?:request\.headers|req\.headers|response\.headers|res\.headers|headers|init\.headers|options\.headers)\s*[,)}]/],
  ["the whole environment", /process\.env\s*[,)}]/],
  ["a serialised request or headers", /JSON\.stringify\(\s*(?:request|req|headers|process\.env|Object\.fromEntries\([^)]*headers)/],
  ["an Authorization value", /\bAuthorization\b\s*:\s*[^,}]*(?:Bearer|token|secret)/i],
];

function logCalls(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(LOG_CALL)].map((m) => m[0]);
}

describe("no log line carries a credential wholesale", () => {
  it("scans the source", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.flatMap(({ source }) => logCalls(source)).length).toBeGreaterThan(200);
  });

  it.each(ALWAYS_WRONG)("never logs %s", (_name, pattern) => {
    const offenders = files.flatMap(({ file, source }) => logCalls(source).filter((call) => pattern.test(call)).map((call) => `${file}: ${call.trim()}`));
    expect(offenders).toEqual([]);
  });

  it("the patterns do catch the wrong thing", () => {
    for (const bad of ["console.log(request.headers)", "console.error('x', headers)", "console.log(process.env)", "console.log(JSON.stringify(request))", "console.log({ Authorization: `Bearer ${token}` })"]) {
      expect(ALWAYS_WRONG.some(([, p]) => p.test(bad)), bad).toBe(true);
    }
    expect(ALWAYS_WRONG.some(([, p]) => p.test("console.log(request.headers.get('user-agent'))"))).toBe(false);
  });
});
