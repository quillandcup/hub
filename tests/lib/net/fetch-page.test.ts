import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeClock } from "../../helpers/fake-clock";
import { resetClock, setClock } from "@/lib/clock";
import { fetchPage, MAX_PAGE_BYTES, setNetHooks, type Transport, type TransportRequest } from "@/lib/net/safe-fetch";

const fake = {} as { clock: FakeClock };
beforeEach(() => {
  fake.clock = new FakeClock(Date.now());
  setClock(fake.clock);
});
afterEach(() => {
  setNetHooks();
  resetClock();
});

const PUBLIC = "93.184.216.34";
const resolveTo = (map: Record<string, string[]>) => async (host: string) => (map[host] ?? []).map((address) => ({ address }));

type Answer = { status?: number; headers?: Record<string, string>; body?: Buffer | Buffer[] };
function fakeTransport(answers: Record<string, Answer>) {
  const calls: TransportRequest[] = [];
  const destroyed: string[] = [];
  const read: string[] = [];
  const transport: Transport = async (req) => {
    calls.push(req);
    const a = answers[req.url.href];
    if (!a) throw new Error("connection refused");
    const chunks = Array.isArray(a.body) ? a.body : [a.body ?? Buffer.from("<html></html>")];
    return {
      status: a.status ?? 200,
      headers: a.headers ?? { "content-type": "text/html" },
      body: (async function* () {
        for (const c of chunks) {
          read.push(req.url.href);
          yield c;
        }
      })(),
      destroy: () => void destroyed.push(req.url.href),
    };
  };
  return { transport, calls, destroyed, read };
}

describe("fetchPage", () => {
  it("returns the bytes and content type of an HTML page", async () => {
    const { transport } = fakeTransport({ "https://example.test/a": { headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.from("<title>Hi</title>") } });
    setNetHooks({ resolve: resolveTo({ "example.test": [PUBLIC] }), transport });

    const page = await fetchPage("https://example.test/a");

    expect(page).toMatchObject({ ok: true, kind: "html", contentType: "text/html; charset=utf-8", finalUrl: "https://example.test/a" });
    expect(page.ok && page.kind === "html" && page.bytes.toString()).toBe("<title>Hi</title>");
  });

  it("keeps the first 512 KB of a bigger page instead of failing, and stops downloading", async () => {
    const chunk = Buffer.alloc(200 * 1024, "a");
    const { transport, destroyed, read } = fakeTransport({ "https://example.test/big": { body: [chunk, chunk, chunk, chunk, chunk] } });
    setNetHooks({ resolve: resolveTo({ "example.test": [PUBLIC] }), transport });

    const page = await fetchPage("https://example.test/big");

    expect(page.ok && page.kind === "html" && page.bytes.length).toBe(MAX_PAGE_BYTES);
    expect(destroyed).toEqual(["https://example.test/big"]);
    expect(read.length).toBe(3);
  });

  it("answers a link straight to a picture from the headers alone, without downloading it", async () => {
    const { transport, destroyed, read } = fakeTransport({ "https://example.test/cover.jpg": { headers: { "content-type": "image/jpeg" }, body: Buffer.alloc(1000) } });
    setNetHooks({ resolve: resolveTo({ "example.test": [PUBLIC] }), transport });

    const page = await fetchPage("https://example.test/cover.jpg");

    expect(page).toEqual({ ok: true, kind: "image", finalUrl: "https://example.test/cover.jpg" });
    expect(destroyed).toEqual(["https://example.test/cover.jpg"]);
    expect(read).toEqual([]);
  });

  it("refuses what is not a page or a raster picture: JSON, SVG, PDF, a missing type", async () => {
    for (const type of ["application/json", "image/svg+xml", "application/pdf", "text/plain", ""]) {
      const { transport } = fakeTransport({ "https://example.test/x": { headers: type ? { "content-type": type } : {} } });
      setNetHooks({ resolve: resolveTo({ "example.test": [PUBLIC] }), transport });
      expect(await fetchPage("https://example.test/x"), type).toMatchObject({ ok: false, reason: "bad_status" });
    }
  });

  it("refuses plain http, private addresses and names that resolve to them, odd ports and credentials", async () => {
    const { transport, calls } = fakeTransport({});
    setNetHooks({ resolve: resolveTo({ "intranet.example.test": ["10.0.0.5"], "mixed.example.test": [PUBLIC, "127.0.0.1"] }), transport });

    for (const url of ["http://example.test/", "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/latest/meta-data", "https://localhost/", "https://intranet.example.test/", "https://mixed.example.test/", "https://example.test:8443/", "https://user:pw@example.test/"]) {
      expect(await fetchPage(url), url).toMatchObject({ ok: false, reason: "blocked" });
    }
    expect(calls).toEqual([]);
  });

  it("checks every redirect: one to a private address is blocked, one to another public page is followed", async () => {
    const { transport } = fakeTransport({
      "https://example.test/go": { status: 302, headers: { location: "https://inside.example.test/secret" } },
      "https://example.test/ok": { status: 301, headers: { location: "/landing" } },
      "https://example.test/landing": { body: Buffer.from("<title>Landed</title>") },
    });
    setNetHooks({ resolve: resolveTo({ "example.test": [PUBLIC], "inside.example.test": ["192.168.0.10"] }), transport });

    expect(await fetchPage("https://example.test/go")).toMatchObject({ ok: false, reason: "blocked" });
    expect(await fetchPage("https://example.test/ok")).toMatchObject({ ok: true, kind: "html", finalUrl: "https://example.test/landing" });
  });

  it("fails quietly on an error status, a dead host and a name that does not resolve", async () => {
    const { transport } = fakeTransport({ "https://example.test/gone": { status: 404 } });
    setNetHooks({ resolve: resolveTo({ "example.test": [PUBLIC], "dead.example.test": [PUBLIC] }), transport });

    expect(await fetchPage("https://example.test/gone")).toMatchObject({ ok: false, reason: "bad_status" });
    expect(await fetchPage("https://dead.example.test/")).toMatchObject({ ok: false, reason: "network" });
    expect(await fetchPage("https://nowhere.example.test/")).toMatchObject({ ok: false, reason: "blocked" });
    expect(await fetchPage("not a url")).toMatchObject({ ok: false, reason: "invalid_url" });
  });

  it("gives up on a page that is too slow", async () => {
    const { transport } = fakeTransport({
      "https://example.test/slow": {
        body: [Buffer.from("a"), Buffer.from("b")],
      },
    });
    const slow: Transport = async (req) => {
      const res = await transport(req);
      return {
        ...res,
        body: (async function* () {
          for await (const c of res.body) {
            fake.clock.advance(20_000);
            yield c;
          }
        })(),
      };
    };
    setNetHooks({ resolve: resolveTo({ "example.test": [PUBLIC] }), transport: slow });

    expect(await fetchPage("https://example.test/slow")).toMatchObject({ ok: false, reason: "timeout" });
  });
});
