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
    { table: "writing_projects", column: "member_id", action: "delete", why: "their words", count: 2 },
    { table: "member_books", column: "member_id", action: "ask", why: "w", count: 1 },
    { table: "prickle_attendance", column: "member_id", action: "repoint", why: "w", count: 40 },
  ],
  liveBooks: 1,
  extras: [
    { item: "auth_user", action: "delete", count: 1, samples: [] },
    { item: "media_files", action: "delete", count: 12, samples: ["image: Cover one", "image: Cover two"] },
    { item: "hiatus_notes", action: "clear", count: 1, samples: ["Hiatus from 01 Mar 2026 (note)"] },
    { item: "audit_entries", action: "delete", count: 3, samples: ["member (3)"] },
  ],
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
    expect(screen.getAllByText("Deleted").length).toBeGreaterThan(0);
    expect(screen.getByText("Kept, without their name")).toBeTruthy();
    expect(previewRemoval).toHaveBeenCalledWith(member.id);
  });

  const open = async () => {
    render(<RemoveMemberPanel member={member} />);
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    await screen.findByText("writing projects");
  };

  it("says up front that the imports are untouched", () => {
    render(<RemoveMemberPanel member={member} />);
    expect(screen.getByText(/imports from Kajabi, Stripe, Zoom and Slack are not touched/i)).toBeTruthy();
  });

  it("shows one summary table, catalog and extras alike, with counts only until a row is opened", async () => {
    await open();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    for (const name of ["writing projects", "Sign-in account", "Stored images and files", "Hiatus notes and reasons", "Audit-log entries about them", "prickle attendance"]) {
      expect(screen.getByRole("button", { name: new RegExp(name, "i") })).toBeTruthy();
    }
    expect(screen.getByText("Text cleared, record stays")).toBeTruthy();
    expect(screen.queryByText("image: Cover one")).toBeNull();
    expect(screen.queryByText("their words")).toBeNull();
    for (const row of screen.getAllByRole("button", { expanded: false })) expect(row.getAttribute("aria-controls")).toBeTruthy();
  });

  it("opens and closes any row the same way: named records for extras, the reason for the catalog", async () => {
    await open();
    const images = screen.getByRole("button", { name: /stored images and files/i });
    await userEvent.click(images);
    expect(images.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("image: Cover one")).toBeTruthy();
    expect(screen.getByText("and 10 more")).toBeTruthy();

    const projects = screen.getByRole("button", { name: /writing projects/i });
    await userEvent.click(projects);
    expect(screen.getByText("their words")).toBeTruthy();

    const signIn = screen.getByRole("button", { name: /sign-in account/i });
    await userEvent.click(signIn);
    expect(screen.getAllByText("No further detail.")).toHaveLength(1);

    await userEvent.click(images);
    expect(images.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("image: Cover one")).toBeNull();
  });

  it("opens a row from the keyboard", async () => {
    await open();
    const audit = screen.getByRole("button", { name: /audit-log entries about them/i });
    audit.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("member (3)")).toBeTruthy();
    await userEvent.keyboard(" ");
    expect(screen.queryByText("member (3)")).toBeNull();
  });

  it("puts the summary above the book question and the confirm button", async () => {
    await open();
    const table = screen.getByRole("table");
    const follows = (node: Node) => table.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(screen.getByText(/Their books and awards/))).toBeTruthy();
    expect(follows(screen.getByRole("button", { name: "Remove this member" }))).toBeTruthy();
  });

  it("lists only the catalog when there are no extras", async () => {
    previewRemoval.mockResolvedValue({ preview: { ...preview, extras: [] } });
    await open();
    expect(screen.queryByRole("button", { name: /sign-in account/i })).toBeNull();
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
    previewRemoval.mockResolvedValue({ preview: { rows: [], extras: [], liveBooks: 0 } });
    render(<RemoveMemberPanel member={member} />);
    await userEvent.click(screen.getByRole("button", { name: /see what would be removed/i }));
    await userEvent.type(await screen.findByRole("textbox"), "Ada Example");
    expect(screen.queryByLabelText(/happy for them to stay/i)).toBeNull();
    expect((screen.getByRole("button", { name: "Remove this member" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/nothing is stored against this member/i)).toBeTruthy();
  });
});
