// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { signedUploadUrl, uploadWithProgress } from "@/lib/chat/upload-progress";

class FakeXhr {
  static last: FakeXhr;
  headers: Record<string, string> = {};
  method = "";
  url = "";
  status = 0;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  sent: unknown;
  aborted = false;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

afterEach(() => vi.unstubAllGlobals());

const file = new File(["12345"], "a.txt", { type: "text/plain" });
const start = (extra: Partial<Parameters<typeof uploadWithProgress>[0]> = {}) => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return uploadWithProgress({ url: "https://x/y", file, contentType: "text/plain", ...extra });
};

describe("signedUploadUrl", () => {
  it("builds the storage URL and drops empty path segments", () => {
    expect(signedUploadUrl("https://p.supabase.co/", "slack-files", "staging//d/a b.png", "tok")).toBe(
      "https://p.supabase.co/storage/v1/object/upload/sign/slack-files/staging/d/a%20b.png?token=tok",
    );
  });
});

describe("uploadWithProgress", () => {
  it("reports bytes, sends headers and the file, and resolves ok", async () => {
    const onProgress = vi.fn();
    const p = start({ apiKey: "key", onProgress });
    const x = FakeXhr.last;
    expect(x.method).toBe("PUT");
    expect(x.headers).toMatchObject({ "content-type": "text/plain", apikey: "key", "x-upsert": "false" });
    expect(x.sent).toBe(file);
    x.upload.onprogress!({ lengthComputable: false, loaded: 1 });
    x.upload.onprogress!({ lengthComputable: true, loaded: 3 });
    x.upload.onprogress!({ lengthComputable: true, loaded: 99 });
    x.status = 200;
    x.onload!();
    expect(await p).toEqual({ ok: true });
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([3, 5, 5]);
  });

  it("works without a key or progress callback", async () => {
    const p = start();
    expect(FakeXhr.last.headers.apikey).toBeUndefined();
    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 1 });
    FakeXhr.last.status = 204;
    FakeXhr.last.onload!();
    expect(await p).toEqual({ ok: true });
  });

  it("reports an HTTP error", async () => {
    const p = start();
    FakeXhr.last.status = 413;
    FakeXhr.last.onload!();
    expect(await p).toEqual({ ok: false, reason: "http", status: 413 });
  });

  it("reports network errors and timeouts", async () => {
    let p = start();
    FakeXhr.last.onerror!();
    expect(await p).toEqual({ ok: false, reason: "network" });
    p = start();
    FakeXhr.last.ontimeout!();
    expect(await p).toEqual({ ok: false, reason: "network" });
  });

  it("aborts through the signal", async () => {
    const ctl = new AbortController();
    const p = start({ signal: ctl.signal });
    ctl.abort();
    expect(FakeXhr.last.aborted).toBe(true);
    expect(await p).toEqual({ ok: false, reason: "aborted" });
  });

  it("does not start when already aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const before = FakeXhr.last;
    expect(await start({ signal: ctl.signal })).toEqual({ ok: false, reason: "aborted" });
    expect(FakeXhr.last).toBe(before);
  });
});
