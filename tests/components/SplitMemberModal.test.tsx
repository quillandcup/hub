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
