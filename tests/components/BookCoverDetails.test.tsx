// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BookCoverDetails from "@/components/books/BookCoverDetails";

const URL_ = "/api/media/media_AAAAAAAAAAA1/book_cover_shelf";
const ASSET = { id: "media_AAAAAAAAAAA1", width: 1600, height: 2560 };

afterEach(cleanup);

describe("BookCoverDetails", () => {
  it("says what a cover may be, with the hint when there is one", () => {
    render(<BookCoverDetails url="" asset={null} hint="Used when you publish." />);
    expect(screen.getByText(/Any size: a JPEG, PNG, WebP or iPhone photo up to 4 MB/)).toBeInTheDocument();
    expect(screen.getByText("Used when you publish.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the size and the Amazon download for the image the cover points at", () => {
    render(<BookCoverDetails url={URL_} asset={ASSET} />);
    expect(screen.getByText(/1600 x 2560 px/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download for Amazon/ })).toHaveAttribute("href", `/api/media/${ASSET.id}/book_cover_kdp_ebook?download=1`);
  });

  it("says why there is no download for a cover too small for Amazon", () => {
    render(<BookCoverDetails url={URL_} asset={{ ...ASSET, width: 400, height: 600 }} />);
    expect(screen.getByText(/at least 625 x 1000 px/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows no size or download when the asset isn't the one the cover points at", () => {
    render(<BookCoverDetails url="/api/media/media_BBBBBBBBBBB2/book_cover_shelf" asset={ASSET} />);
    expect(screen.queryByText(/ px\./)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
