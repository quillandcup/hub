// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const actions = vi.hoisted(() => ({
  addMemberNote: vi.fn(async (_m: string, _b: string): Promise<{ error: string } | { success: true }> => ({ success: true })),
}));
vi.mock("@/app/(admin)/admin/members/[id]/notes-actions", () => actions);

import MemberNoteForm from "@/app/(admin)/admin/members/[id]/MemberNoteForm";

beforeEach(() => vi.clearAllMocks());

describe("MemberNoteForm", () => {
  it("adds a note, clears the box and refreshes", async () => {
    const user = userEvent.setup();
    render(<MemberNoteForm memberId="mbr_AAAAAAAAAAA1" />);
    const add = screen.getByRole("button", { name: "Add note" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await user.type(screen.getByLabelText("Add a note"), "Follow up Friday");
    await user.click(add);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(actions.addMemberNote).toHaveBeenCalledWith("mbr_AAAAAAAAAAA1", "Follow up Friday");
    expect((screen.getByLabelText("Add a note") as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the text and shows the error when saving fails", async () => {
    actions.addMemberNote.mockResolvedValueOnce({ error: "Couldn't save the note." });
    const user = userEvent.setup();
    render(<MemberNoteForm memberId="mbr_AAAAAAAAAAA1" />);
    await user.type(screen.getByLabelText("Add a note"), "Keep me");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save the note.");
    expect((screen.getByLabelText("Add a note") as HTMLTextAreaElement).value).toBe("Keep me");
    expect(refresh).not.toHaveBeenCalled();
  });
});
