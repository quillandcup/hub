// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const track = vi.hoisted(() => vi.fn());
const uploadToSignedUrl = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }) }));

import MediaPicker from "@/components/media/MediaPicker";

const A = { id: "media_AAAAAAAAAAA1", title: "Hedgies on First", alt_text: "A hedgehog at a desk" };
const B = { id: "media_BBBBBBBBBBB2", title: "Retreat lodge", alt_text: null };

let library: { id: string; title: string; alt_text: string | null }[];
let calls: { url: string; init?: RequestInit }[];
let respond: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  library = [A, B];
  calls = [];
  respond = () => undefined;
  track.mockReset();
  uploadToSignedUrl.mockReset();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const custom = await respond(url, init);
    if (custom) return custom;
    if (url.startsWith("/api/media?")) {
      const q = new URL(url, "http://x").searchParams.get("q") ?? "";
      return json({ assets: library.filter((a) => a.title.toLowerCase().includes(q.toLowerCase())) });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(value: string | null = null) {
  const onChange = vi.fn();
  render(<MediaPicker value={value} onChange={onChange} surface="event_cover" />);
  return onChange;
}
const open = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Choose image|Change image/ }));
  await screen.findByRole("tablist");
};

describe("MediaPicker", () => {
  it("shows the current image at the preset's crop, with Change and Remove; empty it offers Choose", async () => {
    const onChange = setup(A.id);
    expect(screen.getByAltText("The chosen image")).toHaveAttribute("src", "/api/media/media_AAAAAAAAAAA1/event_card");
    expect(screen.getByRole("button", { name: "Change image" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(track).toHaveBeenCalledWith("media_cleared", { surface: "event_cover" });
    cleanup();
    setup();
    expect(screen.getByText("No image chosen.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("opens the library, lists the images and picks one", async () => {
    const onChange = setup();
    await open();
    expect(track).toHaveBeenCalledWith("media_picker_opened", { surface: "event_cover" });
    expect(await screen.findByText("Hedgies on First")).toBeInTheDocument();
    expect(screen.getByAltText("A hedgehog at a desk")).toHaveAttribute("src", "/api/media/media_AAAAAAAAAAA1/thumb");

    await userEvent.click(screen.getByText("Retreat lodge"));
    expect(onChange).toHaveBeenCalledWith("media_BBBBBBBBBBB2");
    expect(track).toHaveBeenCalledWith("media_picked", { surface: "event_cover", from: "library", searched: false });
    await waitFor(() => expect(screen.queryByRole("tablist")).not.toBeInTheDocument()); // closed
  });

  it("searches as you type and says when nothing matches", async () => {
    const onChange = setup();
    await open();
    await screen.findByText("Hedgies on First");
    await userEvent.type(screen.getByRole("searchbox"), "lodge");
    await waitFor(() => expect(screen.queryByText("Hedgies on First")).not.toBeInTheDocument());
    expect(calls.some((c) => c.url.includes("q=lodge"))).toBe(true);
    await userEvent.click(screen.getByText("Retreat lodge"));
    expect(track).toHaveBeenCalledWith("media_picked", { surface: "event_cover", from: "library", searched: true });
    expect(onChange).toHaveBeenCalledWith(B.id);
  });

  it("offers an upload when the library is empty, and shows a load error", async () => {
    library = [];
    setup();
    await open();
    expect(await screen.findByText(/No images yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Upload one" }));
    expect(screen.getByLabelText("Image file")).toBeInTheDocument();
    cleanup();

    respond = (url) => (url.startsWith("/api/media?") ? json({ error: "Forbidden" }, 403) : undefined);
    setup();
    await open();
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  });

  it("uploads a small file as form data and uses it, telling analytics when HEIC was converted", async () => {
    respond = (url, init) => (url === "/api/media" && init?.method === "POST" ? json({ asset: { id: "media_CCCCCCCCCCC3" }, duplicate: false, convertedFrom: "heic" }, 201) : undefined);
    const onChange = setup();
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    expect(screen.getByRole("button", { name: "Upload and use" })).toBeDisabled();

    const file = new File([new Uint8Array(1000)], "IMG_0001.heic", { type: "image/heic" });
    await userEvent.upload(screen.getByLabelText("Image file"), file);
    await userEvent.type(screen.getByLabelText("Title"), "Phone photo");
    await userEvent.type(screen.getByLabelText("Tags"), "retreat, lodge");
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("media_CCCCCCCCCCC3", expect.objectContaining({ id: "media_CCCCCCCCCCC3" })));
    const post = calls.find((c) => c.url === "/api/media" && c.init?.method === "POST")!;
    const form = post.init!.body as FormData;
    expect([form.get("title"), form.get("tags")]).toEqual(["Phone photo", "retreat,lodge"]);
    expect((form.get("file") as File).name).toBe("IMG_0001.heic");
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "event_cover", ok: true, converted: true, duplicate: false, large: false });
    expect(track).toHaveBeenCalledWith("media_picked", { surface: "event_cover", from: "upload", searched: false });
  });

  it("sends a big file straight to storage through a signed URL, then confirms it", async () => {
    uploadToSignedUrl.mockResolvedValue({ error: null });
    respond = (url, init) => {
      if (url === "/api/media/uploads") return json({ uploadPath: "uploads/abc", token: "tok", signedUrl: "https://x" });
      if (url === "/api/media" && init?.method === "POST") return json({ asset: { id: "media_DDDDDDDDDDD4" }, duplicate: true }, 200);
      return undefined;
    };
    const onChange = setup();
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    const big = new File([new Uint8Array(5 * 1024 * 1024)], "cover.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Image file"), big);
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("media_DDDDDDDDDDD4", expect.objectContaining({ id: "media_DDDDDDDDDDD4" })));
    expect(uploadToSignedUrl).toHaveBeenCalledWith("uploads/abc", "tok", big, { contentType: "image/png" });
    const confirm = calls.find((c) => c.url === "/api/media" && c.init?.method === "POST")!;
    expect(JSON.parse(confirm.init!.body as string)).toMatchObject({ uploadPath: "uploads/abc", tags: [] });
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "event_cover", ok: true, converted: false, duplicate: true, large: true });
  });

  it("shows why an upload failed and keeps the picker open", async () => {
    respond = (url, init) => (url === "/api/media" && init?.method === "POST" ? json({ error: "Use a JPEG, PNG, WebP, GIF or AVIF image" }, 400) : undefined);
    const onChange = setup();
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    await userEvent.upload(screen.getByLabelText("Image file"), new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }), { applyAccept: false });
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Use a JPEG");
    expect(onChange).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "event_cover", ok: false, converted: false, duplicate: false, large: false });
    expect(screen.getByRole("button", { name: "Upload and use" })).toBeEnabled();
  });

  const detail: Record<string, unknown> = { ...A, tags: [], is_public: false, updated_at: "2026-10-29T10:00:00Z", width: 1000, height: 500, mime_type: "image/png", focal_x: null, focal_y: null, fits: {} };
  const editorFetch = (saved = detail) => (url: string, init?: RequestInit) => {
    if (url === `/api/media/${A.id}` && !init?.method) return json({ asset: detail, usages: [] });
    if (url === `/api/media/${A.id}` && init?.method === "PATCH") return json({ asset: saved });
    return undefined;
  };

  it("opens the focal-point editor from Adjust crop, and refreshes the preview after a save", async () => {
    respond = editorFetch({ ...detail, focal_x: 0.2, focal_y: 0.3, updated_at: "2026-10-30T00:00:00Z" });
    setup(A.id);
    await userEvent.click(screen.getByRole("button", { name: "Adjust crop" }));
    expect(await screen.findByLabelText("Title")).toHaveValue("Hedgies on First");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    await waitFor(() => expect(screen.getByAltText("The chosen image").getAttribute("src")).toMatch(/event_card\?v=\d+/));
    await userEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("has no Adjust crop without an image", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Adjust crop" })).not.toBeInTheDocument();
  });

  it("opens the editor right after an upload is used", async () => {
    function Harness() {
      const [id, setId] = useState<string | null>(null);
      return <MediaPicker value={id} onChange={setId} surface="event_cover" />;
    }
    respond = (url, init) => (url === "/api/media" && init?.method === "POST" ? json({ asset: { id: A.id }, duplicate: false }, 201) : editorFetch()(url, init));
    render(<Harness />);
    await open();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    await userEvent.upload(screen.getByLabelText("Image file"), new File([new Uint8Array(100)], "a.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload and use" }));
    expect(await screen.findByText(/Click the picture to say where the interesting part is/)).toBeInTheDocument();
  });

  describe("with the event's photos", () => {
    const photos = { eventId: "evt_AAAAAAAAAAA1", photos: [{ id: "photo-1" }, { id: "photo-2" }] };
    const setupWithPhotos = (eventPhotos = photos) => {
      const onChange = vi.fn();
      render(<MediaPicker value={null} onChange={onChange} surface="event_cover" eventPhotos={eventPhotos} />);
      return onChange;
    };

    it("offers an Event photos tab only when the event has photos", async () => {
      setupWithPhotos({ eventId: photos.eventId, photos: [] });
      await open();
      expect(screen.queryByRole("tab", { name: "Event photos" })).not.toBeInTheDocument();
      cleanup();
      setupWithPhotos();
      await open();
      expect(screen.getByRole("tab", { name: "Event photos" })).toBeInTheDocument();
    });

    it("copies the chosen photo into the library and uses it", async () => {
      respond = (url, init) => (url === "/api/media/from-event-photo" && init?.method === "POST" ? json({ asset: { id: "media_EEEEEEEEEEE5" } }, 201) : undefined);
      const onChange = setupWithPhotos();
      await open();
      await userEvent.click(screen.getByRole("tab", { name: "Event photos" }));
      const shown = screen.getAllByAltText("An event photo");
      expect(shown[0]).toHaveAttribute("src", "/api/events/evt_AAAAAAAAAAA1/photos/photo-1");
      await userEvent.click(shown[1]);

      await waitFor(() => expect(onChange).toHaveBeenCalledWith("media_EEEEEEEEEEE5"));
      const post = calls.find((c) => c.url === "/api/media/from-event-photo")!;
      expect(JSON.parse(post.init!.body as string)).toEqual({ eventId: "evt_AAAAAAAAAAA1", photoId: "photo-2" });
      expect(track).toHaveBeenCalledWith("media_picked", { surface: "event_cover", from: "event_photo", searched: false });
    });

    it("shows why a photo couldn't be used and stays open", async () => {
      respond = (url, init) => (url === "/api/media/from-event-photo" && init?.method === "POST" ? json({ error: "Couldn't read that photo" }, 502) : undefined);
      const onChange = setupWithPhotos();
      await open();
      await userEvent.click(screen.getByRole("tab", { name: "Event photos" }));
      await userEvent.click(screen.getAllByAltText("An event photo")[0]);
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't read that photo");
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});

describe("MediaPicker as a member's cover control", () => {
  const COVER = { id: "media_AAAAAAAAAAA1", title: "Earlier cover", alt_text: null, width: 1200, height: 1800, updated_at: "2026-10-01T00:00:00Z" };
  const setupCover = (props: Partial<React.ComponentProps<typeof MediaPicker>> = {}) => {
    const onChange = vi.fn();
    render(<MediaPicker own shape="cover" noun="cover" alt="Cover preview" surface="book_cover" preview="book_cover_shelf" removable={false} value={null} onChange={onChange} {...props} />);
    return onChange;
  };
  const ownList = () => {
    respond = (url) => (url.startsWith("/api/bookshelf/cover?") ? json({ assets: [COVER] }) : undefined);
  };

  it("names things after the noun, shows a legacy link while there is no library image, and has no Remove", () => {
    setupCover({ legacyUrl: "https://example.com/old.jpg", children: <p>Requirements</p> });
    expect(screen.getByAltText("Cover preview")).toHaveAttribute("src", "https://example.com/old.jpg");
    expect(screen.getByRole("button", { name: "Change cover" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust crop" })).not.toBeInTheDocument(); // nothing in the library to adjust
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.getByText("Requirements")).toBeInTheDocument();
    cleanup();
    setupCover();
    expect(screen.getByRole("button", { name: "Choose cover" })).toBeInTheDocument();
    expect(screen.queryByAltText("Cover preview")).not.toBeInTheDocument();
  });

  it("lists the member's own images, hands the chosen one over with its size and does not open the editor", async () => {
    ownList();
    const onChange = setupCover();
    await userEvent.click(screen.getByRole("button", { name: "Choose cover" }));
    await userEvent.click(await screen.findByAltText("Earlier cover"));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(COVER.id, { id: COVER.id, width: 1200, height: 1800 }));
    expect(screen.queryByText(/Click the picture/)).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("media_picked", { surface: "book_cover", from: "library", searched: false });
  });

  it("shows the parent's reason when it can't take the image, and opens no editor", async () => {
    ownList();
    render(<MediaPicker own surface="book_cover" value={null} onChange={() => "Couldn't save the cover"} />);
    await userEvent.click(screen.getByRole("button", { name: "Choose image" }));
    await userEvent.click(await screen.findByAltText("Earlier cover"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the cover");
  });

  it("opens the member's trimmed editor from Adjust crop", async () => {
    respond = (url) => (url === `/api/bookshelf/cover/${COVER.id}` ? json({ asset: { ...COVER, tags: [], is_public: false, mime_type: "image/png", focal_x: null, focal_y: null, fits: {} }, usages: [] }) : undefined);
    setupCover({ value: COVER.id });
    await userEvent.click(screen.getByRole("button", { name: "Adjust crop" }));
    expect(await screen.findByText(/Click the picture/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });
});
