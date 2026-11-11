import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClock } from "../../helpers/fake-clock";
import { resetClock, setClock } from "@/lib/clock";
import { fetchImage, isPublicAddress, nodeTransport, safeGet, setNetHooks, sniffImageType, type Transport, type TransportRequest } from "@/lib/net/safe-fetch";

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
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const bytesOf = (...s: string[]) => Buffer.from(s.join(""), "latin1");

/** A transport that answers from a table of address -> response and records every request it was asked to make. */
function fakeTransport(answers: Record<string, { status?: number; headers?: Record<string, string>; body?: Buffer | Buffer[] }>) {
  const calls: TransportRequest[] = [];
  const destroyed: string[] = [];
  const transport: Transport = async (req) => {
    calls.push(req);
    const a = answers[req.url.href];
    if (!a) throw new Error("connection refused");
    const chunks = Array.isArray(a.body) ? a.body : [a.body ?? png];
    return {
      status: a.status ?? 200,
      headers: a.headers ?? {},
      body: (async function* () {
        for (const c of chunks) yield c;
      })(),
      destroy: () => void destroyed.push(req.url.href),
    };
  };
  return { transport, calls, destroyed };
}
const resolveTo = (map: Record<string, string[]>) => async (host: string) => (map[host] ?? []).map((address) => ({ address }));

