// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/app/(admin)/admin/members/[id]/transactions-actions", () => ({ loadMemberTransactions: load }));

import MemberTransactions from "@/app/(admin)/admin/members/[id]/MemberTransactions";

afterEach(() => {
  cleanup();
  load.mockReset();
});

describe("MemberTransactions", () => {
  it("shows a loading line, then the table", async () => {
    load.mockResolvedValue({ rows: [], customerCount: 1 });
    render(<MemberTransactions memberId="mbr_AAAAAAAAAAA1" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading transactions");
    expect(await screen.findByText(/No transactions imported/)).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("mbr_AAAAAAAAAAA1");
  });

  it("shows the reason when the load is refused or fails", async () => {
    load.mockResolvedValueOnce({ error: "Not authorized" });
    const { unmount } = render(<MemberTransactions memberId="m1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authorized");
    unmount();
    load.mockRejectedValueOnce(new Error("boom"));
    render(<MemberTransactions memberId="m2" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the transactions.");
  });
});
