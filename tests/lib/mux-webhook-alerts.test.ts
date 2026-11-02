import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sendOperationsAlert = vi.hoisted(() => vi.fn(async () => {}));
const captureException = vi.hoisted(() => vi.fn());
const unwrapWebhook = vi.hoisted(() => vi.fn());
const uploadAssetFromEvent = vi.hoisted(() => vi.fn());
const assetUpdateFromEvent = vi.hoisted(() => vi.fn());
const courses = vi.hoisted(() => ({
  videosBySourceKeys: vi.fn(),
  updateVideo: vi.fn(),
  updateVideosByAsset: vi.fn(),
  syncLessonDurations: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException }));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ courses }) }));
vi.mock("@/lib/mux", () => ({ createMuxClient: () => ({}), unwrapWebhook, uploadAssetFromEvent, assetUpdateFromEvent }));

import { POST } from "@/app/api/webhooks/mux/route";

const post = () => POST(new NextRequest("http://localhost/api/webhooks/mux", { method: "POST", body: "{}" }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  unwrapWebhook.mockResolvedValue({ type: "video.asset.ready" });
  uploadAssetFromEvent.mockReturnValue(null);
  assetUpdateFromEvent.mockReturnValue({ muxAssetId: "asset-1", status: "ready", playbackId: "pb", durationSeconds: 60 });
  courses.updateVideosByAsset.mockResolvedValue(1);
  courses.syncLessonDurations.mockResolvedValue(undefined);
});

describe("the Mux webhook raises an alert when it can't do its job", () => {
  it("is quiet when it records the update", async () => {
    expect((await post()).status).toBe(200);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("alerts and reports to Sentry when recording an asset update fails, and answers 500 so Mux retries", async () => {
    courses.updateVideosByAsset.mockRejectedValue(new Error("database down"));
    expect((await post()).status).toBe(500);
    expect(sendOperationsAlert).toHaveBeenCalledWith(expect.anything(), { type: "video_failed", what: "webhook_asset" });
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { section: "mux_webhook", stage: "asset" } });
  });

  it("alerts and reports to Sentry when recording an upload fails", async () => {
    uploadAssetFromEvent.mockReturnValue({ uploadId: "up-1", assetId: "asset-1" });
    courses.videosBySourceKeys.mockResolvedValue([{ id: "vid_AAAAAAAAAAA1" }]);
    courses.updateVideo.mockRejectedValue(new Error("database down"));
    expect((await post()).status).toBe(500);
    expect(sendOperationsAlert).toHaveBeenCalledWith(expect.anything(), { type: "video_failed", what: "webhook_upload" });
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { section: "mux_webhook", stage: "upload" } });
  });

  it("alerts when Mux couldn't prepare a video, which is what the lesson page promises", async () => {
    assetUpdateFromEvent.mockReturnValue({ muxAssetId: "asset-1", status: "errored" });
    expect((await post()).status).toBe(200);
    expect(sendOperationsAlert).toHaveBeenCalledWith(expect.anything(), { type: "video_failed", what: "asset_errored" });
  });

  it("does not alert for an early event whose video row isn't there yet, which Mux redelivers", async () => {
    courses.updateVideosByAsset.mockResolvedValue(0);
    expect((await post()).status).toBe(500);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });

  it("does not alert for an unsigned request, which only the internet sends", async () => {
    unwrapWebhook.mockRejectedValue(new Error("bad signature"));
    expect((await post()).status).toBe(401);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });
});
