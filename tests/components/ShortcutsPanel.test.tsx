// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock("html-to-image", () => ({ toBlob: vi.fn().mockResolvedValue(null) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import HelpMenu from "@/components/HelpMenu";
import CalendarKeyboardNav from "@/components/CalendarKeyboardNav";
import ShortcutsProvider, { useRegisterShortcuts } from "@/components/shortcuts/ShortcutsProvider";
import ShortcutsLayout from "@/components/shortcuts/ShortcutsPanel";
import type { ShortcutGroupId, ShortcutNeed } from "@/lib/shortcuts";

function mockKeyboard(hasKeyboard: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: hasKeyboard,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function Registers({ group, has }: { group: ShortcutGroupId; has?: ShortcutNeed[] }) {
  useRegisterShortcuts(group, { has });
  return null;
}

function Page({
  withCalendar = false,
  withTable,
  withDialog = false,
  withGroups = [],
}: {
  withCalendar?: boolean;
  withTable?: ShortcutNeed[];
  withDialog?: boolean;
  withGroups?: ShortcutGroupId[];
}) {
  const [showCalendar, setShowCalendar] = useState(withCalendar);
  return (
    <ShortcutsProvider>
      <HelpMenu />
      <ShortcutsLayout>
        <main>
          {withDialog && <div role="dialog" aria-label="A dialog" />}
          <button type="button">Page button</button>
          <input aria-label="Name" />
          <button type="button" onClick={() => setShowCalendar((s) => !s)}>
            Toggle calendar
          </button>
          {showCalendar && <Registers group="calendar" />}
          {withTable && <Registers group="table" has={withTable} />}
          {withGroups.map((group) => (
            <Registers key={group} group={group} />
          ))}
        </main>
      </ShortcutsLayout>
    </ShortcutsProvider>
  );
}

const panel = () => screen.queryByRole("complementary", { name: "Keyboard shortcuts" });
const search = () => screen.getByRole("searchbox", { name: "Search keyboard shortcuts" });

beforeEach(() => {
  track.mockReset();
  mockKeyboard(true);
});
afterEach(cleanup);

describe("opening and closing", () => {
  it("opens with ? and focuses the search box, toggles closed with a second ? and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Page />);
    expect(panel()).toBeNull();
    await user.keyboard("?");
    expect(panel()).toBeInTheDocument();
    expect(search()).toHaveFocus();
    // The search box is a text box: a typed ? stays there, so the panel closes from outside it.
    await user.click(screen.getByRole("button", { name: "Page button" }));
    await user.keyboard("?");
    expect(panel()).toBeNull();
    await user.keyboard("?");
    expect(panel()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(panel()).toBeNull();
  });

  it("closes with its close button and hands focus back to where it was", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole("button", { name: "Page button" });
    opener.focus();
    await user.keyboard("?");
    await user.click(screen.getByRole("button", { name: "Close keyboard shortcuts" }));
    expect(panel()).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("returns focus after Escape too", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole("button", { name: "Page button" });
    opener.focus();
    await user.keyboard("?");
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("opens from the Help menu, closes the menu, and returns focus to the Help button", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const help = screen.getByRole("button", { name: "Help" });
    await user.click(help);
    await user.click(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(panel()).toBeInTheDocument();
    expect(search()).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(help).toHaveFocus();
  });

  it("asking again from the Help menu while open puts the cursor back in the search box", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.keyboard("?");
    await user.click(screen.getByRole("button", { name: "Page button" }));
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ }));
    expect(search()).toHaveFocus();
  });

  it("is not triggered while typing", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("textbox", { name: "Name" }));
    await user.keyboard("what?");
    expect(panel()).toBeNull();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("what?");
  });

  it("is not triggered with a dialog open, and Escape leaves the panel to the dialog", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page withDialog />);
    await user.keyboard("?");
    expect(panel()).toBeNull();
    rerender(<Page />);
    await user.keyboard("?");
    expect(panel()).toBeInTheDocument();
    rerender(<Page withDialog />);
    await user.keyboard("{Escape}");
    expect(panel()).toBeInTheDocument();
  });

  it("ignores ? with Ctrl or Cmd held", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.keyboard("{Control>}?{/Control}");
    expect(panel()).toBeNull();
  });

  it("records how it was opened, once per opening", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.keyboard("?");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ }));
    await user.click(screen.getByRole("button", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: /Keyboard shortcuts/ }));
    expect(track.mock.calls).toEqual([
      ["shortcuts_panel_opened", { via: "key" }],
      ["shortcuts_panel_opened", { via: "help_menu" }],
    ]);
  });
});

