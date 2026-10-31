// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { uploadCover } from "../helpers/cover-upload";
import BookFormModal from "@/components/books/BookFormModal";
import { addBook, getMyPenNameOptions, updateBook } from "@/app/(member)/bookshelf/actions";
import { publishProject } from "@/app/(member)/projects/actions";

vi.mock("@/app/(member)/bookshelf/actions", () => ({
  addBook: vi.fn(),
  updateBook: vi.fn(),
  getMyPenNameOptions: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/app/(member)/projects/actions", () => ({
  publishProject: vi.fn(),
}));

// Copy lives in components/books/BookFormModal.tsx -- a distinctive fragment is enough to
// confirm the right block renders without asserting on the full verbatim text here.
const DISCLAIMER_FRAGMENT = /substantially written as part of your Quill/;

describe("BookFormModal", () => {
  it("shows the standalone-add disclaimer when there is no projectId", () => {
    render(<BookFormModal isOpen onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByText(DISCLAIMER_FRAGMENT)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add a Book" })).toBeInTheDocument();
  });

  it("hides the disclaimer when publishing a tracked project (projectId present)", () => {
    render(
      <BookFormModal
        isOpen
        onClose={() => {}}
        onSaved={() => {}}
        projectId="project-1"
        projectTitle="My Novel"
      />
    );
    expect(screen.queryByText(DISCLAIMER_FRAGMENT)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: 'Publish "My Novel"' })).toBeInTheDocument();
  });

  it("still shows the disclaimer when editing an existing standalone book (no projectId)", () => {
    // The condition is on projectId, not on whether `book` is set -- editing a standalone book
    // is still the non-publish path, so the eligibility disclaimer stays visible.
    render(
      <BookFormModal
        isOpen
        onClose={() => {}}
        onSaved={() => {}}
        book={{
          id: "book-1",
          title: "My Book",
          description: null,
          coverUrl: "https://example.com/cover.jpg",
          purchaseUrl: "https://example.com/buy",
          publishedDate: "2026-03-15",
          price: null,
          genres: [],
          format: "print",
          penName: null,
          projectId: null,
          coverAsset: null,
        }}
      />
    );
    expect(screen.getByText(DISCLAIMER_FRAGMENT)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit Book" })).toBeInTheDocument();
  });

  describe("Published as", () => {
    it("is hidden when the member has no other names", async () => {
      vi.mocked(getMyPenNameOptions).mockResolvedValue({ defaultName: "Ada E.", others: [] });
      render(<BookFormModal isOpen onClose={() => {}} onSaved={() => {}} />);
      await screen.findByRole("heading", { name: "Add a Book" });
      expect(screen.queryByText("Published as")).not.toBeInTheDocument();
    });

    it("offers the display name first, then their aliases, and submits the choice", async () => {
      vi.mocked(getMyPenNameOptions).mockResolvedValue({ defaultName: "Ada E.", others: ["A. E. Byron"] });
      vi.mocked(addBook).mockResolvedValue({ success: true });
      const user = userEvent.setup();
      render(<BookFormModal isOpen onClose={() => {}} onSaved={() => {}} book={{ id: "book-1", title: "B", description: null, coverUrl: "https://example.com/c.jpg", purchaseUrl: "https://example.com/b", publishedDate: "2026-03-15", price: null, genres: [], format: "print", penName: null, projectId: null, coverAsset: null }} />);

      const select = await screen.findByRole("combobox", { name: /published as/i });
      expect(Array.from((select as HTMLSelectElement).options).map((o) => o.text)).toEqual(["Ada E.", "A. E. Byron"]);
      await user.selectOptions(select, "A. E. Byron");
      expect((select as HTMLSelectElement).value).toBe("A. E. Byron");
    });

    it("keeps a name the book already has even if that alias is no longer offered", async () => {
      vi.mocked(getMyPenNameOptions).mockResolvedValue({ defaultName: "Ada E.", others: [] });
      render(<BookFormModal isOpen onClose={() => {}} onSaved={() => {}} book={{ id: "book-1", title: "B", description: null, coverUrl: "https://example.com/c.jpg", purchaseUrl: "https://example.com/b", publishedDate: "2026-03-15", price: null, genres: [], format: "print", penName: "Retired Name", projectId: null, coverAsset: null }} />);
      const select = (await screen.findByRole("combobox", { name: /published as/i })) as HTMLSelectElement;
      expect(select.value).toBe("Retired Name");
    });
  });
});

