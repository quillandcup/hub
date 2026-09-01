import { describe, it, expect } from "vitest";
import {
  BOOK_COVER_HEIGHT,
  BOOK_COVER_MAX_BYTES,
  BOOK_COVER_WIDTH,
  validateBookCoverDimensions,
  validateBookCoverFile,
} from "@/lib/bookCover";

describe("validateBookCoverFile", () => {
  it("accepts a PNG under the size limit", () => {
    expect(validateBookCoverFile({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("accepts a JPEG under the size limit", () => {
    expect(validateBookCoverFile({ type: "image/jpeg", size: 1024 })).toBeNull();
  });

  it("rejects an unsupported file type", () => {
    expect(validateBookCoverFile({ type: "image/gif", size: 1024 })).toBe(
      "Cover must be a PNG or JPEG image"
    );
  });

  it("rejects a file over the size limit", () => {
    expect(
      validateBookCoverFile({ type: "image/png", size: BOOK_COVER_MAX_BYTES + 1 })
    ).toMatch(/under/);
  });
});

describe("validateBookCoverDimensions", () => {
  it("accepts the exact required dimensions", () => {
    expect(validateBookCoverDimensions(BOOK_COVER_WIDTH, BOOK_COVER_HEIGHT)).toBeNull();
  });

  it("rejects dimensions that are off by even a few pixels", () => {
    expect(validateBookCoverDimensions(BOOK_COVER_WIDTH + 1, BOOK_COVER_HEIGHT)).toMatch(
      /145x215/
    );
    expect(validateBookCoverDimensions(BOOK_COVER_WIDTH, BOOK_COVER_HEIGHT - 1)).toMatch(
      /145x215/
    );
  });

  it("rejects a wildly different aspect ratio", () => {
    expect(validateBookCoverDimensions(2048, 2048)).toContain("2048x2048");
  });
});
