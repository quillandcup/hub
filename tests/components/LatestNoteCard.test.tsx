// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LatestNoteCard from "@/app/(admin)/admin/members/[id]/LatestNoteCard";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const MEMBER = "mbr_AAAAAAAAAAA1";

describe("LatestNoteCard", () => {
  it("shows the note, who wrote it and when in the given zone, and links to all notes over the longest range", () => {
    // 02:30 UTC on the 28th is still the evening of the 27th in New York.
    render(<LatestNoteCard memberId={MEMBER} note={{ body: "Sent an Instagram DM", createdAt: "2027-04-28T02:30:00.000Z", authorName: "Ania Example" }} timeZone="America/New_York" />);
    expect(screen.getByText("Sent an Instagram DM")).toBeInTheDocument();
    expect(screen.getByText(/Ania Example/)).toBeInTheDocument();
    expect(screen.getByText(/4\/27\/2027/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See all notes/ })).toHaveAttribute("href", `/admin/members/${MEMBER}/activity?kinds=note&days=365`);
  });

  it("calls a note whose author's account is gone 'Former staff'", () => {
    render(<LatestNoteCard memberId={MEMBER} note={{ body: "old", createdAt: "2027-04-28T12:00:00.000Z", authorName: null }} timeZone="America/New_York" />);
    expect(screen.getByText(/Former staff/)).toBeInTheDocument();
  });

  it("with no notes, says so and links to the Activity Log tab where the add box is", () => {
    render(<LatestNoteCard memberId={MEMBER} note={null} timeZone="America/New_York" />);
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add the first note/ })).toHaveAttribute("href", `/admin/members/${MEMBER}/activity`);
  });
});
