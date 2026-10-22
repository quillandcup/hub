import { describe, it, expect } from "vitest";
import {
  linksNeedRefresh,
  parseLessonContent,
  presignedExpiry,
  URL_REFRESH_WINDOW_MS,
  type EditorDownloads,
  type EditorPost,
} from "@/lib/kajabi/lesson-content";

// Shaped like the editor's real responses (checked against a live lesson), with made-up values.
const signed = (path: string, date = "20261018T180000Z", token = "sig-a") =>
  `https://bucket.example.test/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${date}&X-Amz-Expires=604800&X-Amz-Signature=${token}`;

function makePost(overrides: { body?: string | null; thumb?: string | null; mediaId?: string; token?: string } = {}): EditorPost {
  const mediaId = overrides.mediaId ?? "9001";
  return {
    data: {
      id: "5001",
      attributes: {
        body: overrides.body === undefined ? "<p>Hello</p>" : overrides.body,
        posterImageUrl: overrides.thumb === undefined ? signed("thumb.jpg", undefined, overrides.token) : overrides.thumb,
      },
      relationships: { media: { data: { id: mediaId } } },
    },
    included: [
      {
        id: mediaId,
        type: "video",
        attributes: {
          wistiaId: "abc123",
          originalVideo: "/sites/1/video/file.mp4",
          status: "ready",
          mediaLibraryAssetId: null,
          urls: { downloadUrl: signed("video.mp4", undefined, overrides.token), videoCaptionsUrl: "/admin/videos/9001/captions" },
        },
      },
    ],
  };
}

const makeDownloads = (...files: Array<{ id: string; name: string; position?: number }>): EditorDownloads => ({
  data: files.map((f, i) => ({
    id: f.id,
    attributes: { name: f.name, position: f.position ?? i, assetUrl: signed(`files/${f.name}`), mediaLibraryAssetId: 7 },
  })),
});

describe("presignedExpiry", () => {
  it("adds X-Amz-Expires seconds to X-Amz-Date", () => {
    expect(presignedExpiry(signed("a"))).toBe("2026-10-25T18:00:00.000Z");
  });

  it("is null for links that aren't presigned, and for nothing", () => {
    expect(presignedExpiry("https://example.test/a.jpg")).toBeNull();
    expect(presignedExpiry("not a url")).toBeNull();
    expect(presignedExpiry(null)).toBeNull();
  });
});

describe("parseLessonContent", () => {
  it("reads the lesson body, thumbnail, video source and files", () => {
    const content = parseLessonContent(makePost(), makeDownloads({ id: "f1", name: "guide.pdf" }));

    expect(content.lessonId).toBe("5001");
    expect(content.bodyHtml).toBe("<p>Hello</p>");
    expect(content.thumbnailUrl).toContain("thumb.jpg");
    expect(content.videoMediaId).toBe("9001");
    expect(content.videoSource).toMatchObject({
      media_id: "9001",
      wistia_id: "abc123",
      original_video: "/sites/1/video/file.mp4",
      status: "ready",
      download_url_expires_at: "2026-10-25T18:00:00.000Z",
    });
    expect(content.files).toHaveLength(1);
    expect(content.files[0]).toMatchObject({ kajabi_id: "f1", filename: "guide.pdf", position: 0 });
  });

  it("keeps the signed link out of a file's raw payload", () => {
    const [file] = parseLessonContent(makePost(), makeDownloads({ id: "f1", name: "guide.pdf" })).files;

    expect(file.source_url).toContain("X-Amz-Signature");
    expect(JSON.stringify(file.raw_payload)).not.toContain("X-Amz-Signature");
  });

  it("handles a lesson with no video and no files", () => {
    const post = makePost();
    delete post.included;
    post.data.relationships = {};
    const content = parseLessonContent(post, { data: [] });

    expect(content.videoSource).toBeNull();
    expect(content.videoMediaId).toBeNull();
    expect(content.files).toEqual([]);
  });

  it("orders files by position", () => {
    const content = parseLessonContent(
      makePost(),
      makeDownloads({ id: "f2", name: "b.pdf", position: 1 }, { id: "f1", name: "a.pdf", position: 0 })
    );
    expect(content.files.map((f) => f.kajabi_id)).toEqual(["f1", "f2"]);
  });

  describe("contentHash", () => {
    const base = () => parseLessonContent(makePost(), makeDownloads({ id: "f1", name: "guide.pdf" })).contentHash;

    it("ignores the expiring links, which differ on every editor load", () => {
      const reloaded = parseLessonContent(makePost({ token: "sig-b" }), makeDownloads({ id: "f1", name: "guide.pdf" }));
      expect(reloaded.contentHash).toBe(base());
    });

    it("changes when the lesson text changes", () => {
      expect(parseLessonContent(makePost({ body: "<p>Edited</p>" }), makeDownloads({ id: "f1", name: "guide.pdf" })).contentHash).not.toBe(base());
    });

    it("changes when the video is replaced (new media id)", () => {
      expect(parseLessonContent(makePost({ mediaId: "9002" }), makeDownloads({ id: "f1", name: "guide.pdf" })).contentHash).not.toBe(base());
    });

    it("changes when a file is added or removed", () => {
      expect(parseLessonContent(makePost(), makeDownloads()).contentHash).not.toBe(base());
      expect(
        parseLessonContent(makePost(), makeDownloads({ id: "f1", name: "guide.pdf" }, { id: "f2", name: "more.pdf" })).contentHash
      ).not.toBe(base());
    });

    it("changes when the thumbnail image changes", () => {
      expect(
        parseLessonContent(makePost({ thumb: "https://img.example.test/other.jpg" }), makeDownloads({ id: "f1", name: "guide.pdf" })).contentHash
      ).not.toBe(base());
    });
  });
});

describe("linksNeedRefresh", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const source = (expires: string | null) => ({
    video_source: { download_url_expires_at: expires } as never,
  });

  it("is true when the stored link expires within the refresh window or already has", () => {
    expect(linksNeedRefresh(source(new Date(now.getTime() + URL_REFRESH_WINDOW_MS - 1000).toISOString()), now)).toBe(true);
    expect(linksNeedRefresh(source("2026-10-01T00:00:00Z"), now)).toBe(true);
  });

  it("is false with plenty of time left, or no link at all", () => {
    expect(linksNeedRefresh(source(new Date(now.getTime() + URL_REFRESH_WINDOW_MS + 60_000).toISOString()), now)).toBe(false);
    expect(linksNeedRefresh(source(null), now)).toBe(false);
    expect(linksNeedRefresh({ video_source: null }, now)).toBe(false);
  });
});
