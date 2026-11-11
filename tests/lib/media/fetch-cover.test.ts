import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLegacyCover, isPublicAddress } from "@/lib/media/fetch-cover";
import { setNetHooks, type Transport, type TransportRequest } from "@/lib/net/safe-fetch";

const SUPABASE = "http://127.0.0.1:54321";
const PUBLIC = async () => [{ address: "93.184.216.34" }];
const PRIVATE = async () => [{ address: "10.0.0.5" }];
const storage = (download: (path: string) => unknown = () => ({ data: null, error: { message: "gone" } })) =>
  ({ from: vi.fn((bucket: string) => ({ download: vi.fn(async (path: string) => download(`${bucket}/${path}`)) })) }) as unknown as SupabaseClient["storage"];
const BYTES = Buffer.from([1, 2, 3, 4]);

describe("isPublicAddress", () => {
  it("accepts addresses on the open internet", () => {
    for (const ok of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.255.255", "2606:2800:220:1:248:1893:25c8:1946"]) expect(isPublicAddress(ok), ok).toBe(true);
  });

  it("refuses this machine, private networks, link-local, carrier-grade NAT, multicast and anything malformed", () => {
    for (const bad of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "224.0.0.1", "255.255.255.255", "192.0.0.1", "::", "::1", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "::ffff:10.0.0.1", "999.1.1.1", "nope"]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });
});

describe("fetchLegacyCover: our own bucket", () => {
  it("reads a cover in the book-covers bucket from storage, by its path", async () => {
    const reads: string[] = [];
    const fake = storage((path) => (reads.push(path), { data: new Blob([BYTES]), error: null }));
    const result = await fetchLegacyCover(fake, SUPABASE, `${SUPABASE}/storage/v1/object/public/book-covers/mbr_AAAAAAAAAAA1/some%20cover.jpg?t=1`);
    expect(reads).toEqual(["book-covers/mbr_AAAAAAAAAAA1/some cover.jpg"]);
    expect(result).toEqual({ bytes: BYTES });
  });

  it("says when the file is gone", async () => {
    expect(await fetchLegacyCover(storage(), SUPABASE, `${SUPABASE}/storage/v1/object/public/book-covers/x.jpg`)).toEqual({ error: "the file is gone from the book-covers bucket" });
  });
});

describe("fetchLegacyCover: a link to another site (pinned fetch)", () => {
  type Answer = { status?: number; headers?: Record<string, string>; body?: Buffer | Buffer[] };
  /** Installs a name lookup and a socket that answer from tables, and records every request that reached the socket. */
  function net(answers: Record<string, Answer>, resolve: (host: string) => Promise<{ address: string }[]> = PUBLIC) {
    const calls: TransportRequest[] = [];
    const transport: Transport = async (req) => {
      calls.push(req);
      const a = answers[req.url.href];
      if (!a) throw new Error("connection refused");
      const chunks = Array.isArray(a.body) ? a.body : [a.body ?? BYTES];
      return {
        status: a.status ?? 200,
        headers: a.headers ?? {},
        body: (async function* () {
          for (const c of chunks) yield c;
        })(),
        destroy: () => {},
      };
    };
    setNetHooks({ resolve, transport });
    return calls;
  }
  afterEach(() => setNetHooks());
  const get = (url: string) => fetchLegacyCover(storage(), SUPABASE, url);

  it("downloads a picture from a public address, connecting to the address it resolved", async () => {
    const calls = net({ "https://pics.example.test/cover.jpg": {} });
    expect(await get("https://pics.example.test/cover.jpg")).toEqual({ bytes: BYTES });
    expect(calls.map((c) => c.address)).toEqual(["93.184.216.34"]);
  });

  it("refuses plain http, whatever the address, without connecting", async () => {
    const calls = net({ "http://pics.example.test/c.jpg": {}, "http://93.184.216.34/c.jpg": {} });
    expect(await get("http://pics.example.test/c.jpg")).toEqual({ error: "not an https link" });
    expect(await get("http://93.184.216.34/c.jpg")).toEqual({ error: "not an https link" });
    expect(calls).toHaveLength(0);
  });

  it("refuses an https link that redirects to plain http", async () => {
    const calls = net({ "https://short.example.test/c": { status: 302, headers: { location: "http://cdn.example.test/real.jpg" } }, "http://cdn.example.test/real.jpg": {} });
    expect(await get("https://short.example.test/c")).toEqual({ error: "not an https link" });
    expect(calls).toHaveLength(1);
  });

  it("refuses private networks, localhost, link-local and odd ports, without connecting", async () => {
    const calls = net({}, PRIVATE);
    expect(await get("https://pics.example.test/c.jpg")).toEqual({ error: "not a public address" });
    net({});
    expect(await get("https://localhost/c.jpg")).toEqual({ error: "not a public address" });
    expect(await get("https://metadata.internal/c.jpg")).toEqual({ error: "not a public address" });
    expect(await get("https://169.254.169.254/latest/meta-data")).toEqual({ error: "not a public address" });
    expect(await get("https://[::1]/c.jpg")).toEqual({ error: "not a public address" });
    expect(await get("ftp://pics.example.test/c.jpg")).toEqual({ error: "not an https link" });
    expect(await get("https://pics.example.test:8443/c.jpg")).toEqual({ error: "unusual port" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a name with any private answer (rebinding), and never connects to a redirect's private target", async () => {
    const calls = net({ "https://sneaky.example.test/c": { status: 301, headers: { location: "https://169.254.169.254/latest/meta-data" } } });
    expect(await get("https://sneaky.example.test/c")).toEqual({ error: "not a public address" });
    expect(calls).toHaveLength(1);
    net({}, async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }]);
    expect(await get("https://mixed.example.test/c")).toEqual({ error: "not a public address" });
  });

  it("reports a link that is not a link, and a name that doesn't resolve", async () => {
    net({});
    expect(await get("not a url")).toEqual({ error: "not a valid link" });
    net({}, async () => []);
    expect(await get("https://nowhere.example.test/c.jpg")).toEqual({ error: "the address doesn't resolve" });
    net({}, async () => Promise.reject(new Error("ENOTFOUND")));
    expect(await get("https://nowhere.example.test/c.jpg")).toEqual({ error: "the address doesn't resolve" });
  });

  it("follows a redirect to another public address", async () => {
    net({ "https://short.example.test/c": { status: 302, headers: { location: "https://cdn.example.test/real.jpg" } }, "https://cdn.example.test/real.jpg": {} });
    expect(await get("https://short.example.test/c")).toEqual({ bytes: BYTES });
  });

  it("gives up on a redirect loop or a redirect that says nowhere", async () => {
    net({ "https://loop.example.test/a": { status: 302, headers: { location: "https://loop.example.test/a" } }, "https://lost.example.test/a": { status: 302 } });
    expect(await get("https://loop.example.test/a")).toEqual({ error: "too many redirects" });
    expect(await get("https://lost.example.test/a")).toEqual({ error: "redirected (HTTP 302) without saying where" });
  });

  it("reports an error status and a download that fails", async () => {
    net({ "https://gone.example.test/c.jpg": { status: 404 } });
    expect(await get("https://gone.example.test/c.jpg")).toEqual({ error: "HTTP 404" });
    expect(await get("https://down.example.test/c.jpg")).toEqual({ error: "couldn't download it" });
  });

  it("refuses a file that announces it is too large, and one that turns out too large while it streams", async () => {
    net({
      "https://huge.example.test/declared.jpg": { headers: { "content-length": String(50 * 1024 * 1024) } },
      "https://huge.example.test/streamed.jpg": { body: [Buffer.alloc(6 * 1024 * 1024), Buffer.alloc(5 * 1024 * 1024)] },
    });
    expect(await get("https://huge.example.test/declared.jpg")).toEqual({ error: "larger than 10 MB" });
    expect(await get("https://huge.example.test/streamed.jpg")).toEqual({ error: "larger than 10 MB" });
  });

  it("accepts a cover between the proxy's 5 MB cap and the cover cap of 10 MB", async () => {
    net({ "https://big.example.test/c.jpg": { body: Buffer.alloc(7 * 1024 * 1024) } });
    const got = await get("https://big.example.test/c.jpg");
    expect("bytes" in got && got.bytes.length).toBe(7 * 1024 * 1024);
  });
});