describe("isPublicAddress", () => {
  it("accepts the open internet", () => {
    for (const ok of [PUBLIC, "8.8.8.8", "172.32.0.1", "100.63.255.255", "2606:2800:220:1:248:1893:25c8:1946"]) expect(isPublicAddress(ok), ok).toBe(true);
  });

  it("refuses this machine, private, link-local, shared, benchmark, reserved ranges and IPv4 hidden in IPv6", () => {
    for (const bad of ["0.0.0.0", "127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::", "::1", "fe80::1", "fd12::1", "64:ff9b::1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "nope"]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });
});

describe("sniffImageType", () => {
  it("names the allowed raster types by their first bytes", () => {
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(bytesOf("GIF89a", "\0\0\0"))).toBe("image/gif");
    expect(sniffImageType(bytesOf("RIFF", "\0\0\0\0", "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(bytesOf("\0\0\0\x1c", "ftypavif", "\0\0\0\0"))).toBe("image/avif");
  });

  it("does not know SVG, HTML, text or nothing", () => {
    for (const other of ['<svg xmlns="http://www.w3.org/2000/svg"/>', "<html><script>alert(1)</script>", "hello", ""]) expect(sniffImageType(Buffer.from(other))).toBeNull();
  });
});

describe("safeGet: which addresses it will touch", () => {
  const refused = async (url: string, resolve: Record<string, string[]> = {}, allowHttp = false) => {
    const t = fakeTransport({});
    setNetHooks({ resolve: resolveTo(resolve), transport: t.transport });
    const result = await safeGet(url, { maxBytes: 100, timeoutMs: 1000, allowHttp });
    return { result, calls: t.calls };
  };

  it.each([
    ["localhost", "https://localhost/a.png"],
    ["a .localhost name", "https://app.localhost/a.png"],
    ["an .internal name", "https://db.internal/a.png"],
    ["loopback", "https://127.0.0.1/a.png"],
    ["the cloud metadata address", "https://169.254.169.254/latest/meta-data"],
    ["a private range", "https://10.0.0.5/a.png"],
    ["another private range", "https://192.168.1.1/a.png"],
    ["IPv6 loopback", "https://[::1]/a.png"],
    ["IPv4 inside IPv6", "https://[::ffff:10.0.0.1]/a.png"],
    ["a decimal spelling of loopback", "https://2130706433/a.png"],
    ["an unusual port", `https://${PUBLIC}:8443/a.png`],
    ["credentials in the address", `https://user:pass@${PUBLIC}/a.png`],
    ["plain http", `http://${PUBLIC}/a.png`],
    ["another scheme", "file:///etc/passwd"],
  ])("refuses %s without connecting", async (_name, url) => {
    const { result, calls } = await refused(url);
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(calls).toEqual([]);
  });

  it("refuses a name that resolves to a private address, or to a private one among public ones, or to nothing", async () => {
    for (const answers of [["10.0.0.5"], [PUBLIC, "169.254.169.254"], []]) {
      const { result, calls } = await refused("https://pictures.example.test/a.png", { "pictures.example.test": answers });
      expect(result).toMatchObject({ ok: false, reason: "blocked" });
      expect(calls).toEqual([]);
    }
  });

  it("says a link that is not a link is invalid", async () => {
    expect((await refused("not a url")).result).toMatchObject({ ok: false, reason: "invalid_url" });
  });

  it("allows http only when the caller does", async () => {
    const t = fakeTransport({ [`http://${PUBLIC}/a.png`]: {} });
    setNetHooks({ transport: t.transport });
    expect(await safeGet(`http://${PUBLIC}/a.png`, { maxBytes: 100, timeoutMs: 1000, allowHttp: true })).toMatchObject({ ok: true });
  });
});

describe("safeGet: connecting", () => {
  it("connects to the address it checked, resolving the name once, and sends nothing of ours", async () => {
    const resolve = vi.fn(resolveTo({ "pictures.example.test": [PUBLIC] }));
    const t = fakeTransport({ "https://pictures.example.test/a.png": { headers: { "content-type": "image/png", "set-cookie": "a=b" } } });
    setNetHooks({ resolve, transport: t.transport });
    const result = await safeGet("https://pictures.example.test/a.png", { maxBytes: 1000, timeoutMs: 1000, accept: "image/png" });
    expect(result).toMatchObject({ ok: true, contentType: "image/png", finalUrl: "https://pictures.example.test/a.png" });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(t.calls[0].address).toBe(PUBLIC);
    expect(t.calls[0].headers).toEqual({ accept: "image/png", "accept-encoding": "identity" });
  });

  it("follows redirects by hand and checks every hop: one to a private address is refused", async () => {
    const t = fakeTransport({
      "https://a.example.test/1": { status: 302, headers: { location: "https://b.example.test/2" } },
      "https://b.example.test/2": { status: 301, headers: { location: "https://169.254.169.254/latest" } },
    });
    setNetHooks({ resolve: resolveTo({ "a.example.test": [PUBLIC], "b.example.test": [PUBLIC] }), transport: t.transport });
    expect(await safeGet("https://a.example.test/1", { maxBytes: 100, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "blocked" });
    expect(t.calls.map((c) => c.url.href)).toEqual(["https://a.example.test/1", "https://b.example.test/2"]);
    expect(t.destroyed).toHaveLength(2);
  });

  it("refuses a redirect to a name that now resolves privately (rebinding between hops)", async () => {
    let answers = [PUBLIC];
    const t = fakeTransport({ "https://a.example.test/1": { status: 302, headers: { location: "https://rebind.example.test/x" } } });
    setNetHooks({ resolve: async (h) => (h === "a.example.test" ? [{ address: PUBLIC }] : answers.map((address) => ({ address }))), transport: t.transport });
    answers = ["127.0.0.1"];
    expect(await safeGet("https://a.example.test/1", { maxBytes: 100, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("follows a short chain, resolves a relative location, and gives up after three redirects", async () => {
    const ok = fakeTransport({
      "https://a.example.test/1": { status: 302, headers: { location: "/2" } },
      "https://a.example.test/2": {},
    });
    setNetHooks({ resolve: resolveTo({ "a.example.test": [PUBLIC] }), transport: ok.transport });
    expect(await safeGet("https://a.example.test/1", { maxBytes: 100, timeoutMs: 1000 })).toMatchObject({ ok: true, finalUrl: "https://a.example.test/2" });

    const loop = fakeTransport({ "https://a.example.test/1": { status: 302, headers: { location: "/1" } } });
    setNetHooks({ resolve: resolveTo({ "a.example.test": [PUBLIC] }), transport: loop.transport });
    expect(await safeGet("https://a.example.test/1", { maxBytes: 100, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "too_many_redirects" });
    expect(loop.calls).toHaveLength(4);
  });

  it("reports a redirect with no place to go, one to a non-link, an error status and a refused connection", async () => {
    const t = fakeTransport({
      "https://a.example.test/nowhere": { status: 302 },
      "https://a.example.test/odd": { status: 302, headers: { location: "http://" } },
      "https://a.example.test/missing": { status: 404 },
    });
    setNetHooks({ resolve: resolveTo({ "a.example.test": [PUBLIC] }), transport: t.transport });
    const get = (path: string) => safeGet(`https://a.example.test/${path}`, { maxBytes: 100, timeoutMs: 1000 });
    expect(await get("nowhere")).toMatchObject({ ok: false, reason: "bad_status" });
    expect(await get("odd")).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(await get("missing")).toMatchObject({ ok: false, reason: "bad_status" });
    expect(await get("down")).toMatchObject({ ok: false, reason: "network" });
  });

  it("stops at a declared size over the limit, and at the limit while streaming without a declared size", async () => {
    const t = fakeTransport({
      "https://a.example.test/declared": { headers: { "content-length": "101" }, body: Buffer.alloc(10) },
      "https://a.example.test/streamed": { body: [Buffer.alloc(60), Buffer.alloc(60)] },
    });
    setNetHooks({ resolve: resolveTo({ "a.example.test": [PUBLIC] }), transport: t.transport });
    expect(await safeGet("https://a.example.test/declared", { maxBytes: 100, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "too_large" });
    expect(await safeGet("https://a.example.test/streamed", { maxBytes: 100, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "too_large" });
    expect(t.destroyed).toEqual(["https://a.example.test/declared", "https://a.example.test/streamed"]);
  });

  it("gives up when the time budget runs out between chunks", async () => {
    const transport: Transport = async () => ({
      status: 200,
      headers: {},
      body: (async function* () {
        yield Buffer.alloc(1);
        fake.clock.advance(5000);
        yield Buffer.alloc(1);
      })(),
      destroy: () => {},
    });
    setNetHooks({ resolve: resolveTo({ "a.example.test": [PUBLIC] }), transport });
    expect(await safeGet("https://a.example.test/slow", { maxBytes: 100, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("gives up before a request when the budget is already spent by earlier hops", async () => {
    setNetHooks({
      resolve: async (h) => {
        fake.clock.advance(5000);
        return [{ address: h === "a.example.test" ? PUBLIC : PUBLIC }];
      },
      transport: fakeTransport({}).transport,
    });
    expect(await safeGet("https://a.example.test/1", { maxBytes: 100, timeoutMs: 1000 })).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("lets the caller turn a response away from its headers alone", async () => {
    const t = fakeTransport({ "https://a.example.test/1": { headers: { "content-type": "text/html" } } });
    setNetHooks({ resolve: resolveTo({ "a.example.test": [PUBLIC] }), transport: t.transport });
    const result = await safeGet("https://a.example.test/1", { maxBytes: 100, timeoutMs: 1000, acceptResponse: (h) => h["content-type"] === "image/png" });
    expect(result).toMatchObject({ ok: false, reason: "bad_status" });
  });
});

describe("fetchImage", () => {
  const serve = (body: Buffer, headers: Record<string, string> = {}) => {
    const t = fakeTransport({ "https://pictures.example.test/p": { body, headers } });
    setNetHooks({ resolve: resolveTo({ "pictures.example.test": [PUBLIC] }), transport: t.transport });
  };

  it("returns the bytes with the type the bytes show, whatever the server says", async () => {
    serve(png, { "content-type": "text/plain" });
    expect(await fetchImage("https://pictures.example.test/p")).toMatchObject({ ok: true, contentType: "image/png", bytes: png });
  });

  it("refuses SVG, HTML dressed as an image, and anything over 5 MB", async () => {
    serve(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { "content-type": "image/svg+xml" });
    expect(await fetchImage("https://pictures.example.test/p")).toMatchObject({ ok: false, reason: "not_image" });
    serve(Buffer.from("<html>"), { "content-type": "image/png" });
    expect(await fetchImage("https://pictures.example.test/p")).toMatchObject({ ok: false, reason: "not_image" });
    serve(png, { "content-length": String(5 * 1024 * 1024 + 1) });
    expect(await fetchImage("https://pictures.example.test/p")).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("refuses plain http", async () => {
    expect(await fetchImage(`http://${PUBLIC}/p`)).toMatchObject({ ok: false, reason: "blocked" });
  });
});

describe("nodeTransport: the pinned connection", () => {
  it("connects to the pinned address while the URL's name stays in Host, and returns the status, headers and body", async () => {
    let seen: http.IncomingHttpHeaders = {};
    const server = http.createServer((req, res) => {
      seen = req.headers;
      res.writeHead(200, { "content-type": "image/png", "x-extra": "1" });
      res.end(png);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      // The name does not exist: only the pinned address can have answered.
      const url = new URL(`http://pinned.invalid:${port}/p.png`);
      const res = await nodeTransport({ url, address: "127.0.0.1", headers: { accept: "image/png", "accept-encoding": "identity" }, signal: new AbortController().signal });
      const chunks: Uint8Array[] = [];
      for await (const c of res.body) chunks.push(c);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(Buffer.concat(chunks)).toEqual(png);
      expect(seen.host).toBe(`pinned.invalid:${port}`);
      expect(seen.cookie).toBeUndefined();
      expect(seen.referer).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("rejects when nothing is listening", async () => {
    await expect(nodeTransport({ url: new URL("http://pinned.invalid:1/"), address: "127.0.0.1", headers: {}, signal: new AbortController().signal })).rejects.toThrow();
  });
});
