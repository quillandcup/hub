// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { track, unblockChatPreviews } = vi.hoisted(() => ({ track: vi.fn(), unblockChatPreviews: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({ track }));
vi.mock("@/app/(member)/chat/actions", () => ({ unblockChatPreviews }));

import BlockedPreviewsList from "@/components/chat/BlockedPreviewsList";
import type { PreviewBlock } from "@/lib/chat/link-preview-blocks";

const SITE: PreviewBlock = { scope: "site", host: "example.test", pathPrefix: null, url: null };
const PATH: PreviewBlock = { scope: "path", host: "example.test", pathPrefix: "/blog", url: null };
const LINK: PreviewBlock = { scope: "link", host: "other.test", pathPrefix: null, url: "https://other.test/a?x=1" };

beforeEach(() => {
  track.mockReset();
  unblockChatPreviews.mockReset().mockResolvedValue({ ok: true });
});

describe("BlockedPreviewsList", () => {
  it("says so when nothing is blocked", () => {
    render(<BlockedPreviewsList initial={[]} />);
    expect(screen.getByText(/Nothing blocked/)).toBeInTheDocument();
  });

  it("lists each block plainly", () => {
    render(<BlockedPreviewsList initial={[SITE, PATH, LINK]} />);
    expect(screen.getByText("example.test")).toBeInTheDocument();
    expect(screen.getByText("example.test/blog/…")).toBeInTheDocument();
    expect(screen.getByText("other.test/a?x=1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Stop blocking/ })).toHaveLength(3);
  });

  it("lifts one block, records only its scope, and drops it from the list", async () => {
    render(<BlockedPreviewsList initial={[SITE, PATH]} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop blocking example.test/blog/…" }));

    await waitFor(() => expect(screen.queryByText("example.test/blog/…")).toBeNull());
    expect(unblockChatPreviews).toHaveBeenCalledWith(PATH);
    expect(track).toHaveBeenCalledWith("chat_preview_unblocked", { scope: "path" });
    expect(screen.getByText("example.test")).toBeInTheDocument();
  });

  it("shows why it failed and keeps the block, also when the action throws", async () => {
    unblockChatPreviews.mockResolvedValue({ ok: false, error: "That couldn't be changed. Try again." });
    render(<BlockedPreviewsList initial={[SITE]} />);
    fireEvent.click(screen.getByRole("button", { name: /Stop blocking/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That couldn't be changed");
    expect(screen.getByText("example.test")).toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();

    unblockChatPreviews.mockRejectedValue(new Error("network"));
    // The alert shows while the first action's transition is still pending, and the button is disabled until it ends: a click
    // before then is ignored and the alert never changes (it failed on slow runners).
    await waitFor(() => expect(screen.getByRole("button", { name: /Stop blocking/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Stop blocking/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong"));
  });
});
