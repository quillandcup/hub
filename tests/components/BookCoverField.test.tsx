// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { uploadCover } from "../helpers/cover-upload";
import "@testing-library/jest-dom/vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));

import BookCoverField, { type CoverAsset } from "@/components/books/BookCoverField";
import { BOOK_COVER_MAX_BYTES } from "@/lib/bookCover";

const URL_ = "/api/media/media_AAAAAAAAAAA1/book_cover_shelf";
const ASSET = { id: "media_AAAAAAAAAAA1", width: 1600, height: 2560 };
const file = (size = 10, name = "cover.png") => new File([new Uint8Array(size)], name, { type: "image/png" });

/** What a form around the field does: keeps the cover it is told about. */
function Harness({ onUploaded }: { onUploaded?: () => string | void }) {
  const [url, setUrl] = useState("");
  const [asset, setAsset] = useState<CoverAsset | null>(null);
  return (
    <BookCoverField
      url={url}
      asset={asset}
      onUploaded={(cover) => {
        const problem = onUploaded?.();
        if (problem) return problem;
        setUrl(cover.url);
        setAsset(cover.asset);
      }}
    />
  );
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const detail = { id: ASSET.id, title: "My Cover", alt_text: null, tags: [], is_public: false, updated_at: "2026-10-29T10:00:00Z", width: 1600, height: 2560, mime_type: "image/png", focal_x: null, focal_y: null, fits: {} };
let respond: () => Response | Promise<Response>;
let own: { id: string; title: string; updated_at: string; width: number; height: number }[];
let calls: { url: string; init?: RequestInit }[];
beforeEach(() => {
  track.mockReset();
  own = [];
  calls = [];
  respond = () => json({ url: URL_, assetId: ASSET.id, width: 1600, height: 2560, convertedFrom: null, duplicate: false });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === `/api/bookshelf/cover/${ASSET.id}`) return init?.method === "PATCH" ? json({ asset: { ...detail, focal_x: 0.5, focal_y: 0.5, updated_at: "2026-10-30T00:00:00Z" } }) : json({ asset: detail, usages: [] });
      if (url.startsWith("/api/bookshelf/cover?")) return json({ assets: own });
      return respond();
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BookCoverField", () => {
  it("uploads the chosen file, tells the parent about the new cover and records it", async () => {
    const onUploaded = vi.fn();
    render(<BookCoverField url="" asset={null} onUploaded={onUploaded} />);
    expect(screen.queryByAltText("Cover preview")).not.toBeInTheDocument();

    await uploadCover(file());
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ url: URL_, asset: ASSET }));
    expect(fetch).toHaveBeenCalledWith("/api/bookshelf/cover", expect.objectContaining({ method: "POST" }));
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "book_cover", ok: true, converted: false, duplicate: false, large: false });
  });

  it("records a converted HEIC photo and a file the library already had", async () => {
    respond = () => new Response(JSON.stringify({ url: URL_, assetId: ASSET.id, width: 10, height: 10, convertedFrom: "heic", duplicate: true }), { status: 200 });
    render(<BookCoverField url="" asset={null} onUploaded={() => {}} />);
    await uploadCover(file());
    await waitFor(() => expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "book_cover", ok: true, converted: true, duplicate: true, large: false }));
  });

  it("shows the preview and, for a big enough library cover, the size and the Amazon download", () => {
    render(<BookCoverField url={URL_} asset={ASSET} onUploaded={() => {}} />);
    expect(screen.getByAltText("Cover preview")).toHaveAttribute("src", URL_);
    expect(screen.getByText(/1600 x 2560 px/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Download for Amazon/ });
    expect(link).toHaveAttribute("href", `/api/media/${ASSET.id}/book_cover_kdp_ebook?download=1`);
    link.addEventListener("click", (e) => e.preventDefault());
    return userEvent.click(link).then(() => expect(track).toHaveBeenCalledWith("media_downloaded", { kind: "kdp_ebook" }));
  });

  it("explains what's missing for a cover too small for Amazon", () => {
    render(<BookCoverField url={URL_} asset={{ ...ASSET, width: 400, height: 600 }} onUploaded={() => {}} />);
    expect(screen.getByText(/at least 625 x 1000 px/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows no size or download when the cover isn't the asset it was given (an older cover)", () => {
    render(<BookCoverField url="https://example.com/cover.jpg" asset={ASSET} onUploaded={() => {}} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/ px\./)).not.toBeInTheDocument();
  });

  it("refuses a file over the size a request can carry, without uploading", async () => {
    render(<BookCoverField url="" asset={null} onUploaded={() => {}} />);
    await uploadCover(file(BOOK_COVER_MAX_BYTES + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("under 4 MB");
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);
  });

  it("shows why an upload failed", async () => {
    respond = () => new Response(JSON.stringify({ error: "Use a JPEG, PNG, WebP, GIF or AVIF image" }), { status: 400 });
    const onUploaded = vi.fn();
    render(<BookCoverField url="" asset={null} onUploaded={onUploaded} />);
    await uploadCover(file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Use a JPEG");
    expect(onUploaded).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "book_cover", ok: false, converted: false, duplicate: false, large: false });
  });

  it("shows a generic message when the request itself fails", async () => {
    respond = () => Promise.reject(new TypeError("Failed to fetch"));
    render(<BookCoverField url="" asset={null} onUploaded={() => {}} />);
    await uploadCover(file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed, try again");
  });

  it("shows the parent's reason when it can't take the cover", async () => {
    render(<BookCoverField url="" asset={null} onUploaded={() => "Couldn't save the cover"} />);
    await uploadCover(file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the cover");
  });

  it("opens the crop editor for the member's own cover once an upload is taken, with only the framing controls", async () => {
    render(<Harness />);
    await uploadCover(file());
    expect(await screen.findByText(/Click the picture to say where the interesting part is/)).toBeInTheDocument();
    expect(calls.some((c) => c.url === `/api/bookshelf/cover/${ASSET.id}`)).toBe(true);
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "The original" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Amazon ebook cover/ })).toBeInTheDocument();
  });

  it("does not open the editor when the parent can't take the cover", async () => {
    render(<Harness onUploaded={() => "Couldn't save the cover"} />);
    await uploadCover(file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the cover");
    expect(screen.queryByText(/Click the picture/)).not.toBeInTheDocument();
  });

  it("adjusts the crop of an existing library cover and refreshes the preview after saving", async () => {
    render(<BookCoverField url={URL_} asset={ASSET} onUploaded={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Adjust crop" }));
    expect(await screen.findByText(/Click the picture/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.init?.method === "PATCH")).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.init?.method === "PATCH")!.init!.body as string)).toEqual({ focal: null });
    await waitFor(() => expect(screen.getByAltText("Cover preview").getAttribute("src")).toMatch(/book_cover_shelf\?v=\d+/));
  });

  it("offers no Adjust crop for an older cover that is a link to somewhere else", () => {
    render(<BookCoverField url="https://example.com/cover.jpg" asset={null} onUploaded={() => {}} />);
    expect(screen.queryByRole("button", { name: "Adjust crop" })).not.toBeInTheDocument();
  });

  it("lists the member's own images and uses the chosen one as the cover", async () => {
    own = [{ id: "media_BBBBBBBBBBB2", title: "Earlier cover", updated_at: "2026-10-01T00:00:00Z", width: 1200, height: 1800 }];
    const onUploaded = vi.fn();
    render(<BookCoverField url="" asset={null} onUploaded={onUploaded} />);
    await userEvent.click(screen.getByRole("button", { name: "Choose cover" }));
    await userEvent.click(await screen.findByAltText("Earlier cover"));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ url: "/api/media/media_BBBBBBBBBBB2/book_cover_shelf", asset: { id: "media_BBBBBBBBBBB2", width: 1200, height: 1800 } }));
    expect(track).toHaveBeenCalledWith("media_picked", { surface: "book_cover", from: "library", searched: false });
  });

  it("says when there are no earlier images, and searches by title", async () => {
    render(<BookCoverField url="" asset={null} onUploaded={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Choose cover" }));
    expect(await screen.findByText(/No images yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    await waitFor(() => expect(calls.some((c) => c.url.includes("q=zzz"))).toBe(true));
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
  });

  it("shows why the images couldn't be loaded", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (url.startsWith("/api/bookshelf/cover?") ? json({ error: "Not authenticated" }, 401) : original(url, init)));
    render(<BookCoverField url="" asset={null} onUploaded={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Choose cover" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authenticated");
  });
});
