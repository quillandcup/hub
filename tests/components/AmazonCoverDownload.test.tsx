// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));

import AmazonCoverDownload from "@/components/media/AmazonCoverDownload";

afterEach(() => {
  cleanup();
  track.mockReset();
});

describe("AmazonCoverDownload", () => {
  it("links to the Amazon cover of an image big enough for one, and records the click", async () => {
    render(<AmazonCoverDownload asset={{ id: "media_AAAAAAAAAAA1", width: 1250, height: 2000 }} />);
    const link = screen.getByRole("link", { name: "Download for Amazon (1600 x 2560 JPEG)" });
    expect(link).toHaveAttribute("href", "/api/media/media_AAAAAAAAAAA1/book_cover_kdp_ebook?download=1");
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(track).toHaveBeenCalledWith("media_downloaded", { kind: "kdp_ebook" });
  });

  it("says why instead of linking when the image is too small, at exactly the minimum it links", () => {
    render(<AmazonCoverDownload asset={{ id: "media_AAAAAAAAAAA1", width: 145, height: 215 }} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("amazon-unavailable")).toHaveTextContent("This image is 145 x 215 px; at least 625 x 1000 px is needed. Upload a larger one.");
    cleanup();
    render(<AmazonCoverDownload asset={{ id: "media_AAAAAAAAAAA1", width: 625, height: 1000 }} />);
    expect(screen.getByRole("link", { name: /Download for Amazon/ })).toBeInTheDocument();
  });
});
