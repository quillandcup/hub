// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EffectivenessPanel from "@/app/(admin)/admin/mentorship/EffectivenessPanel";
import VolunteersPanel from "@/app/(admin)/admin/mentorship/VolunteersPanel";
import { computeOverallStats, computePeriodStats, computeMentorStats, type MentorshipRow } from "@/lib/mentorship";
const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }));
vi.mock("@/app/(admin)/admin/mentorship/actions", () => ({ addVolunteer: mocks.add, removeVolunteer: mocks.remove }));
vi.mock("@/components/MemberSearch", () => ({ default: ({ onSelect, selectedMemberId }: { onSelect: (m: { id: string; name: string }) => void; selectedMemberId: string | null }) => <button type="button" onClick={() => onSelect({ id: "ada", name: "Ada" })}>{selectedMemberId ? "Ada selected" : "Choose Ada"}</button> }));
const volunteer = { memberId: "ada", name: "Ada", note: "Mornings", volunteeredAt: "2026-01-01", openLoad: 1, totalMatches: 3, lastStartedOn: "2026-10-01" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.add.mockResolvedValue({ success: true }); mocks.remove.mockResolvedValue({ success: true });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ members: [{ id: "ada", name: "Ada" }] }) })));
});
describe("staff volunteer panel", () => {
  it("requires a member, adds their note, and clears the form on success", async () => {
    const user = userEvent.setup(); render(<VolunteersPanel volunteers={[]} />);
    expect(screen.getByRole("button", { name: "Add volunteer" })).toBeDisabled(); expect(screen.getByText("No volunteers yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose Ada" })); await user.type(screen.getByLabelText("Note"), "Afternoons");
    await user.click(screen.getByRole("button", { name: "Add volunteer" }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith("ada", "Afternoons"));
    await waitFor(() => expect(screen.getByLabelText("Note")).toHaveValue(""));
    expect(screen.getByRole("button", { name: "Add volunteer" })).toBeDisabled();
  });
  it("preserves the selected member and note when addition fails", async () => {
    mocks.add.mockResolvedValue({ error: "Unable to add" }); const user = userEvent.setup(); render(<VolunteersPanel volunteers={[]} />);
    await user.click(screen.getByRole("button", { name: "Choose Ada" })); await user.type(screen.getByLabelText("Note"), "Keep this"); await user.click(screen.getByRole("button", { name: "Add volunteer" }));
    expect(await screen.findByText("Unable to add")).toBeInTheDocument(); expect(screen.getByLabelText("Note")).toHaveValue("Keep this");
  });
  it("shows ranked volunteers and handles successful and failed withdrawals", async () => {
    const user = userEvent.setup(); render(<VolunteersPanel volunteers={[volunteer, { ...volunteer, memberId: "bea", name: "Bea", lastStartedOn: null, note: null }]} />);
    expect(screen.getByRole("link", { name: "Ada" })).toHaveAttribute("href", "/admin/members/ada"); expect(screen.getByText("Never")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]); expect(mocks.remove).toHaveBeenCalledWith("ada");
    mocks.remove.mockResolvedValue({ error: "Withdrawal failed" }); await user.click(screen.getAllByRole("button", { name: "Remove" })[1]);
    expect(await screen.findByText("Withdrawal failed")).toBeInTheDocument();
  });
  it("keeps the form usable if loading members fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline"))); render(<VolunteersPanel volunteers={[]} />);
    expect(screen.getByLabelText("Note")).toBeEnabled(); await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/members"));
  });
});
describe("effectiveness report", () => {
  it("shows empty tables and an unknown conversion rate when there are no matches", () => {
    render(<EffectivenessPanel overall={computeOverallStats([])} periods={[]} mentors={[]} />);
    expect(screen.getAllByText("No matches yet.")).toHaveLength(2); expect(screen.getByText("–")).toBeInTheDocument();
  });
  it("separates non-trial arrivals from conversions and links each big sister", () => {
    const rows: MentorshipRow[] = [{ id: "a", mentorMemberId: "ada", mentorName: "Ada", newMemberId: "new", newMemberName: "New", startedOn: "2026-10-01", trialEndsOn: "2026-10-08", kind: "trial", status: "matched", outcomeNote: null, active: true, outcome: "converted", convertedOn: "2026-10-08", currentMember: true }];
    render(<EffectivenessPanel overall={computeOverallStats(rows)} periods={computePeriodStats(rows)} mentors={computeMentorStats(rows)} />);
    expect(screen.getAllByText("100%")).toHaveLength(3);
    const row = screen.getByRole("link", { name: "Ada" }).closest("tr")!;
    expect(within(row).getByRole("link")).toHaveAttribute("href", "/admin/members/ada"); expect(within(row).getAllByRole("cell")[7]).toHaveTextContent("1");
  });
});
