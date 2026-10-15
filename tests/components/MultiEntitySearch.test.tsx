// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MultiEntitySearch from "@/components/MultiEntitySearch";
import MultiMemberSearch from "@/components/MultiMemberSearch";
import MultiSelectSearch from "@/components/MultiSelectSearch";

describe("MultiEntitySearch", () => {
  it("adds a match from the dropdown and offers only unselected items", async () => {
    const onChange = vi.fn();
    render(
      <MultiEntitySearch
        items={[
          { id: "a", name: "Alder", detail: "alder@example.test" },
          { id: "b", name: "Alma" },
        ]}
        selectedIds={["a"]}
        onChange={onChange}
        placeholder="find"
      />
    );
    await userEvent.type(screen.getByPlaceholderText("find"), "al");
    expect(screen.getAllByRole("button", { name: /Alma/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /alder@example.test/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Alma/ }));
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("removes a chip", async () => {
    const onChange = vi.fn();
    render(<MultiEntitySearch items={[{ id: "a", name: "Alder" }]} selectedIds={["a"]} onChange={onChange} />);
    await userEvent.click(screen.getByTitle("Remove Alder"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("wrappers", () => {
  it("MultiMemberSearch searches by email and skips unknown ids", async () => {
    const onChange = vi.fn();
    render(
      <MultiMemberSearch
        members={[{ id: "m1", name: "Moss Bramble", email: "moss@example.test" }]}
        selectedMemberIds={["gone"]}
        onChange={onChange}
        placeholder="who"
      />
    );
    expect(screen.queryByTitle(/Remove/)).toBeNull();
    await userEvent.type(screen.getByPlaceholderText("who"), "moss@");
    await userEvent.click(screen.getByRole("button", { name: /Moss Bramble/ }));
    expect(onChange).toHaveBeenCalledWith(["gone", "m1"]);
  });

  it("MultiSelectSearch keeps a chip, with its note, for a value no longer in options", () => {
    render(
      <MultiSelectSearch options={["x"]} selected={["old"]} onChange={() => {}} chipNote={(v) => (v === "old" ? "(retired)" : undefined)} />
    );
    expect(screen.getByText("old")).toBeInTheDocument();
    expect(screen.getByText("(retired)")).toBeInTheDocument();
  });
});
