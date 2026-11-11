import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OUTBOUND_COMMENT, OUTBOUND_PRODUCT, OUTBOUND_USER_AGENT, SUPPORT_EMAIL, APP_URL, buildUserAgent, userAgentWith } from "@/lib/config";
import { DEFAULT_USER_AGENT } from "@/lib/net/safe-fetch";
import { outboundFetch, outboundHeaders } from "@/lib/http/outbound";

/**
 * RFC 9110 5.5/10.1.5: `User-Agent = product *( RWS ( product / comment ) )`, `product = token [ "/" product-version ]`,
 * a comment is `( ctext / quoted-pair / comment )` in parentheses. ASCII only, no control characters.
 */
const TOKEN = "[A-Za-z0-9!#$%&'*+.^_`|~-]+";
const PRODUCT = `${TOKEN}(?:/${TOKEN})?`;
const COMMENT = "\\([\\t \\x21-\\x27\\x2A-\\x5B\\x5D-\\x7E]*\\)";
const VALID_UA = new RegExp(`^${PRODUCT}(?: (?:${PRODUCT}|${COMMENT}))*$`);

describe("the outbound User-Agent definition", () => {
  it("is valid, informative and short", () => {
    expect(OUTBOUND_USER_AGENT).toMatch(VALID_UA);
    expect(OUTBOUND_USER_AGENT.length).toBeLessThan(250);
    expect(OUTBOUND_USER_AGENT).toContain(APP_URL);
    expect(OUTBOUND_USER_AGENT).toContain(SUPPORT_EMAIL);
    expect(OUTBOUND_USER_AGENT.startsWith(`${OUTBOUND_PRODUCT.name}/${OUTBOUND_PRODUCT.version} (`)).toBe(true);
    expect(OUTBOUND_COMMENT).toContain(APP_URL);
  });

  it("would have rejected the old placeholder (spaces in the product, a fixed 1.0)", () => {
    // What the picture proxy sent before: three products, the first two without a version.
    const old = `Quill Cup Hub/1.0 (+${APP_URL}; ${SUPPORT_EMAIL})`;
    const products = old.replace(/\s*\(.*\)$/, "").split(" ");
    expect(products).toHaveLength(3);
    expect(OUTBOUND_USER_AGENT.replace(/\s*\(.*\)$/, "").split(" ")).toHaveLength(1);
    expect(OUTBOUND_PRODUCT.version).not.toBe("1.0");
  });

  it("is what the safe fetch sends by default", () => {
    expect(DEFAULT_USER_AGENT).toBe(OUTBOUND_USER_AGENT);
  });

  it.each([
    ["spaces and an ampersand in the product", { product: "Quill & Cup Hub", version: "abc1234", url: "https://x.example", contact: "a@x.example" }],
    ["parentheses, a backslash and non-ASCII in the contact", { product: "P", version: "1", url: "https://x.example/(a)\\b", contact: "Zoë <a@x.example>\r\nX-Evil: 1" }],
    ["an empty version", { product: "P", version: "", url: "https://x.example", contact: "a@x.example" }],
    ["a missing version", { product: "P", url: "https://x.example", contact: "a@x.example" }],
    ["an absurdly long contact and version", { product: "P", version: "v".repeat(500), url: "https://x.example", contact: "c".repeat(2000) }],
    ["an empty product", { product: "", version: "1", url: "u", contact: "c" }],
  ])("stays valid with %s", (_name, parts) => {
    const ua = buildUserAgent(parts);
    expect(ua).toMatch(VALID_UA);
    expect(ua).not.toMatch(/[\r\n]/);
    expect(ua.length).toBeLessThan(300);
  });

  it("falls back to dev when there is no deployed commit", () => {
    expect(buildUserAgent({ product: "HedgieHub", url: "https://x.example", contact: "a@x.example" })).toMatch(/^HedgieHub\/dev \(/);
  });

  it("adds integration tokens in front of the comment, sanitised", () => {
    const ua = userAgentWith("slack-import/2", "we ird/1 2");
    expect(ua).toMatch(VALID_UA);
    expect(ua).toContain(" slack-import/2 we-ird/1-2 (");
    expect(ua.endsWith(`(${OUTBOUND_COMMENT})`)).toBe(true);
    expect(userAgentWith()).toBe(OUTBOUND_USER_AGENT);
  });
});

describe("outboundHeaders and outboundFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds the User-Agent and keeps the caller's headers", () => {
    expect(outboundHeaders({ Authorization: "Bearer x" })).toEqual({ Authorization: "Bearer x", "User-Agent": OUTBOUND_USER_AGENT });
    expect(outboundHeaders(new Headers({ accept: "a" }))).toEqual({ accept: "a", "User-Agent": OUTBOUND_USER_AGENT });
    expect(outboundHeaders(undefined, "x/1")["User-Agent"]).toBe(userAgentWith("x/1"));
  });

  it("does not replace a User-Agent the caller chose", () => {
    expect(outboundHeaders({ "user-agent": "custom/1" })).toEqual({ "user-agent": "custom/1" });
  });

  it("sends it on fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await outboundFetch("https://example.org/x", { method: "POST", headers: { a: "b" } });
    expect(fetchMock).toHaveBeenCalledWith("https://example.org/x", { method: "POST", headers: { a: "b", "User-Agent": OUTBOUND_USER_AGENT } });
  });
});

