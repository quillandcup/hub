// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import MediaEditor from "@/components/media/MediaEditor";

const ASSET = {
  id: "media_AAAAAAAAAAA1", title: "Cover", alt_text: null, tags: [], is_public: false, width: 100, height: 150,
  mime_type: "image/jpeg", focal_x: null, focal_y: null, fits: {}, updated_at: "2097-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ asset: ASSET, usages: [] }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("adjusting an image from inside another form", () => {
  it("saves the image without submitting the form around it", async () => {
    const outer = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onChanged = vi.fn();
    render(
      <form onSubmit={outer}>
        <MediaEditor assetId={ASSET.id} own onClose={vi.fn()} onChanged={onChanged} />
      </form>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(outer).not.toHaveBeenCalled();
  });
});
