import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../helpers/api-fetch";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));

import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { setNetHooks, type Transport, type TransportRequest } from "@/lib/net/safe-fetch";

const MESSAGE = "msg_AAAAAAAAAAA1";
const PUBLIC = "93.184.216.34";
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

/** What the upstream hosts answer, by URL. */
let upstream: Record<string, { status?: number; headers?: Record<string, string>; body?: Buffer }> = {};
let requests: TransportRequest[] = [];
let resolves: Record<string, string[]> = {};
const transport: Transport = async (req) => {
  requests.push(req);
  const a = upstream[req.url.href];
  if (!a) throw new Error("refused");
  return { status: a.status ?? 200, headers: a.headers ?? {}, body: (async function* () { yield a.body ?? png; })(), destroy: () => {} };
};

const ATTACHMENTS = [
  { title: "A page", text: "x", image_url: "https://img.example.test/big.png", thumb_url: "https://img.example.test/small.png" },
  { title: "Second", image_url: "https://img.example.test/second.png" },
];
const BOT = { name: "Deploy Bot", icon: "https://img.example.test/logo.png" };

function setMessage(over: { attachments?: unknown; blocks?: unknown; bot?: unknown; deleted?: boolean; hidden?: boolean } = {}) {
  repos = createInMemoryRepos(
    new InMemoryDataset({
      chatChannels: [{ id: "chn_AAAAAAAAAAA1", slack_channel_id: "C1" }],
      chatMessages: [{ id: MESSAGE, channel_id: "chn_AAAAAAAAAAA1", slack_ts: "1.1", deleted_at: over.deleted ? "2026-01-01T00:00:00Z" : null }],
      // hidden: row-level security shows the caller no content row at all
      chatMessageContents: over.hidden ? [] : [{ message_id: MESSAGE, body: "hello", attachments: (over.attachments ?? ATTACHMENTS) as never, blocks: (over.blocks ?? null) as never, bot: (over.bot ?? null) as never }],
    }),
  );
}

const get = (query: string) => apiFetch(`/api/chat/unfurl-image${query}`);
const known = () => Object.fromEntries(["big", "small", "second", "logo"].map((n) => [`https://img.example.test/${n}.png`, {}]));

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "member@example.com" });
  vi.mocked(createClient).mockResolvedValue({} as never);
  vi.mocked(createServiceRoleClient).mockReturnValue({} as never);
  setMessage();
  upstream = known();
  requests = [];
  resolves = { "img.example.test": [PUBLIC] };
  setNetHooks({ resolve: async (h) => (resolves[h] ?? []).map((address) => ({ address })), transport });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  setNetHooks();
  vi.restoreAllMocks();
});

