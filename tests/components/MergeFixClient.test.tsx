// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import MergeFixClient from "@/app/(admin)/admin/hygiene/merge-fix/MergeFixClient";
import type { EnrichedGroup } from "@/lib/merge-fix";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/hygiene/merge-fix/actions", () => ({ dismissGroup: vi.fn(), undismissGroup: vi.fn() }));
// What the merge modal is handed, so a merge keeps the legal name.
vi.mock("@/app/(admin)/admin/members/BulkMergeMemberModal", () => ({
  default: ({ members }: { members: unknown[] }) => <pre data-testid="merge-modal">{JSON.stringify(members)}</pre>,
}));

const group: EnrichedGroup = {
  reason: "Same name",
  confidence: "high",
  members: [
    { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E", email: "ada@example.test", status: "active", stripe_customer_id: null, stripe_active: false },
    { id: "mbr_AAAAAAAAAAA2", name: "Ada Example", displayName: null, email: "ada2@example.test", status: "cancelled", stripe_customer_id: null, stripe_active: false },
  ],
};

describe("MergeFixClient", () => {
  it("shows a flagged member by display name with the legal name beneath, which is why they were flagged", () => {
    render(<MergeFixClient duplicateGroups={[group]} dismissedKeys={new Set()} />);

    expect(screen.getByRole("link", { name: "Ada E" })).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA1");
    // The member with no display name shows the legal name once, not twice.
    expect(screen.getAllByText("Ada Example")).toHaveLength(2); // the legal-name line under "Ada E" and the link of the other member
    expect(screen.getByRole("link", { name: "Ada Example" })).toHaveAttribute("href", "/admin/members/mbr_AAAAAAAAAAA2");
  });

  it("hands the merge the legal name beside the display name", async () => {
    render(<MergeFixClient duplicateGroups={[group]} dismissedKeys={new Set()} />);

    await userEvent.click(screen.getByRole("button", { name: /^Merge$/ }));

    expect(JSON.parse(screen.getByTestId("merge-modal").textContent!)[0]).toEqual({ id: "mbr_AAAAAAAAAAA1", name: "Ada Example", display_name: "Ada E", email: "ada@example.test" });
  });
});
