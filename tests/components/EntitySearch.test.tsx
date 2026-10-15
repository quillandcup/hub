// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import EntitySearch from "@/components/EntitySearch";
import MemberSearch from "@/components/MemberSearch";
import StaffSearch from "@/components/StaffSearch";

const ITEMS = [
  { id: "1", name: "Fern Quillsby", detail: "fern@example.test" },
  { id: "2", name: "Bramble Admin", detail: "bramble@example.test" },
];

describe("EntitySearch", () => {
  it("matches on name or detail and reports the pick", async () => {
    const onSelect = vi.fn();
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={onSelect} placeholder="Search" />);
    await userEvent.type(screen.getByPlaceholderText("Search"), "bramble@");
    await userEvent.click(await screen.findByRole("button", { name: /Bramble Admin/ }));
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("shows the selection, falling back to selectedName, and clears it", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<EntitySearch items={ITEMS} selectedId="1" onSelect={onSelect} />);
    expect(screen.getByText("Fern Quillsby")).toBeInTheDocument();
    rerender(<EntitySearch items={ITEMS} selectedId="zzz" selectedName="Someone Else" onSelect={onSelect} />);
    await userEvent.click(screen.getByTitle("Clear selection"));
    expect(screen.getByText("Someone Else")).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("wrappers feed it their own data", () => {
  it("MemberSearch hands back the original member object", async () => {
    const members = [{ id: "m1", name: "Fern Quillsby", email: "fern@example.test" }];
    const onSelect = vi.fn();
    render(<MemberSearch members={members} selectedMemberId={null} onSelect={onSelect} placeholder="Members" />);
    await userEvent.type(screen.getByPlaceholderText("Members"), "fern");
    await userEvent.click(await screen.findByRole("button", { name: /Fern Quillsby/ }));
    expect(onSelect).toHaveBeenCalledWith(members[0]);
  });

  it("StaffSearch shows email and role and returns the staff user", async () => {
    const staff = [{ id: "u1", name: "Bramble Admin", email: "bramble@example.test", role: "admin" }];
    const onSelect = vi.fn();
    render(<StaffSearch staff={staff} selectedUserId={null} onSelect={onSelect} placeholder="Staff" />);
    await userEvent.type(screen.getByPlaceholderText("Staff"), "bram");
    expect(await screen.findByText("bramble@example.test · admin")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Bramble Admin/ }));
    expect(onSelect).toHaveBeenCalledWith(staff[0]);
  });
});
