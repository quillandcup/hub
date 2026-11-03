import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ prepare: vi.fn(), upload: vi.fn() }));
vi.mock("@/app/(member)/chat/actions", () => ({ prepareChatUploads: m.prepare }));
vi.mock("@/lib/chat/upload-progress", async (original) => ({
  ...(await original<typeof import("@/lib/chat/upload-progress")>()),
  uploadWithProgress: m.upload,
}));

import { uploadStagedFiles } from "@/lib/chat/upload-client";

const file = (name: string) => new File(["x"], name, { type: "image/png" });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  m.prepare.mockReset();
  m.upload.mockReset();
});

describe("uploadStagedFiles", () => {
  it("uploads each file to its signed place and returns the staged uploads in order", async () => {
    m.prepare.mockResolvedValue({ ok: true, uploads: [{ path: "staging/a", token: "t1" }, { path: "staging/b", token: "t2" }] });
    m.upload.mockImplementation(async ({ onProgress }: { onProgress: (n: number) => void }) => {
      onProgress(1);
      return { ok: true };
    });
    const progress = vi.fn();
    const result = await uploadStagedFiles([file("a.png"), file("b.png")], new AbortController().signal, progress);
    expect(result).toEqual({
      ok: true,
      uploads: [
        { path: "staging/a", name: "a.png", mimetype: "image/png", size: 1 },
        { path: "staging/b", name: "b.png", mimetype: "image/png", size: 1 },
      ],
    });
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it("gives the reason when the places can't be prepared, or when the preparing call throws", async () => {
    m.prepare.mockResolvedValue({ ok: false, error: "Attach up to 10 files at a time." });
    expect(await uploadStagedFiles([file("a.png")], new AbortController().signal)).toEqual({ ok: false, error: "Attach up to 10 files at a time." });
    m.prepare.mockRejectedValue(new Error("down"));
    expect(await uploadStagedFiles([file("a.png")], new AbortController().signal)).toEqual({ ok: false, error: "Couldn't start the upload. Try again." });
  });

  it("names the file that failed, and says aborted when cancelled", async () => {
    m.prepare.mockResolvedValue({ ok: true, uploads: [{ path: "staging/a", token: "t1" }] });
    m.upload.mockResolvedValue({ ok: false, reason: "network" });
    expect(await uploadStagedFiles([file("a.png")], new AbortController().signal)).toEqual({ ok: false, error: "Couldn't upload a.png. Try again." });
    const controller = new AbortController();
    controller.abort();
    expect(await uploadStagedFiles([file("a.png")], controller.signal)).toEqual({ ok: false, error: "aborted" });
  });
});
