// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SplitMemberModal from "@/app/(admin)/admin/members/[id]/SplitMemberModal";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const member = { id: "m1", name: "Wren Holloway", email: "wren@example.com" };
const nameAliases = [{ id: "n1", alias: "Ivy Marsh", source: "zoom", active: true }];
const emailAliases = [{ id: "e1", alias_email: "ivy@example.com", source: "manual", active: true }];

function setup() {
  render(<SplitMemberModal member={member} nameAliases={nameAliases} emailAliases={emailAliases} isOpen onClose={() => {}} />);
}

describe("SplitMemberModal", () => {
  it("fills name and email from the ticked aliases", async () => {
    setup();
    await userEvent.click(screen.getByLabelText("Ivy Marsh"));
    await userEvent.click(screen.getByLabelText("ivy@example.com"));
    expect(screen.getByLabelText(/new member name/i)).toHaveValue("Ivy Marsh");
    expect(screen.getByLabelText(/new member email/i)).toHaveValue("ivy@example.com");
  });

  it("does not overwrite a name already typed", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/new member name/i), "Ivy M. Marsh");
    await userEvent.click(screen.getByLabelText("Ivy Marsh"));
    expect(screen.getByLabelText(/new member name/i)).toHaveValue("Ivy M. Marsh");
  });
});

describe("SplitMemberModal submit", () => {
  it("posts the ticked aliases and closes on success", async () => {
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ memberId: "new-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SplitMemberModal member={member} nameAliases={nameAliases} emailAliases={emailAliases} isOpen onClose={onClose} />);

    expect(screen.getByRole("button", { name: /split into new member/i })).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Ivy Marsh"));
    await userEvent.click(screen.getByLabelText("ivy@example.com"));
    await userEvent.click(screen.getByRole("button", { name: /split into new member/i }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      memberId: "m1",
      name: "Ivy Marsh",
      email: "ivy@example.com",
      nameAliasIds: ["n1"],
      emailAliasIds: ["e1"],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's error and stays open", async () => {
    const onClose = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Another member already has that email.", conflictingMemberId: "other-1" }) }));
    render(<SplitMemberModal member={member} nameAliases={nameAliases} emailAliases={emailAliases} isOpen onClose={onClose} />);

    await userEvent.click(screen.getByLabelText("Ivy Marsh"));
    await userEvent.click(screen.getByLabelText("ivy@example.com"));
    await userEvent.click(screen.getByRole("button", { name: /split into new member/i }));

    expect(await screen.findByText("Another member already has that email.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View that member" })).toHaveAttribute("href", "/admin/members/other-1");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("untoggles an alias", async () => {
    setup();
    const box = screen.getByLabelText("Ivy Marsh");
    await userEvent.click(box);
    await userEvent.click(box);
    expect(box).not.toBeChecked();
  });
});

describe("SplitMemberModal move to existing member", () => {
  it("offers to move the aliases when the email already belongs to a member", async () => {
    const onClose = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Ivy Marsh already has that email.", conflictingMemberId: "other-1", conflictingMemberName: "Ivy Marsh", canMoveAliases: true }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<SplitMemberModal member={member} nameAliases={nameAliases} emailAliases={emailAliases} isOpen onClose={onClose} />);

    await userEvent.click(screen.getByLabelText("Ivy Marsh"));
    await userEvent.click(screen.getByLabelText("ivy@example.com"));
    await userEvent.click(screen.getByRole("button", { name: /split into new member/i }));
    await userEvent.click(await screen.findByRole("button", { name: /move ticked names and emails to ivy marsh/i }));

    expect(fetchMock.mock.calls[1][0]).toBe("/api/admin/members/move-aliases");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      fromMemberId: "m1",
      toMemberId: "other-1",
      nameAliasIds: ["n1"],
      emailAliasIds: ["e1"],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the error when the move fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "x", conflictingMemberId: "o", conflictingMemberName: "Ivy", canMoveAliases: true }) })
        .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Move blew up" }) })
    );
    render(<SplitMemberModal member={member} nameAliases={nameAliases} emailAliases={emailAliases} isOpen onClose={() => {}} />);
    await userEvent.click(screen.getByLabelText("Ivy Marsh"));
    await userEvent.click(screen.getByLabelText("ivy@example.com"));
    await userEvent.click(screen.getByRole("button", { name: /split into new member/i }));
    await userEvent.click(await screen.findByRole("button", { name: /move ticked names and emails/i }));
    expect(await screen.findByText("Move blew up")).toBeInTheDocument();
  });
});
