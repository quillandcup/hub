// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActionMenu from "@/components/ActionMenu";

const setup = () => {
  const copy = vi.fn();
  const off = vi.fn();
  render(
    <>
      <button>outside</button>
      <ActionMenu
        label="Course actions"
        items={[
          { key: "copy", label: "Duplicate", onSelect: copy },
          { key: "off", label: "Take over", disabled: true, hint: "Import first", onSelect: off },
          { key: "stats", label: "Watch stats", href: "/stats" },
        ]}
      />
    </>
  );
  return { copy, off };
};

describe("ActionMenu", () => {
  it("is closed until the button is pressed, then focuses the first item", async () => {
    setup();
    const user = userEvent.setup();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Course actions" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Course actions" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
  });

  it("moves with the arrow keys, wrapping and skipping a disabled item", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Course actions" }));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Watch stats" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Watch stats" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Watch stats" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the button", async () => {
    setup();
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Course actions" });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes on a click outside and on Tab", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Course actions" }));
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Course actions" }));
    await user.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("runs an item's action and closes; a disabled item does nothing but shows its hint", async () => {
    const { copy, off } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Course actions" }));
    expect(screen.getByText("Import first")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Take over/ }));
    expect(off).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(copy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders a link item as a link", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Course actions" }));
    expect(screen.getByRole("menuitem", { name: "Watch stats" })).toHaveAttribute("href", "/stats");
  });

  it("renders nothing without items", () => {
    const { container } = render(<ActionMenu items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
