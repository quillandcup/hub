// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));

import BookCoverField from "@/components/books/BookCoverField";
import { BOOK_COVER_MAX_BYTES } from "@/lib/bookCover";

const URL_ = "/api/media/media_AAAAAAAAAAA1/book_cover_shelf";
const ASSET = { id: "media_AAAAAAAAAAA1", width: 1600, height: 2560 };
const file = (size = 10, name = "cover.png") => new File([new Uint8Array(size)], name, { type: "image/png" });

let respond: () => Response | Promise<Response>;
beforeEach(() => {
  track.mockReset();
  respond = () => new Response(JSON.stringify({ url: URL_, assetId: ASSET.id, width: 1600, height: 2560, convertedFrom: null, duplicate: false }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async () => respond()));
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

    await userEvent.upload(screen.getByLabelText("Cover image file"), file());
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ url: URL_, asset: ASSET }));
    expect(fetch).toHaveBeenCalledWith("/api/bookshelf/cover", expect.objectContaining({ method: "POST" }));
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "book_cover", ok: true, converted: false, duplicate: false, large: false });
  });

  it("records a converted HEIC photo and a file the library already had", async () => {
    respond = () => new Response(JSON.stringify({ url: URL_, assetId: ASSET.id, width: 10, height: 10, convertedFrom: "heic", duplicate: true }), { status: 200 });
    render(<BookCoverField url="" asset={null} onUploaded={() => {}} />);
    await userEvent.upload(screen.getByLabelText("Cover image file"), file());
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
    await userEvent.upload(screen.getByLabelText("Cover image file"), file(BOOK_COVER_MAX_BYTES + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("under 4 MB");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows why an upload failed", async () => {
    respond = () => new Response(JSON.stringify({ error: "Use a JPEG, PNG, WebP, GIF or AVIF image" }), { status: 400 });
    const onUploaded = vi.fn();
    render(<BookCoverField url="" asset={null} onUploaded={onUploaded} />);
    await userEvent.upload(screen.getByLabelText("Cover image file"), file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Use a JPEG");
    expect(onUploaded).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("media_uploaded", { surface: "book_cover", ok: false, converted: false, duplicate: false, large: false });
  });

  it("shows a generic message when the request itself fails, and the parent's reason when it can't take the cover", async () => {
    respond = () => Promise.reject(new Error("offline"));
    const { rerender } = render(<BookCoverField url="" asset={null} onUploaded={() => {}} />);
    await userEvent.upload(screen.getByLabelText("Cover image file"), file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed, try again");

    respond = () => new Response(JSON.stringify({ url: URL_, assetId: ASSET.id, width: 1, height: 1 }), { status: 200 });
    rerender(<BookCoverField url="" asset={null} onUploaded={() => "Couldn't save the cover"} />);
    await userEvent.upload(screen.getByLabelText("Cover image file"), file());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the cover");
  });
});
