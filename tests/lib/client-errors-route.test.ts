import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getCurrentUser = vi.hoisted(() => vi.fn());
const sendOperationsAlert = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/operations-alerts", () => ({ sendOperationsAlert }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

import { POST } from "@/app/api/client-errors/route";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/client-errors", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  getCurrentUser.mockReset().mockResolvedValue({ id: "u1", email: "a@example.com" });
  sendOperationsAlert.mockClear();
});

describe("POST /api/client-errors", () => {
  it("alerts with the route as a template, never the ids in the path", async () => {
    const response = await post({ path: "/admin/events/evt_esQojgSTH2XD?x=1", message: "Error: boom" });
    expect(response.status).toBe(204);
    expect(sendOperationsAlert).toHaveBeenCalledWith(expect.objectContaining({ rateLimit: expect.anything() }), { type: "client_crash", route: "/admin/events/[id]", message: "Error: boom" });
  });

  it("alerts a course video that failed to play as its own kind, by route template", async () => {
    const response = await post({ path: "/courses/ready-writer/lessons/les_esQojgSTH2XD", kind: "video", message: "Playback error, code 4" });
    expect(response.status).toBe(204);
    expect(sendOperationsAlert).toHaveBeenCalledWith(expect.objectContaining({ rateLimit: expect.anything() }), {
      type: "video_failed",
      what: "playback",
      route: "/courses/ready-writer/lessons/[id]",
      detail: "Playback error, code 4",
    });
  });

  it("passes on what the player said about a video failure, keeping only values of the expected shape", async () => {
    await post({
      path: "/courses/ready-writer/lessons/les_esQojgSTH2XD",
      kind: "video",
      message: "Playback error, code 2",
      playback: { code: 2, lessonId: "les_esQojgSTH2XD", playbackId: "AbCdEf1234567890", restricted: true, status: 403, detail: "manifestLoadError" },
    });
    expect(sendOperationsAlert).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      playback: { code: 2, lessonId: "les_esQojgSTH2XD", playbackId: "AbCdEf1234567890", restricted: true, status: 403, detail: "manifestLoadError" },
    }));

    await post({ path: "/courses/x/lessons/y", kind: "video", message: "m", playback: { code: 2, muxData: true } });
    expect(sendOperationsAlert).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ playback: { code: 2, muxData: true } }));

    await post({
      path: "/courses/x/lessons/y",
      kind: "video",
      message: "m",
      playback: { code: 2, lessonId: "not an id", playbackId: "https://x/?token=abc", restricted: "yes", status: 20, detail: "<b>hi</b>" },
    });
    expect(sendOperationsAlert).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ playback: { code: 2 } }));

    await post({ path: "/courses/x/lessons/y", kind: "video", message: "m", playback: { code: "2" } });
    expect(sendOperationsAlert).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ playback: undefined }));
    await post({ path: "/courses/x/lessons/y", kind: "video", message: "m", playback: "nope" });
    expect(sendOperationsAlert).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ playback: undefined }));
  });

  it("refuses anyone not signed in", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await post({ path: "/x", message: "m" })).status).toBe(401);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });

  it("rejects a malformed body, a non-path and a missing message", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ path: "https://evil.example/x", message: "m" })).status).toBe(400);
    expect((await post({ path: "/x" })).status).toBe(400);
    expect(sendOperationsAlert).not.toHaveBeenCalled();
  });
});
