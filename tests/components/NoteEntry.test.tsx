// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActivityFeedRow } from "@/lib/activity-feed";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
type Result = { error: string } | { success: true };
const actions = vi.hoisted(() => ({
  editMemberNote: vi.fn(async (_m: string, _n: string, _b: string): Promise<Result> => ({ success: true })),
  deleteMemberNote: vi.fn(async (_m: string, _n: string): Promise<Result> => ({ success: true })),
}));
vi.mock("@/app/(admin)/admin/members/[id]/notes-actions", () => actions);

import NoteEntry from "@/app/(admin)/admin/activity/NoteEntry";

const ME = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2027-04-29T12:00:00Z");
const row = (over: Partial<ActivityFeedRow> = {}, data: Record<string, unknown> = {}): ActivityFeedRow => ({
  event_id: "note:mnote_AAAAAAAAAAA1",
  kind: "note",
  occurred_at: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
  is_audit: true,
  actor_user_id: ME,
  actor_kind: "staff",
  actor_label: "Ania Example",
  member_id: "mbr_AAAAAAAAAAA1",
  member_name: "Ada Example",
  acting_as_member_id: null,
  acting_as_member_name: null,
  event_type: "note",
  entity_type: null,
  entity_id: null,
  title: "Note",
  description: "Sent an Instgram DM",
  source: "member_admin_notes",
  data: { note_id: "mnote_AAAAAAAAAAA1", edited_at: null, ...data },
  ...over,
});
const controls = { memberId: "mbr_AAAAAAAAAAA1", currentUserId: ME, editMinutes: 15 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("NoteEntry", () => {
  it("shows the note's full text in the timeline, with no controls outside a member's page", () => {
    render(<NoteEntry row={row({ description: "line one\nline two" })} />);
    expect(screen.getByText(/line one/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks an edited note", () => {
    render(<NoteEntry row={row({}, { edited_at: "2027-04-29T11:58:00Z" })} />);
    expect(screen.getByText("edited")).toBeTruthy();
  });

  it("offers Edit to the author inside the window, and Delete", () => {
    render(<NoteEntry row={row()} controls={controls} />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("hides Edit from another admin and once the window has passed, but keeps Delete", () => {
    const { rerender } = render(<NoteEntry row={row()} controls={{ ...controls, currentUserId: "someone-else" }} />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    rerender(<NoteEntry row={row({ occurred_at: new Date(NOW.getTime() - 16 * 60_000).toISOString() })} controls={controls} />);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("edits the text and refreshes", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<NoteEntry row={row()} controls={controls} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit note") as HTMLTextAreaElement;
    expect(box.value).toBe("Sent an Instgram DM");
    await user.clear(box);
    await user.type(box, "Sent an Instagram DM");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(actions.editMemberNote).toHaveBeenCalledWith("mbr_AAAAAAAAAAA1", "mnote_AAAAAAAAAAA1", "Sent an Instagram DM");
  });

  it("keeps the editor open with the reason when the edit is refused, and Cancel puts the text back", async () => {
    actions.editMemberNote.mockResolvedValueOnce({ error: "Only the author can edit a note, and only in the first 15 minutes." });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<NoteEntry row={row()} controls={controls} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Edit note"), " more");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/first 15 minutes/);
    expect(refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Sent an Instgram DM")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("deletes the note", async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<NoteEntry row={row()} controls={controls} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(actions.deleteMemberNote).toHaveBeenCalledWith("mbr_AAAAAAAAAAA1", "mnote_AAAAAAAAAAA1"));
    expect(refresh).toHaveBeenCalled();
  });
});
