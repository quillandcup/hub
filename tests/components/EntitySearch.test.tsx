// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    await userEvent.click(await screen.findByRole("option", { name: /Bramble Admin/ }));
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("draws the list on the page body, so a modal's overflow-hidden can't cut it off, and follows the input on scroll", async () => {
    render(
      <div data-testid="clip" style={{ overflow: "hidden" }}>
        <EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />
      </div>
    );
    const input = screen.getByPlaceholderText("Search");
    let bottom = 100;
    input.getBoundingClientRect = () => ({ bottom, left: 20, width: 300 }) as DOMRect;
    await userEvent.type(input, "bramble");
    const list = (await screen.findByRole("listbox")).parentElement as HTMLElement;
    expect(screen.getByTestId("clip")).not.toContainElement(list);
    expect(list.parentElement).toBe(document.body);
    expect(list).toHaveStyle({ top: "104px", left: "20px", width: "300px" });
    bottom = 150;
    fireEvent.scroll(window);
    expect(list).toHaveStyle({ top: "154px" });
  });

  it("lists everything on focus with browse, and still filters as you type", async () => {
    const onSelect = vi.fn();
    render(<EntitySearch items={ITEMS} browse selectedId={null} onSelect={onSelect} placeholder="Search" />);

    await userEvent.click(screen.getByPlaceholderText("Search"));
    expect(screen.getAllByRole("option")).toHaveLength(2);

    await userEvent.type(screen.getByPlaceholderText("Search"), "bram");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.click(screen.getByRole("option", { name: /Bramble Admin/ }));
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("shows nothing before typing without browse", async () => {
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />);

    await userEvent.click(screen.getByPlaceholderText("Search"));

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("is a combobox you can drive from the keyboard: arrows move (wrapping), Enter picks", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={onSelect} placeholder="Search" />);
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.type(input, "example");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(2);

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Fern Quillsby/ })).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: /Fern Quillsby/ }).id);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: /Fern Quillsby/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: /Bramble Admin/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("picks the only match on Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={onSelect} placeholder="Search" />);
    await user.type(screen.getByRole("combobox", { name: "Search" }), "fern{Enter}");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("closes the list on the first Escape, and only the second reaches the modal around it", async () => {
    const user = userEvent.setup();
    const onOuterKey = vi.fn();
    render(
      <div onKeyDown={(e) => e.key === "Escape" && onOuterKey()}>
        <EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />
      </div>
    );
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.type(input, "example");
    expect(screen.getAllByRole("option")).toHaveLength(2);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveValue("example");
    expect(onOuterKey).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onOuterKey).toHaveBeenCalledTimes(1);
  });

  it("lets Escape through when there is no list to close", async () => {
    const user = userEvent.setup();
    const onOuterKey = vi.fn();
    render(
      <div onKeyDown={(e) => e.key === "Escape" && onOuterKey()}>
        <EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />
      </div>
    );
    await user.type(screen.getByRole("combobox", { name: "Search" }), "zzz{Escape}");
    expect(onOuterKey).toHaveBeenCalledTimes(1);
  });

  it("opens a closed list again on ArrowDown, and typing brings it back too", async () => {
    const user = userEvent.setup();
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />);
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.type(input, "example{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);

    await user.keyboard("{Escape}");
    await user.type(input, "{Backspace}");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("Home and End jump to the first and last option once one is highlighted, and leave the caret alone before", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={onSelect} placeholder="Search" />);
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.type(input, "example");
    await user.keyboard("{Home}");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    await user.keyboard("{ArrowDown}{End}");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);
    await user.keyboard("{Home}");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("shares one highlight between the mouse and the keyboard, and resets it when the results change", async () => {
    const user = userEvent.setup();
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />);
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.type(input, "example");
    await user.hover(screen.getByRole("option", { name: /Bramble Admin/ }));
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: /Bramble Admin/ }).id);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Fern Quillsby/ })).toHaveAttribute("aria-selected", "true");

    await user.type(input, "{Backspace}");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("scrolls the highlighted option into view", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />);
      await user.type(screen.getByRole("combobox", { name: "Search" }), "example{ArrowDown}");
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      // @ts-expect-error jsdom has no scrollIntoView; restore that
      delete Element.prototype.scrollIntoView;
    }
  });

  it("does not take Enter when nothing matches, so the form around it submits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />
        <button type="submit">Save</button>
      </form>
    );
    await user.type(screen.getByRole("combobox", { name: "Search" }), "zzz{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit the form when Enter picks, and Ctrl+Enter submits it instead", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onSelect = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <EntitySearch items={ITEMS} selectedId={null} onSelect={onSelect} placeholder="Search" />
        <button type="submit">Save</button>
      </form>
    );
    await user.type(screen.getByRole("combobox", { name: "Search" }), "example{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByRole("combobox", { name: "Search" }), "example{ArrowDown}{Control>}{Enter}{/Control}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows the key hints under the options, hidden from assistive technology", async () => {
    const user = userEvent.setup();
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" />);
    await user.type(screen.getByRole("combobox", { name: "Search" }), "example");
    const hints = screen.getByText("navigate").parentElement as HTMLElement;
    expect(hints).toHaveAttribute("aria-hidden", "true");
    expect(hints).toHaveTextContent(/select/);
    expect(hints).toHaveTextContent(/close/);
  });

  it("says nothing is highlighted when there are no results, with emptyText showing", async () => {
    const user = userEvent.setup();
    render(<EntitySearch items={ITEMS} selectedId={null} onSelect={vi.fn()} placeholder="Search" emptyText="No matches" />);
    const input = screen.getByRole("combobox", { name: "Search" });
    await user.type(input, "zzz{ArrowDown}");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).not.toHaveAttribute("aria-activedescendant");
  });

  it("leaves no close timer pending once it unmounts after a blur", () => {
    // The dropdown closes on a short delay after blur; if that timer outlives the component it fires
    // on a torn-down DOM, which failed unit-test runs at random with `window is not defined`.
    vi.useFakeTimers();
    try {
      const { unmount } = render(<EntitySearch items={ITEMS} selectedId={null} onSelect={() => {}} placeholder="Search" />);
      const input = screen.getByPlaceholderText("Search");
      fireEvent.focus(input);
      fireEvent.blur(input);
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the selection, falling back to selectedName, and clears it", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<EntitySearch items={ITEMS} selectedId="1" onSelect={onSelect} />);
    expect(screen.getByText("Fern Quillsby")).toBeInTheDocument();
    rerender(<EntitySearch items={ITEMS} selectedId="zzz" selectedName="Someone Else" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
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
    await userEvent.click(await screen.findByRole("option", { name: /Fern Quillsby/ }));
    expect(onSelect).toHaveBeenCalledWith(members[0]);
  });

  it("StaffSearch shows email and role and returns the staff user", async () => {
    const staff = [{ id: "u1", name: "Bramble Admin", email: "bramble@example.test", role: "admin" }];
    const onSelect = vi.fn();
    render(<StaffSearch staff={staff} selectedUserId={null} onSelect={onSelect} placeholder="Staff" />);
    await userEvent.type(screen.getByPlaceholderText("Staff"), "bram");
    expect(await screen.findByText("bramble@example.test · admin")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Bramble Admin/ }));
    expect(onSelect).toHaveBeenCalledWith(staff[0]);
  });
});
