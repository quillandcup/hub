import { describe, expect, it, vi } from "vitest";
import type Mux from "@mux/ts";
import { addTextTrack, generateTextTrack, removeTextTrack } from "@/lib/mux";

const fakeMux = (assets: Record<string, ReturnType<typeof vi.fn>>) => ({ video: { assets } }) as unknown as Mux;

describe("addTextTrack", () => {
  it("has Mux fetch the file from the link and keep it as a subtitles track, marked as closed captions", async () => {
    const createTrack = vi.fn(async () => ({ id: "trk_1" }));
    const result = await addTextTrack(fakeMux({ createTrack }), "asset_1", { url: "https://files.example/a.vtt", language: "en", name: "English", closedCaptions: true });

    expect(result).toEqual({ trackId: "trk_1" });
    expect(createTrack).toHaveBeenCalledWith("asset_1", { type: "text", text_type: "subtitles", url: "https://files.example/a.vtt", language_code: "en", name: "English", closed_captions: true });
  });

  it("fails when Mux makes a track with no id", async () => {
    await expect(addTextTrack(fakeMux({ createTrack: vi.fn(async () => ({})) }), "a", { url: "u", language: "en", name: "English", closedCaptions: false })).rejects.toThrow("no id");
  });
});

describe("removeTextTrack", () => {
  it("takes the track off the asset", async () => {
    const deleteTrack = vi.fn(async () => undefined);
    await removeTextTrack(fakeMux({ deleteTrack }), "asset_1", "trk_1");
    expect(deleteTrack).toHaveBeenCalledWith("asset_1", "trk_1");
  });

  it("treats a track Mux no longer has as removed, and passes on any other failure", async () => {
    await expect(removeTextTrack(fakeMux({ deleteTrack: vi.fn(async () => Promise.reject(Object.assign(new Error("not found"), { status: 404 }))) }), "a", "t")).resolves.toBeUndefined();
    await expect(removeTextTrack(fakeMux({ deleteTrack: vi.fn(async () => Promise.reject(Object.assign(new Error("boom"), { status: 500 }))) }), "a", "t")).rejects.toThrow("boom");
  });
});

describe("generateTextTrack", () => {
  const audio = { id: "aud_1", type: "audio" };
  const video = { id: "vid_1", type: "video" };

  it("asks Mux to write subtitles from the asset's audio, and gives the track it made", async () => {
    const retrieve = vi.fn(async () => ({ tracks: [video, audio] }));
    const generateSubtitles = vi.fn(async () => [{ id: "trk_9", type: "text" }]);
    const result = await generateTextTrack(fakeMux({ retrieve, generateSubtitles }), "asset_1", { language: "en", name: "English (automatic)" });

    expect(result).toEqual({ trackId: "trk_9" });
    expect(generateSubtitles).toHaveBeenCalledWith("asset_1", "aud_1", { generated_subtitles: [{ language_code: "en", name: "English (automatic)" }] });
  });

  it("fails when the asset has no audio, or Mux made no subtitle track", async () => {
    await expect(generateTextTrack(fakeMux({ retrieve: vi.fn(async () => ({ tracks: [video] })) }), "a", { language: "en", name: "x" })).rejects.toThrow("no audio");
    await expect(generateTextTrack(fakeMux({ retrieve: vi.fn(async () => ({})) }), "a", { language: "en", name: "x" })).rejects.toThrow("no audio");
    await expect(generateTextTrack(fakeMux({ retrieve: vi.fn(async () => ({ tracks: [audio] })), generateSubtitles: vi.fn(async () => []) }), "a", { language: "en", name: "x" })).rejects.toThrow("no subtitle track");
  });
});
