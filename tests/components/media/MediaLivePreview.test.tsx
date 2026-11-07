// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(card.querySelector("img")).toHaveStyle({ objectPosition: "0% 50%" });
    // 400x200 picture, 290x430 frame: scaled to 860x430, the window centred on x=0.2 starts 27px in, of 570px of slack.
    expect(screen.getByTestId("live-a book cover").querySelector("img")?.style.objectPosition).toMatch(/^4\.7\d*% 50%$/);

    await userEvent.selectOptions(screen.getByLabelText(/isn't cover-shaped/), "white");
    expect(screen.getByTestId("live-a book cover")).toHaveAttribute("data-fit", "white");
  });
});

describe("upload preview", () => {
  it("draws the chosen file, and falls back to the name when the browser can't draw it", async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async (f: File) => {
      if (f.type === "image/heic") throw new Error("can't decode");
      return { width: 400, height: 200, close };
    }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    render(<MediaUploadForm surface="admin_library" onUploaded={vi.fn()} onError={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText("Image file"), new File(["x"], "photo.png", { type: "image/png" }));
    await waitFor(() => expect(drawImage).toHaveBeenCalled());
    expect(screen.getByRole("img", { name: "Preview of the chosen image" })).toBeInTheDocument();
    expect(screen.getByText("Choose a different file")).toBeInTheDocument();

    await userEvent.upload(screen.getByLabelText("Image file"), new File(["x"], "photo.heic", { type: "image/heic" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Preview of the chosen image" })).toBeNull());
    expect(screen.getByText("photo.heic")).toBeInTheDocument();
  });
});
