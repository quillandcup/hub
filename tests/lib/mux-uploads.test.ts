import { describe, expect, it, vi } from "vitest";
import type Mux from "@mux/ts";
import { createDirectUpload, getUploadStatus, uploadAssetFromEvent } from "@/lib/mux";

const fakeMux = (uploads: { create?: ReturnType<typeof vi.fn>; retrieve?: ReturnType<typeof vi.fn> }) => ({ video: { uploads } }) as unknown as Mux;

describe("createDirectUpload", () => {
  it("asks Mux for an upload the page may send to, whose asset plays signed at 1080p at the chosen quality", async () => {
    const create = vi.fn(async () => ({ id: "up_1", url: "https://storage.example/upload" }));
    const result = await createDirectUpload(fakeMux({ create }), { corsOrigin: "https://hub.example", quality: "plus" });

    expect(result).toEqual({ uploadId: "up_1", url: "https://storage.example/upload" });
    expect(create).toHaveBeenCalledWith({
      cors_origin: "https://hub.example",
      new_asset_settings: { playback_policies: ["signed"], video_quality: "plus", max_resolution_tier: "1080p" },
    });
  });

  it("fails when Mux gives no address to send to", async () => {
    const create = vi.fn(async () => ({ id: "up_1" }));
    await expect(createDirectUpload(fakeMux({ create }), { corsOrigin: "https://hub.example", quality: "plus" })).rejects.toThrow("no address");
  });
});

describe("getUploadStatus", () => {
  const status = async (upload: object) => getUploadStatus(fakeMux({ retrieve: vi.fn(async () => upload) }), "up_1");

  it("says the upload is still waiting for the file", async () => {
    expect(await status({ status: "waiting" })).toEqual({ status: "waiting" });
  });

  it("gives the asset Mux made once the file is complete", async () => {
    expect(await status({ status: "asset_created", asset_id: "asset_1" })).toEqual({ status: "asset_created", assetId: "asset_1" });
  });

  it("calls an errored, cancelled or timed out upload failed, and a complete one with no asset too", async () => {
    for (const s of ["errored", "cancelled", "timed_out"]) expect(await status({ status: s })).toEqual({ status: "failed" });
    expect(await status({ status: "asset_created" })).toEqual({ status: "failed" });
  });
});

describe("uploadAssetFromEvent", () => {
  it("reads the upload and asset a video.upload.asset_created event links", () => {
    expect(uploadAssetFromEvent({ type: "video.upload.asset_created", data: { id: "up_1", asset_id: "asset_1" } })).toEqual({ uploadId: "up_1", assetId: "asset_1" });
  });

  it("ignores other events and events with nothing to link", () => {
    expect(uploadAssetFromEvent({ type: "video.asset.ready", data: { id: "asset_1" } })).toBeNull();
    expect(uploadAssetFromEvent({ type: "video.upload.asset_created", data: { id: "up_1" } })).toBeNull();
    expect(uploadAssetFromEvent({ type: "video.upload.asset_created" })).toBeNull();
  });
});