describe("GET /api/chat/unfurl-image", () => {
  it("serves the picture at that position with the headers that keep it inert, and sends upstream nothing of ours", async () => {
    const res = await get(`?m=${MESSAGE}&i=1`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toMatch(/^private, max-age=\d+$/);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(requests.map((r) => r.url.href)).toEqual(["https://img.example.test/small.png"]);
    expect(Object.keys(requests[0].headers).sort()).toEqual(["accept", "accept-encoding", "user-agent"]);
  });

  it("numbers pictures in the order they are drawn: cards in turn, image then thumbnail", async () => {
    const paths: string[] = [];
    for (let i = 0; i < 3; i++) {
      requests = [];
      await get(`?m=${MESSAGE}&i=${i}`);
      paths.push(requests[0].url.pathname);
    }
    expect(paths).toEqual(["/big.png", "/small.png", "/second.png"]);
  });

  it("puts the app's logo first", async () => {
    setMessage({ bot: BOT });
    await get(`?m=${MESSAGE}&i=0`);
    expect(requests[0].url.href).toBe(BOT.icon);
    requests = [];
    await get(`?m=${MESSAGE}&i=1`);
    expect(requests[0].url.pathname).toBe("/big.png");
  });

  it("serves the pictures of an app's blocks", async () => {
    setMessage({ attachments: [], bot: BOT, blocks: [{ type: "image", image_url: "https://img.example.test/big.png", alt_text: "x" }] });
    expect((await get(`?m=${MESSAGE}&i=1`)).status).toBe(200);
    expect(requests[0].url.pathname).toBe("/big.png");
  });

  it("refuses a visitor who isn't signed in without reading anything", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(401);
    expect(requests).toEqual([]);
  });

  it("is a 404 for a message the viewer can't read (no content for them), a deleted one, a missing one and a malformed request", async () => {
    setMessage({ hidden: true });
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(404);
    setMessage({ deleted: true });
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(404);
    setMessage();
    for (const query of ["", "?m=msg_BBBBBBBBBBB2&i=0", "?m=not-an-id&i=0", `?m=${MESSAGE}`, `?m=${MESSAGE}&i=-1`, `?m=${MESSAGE}&i=abc`, `?m=${MESSAGE}&i=1000`]) {
      expect((await get(query)).status, query).toBe(404);
    }
    expect(requests).toEqual([]);
  });

  it("is a 404 for a position past the last picture, and for a message with no pictures", async () => {
    expect((await get(`?m=${MESSAGE}&i=3`)).status).toBe(404);
    setMessage({ attachments: [] });
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(404);
  });

  it("is a 404 when the content can't be read at all", async () => {
    vi.spyOn(repos.chat, "unfurlContext").mockRejectedValue(new Error("boom"));
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(404);
  });

  it("ignores an address in the query: it only ever fetches what the message lists", async () => {
    const res = await get(`?m=${MESSAGE}&i=0&url=${encodeURIComponent("https://evil.example.test/x.png")}`);
    expect(res.status).toBe(200);
    expect(requests.map((r) => r.url.hostname)).toEqual(["img.example.test"]);
  });

  describe("an address in the message that points somewhere it must not", () => {
    const cases: [string, string, string[]?][] = [
      ["localhost", "https://localhost/a.png"],
      ["the cloud metadata address", "https://169.254.169.254/latest/meta-data/"],
      ["a private range", "https://10.1.2.3/a.png"],
      ["a private range with a port", "https://192.168.0.1:8443/a.png"],
      ["a name that resolves to a private address", "https://rebind.example.test/a.png", ["10.0.0.9"]],
    ];
    it.each(cases)("%s: 502 with no detail, and nothing connected to", async (_name, url, answers) => {
      resolves["rebind.example.test"] = answers ?? [];
      setMessage({ attachments: [{ title: "t", image_url: url }] });
      const res = await get(`?m=${MESSAGE}&i=0`);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Not available" });
      expect(requests).toEqual([]);
    });

    it("refuses a redirect from a public address to a private one", async () => {
      upstream["https://img.example.test/big.png"] = { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } };
      expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(502);
      expect(requests).toHaveLength(1);
    });

    it("logs the upstream status code of a refusal, and not the address", async () => {
      upstream["https://img.example.test/big.png"] = { status: 403 };
      expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(502);
      const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(logged).toContain("bad_status");
      expect(logged).toContain("403");
      expect(logged).not.toContain("img.example.test");
      expect(requests[0].headers["user-agent"]).toBeTruthy();
    });

    it("keeps the address, which can carry a token, out of the log", async () => {
      setMessage({ attachments: [{ title: "t", image_url: "https://10.0.0.1/a.png?token=SECRET" }] });
      await get(`?m=${MESSAGE}&i=0`);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("SECRET");
    });
  });

  it("refuses what isn't a picture: HTML, SVG, and an image type the bytes don't back up", async () => {
    for (const [body, type] of [
      [Buffer.from("<html><script>alert(1)</script></html>"), "text/html"],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"],
      [Buffer.from("not an image"), "image/png"],
    ] as const) {
      upstream["https://img.example.test/big.png"] = { body, headers: { "content-type": type } };
      expect((await get(`?m=${MESSAGE}&i=0`)).status, type).toBe(502);
    }
  });

  it("refuses a picture over 5 MB and an error from the other end", async () => {
    upstream["https://img.example.test/big.png"] = { headers: { "content-length": String(6 * 1024 * 1024) } };
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(502);
    upstream["https://img.example.test/big.png"] = { status: 404 };
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(502);
  });

  it("slows a viewer who asks for too many, before fetching", async () => {
    vi.spyOn(repos.rateLimit, "hit").mockResolvedValue(false);
    const res = await get(`?m=${MESSAGE}&i=0`);
    expect(res.status).toBe(429);
    expect(requests).toEqual([]);
  });
});

describe("GET /api/chat/unfurl-image: the Hub's own link previews and removed cards", () => {
  const draft = (url: string, position: number, imageUrl: string | null) => ({ url, position, finalUrl: url, kind: "link" as const, status: "ok" as const, title: "T", description: null, siteName: null, imageUrl });

  it("serves the picture of a link preview, numbered after Slack's cards", async () => {
    setMessage({ attachments: [{ title: "Slack's", image_url: "https://img.example.test/big.png" }] });
    await repos.chatLinkPreviews.save(MESSAGE, [draft("https://example.test/post", 0, "https://img.example.test/second.png")]);

    expect((await get(`?m=${MESSAGE}&i=1`)).status).toBe(200);
    expect(requests.map((r) => r.url.pathname)).toEqual(["/second.png"]);
  });

  it("refuses the picture of a preview its author removed, and of a Slack card they removed, and renumbers the rest", async () => {
    setMessage({ attachments: [{ title: "Slack's", title_link: "https://slack-card.example.test/", image_url: "https://img.example.test/big.png" }] });
    await repos.chatLinkPreviews.save(MESSAGE, [draft("https://example.test/post", 0, "https://img.example.test/second.png"), draft("https://example.test/other", 1, "https://img.example.test/small.png")]);
    await repos.chatLinkPreviews.hide(MESSAGE, "url:https://example.test/post");
    await repos.chatLinkPreviews.hide(MESSAGE, "url:https://slack-card.example.test/");

    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(200);
    expect(requests.map((r) => r.url.pathname)).toEqual(["/small.png"]);
    expect((await get(`?m=${MESSAGE}&i=1`)).status).toBe(404);
  });

  it("answers 404 and fetches nothing when the removed cards can't be read", async () => {
    setMessage();
    repos.chatLinkPreviews.hiddenKeys = async () => {
      throw new Error("db down");
    };
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(404);
    expect(requests).toEqual([]);
  });

  it("answers 404 when the previews can't be read", async () => {
    setMessage();
    repos.chatLinkPreviews.forMessages = async () => {
      throw new Error("db down");
    };
    expect((await get(`?m=${MESSAGE}&i=0`)).status).toBe(404);
  });
});
