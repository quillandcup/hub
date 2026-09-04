// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BookFormModal from "@/components/books/BookFormModal";

vi.mock("@/app/(member)/bookshelf/actions", () => ({
  addBook: vi.fn(),
  updateBook: vi.fn(),
}));

vi.mock("@/app/(member)/projects/actions", () => ({
  publishProject: vi.fn(),
}));

vi.mock("@/lib/bookCover", () => ({
  describeBookCoverRequirements: () => "PNG or JPG, at least 1600x2400px",
  validateBookCoverDimensions: () => null,
  validateBookCoverFile: () => null,
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
          genre: null,
          format: "print",
          projectId: null,
        }}
      />
    );
    expect(screen.getByText(DISCLAIMER_FRAGMENT)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit Book" })).toBeInTheDocument();
  });
});
