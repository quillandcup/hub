// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const actions = vi.hoisted(() => ({
  addMemberNote: vi.fn(async (_m: string, _b: string): Promise<{ error: string } | { success: true }> => ({ success: true })),
  deleteMemberNote: vi.fn(async (_m: string, _n: string): Promise<{ error: string } | { success: true }> => ({ success: true })),
}));
vi.mock("@/app/(admin)/admin/members/[id]/notes-actions", () => actions);

import MemberNotesPanel from "@/app/(admin)/admin/members/[id]/MemberNotesPanel";

const MEMBER = "mbr_AAAAAAAAAAA1";
const notes = [
  { id: "mnote_AAAAAAAAAAA1", body: "Sent an Instagram DM", createdAt: "2027-04-28T15:30:00.000Z", authorName: "Ania Example" },
  { id: "mnote_AAAAAAAAAAA2", body: "Left a voicemail", createdAt: "2027-04-27T02:30:00.000Z", authorName: null },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MemberNotesPanel", () => {
  it("lists notes with author and time in the given zone", () => {
    render(<MemberNotesPanel memberId={MEMBER} notes={notes} timeZone="America/New_York" />);
    expect(screen.getByText("Sent an Instagram DM")).toBeTruthy();
    expect(screen.getByText(/Ania Example/)).toBeTruthy();
    expect(screen.getByText(/Former staff/)).toBeTruthy();
    // 02:30 UTC on the 27th is still the evening of the 26th in New York.
    expect(screen.getByText(/Apr 26, 2027/)).toBeTruthy();
  });

  it("shows an empty state", () => {
    render(<MemberNotesPanel memberId={MEMBER} notes={[]} timeZone="America/New_York" />);
    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });

  it("adds a note, clears the box and refreshes", async () => {
    const user = userEvent.setup();
    render(<MemberNotesPanel memberId={MEMBER} notes={[]} timeZone="America/New_York" />);
    const add = screen.getByRole("button", { name: "Add note" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await user.type(screen.getByLabelText("New note"), "Follow up Friday");
    await user.click(add);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(actions.addMemberNote).toHaveBeenCalledWith(MEMBER, "Follow up Friday");
    expect((screen.getByLabelText("New note") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the text and shows the error when saving fails", async () => {
    actions.addMemberNote.mockResolvedValueOnce({ error: "Couldn't save the note." });
    const user = userEvent.setup();
    render(<MemberNotesPanel memberId={MEMBER} notes={[]} timeZone="America/New_York" />);
    await user.type(screen.getByLabelText("New note"), "Keep me");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save the note.");
    expect((screen.getByLabelText("New note") as HTMLTextAreaElement).value).toBe("Keep me");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("deletes a note", async () => {
    const user = userEvent.setup();
    render(<MemberNotesPanel memberId={MEMBER} notes={notes} timeZone="America/New_York" />);
    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(actions.deleteMemberNote).toHaveBeenCalledWith(MEMBER, "mnote_AAAAAAAAAAA1"));
    expect(refresh).toHaveBeenCalled();
  });
});