describe("SDK clients carry our identity", () => {
  it("Stripe gets appInfo, which it adds to its own User-Agent", async () => {
    const { StripeClientWrapper } = await import("@/lib/stripe/client");
    const wrapper = new StripeClientWrapper("sk_test_123") as unknown as { stripe: { getAppInfoAsString(): string } };
    expect(wrapper.stripe.getAppInfoAsString()).toContain(`${OUTBOUND_PRODUCT.name}/${OUTBOUND_PRODUCT.version}`);
    expect(wrapper.stripe.getAppInfoAsString()).toContain(APP_URL);
  });

  it("Mux keeps its own clause after ours", async () => {
    const { createMuxClient } = await import("@/lib/mux");
    const client = createMuxClient() as unknown as { _options: { defaultHeaders?: Record<string, string> } };
    const ua = client._options.defaultHeaders?.["User-Agent"] ?? "";
    expect(ua.startsWith(OUTBOUND_USER_AGENT)).toBe(true);
    expect(ua).toMatch(/ Mux\/JS \d/);
    expect(ua).toMatch(VALID_UA);
  });

  it("Slack's client prefixes its User-Agent with our name and version", async () => {
    const { createSlackClient } = await import("@/lib/slack-client");
    const { getUserAgent } = await import("@slack/web-api/dist/instrument");
    createSlackClient("xoxb-test");
    expect(getUserAgent().startsWith(`${OUTBOUND_PRODUCT.name}/${OUTBOUND_PRODUCT.version} `)).toBe(true);
  });

  it("Google Calendar requests carry our directive next to googleapis's own", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", JSON.stringify({ client_email: "a@b.example", private_key: "k" }));
    const { GoogleCalendarClient } = await import("@/lib/google-calendar/client");
    const client = new GoogleCalendarClient() as unknown as { calendar: { context: { _options: { userAgentDirectives?: { product: string; version: string; comment: string }[] } } } };
    const directive = client.calendar.context._options.userAgentDirectives?.[0];
    expect(directive).toEqual({ product: OUTBOUND_PRODUCT.name, version: OUTBOUND_PRODUCT.version, comment: OUTBOUND_COMMENT });
    vi.unstubAllEnvs();
  });

  it("web-push is given the header on both send paths", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../lib/channels/web-push.ts"), "utf8");
    expect(source.match(/headers: \{ "User-Agent": OUTBOUND_USER_AGENT \}/g)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Guard: a new outbound HTTP call must carry the User-Agent. Parses the source like tests/lib/data-access-layer.test.ts.
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

const files = ["app", "lib", "components", "scripts"]
  .flatMap((dir) => sourceFiles(path.join(root, dir)))
  .map((file) => ({ file: path.relative(root, file), source: fs.readFileSync(file, "utf8") }));

/** Files that may call raw `fetch(` / build an SDK client themselves, each with the reason. Only ever shrinks. */
const ALLOWED_RAW_FETCH: Record<string, string> = {
  "lib/http/outbound.ts": "the wrapper itself",
  "lib/analytics/client.ts": "browser code calling our own tracking route",
  "app/api/health/route.ts": "calls our own Supabase project (the database check), not a third party",
  "scripts/kajabi-course-content.ts": "runs inside a logged-in Kajabi browser page (page.evaluate), where the browser sets its own User-Agent",
};

describe("outbound requests are identified", () => {
  it("scans the source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no raw fetch( to an external host without outboundFetch", () => {
    const offenders = files.flatMap(({ file, source }) => {
      if (ALLOWED_RAW_FETCH[file]) return [];
      // A client component's fetch runs in the member's browser, which sets the User-Agent.
      if (/^\s*["']use client["']/.test(source)) return [];
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      return [...code.matchAll(/(?<![.\w])fetch\(\s*([^)\n]*)/g)]
        .filter((m) => !/^[`"']\//.test(m[1])) // same-origin path
        .filter((m) => !/^[`"']\$\{(endpoint|api)\}/.test(m[1])) // same-origin path held in a variable of a shared client component
        .filter((m) => !/^\/\//.test(m[1]))
        .map(() => file);
    });
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("every allowlist entry still needs its line", () => {
    for (const file of Object.keys(ALLOWED_RAW_FETCH)) {
      const found = files.find((f) => f.file === file);
      expect(found, `${file} is gone: remove it from ALLOWED_RAW_FETCH`).toBeTruthy();
      expect(/(?<![.\w])fetch\(/.test(found!.source) || file === "lib/http/outbound.ts", `${file} no longer calls fetch: remove it`).toBe(true);
    }
  });

  it("Slack clients are built only by createSlackClient", () => {
    const offenders = files.filter(({ file, source }) => file !== "lib/slack-client.ts" && /new WebClient\(/.test(source)).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("Stripe, Mux, googleapis and web-push call sites carry the identity", () => {
    const need: [string, RegExp][] = [
      ["new Stripe(", /appInfo:/],
      ["new Mux(", /defaultHeaders:/],
      ["google.calendar(", /userAgentDirectives:/],
      ["webpush.sendNotification(", /OUTBOUND_USER_AGENT/],
    ];
    for (const [call, ok] of need) {
      for (const { file, source } of files.filter((f) => f.source.includes(call))) {
        expect(ok.test(source), `${file} calls ${call} without our User-Agent`).toBe(true);
      }
    }
  });
});