describe("BookFormModal genre tags", () => {
  const BOOK = { id: "book-1", title: "B", description: null, coverUrl: "https://example.com/c.jpg", purchaseUrl: "https://example.com/b", publishedDate: "2026-03-15", price: null, genres: ["Romance", "Fantasy"], format: "print" as const, penName: null, projectId: null, coverAsset: null };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the saved genres as chips", () => {
    render(<BookFormModal isOpen onClose={() => {}} onSaved={() => {}} book={BOOK} />);
    expect(screen.getByRole("button", { name: "Remove Romance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Fantasy" })).toBeInTheDocument();
  });

  it("saves the added and removed genres in order", async () => {
    vi.mocked(updateBook).mockResolvedValue({ success: true });
    const onSaved = vi.fn();
    render(<BookFormModal isOpen onClose={() => {}} onSaved={onSaved} book={BOOK} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove Romance" }));
    await userEvent.type(screen.getByLabelText("Genre / Tropes"), "Cozy Mystery{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateBook).toHaveBeenCalledWith("book-1", expect.objectContaining({ genres: ["Fantasy", "Cozy Mystery"] }));
  });

  it("saves an empty genre when none are left", async () => {
    vi.mocked(updateBook).mockResolvedValue({ success: true });
    render(<BookFormModal isOpen onClose={() => {}} onSaved={() => {}} book={{ ...BOOK, genres: [] }} />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateBook).toHaveBeenCalledWith("book-1", expect.objectContaining({ genres: [] })));
  });
});

describe("BookFormModal cover", () => {
  const BOOK = { id: "book-1", title: "B", description: null, coverUrl: "https://example.com/c.jpg", purchaseUrl: "https://example.com/b", publishedDate: "2026-03-15", price: null, genres: [], format: "print" as const, penName: null, projectId: null, coverAsset: null };
  const uploaded = { url: "/api/media/media_AAAAAAAAAAA1/book_cover_shelf", assetId: "media_AAAAAAAAAAA1", width: 1600, height: 2560 };

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function stubUpload(response: unknown, ok = true) {
    // The chooser's library tab asks for the member's images first; the upload answers `response`.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: url.includes("?") ? true : ok, json: async () => (url.includes("?") ? { assets: [] } : response) }) as Response));
  }

  it("accepts a cover of any size and saves the library cover the upload answered with", async () => {
    stubUpload(uploaded);
    vi.mocked(updateBook).mockResolvedValue({ success: true });
    const onSaved = vi.fn();
    render(<BookFormModal isOpen onClose={() => {}} onSaved={onSaved} book={BOOK} />);

    await uploadCover(new File([new Uint8Array(10)], "cover.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByAltText("Cover preview")).toHaveAttribute("src", uploaded.url));
    expect(screen.getByText(/1600 x 2560 px/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download for Amazon/ })).toHaveAttribute("href", `/api/media/${uploaded.assetId}/book_cover_kdp_ebook?download=1`);

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateBook).toHaveBeenCalledWith("book-1", expect.objectContaining({ coverUrl: uploaded.url }));
  });

  it("says a cover is too small for Amazon, and offers no download", async () => {
    stubUpload({ ...uploaded, width: 290, height: 430 });
    render(<BookFormModal isOpen onClose={() => {}} onSaved={() => {}} book={BOOK} />);
    await uploadCover(new File([new Uint8Array(10)], "small.png", { type: "image/png" }));
    expect(await screen.findByText(/at least 625 x 1000 px/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download for Amazon/ })).not.toBeInTheDocument();
  });

  it("offers the Amazon download for a book whose cover is already in the library", () => {
    render(
      <BookFormModal isOpen onClose={() => {}} onSaved={() => {}} book={{ ...BOOK, coverUrl: uploaded.url, coverAsset: { id: uploaded.assetId, width: 1200, height: 1800 } }} />,
    );
    expect(screen.getByRole("link", { name: /Download for Amazon/ })).toBeInTheDocument();
  });

  it("can be published once a cover has been uploaded", async () => {
    stubUpload(uploaded);
    vi.mocked(publishProject).mockResolvedValue({ success: true });
    render(<BookFormModal isOpen onClose={() => {}} onSaved={() => {}} projectId="project-1" projectTitle="My Novel" />);
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled(); // no cover yet

    await uploadCover(new File([new Uint8Array(10)], "cover.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled());
  });
});
