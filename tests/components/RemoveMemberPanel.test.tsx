// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const previewRemoval = vi.fn();
const removeMember = vi.fn();
vi.mock("@/app/(admin)/admin/members/[id]/removal-actions", () => ({
  previewRemoval: (...a: unknown[]) => previewRemoval(...a),
  removeMember: (...a: unknown[]) => removeMember(...a),
}));

import RemoveMemberPanel from "@/app/(admin)/admin/members/[id]/RemoveMemberPanel";

const member = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", removed: false };
const preview = {
  rows: [
    { table: "writing_projects", column: "member_id", action: "delete", why: "w", count: 2 },
    { table: "member_books", column: "member_id", action: "ask", why: "w", count: 1 },
    { table: "prickle_attendance", column: "member_id", action: "repoint", why: "w", count: 40 },
  ],
  liveBooks: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  previewRemoval.mockResolvedValue({ preview });
  removeMember.mockResolvedValue({ success: true, leftovers: [] });
});

describe("RemoveMemberPanel", () => {
  it("only says so for a member who was already removed", () => {
    render(<RemoveMemberPanel member={{ ...member, removed: true }} />);
    expect(screen.getByText(/was removed on their request/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing but the dry-run button until asked, then what each kind of record does", async () => {
    render(<RemoveMemberPanel member={member} />);
    expect(screen.queryByText("Remove this member")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    expect(await screen.findByText("writing projects")).toBeTruthy();
    expect(screen.getByText("Deleted")).toBeTruthy();
    expect(screen.getByText("Kept, without their name")).toBeTruthy();
    expect(previewRemoval).toHaveBeenCalledWith(member.id);
  });

  it("needs the member's answer about their books and the typed name before it can remove", async () => {
    render(<RemoveMemberPanel member={member} />);
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    const remove = await screen.findByRole("button", { name: "Remove this member" });
    expect((remove as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByRole("textbox"), "Ada Example");
    expect((remove as HTMLButtonElement).disabled).toBe(true); // still no answer about the books
    await userEvent.click(screen.getByLabelText(/happy for them to stay/i));
    expect((remove as HTMLButtonElement).disabled).toBe(false);

    await userEvent.click(remove);
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith(member.id, true, "Ada Example"));
    expect(await screen.findByText("The member was removed.")).toBeTruthy();
    expect(screen.getByText(/remove them at the source/i)).toBeTruthy();
  });

  it("removes books too when that is the answer", async () => {
    render(<RemoveMemberPanel member={member} />);
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    await userEvent.type(await screen.findByRole("textbox"), "Ada Example");
    await userEvent.click(screen.getByLabelText("Remove them too."));
    await userEvent.click(screen.getByRole("button", { name: "Remove this member" }));
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith(member.id, false, "Ada Example"));
  });

  it("shows the error and stays on the form when the removal is refused", async () => {
    removeMember.mockResolvedValue({ error: "The name you typed doesn't match this member's name." });
    render(<RemoveMemberPanel member={member} />);
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    await userEvent.type(await screen.findByRole("textbox"), "Ada Example");
    await userEvent.click(screen.getByLabelText("Remove them too."));
    await userEvent.click(screen.getByRole("button", { name: "Remove this member" }));
    expect(await screen.findByText(/name you typed doesn't match/i)).toBeTruthy();
    expect(screen.queryByText("The member was removed.")).toBeNull();
  });

  it("lists what did not finish after the database part went through", async () => {
    removeMember.mockResolvedValue({ success: true, leftovers: ["Their sign-in account was not deleted (x)."] });
    render(<RemoveMemberPanel member={member} />);
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    await userEvent.type(await screen.findByRole("textbox"), "Ada Example");
    await userEvent.click(screen.getByLabelText("Remove them too."));
    await userEvent.click(screen.getByRole("button", { name: "Remove this member" }));
    expect(await screen.findByText(/did not finish and need doing by hand/i)).toBeTruthy();
    expect(screen.getByText(/sign-in account was not deleted/i)).toBeTruthy();
  });

  it("shows an error from the dry run", async () => {
    previewRemoval.mockResolvedValue({ error: "Couldn't load what would be removed." });
    render(<RemoveMemberPanel member={member} />);
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    expect(await screen.findByText("Couldn't load what would be removed.")).toBeTruthy();
  });

  it("asks nothing about books for a member with none", async () => {
    previewRemoval.mockResolvedValue({ preview: { rows: [], liveBooks: 0 } });
    render(<RemoveMemberPanel member={member} />);
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    await userEvent.type(await screen.findByRole("textbox"), "Ada Example");
    expect(screen.queryByLabelText(/happy for them to stay/i)).toBeNull();
    expect((screen.getByRole("button", { name: "Remove this member" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/nothing is stored against this member/i)).toBeTruthy();
  });
});
