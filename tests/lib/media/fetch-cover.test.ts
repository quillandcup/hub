import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import type { SupabaseClient } from "@supabase/supabase-js";
import { server } from "../../setup-msw";
import { fetchLegacyCover, isPublicAddress } from "@/lib/media/fetch-cover";

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

describe("fetchLegacyCover: a link to another site", () => {
  it("downloads a picture from a public address", async () => {
    server.use(http.get("https://pics.example.test/cover.jpg", () => new HttpResponse(BYTES)));
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://pics.example.test/cover.jpg", PUBLIC)).toEqual({ bytes: BYTES });
  });

  it("refuses an address on a private network, localhost, a bare private IP and a non-http link, without asking it for anything", async () => {
    const hit = vi.fn(() => new HttpResponse(BYTES));
    server.use(http.get("https://*/*", hit), http.get("http://*/*", hit));
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://pics.example.test/c.jpg", PRIVATE)).toEqual({ error: "not a public address" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "http://localhost/c.jpg", PUBLIC)).toEqual({ error: "not a public address" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "http://metadata.internal/c.jpg", PUBLIC)).toEqual({ error: "not a public address" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "http://169.254.169.254/latest/meta-data", PUBLIC)).toEqual({ error: "not a public address" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "http://[::1]/c.jpg", PUBLIC)).toEqual({ error: "not a public address" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "ftp://pics.example.test/c.jpg", PUBLIC)).toEqual({ error: "not an http(s) link" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://pics.example.test:8443/c.jpg", PUBLIC)).toEqual({ error: "unusual port" });
    expect(hit).not.toHaveBeenCalled();
  });

  it("reports a link that is not a link, and a name that doesn't resolve", async () => {
    expect(await fetchLegacyCover(storage(), SUPABASE, "not a url", PUBLIC)).toEqual({ error: "not a valid link" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://nowhere.example.test/c.jpg", async () => [])).toEqual({ error: "the address doesn't resolve" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://nowhere.example.test/c.jpg", async () => Promise.reject(new Error("ENOTFOUND")))).toEqual({ error: "the address doesn't resolve" });
  });

  it("follows a redirect to another public address, and checks every hop", async () => {
    server.use(
      http.get("https://short.example.test/c", () => new HttpResponse(null, { status: 302, headers: { location: "https://cdn.example.test/real.jpg" } })),
      http.get("https://cdn.example.test/real.jpg", () => new HttpResponse(BYTES)),
      http.get("https://sneaky.example.test/c", () => new HttpResponse(null, { status: 301, headers: { location: "http://169.254.169.254/latest/meta-data" } }))
    );
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://short.example.test/c", PUBLIC)).toEqual({ bytes: BYTES });
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://sneaky.example.test/c", PUBLIC)).toEqual({ error: "not a public address" });
  });

  it("gives up on a redirect loop or a redirect that says nowhere", async () => {
    server.use(
      http.get("https://loop.example.test/a", () => new HttpResponse(null, { status: 302, headers: { location: "https://loop.example.test/a" } })),
      http.get("https://lost.example.test/a", () => new HttpResponse(null, { status: 302 }))
    );
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://loop.example.test/a", PUBLIC)).toEqual({ error: "too many redirects" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://lost.example.test/a", PUBLIC)).toEqual({ error: "redirected (HTTP 302) without saying where" });
  });

  it("reports an error status and a download that fails", async () => {
    server.use(http.get("https://gone.example.test/c.jpg", () => new HttpResponse(null, { status: 404 })), http.get("https://down.example.test/c.jpg", () => HttpResponse.error()));
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://gone.example.test/c.jpg", PUBLIC)).toEqual({ error: "HTTP 404" });
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://down.example.test/c.jpg", PUBLIC)).toEqual({ error: "couldn't download it" });
  });

  it("refuses a file that announces it is too large, before reading it", async () => {
    server.use(http.get("https://huge.example.test/declared.jpg", () => new HttpResponse(BYTES, { headers: { "content-length": String(50 * 1024 * 1024) } })));
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://huge.example.test/declared.jpg", PUBLIC)).toEqual({ error: "larger than 10 MB" });
  });

  it("stops reading a file that turns out too large while it streams", async () => {
    server.use(http.get("https://huge.example.test/streamed.jpg", () => new HttpResponse(Buffer.alloc(10 * 1024 * 1024 + 1))));
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://huge.example.test/streamed.jpg", PUBLIC)).toEqual({ error: "larger than 10 MB" });
  });

  it("returns an empty body as it is (the image check then refuses it)", async () => {
    server.use(http.get("https://empty.example.test/c.jpg", () => new HttpResponse(null, { status: 200 })));
    expect(await fetchLegacyCover(storage(), SUPABASE, "https://empty.example.test/c.jpg", PUBLIC)).toEqual({ bytes: Buffer.alloc(0) });
  });
});
