// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberNotesCard from "@/app/(member)/members/[id]/MemberNotesCard";
import { saveMemberNote } from "@/app/(member)/members/[id]/noteActions";

vi.mock("@/app/(member)/members/[id]/noteActions", () => ({ saveMemberNote: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MemberNotesCard", () => {
  it("saves a new note and only enables Save when something changed", async () => {
    vi.mocked(saveMemberNote).mockResolvedValue({ success: true, updatedAt: "2026-09-28T12:00:00Z" });
    render(<MemberNotesCard subjectMemberId="m-pat" firstName="Pat" initialBody="" initialUpdatedAt={null} />);

    const save = screen.getByRole("button", { name: "Save note" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("My notes"), "Ask about the query letter");
    await userEvent.click(save);

    expect(saveMemberNote).toHaveBeenCalledWith("m-pat", "Ask about the query letter");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(save).toBeDisabled();
  });

  it("clearing an existing note deletes it", async () => {
    vi.mocked(saveMemberNote).mockResolvedValue({ success: true, updatedAt: null });
    render(
      <MemberNotesCard
        subjectMemberId="m-pat"
        firstName="Pat"
        initialBody="old note"
        initialUpdatedAt="2026-09-01T12:00:00Z"
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Last edited Sep 1, 2026");

    await userEvent.clear(screen.getByLabelText("My notes"));
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(saveMemberNote).toHaveBeenCalledWith("m-pat", "");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Note deleted."));
  });

  it("shows the server error and keeps the typed note", async () => {
    vi.mocked(saveMemberNote).mockResolvedValue({ error: "Couldn't save your note — please try again." });
    render(<MemberNotesCard subjectMemberId="m-pat" firstName="Pat" initialBody="" initialUpdatedAt={null} />);

    await userEvent.type(screen.getByLabelText("My notes"), "draft");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn't save your note"));
    expect(screen.getByLabelText("My notes")).toHaveValue("draft");
  });
});
