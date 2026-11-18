// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import MultiEntitySearch from "@/components/MultiEntitySearch";
import MultiMemberSearch from "@/components/MultiMemberSearch";
import MultiSelectSearch from "@/components/MultiSelectSearch";

describe("MultiEntitySearch", () => {
  it("adds a match from the dropdown, and marks the chosen ones, which a click takes off again", async () => {
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
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getByRole("option", { name: /Alder/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Alma/ })).toHaveAttribute("aria-selected", "false");
    await userEvent.click(screen.getByRole("option", { name: /Alma/ }));
    expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
    await userEvent.click(screen.getByRole("option", { name: /Alder/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("leaves no close timer pending once it unmounts after a blur", () => {
    // The dropdown closes on a short delay after blur; if that timer outlives the component it fires
    // on a torn-down DOM, which failed unit-test runs at random with `window is not defined`.
    vi.useFakeTimers();
    try {
      const { unmount } = render(<MultiEntitySearch items={[{ id: "a", name: "Alder" }]} selectedIds={[]} onChange={() => {}} placeholder="find" />);
      const input = screen.getByPlaceholderText("find");
      fireEvent.focus(input);
      fireEvent.blur(input);
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws the list on the page body, outside an overflow-hidden parent, and follows the input on scroll", async () => {
    render(
      <div data-testid="clip" style={{ overflow: "hidden" }}>
        <MultiEntitySearch items={[{ id: "a", name: "Alder" }]} selectedIds={[]} onChange={() => {}} placeholder="find" />
      </div>
    );
    const input = screen.getByPlaceholderText("find");
    let bottom = 100;
    input.getBoundingClientRect = () => ({ bottom, left: 20, width: 300 }) as DOMRect;
    await userEvent.type(input, "al");
    const list = (await screen.findByRole("listbox")).parentElement as HTMLElement;
    expect(screen.getByTestId("clip")).not.toContainElement(list);
    expect(list.parentElement).toBe(document.body);
    expect(list).toHaveAttribute("data-entity-search-list");
    expect(list).toHaveStyle({ top: "104px", left: "20px", width: "300px" });
    bottom = 150;
    fireEvent.scroll(window);
    expect(list).toHaveStyle({ top: "154px" });
  });

  it("removes a chip", async () => {
    const onChange = vi.fn();
    render(<MultiEntitySearch items={[{ id: "a", name: "Alder" }]} selectedIds={["a"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Alder" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

const PEOPLE = [
  { id: "a", name: "Alder" },
  { id: "b", name: "Alma" },
  { id: "c", name: "Alma Two" },
];

/** MultiEntitySearch with its own selection state, inside a form that records submits. */
function Harness({ initial = [] as string[], onChangeSpy, onSubmit }: { initial?: string[]; onChangeSpy?: (ids: string[]) => void; onSubmit: () => void }) {
  const [ids, setIds] = useState(initial);
  return (
    <div onKeyDown={(e) => e.key === "Escape" && outerEscape()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <MultiEntitySearch
          items={PEOPLE}
          selectedIds={ids}
          onChange={(next) => {
            setIds(next);
            onChangeSpy?.(next);
          }}
          placeholder="find"
        />
        <output data-testid="chosen">{ids.join(",")}</output>
        <button type="submit">Save</button>
      </form>
    </div>
  );
}
const outerEscape = vi.fn();

describe("MultiEntitySearch keyboard", () => {
  const setup = (initial: string[] = []) => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={initial} onSubmit={onSubmit} />);
    return { user, onSubmit, input: screen.getByRole("combobox", { name: "find" }) };
  };

  it("is a combobox over a multiselectable listbox, with the highlight in aria-activedescendant", async () => {
    const { user, input } = setup();
    await user.type(input, "al");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(input).not.toHaveAttribute("aria-activedescendant");

    await user.keyboard("{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2].id);
  });

  it("toggles the highlighted option on Enter, keeps the list open and does not submit the form", async () => {
    const { user, onSubmit, input } = setup();
    await user.type(input, "alma{ArrowDown}{Enter}");
    expect(screen.getByTestId("chosen")).toHaveTextContent("b");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(input).toHaveValue("alma");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("chosen")).toHaveTextContent("b,c");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(screen.getByTestId("chosen")).toHaveTextContent(/^c$/);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "false");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves Enter to the form when the list is closed or nothing is highlighted, even with a single match", async () => {
    const { user, onSubmit, input } = setup();
    await user.type(input, "alder{Enter}");
    expect(screen.getByTestId("chosen")).toBeEmptyDOMElement();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.clear(input);
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("submits the form on Ctrl+Enter even with an option highlighted", async () => {
    const { user, onSubmit, input } = setup();
    await user.type(input, "alma{ArrowDown}{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("chosen")).toBeEmptyDOMElement();
  });

  it("treats Space as a typed character", async () => {
    const { user, input } = setup();
    await user.type(input, "alma{ArrowDown} two");
    expect(input).toHaveValue("alma two");
    expect(screen.getByTestId("chosen")).toBeEmptyDOMElement();
  });

  it("closes the list on the first Escape and lets the second through", async () => {
    outerEscape.mockClear();
    const { user, input } = setup();
    await user.type(input, "al{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(outerEscape).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(outerEscape).toHaveBeenCalledTimes(1);

    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("removes the last chip on Backspace in an empty box, but edits the text when there is some", async () => {
    const { user, input } = setup(["a", "b"]);
    await user.click(input);
    await user.keyboard("{Backspace}");
    expect(screen.getByTestId("chosen")).toHaveTextContent(/^a$/);
    await user.keyboard("{Backspace}");
    expect(screen.getByTestId("chosen")).toBeEmptyDOMElement();

    await user.type(input, "xy{Backspace}");
    expect(input).toHaveValue("x");
  });

  it("shares the highlight with the mouse, and Home/End jump once something is highlighted", async () => {
    const { user, input } = setup();
    await user.type(input, "al");
    await user.hover(screen.getAllByRole("option")[1]);
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[1].id);
    await user.keyboard("{End}");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[2].id);
    await user.keyboard("{Home}");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0].id);
  });

  it("shows no list and highlights nothing when nothing matches", async () => {
    const { user, input } = setup();
    await user.type(input, "zzz{ArrowDown}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the key hints with Enter as toggle", async () => {
    const { user, input } = setup();
    await user.type(input, "al");
    expect(screen.getByText("toggle")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    await userEvent.type(screen.getByPlaceholderText("who"), "moss@");
    await userEvent.click(screen.getByRole("option", { name: /Moss Bramble/ }));
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
