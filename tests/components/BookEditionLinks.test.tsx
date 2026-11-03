// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BookEditionLinks from "@/components/books/BookEditionLinks";

afterEach(cleanup);

describe("BookEditionLinks", () => {
  it("links each edition with its price, print first", () => {
    render(
      <BookEditionLinks
        track="t"
        editions={[
          { format: "ebook", purchaseUrl: "https://example.com/ebook", price: 4.99 },
          { format: "print", purchaseUrl: "https://example.com/print", price: null },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Print", "Ebook $4.99"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://example.com/print", "https://example.com/ebook"]);
  });

  it("shows an unsafe link as plain text instead of linking it", () => {
    render(<BookEditionLinks track="t" editions={[{ format: "print", purchaseUrl: "javascript:alert(1)", price: 10 }]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Print $10.00")).toBeInTheDocument();
  });
});
