import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { http, HttpResponse } from "msw";
import { server } from "../setup-msw";
import { makeTrackbearCoverCopier } from "@/lib/trackbear-cover";
import type { SupabaseClient } from "@supabase/supabase-js";

const COVER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";

function makeStorageMock(uploadError: { message: string } | null = null) {
  const upload = vi.fn().mockResolvedValue({ error: uploadError });
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }));
  const supabase = { storage: { from: vi.fn(() => ({ upload, getPublicUrl })) } } as unknown as SupabaseClient;
  return { supabase, upload };
}

describe("makeTrackbearCoverCopier", () => {
  it("downloads a TrackBear cover and stores it as a 145x215 JPEG in the member's folder", async () => {
    const webp = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#336699" } }).webp().toBuffer();
    server.use(http.get(`https://trackbear.app/uploads/covers/${COVER}`, () => new HttpResponse(webp)));
    const { supabase, upload } = makeStorageMock();

    const result = await makeTrackbearCoverCopier(supabase)(COVER, "member-1");

    expect(result).toEqual({ url: expect.stringMatching(/^https:\/\/cdn\.test\/member-1\/.+\.jpg$/), resizedFrom: "600×900" });
    const [path, bytes, opts] = upload.mock.calls[0];
    expect(path).toMatch(/^member-1\/.+\.jpg$/);
    expect(opts).toEqual({ contentType: "image/jpeg" });
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 145, 215]);
  });

  it("refuses filenames that aren't TrackBear's <uuid>.<ext> shape", async () => {
    const { supabase, upload } = makeStorageMock();
    const result = await makeTrackbearCoverCopier(supabase)("../../etc/passwd", "member-1");
    expect(result).toEqual({ error: expect.any(String) });
    expect(upload).not.toHaveBeenCalled();
  });

  it("reports a missing cover instead of throwing", async () => {
    server.use(http.get(`https://trackbear.app/uploads/covers/${COVER}`, () => new HttpResponse(null, { status: 404 })));
    const { supabase } = makeStorageMock();
    const result = await makeTrackbearCoverCopier(supabase)(COVER, "member-1");
    expect(result).toEqual({ error: expect.stringMatching(/HTTP 404/) });
  });
});
