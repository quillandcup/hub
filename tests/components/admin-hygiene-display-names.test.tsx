// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/data/aliases",
  useSearchParams: () => new URLSearchParams(),
}));

import AmbiguousNamesResolver from "@/app/(admin)/admin/hygiene/ambiguous-names/AmbiguousNamesResolver";
import AliasesTable from "@/app/(admin)/admin/data/aliases/AliasesTable";
import MissingStripeTable from "@/app/(admin)/admin/hygiene/missing-member-data/MissingStripeTable";
import MatchingGame from "@/app/(admin)/admin/hygiene/name-matching/MatchingGame";
import MemberSlackSearchForm from "@/app/(admin)/admin/hygiene/members-without-slack/MemberSlackSearchForm";

const ada = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E", email: "ada@example.com" };

describe("admin hygiene tools show display names", () => {
  it("ambiguous names: candidate button uses the display name, tooltip has the legal name", () => {
    render(
      <AmbiguousNamesResolver
        entries={[{ zoomName: "Ada", occurrenceCount: 2, lastSeenAt: "2026-07-01T00:00:00Z", candidates: [ada] }]}
      />,
    );
    const button = screen.getByRole("button", { name: "Ada E" });
    expect(button).toHaveAttribute("title", expect.stringContaining("Ada Example"));
  });

  it("aliases table: display name leads with the legal name beneath", () => {
    render(
      <AliasesTable
        rows={[{ member: { ...ada, status: "active" }, aliases: [{ id: "a1", alias: "Adaa", created_at: "2026-01-01T00:00:00Z" }] }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Ada E" })).toBeInTheDocument();
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
  });

  it("missing stripe table: display name leads with the legal name beneath", () => {
    render(<MissingStripeTable rows={[{ ...ada, kajabi_id: null }]} />);
    expect(screen.getByRole("link", { name: "Ada E" })).toBeInTheDocument();
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
  });

  it("matching game: member needing a match shows both names", () => {
    render(<MatchingGame unmatchedAttendees={[]} membersWithNoAttendance={[ada]} />);
    expect(screen.getByText("Ada E")).toBeInTheDocument();
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
  });

  it("members without Slack: shows display name and legal name", () => {
    render(<MemberSlackSearchForm unmatchedMembers={[ada]} slackUsers={[]} />);
    expect(screen.getByText("Ada E")).toBeInTheDocument();
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
  });

  it("a member without a display name shows the legal name once", () => {
    render(<MissingStripeTable rows={[{ id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "f@example.com", kajabi_id: null }]} />);
    expect(screen.getAllByText("Fern Example")).toHaveLength(1);
  });
});
