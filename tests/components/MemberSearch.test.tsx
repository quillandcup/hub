// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberSearch from "@/components/MemberSearch";
import MultiMemberSearch from "@/components/MultiMemberSearch";
import { memberSearchItem } from "@/lib/member-search-item";

const MEMBERS = [
  { id: "mbr_AAAAAAAAAAA1", name: "Laura May Best", displayName: "Bestie", email: "laura@example.test" },
  { id: "mbr_AAAAAAAAAAA2", name: "Julie Cocaigne", displayName: "Jude C", email: "julie@example.test" },
  { id: "mbr_AAAAAAAAAAA3", name: "Jude Doyle", displayName: null, email: "jude@example.test" },
];

describe("memberSearchItem", () => {
  it("leads with the display name and keeps the legal name and email on the second line", () => {
    expect(memberSearchItem(MEMBERS[0])).toEqual({ id: MEMBERS[0].id, name: "Bestie", detail: "Laura May Best · laura@example.test" });
  });

  it("has no legal-name line when there is no display name, or it equals the name", () => {
    expect(memberSearchItem(MEMBERS[2])).toMatchObject({ name: "Jude Doyle", detail: "jude@example.test" });
    expect(memberSearchItem({ id: "x", name: "Ann Example", displayName: "Ann Example" })).toEqual({ id: "x", name: "Ann Example", detail: null });
  });
});

describe("MemberSearch", () => {
  const setup = () => {
    const onSelect = vi.fn();
    render(<MemberSearch members={MEMBERS} selectedMemberId={null} onSelect={onSelect} placeholder="Find" />);
    return { onSelect, input: screen.getByRole("combobox") };
  };

  it("finds a member by their display name, and shows that name first", async () => {
    const { input } = setup();
    await userEvent.type(input, "bestie");
    expect(screen.getByRole("option", { name: /Bestie/ })).toHaveTextContent("Laura May Best");
  });

  it("still finds them by their legal name", async () => {
    const { input } = setup();
    await userEvent.type(input, "best");
    expect(screen.getByRole("option", { name: /Bestie/ })).toBeInTheDocument();
  });

  it("finds a member by display name even when another member matches the first name", async () => {
    const { input } = setup();
    await userEvent.type(input, "jude");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Jude C"), expect.stringContaining("Jude Doyle")]);
  });

  it("hands back the whole member when one is picked", async () => {
    const { input, onSelect } = setup();
    await userEvent.type(input, "bestie");
    await userEvent.click(screen.getByRole("option", { name: /Bestie/ }));
    expect(onSelect).toHaveBeenCalledWith(MEMBERS[0]);
  });
});

describe("MultiMemberSearch", () => {
  it("finds members by display name too", async () => {
    render(<MultiMemberSearch members={MEMBERS} selectedMemberIds={[]} onChange={vi.fn()} placeholder="find" />);
    await userEvent.type(screen.getByPlaceholderText("find"), "bestie");
    expect(screen.getByRole("button", { name: /Bestie/ })).toHaveTextContent("Laura May Best");
  });
});
