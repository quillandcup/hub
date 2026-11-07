// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import MediaEditor from "@/components/media/MediaEditor";
import MediaUploadForm from "@/components/media/MediaUploadForm";

const ASSET = {
  id: "media_AAAAAAAAAAA1", title: "Cover", alt_text: null, tags: [], is_public: false, width: 400, height: 200,
  mime_type: "image/jpeg", focal_x: null, focal_y: null, fits: {}, updated_at: "2097-01-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("media editor live preview", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ asset: ASSET, usages: [] }) })));
  });

  it("shows a new focal point and fit in the thumbnails before saving", async () => {
    render(<MediaEditor assetId={ASSET.id} onClose={vi.fn()} onChanged={vi.fn()} />);
    const picture = await screen.findByAltText("Cover");
    vi.spyOn(picture, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 50 } as DOMRect);
    expect(screen.queryByTestId("live-an event card")).toBeNull();

    fireEvent.click(picture, { clientX: 20, clientY: 40 });
    const card = screen.getByTestId("live-an event card");
    expect(card.querySelector("img")).toHaveStyle({ objectPosition: "20% 80%" });
    expect(screen.getByTestId("live-a book cover").querySelector("img")).toHaveStyle({ objectPosition: "20% 80%" });

    await userEvent.selectOptions(screen.getByLabelText(/isn't cover-shaped/), "white");
    expect(screen.getByTestId("live-a book cover")).toHaveAttribute("data-fit", "white");
  });
});

describe("upload preview", () => {
  it("previews the chosen file, revokes it, and falls back to the name when the browser can't draw it", async () => {
    const create = vi.fn(() => "blob:one");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const { unmount } = render(<MediaUploadForm surface="admin_library" onUploaded={vi.fn()} onError={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Image file"), new File(["x"], "photo.heic", { type: "image/heic" }));

    const img = await screen.findByAltText("Preview of photo.heic");
    expect(img).toHaveAttribute("src", "blob:one");
    expect(screen.getByText("Choose a different file")).toBeInTheDocument();

    fireEvent.error(img);
    expect(screen.queryByAltText("Preview of photo.heic")).toBeNull();
    expect(screen.getByText("photo.heic")).toBeInTheDocument();

    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:one");
  });
});
