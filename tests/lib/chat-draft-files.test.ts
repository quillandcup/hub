import { describe, expect, it, vi } from "vitest";
import { ownDraftFiles, withPreviewUrls } from "@/lib/chat/draft-files";

const me = "mbr_AAAAAAAAAAA1";
const path = (name: string, who = me) => `staging/2026-11-02/${who}-00000000-0000-4000-8000-000000000000/${name}`;
const file = (name: string, mimetype = "image/png") => ({ path: path(name), name, mimetype, size: 4 });

describe("withPreviewUrls", () => {
  const service = (result: { data: { path: string | null; signedUrl: string }[] | null; error: { message: string } | null }) => {
    const createSignedUrls = vi.fn(async () => result);
    return { createSignedUrls, client: { storage: { from: () => ({ createSignedUrls }) } } as never };
  };

  it("signs a link for each image of the member's own and none for other files", async () => {
    const s = service({ data: [{ path: path("a.png"), signedUrl: "https://s/a" }], error: null });
    const out = await withPreviewUrls(s.client, me, [file("a.png"), file("n.pdf", "application/pdf")]);
    expect(out.map((f) => f.url)).toEqual(["https://s/a", null]);
    expect(s.createSignedUrls).toHaveBeenCalledWith([path("a.png")], 3600);
  });

  it("does not ask for a path that is not the member's", async () => {
    const s = service({ data: [], error: null });
    const out = await withPreviewUrls(s.client, me, [{ ...file("a.png"), path: path("a.png", "mbr_BBBBBBBBBBB2") }]);
    expect(out[0].url).toBeNull();
    expect(s.createSignedUrls).not.toHaveBeenCalled();
  });

  it("lists the files without previews when signing fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = service({ data: null, error: { message: "nope" } });
    expect((await withPreviewUrls(s.client, me, [file("a.png")])).map((f) => f.url)).toEqual([null]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("ownDraftFiles", () => {
  it("keeps well-formed own staged files up to the limit and drops everything else", () => {
    const good = [file("a.png"), file("b.png"), file("c.png")];
    const bad = [null, "x", { ...file("d.png"), path: path("d.png", "mbr_BBBBBBBBBBB2") }, { ...file("e.png"), name: "" }, { ...file("f.png"), size: -1 }];
    expect(ownDraftFiles(me, [...bad, ...good], 2)).toEqual([file("a.png"), file("b.png")]);
    expect(ownDraftFiles(me, "nope", 10)).toEqual([]);
  });

  it("falls back to a generic type and trims long names", () => {
    const [f] = ownDraftFiles(me, [{ ...file("a.png"), mimetype: 5, name: "n".repeat(300) }], 10);
    expect(f.mimetype).toBe("application/octet-stream");
    expect(f.name).toHaveLength(200);
  });
});