describe("no keyboard", () => {
  it("does not listen for ? and has no Help menu item on a touch device or a small screen", async () => {
    mockKeyboard(false);
    const user = userEvent.setup();
    render(<Page />);
    await user.keyboard("?");
    expect(panel()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("menuitem", { name: "Hedgie Help" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeNull();
  });

  it("asks for the same device test as the key caps", () => {
    const matchMedia = window.matchMedia as unknown as ReturnType<typeof vi.fn>;
    render(<Page />);
    expect(matchMedia).toHaveBeenCalledWith("(hover: hover) and (pointer: fine) and (min-width: 640px)");
  });
});

describe("the list", () => {
  it("shows the everywhere sections with key caps and a line about the ? key", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.keyboard("?");
    const region = panel()!;
    for (const name of ["Basics", "Search"]) {
      expect(within(region).getByRole("heading", { name })).toBeInTheDocument();
    }
    // The picker and dialog form keys are page-scoped too: nothing on this page has them.
    expect(within(region).queryByRole("heading", { name: "Pickers" })).toBeNull();
    expect(within(region).queryByRole("heading", { name: "Forms in dialogs" })).toBeNull();
    expect(within(region).getByText("to toggle this panel")).toBeInTheDocument();
    // Page-scoped groups that are not on the page stay out.
    expect(within(region).queryByRole("heading", { name: "Calendar" })).toBeNull();
    expect(within(region).queryByRole("heading", { name: "Lists and tables" })).toBeNull();
    expect(within(region).queryByText("On this page")).toBeNull();
  });

  it("lists a page's shortcuts first, only while their component is mounted", async () => {
    const user = userEvent.setup();
    render(<Page withCalendar />);
    await user.keyboard("?");
    const region = panel()!;
    const headings = within(region).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Calendar");
    expect(headings).toContain("Basics");
    expect(within(region).getByText("On this page")).toBeInTheDocument();
    expect(within(region).getByText("Previous week")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle calendar" }));
    expect(within(region).queryByRole("heading", { name: "Calendar" })).toBeNull();
    expect(within(region).queryByText("On this page")).toBeNull();
  });

  it("follows a real page component: the calendar keys appear with CalendarKeyboardNav", async () => {
    const user = userEvent.setup();
    render(
      <ShortcutsProvider>
        <CalendarKeyboardNav prevHref="/p" nextHref="/n" todayHref="/t" />
        <ShortcutsLayout>
          <main />
        </ShortcutsLayout>
      </ShortcutsProvider>,
    );
    await user.keyboard("?");
    expect(within(panel()!).getByText("Jump to today")).toBeInTheDocument();
  });

  it("lists a table's optional keys only for what that table can do", async () => {
    const user = userEvent.setup();
    render(<Page withTable={["open"]} />);
    await user.keyboard("?");
    const region = panel()!;
    expect(within(region).getByText("Next row")).toBeInTheDocument();
    expect(within(region).getByText("Open the row")).toBeInTheDocument();
    expect(within(region).queryByText("Next page")).toBeNull();
    expect(within(region).queryByText("Select or unselect the row")).toBeNull();
  });

  it("shows alternatives with 'or' and reads them out in words", async () => {
    const user = userEvent.setup();
    render(<Page withCalendar />);
    await user.keyboard("?");
    const row = within(panel()!).getByText("Previous week").closest("li")!;
    expect(row).toHaveTextContent("or");
    expect(row).toHaveTextContent("p");
    expect(row).toHaveTextContent("k");
  });

  it("filters by label, by keys and by section, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Page withCalendar withGroups={["pickers", "forms"]} />);
    await user.keyboard("?");
    const region = panel()!;

    await user.type(search(), "week");
    expect(within(region).getByText("Previous week")).toBeInTheDocument();
    expect(within(region).queryByText("Open search")).toBeNull();
    expect(within(region).queryByRole("heading", { name: "Basics" })).toBeNull();

    await user.clear(search());
    await user.type(search(), "backspace");
    expect(within(region).getByText(/Remove the last chosen item/)).toBeInTheDocument();
    expect(within(region).queryByText("Previous week")).toBeNull();

    await user.clear(search());
    await user.type(search(), "cmd enter");
    expect(within(region).getByText("Save a form in a dialog")).toBeInTheDocument();

    await user.clear(search());
    await user.type(search(), "calendar");
    expect(within(region).getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
    expect(within(region).queryByRole("heading", { name: "Basics" })).toBeNull();

    await user.clear(search());
    await user.type(search(), "zzzz");
    expect(within(region).getByRole("status")).toHaveTextContent("No shortcuts match");
  });
});
