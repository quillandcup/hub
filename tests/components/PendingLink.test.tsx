// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const status = { pending: false };
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useLinkStatus: () => status,
}));

import PendingLink from "@/components/search/PendingLink";

describe("PendingLink", () => {
  it("shows a spinner only while the navigation is pending", () => {
    status.pending = false;
    const { rerender } = render(<PendingLink href="/search?q=a">View all</PendingLink>);
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/search?q=a");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    status.pending = true;
    rerender(<PendingLink href="/search?q=a">View all</PendingLink>);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });
});
