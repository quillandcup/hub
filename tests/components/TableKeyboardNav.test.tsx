// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import TableKeyboardNav, { TABLE_KEYBOARD_SHORTCUTS } from "@/components/TableKeyboardNav";
import CalendarKeyboardNav from "@/components/CalendarKeyboardNav";
import { DataTablePager } from "@/components/DataTablePager";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { isOverlayOpen, isTypingTarget } from "@/lib/keyboard";

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = Array.from({ length: 60 }, (_, i) => ({ id: `r${i + 1}`, name: `Person ${String(i + 1).padStart(2, "0")}` }));
const opened = vi.fn();

function Fixture({
  rows = ROWS,
  checkboxes = true,
  links = true,
  rowPrimary = false,
  label = "Members",
}: {
  rows?: Row[];
  checkboxes?: boolean;
  links?: boolean;
  rowPrimary?: boolean;
  label?: string;
}) {
  const table = useDataTable<Row, "name">({
    rows,
    search: (r) => r.name,
    getSortValue: (r) => r.name,
    pageSize: 25,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div>
      {/* Typing in the search box must not move the highlight. */}
      <input aria-label="Search" value={table.search?.query ?? ""} onChange={(e) => table.search?.onChange(e.target.value)} />
      <TableKeyboardNav table={table} label={label}>
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all" />
              </th>
              <SortableTh label="Name" {...table.sortProps("name")} />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id} {...(rowPrimary ? { "data-row-primary": true, onClick: () => opened(row.id) } : {})}>
                {checkboxes && (
                  <td>
                    <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                  </td>
                )}
                <td>
                  {links ? (
                    <a
                      href={`/members/${row.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        opened(row.id);
                      }}
                    >
                      {row.name}
                    </a>
                  ) : (
                    row.name
                  )}
                </td>
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={2}>Nothing here</td>
              </tr>
            )}
          </tbody>
        </table>
        <DataTablePager table={table} itemLabel="members" />
      </TableKeyboardNav>
    </div>
  );
}

function region(name = "Members") {
  return screen.getByRole("group", { name });
}

function activeRows() {
  return [...document.querySelectorAll('tr[data-kbd-active="true"]')].map((tr) => tr.textContent);
}

function activeName() {
  const rows = activeRows();
  expect(rows).toHaveLength(1);
  return rows[0];
}

function checkedNames() {
  return screen
    .getAllByRole("checkbox")
    .filter((box) => (box as HTMLInputElement).checked)
    .map((box) => box.getAttribute("aria-label"));
}

/** Put keyboard focus on the table region, as a Tab would. */
async function focusRegion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("Search"));
  await user.tab();
  expect(region()).toHaveFocus();
}

beforeEach(() => {
  opened.mockClear();
  push.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("TableKeyboardNav moving", () => {
  it("moves with j/k and the arrow keys, stops at the ends, and names the row with aria-activedescendant", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    expect(activeRows()).toEqual([]);

    await user.keyboard("j");
    expect(activeName()).toContain("Person 01");
    expect(region()).toHaveAttribute("aria-activedescendant", document.querySelector("tr[data-kbd-active]")!.id);
    await user.keyboard("j{ArrowDown}");
    expect(activeName()).toContain("Person 03");
    await user.keyboard("k{ArrowUp}");
    expect(activeName()).toContain("Person 01");
    await user.keyboard("k");
    expect(activeName()).toContain("Person 01");
  });

  it("jumps with Home and End", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("{End}");
    expect(activeName()).toContain("Person 25");
    await user.keyboard("{Home}");
    expect(activeName()).toContain("Person 01");
  });

  it("announces the row in a polite live region", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("jj");
    const status = region().querySelector("[aria-live=polite]")!;
    expect(status).toHaveTextContent("Person 02");
    expect(status).toHaveTextContent("row 2 of 25");
    expect(status).toHaveTextContent("not selected");
  });

  it("does not move on an empty table", async () => {
    const user = userEvent.setup();
    render(<Fixture rows={[]} />);
    region().focus();
    await user.keyboard("jk{End}");
    expect(activeRows()).toEqual([]);
  });
});

describe("TableKeyboardNav opening", () => {
  it("Enter follows the highlighted row's link", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("jj{Enter}");
    expect(opened).toHaveBeenCalledWith("r2");
  });

  it("Enter clicks the row itself when the row is marked data-row-primary", async () => {
    const user = userEvent.setup();
    render(<Fixture links={false} rowPrimary />);
    await focusRegion(user);
    await user.keyboard("j{Enter}");
    expect(opened).toHaveBeenCalledWith("r1");
  });

  it("Enter does nothing without a highlight or a primary action", async () => {
    const user = userEvent.setup();
    render(<Fixture links={false} />);
    await focusRegion(user);
    await user.keyboard("{Enter}j{Enter}");
    expect(opened).not.toHaveBeenCalled();
  });

  it("leaves Enter to a focused link", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("j");
    const link = screen.getByRole("link", { name: "Person 01" });
    link.focus();
    await user.keyboard("{Enter}");
    // The browser's own Enter-on-a-link click, once; not a second one from the table.
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe("TableKeyboardNav selecting", () => {
  it("Space toggles the highlighted row's checkbox and keeps the page from scrolling", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("jj");
    expect(fireEvent.keyDown(region(), { key: " " })).toBe(false);
    expect(checkedNames()).toEqual(["Select Person 02"]);
    expect(screen.getByRole("row", { name: /Person 02/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("row", { name: /Person 01/ })).toHaveAttribute("aria-selected", "false");
    await user.keyboard(" ");
    expect(checkedNames()).toEqual([]);
    expect(screen.getByRole("row", { name: /Person 02/ })).toHaveAttribute("aria-selected", "false");
  });

  it("Space does not toggle twice from a focused checkbox", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("j");
    screen.getByRole("checkbox", { name: "Select Person 01" }).focus();
    await user.keyboard(" ");
    expect(checkedNames()).toEqual(["Select Person 01"]);
  });

  it("Shift+j and Shift+k extend and shrink the selected range", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("jj");
    await user.keyboard("{Shift>}jj{/Shift}");
    expect(checkedNames()).toEqual(["Select Person 02", "Select Person 03", "Select Person 04"]);
    await user.keyboard("{Shift>}k{/Shift}");
    expect(checkedNames()).toEqual(["Select Person 02", "Select Person 03"]);
    await user.keyboard("{Shift>}{ArrowUp}{ArrowUp}{/Shift}");
    expect(checkedNames()).toEqual(["Select Person 01", "Select Person 02"]);
    expect(activeName()).toContain("Person 01");
  });

  it("a plain move after extending starts a new range", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("j{Shift>}j{/Shift}");
    expect(checkedNames()).toEqual(["Select Person 01", "Select Person 02"]);
    await user.keyboard("jj{Shift>}j{/Shift}");
    expect(checkedNames()).toEqual(["Select Person 01", "Select Person 02", "Select Person 04", "Select Person 05"]);
  });

  it("a table without checkboxes ignores Space, and Shift moves are plain moves", async () => {
    const user = userEvent.setup();
    render(<Fixture checkboxes={false} />);
    await focusRegion(user);
    await user.keyboard("j");
    expect(fireEvent.keyDown(region(), { key: " " })).toBe(true);
    await user.keyboard("{Shift>}j{/Shift}");
    expect(activeName()).toContain("Person 02");
    expect(checkedNames()).toEqual([]);
  });
});

describe("TableKeyboardNav paging", () => {
  it("] and [ change the page and the highlight goes to the first row", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("jjj]");
    expect(screen.getByText(/Showing 26–50 of 60/)).toBeInTheDocument();
    expect(activeName()).toContain("Person 26");
    await user.keyboard("j[[");
    expect(screen.getByText(/Showing 1–25 of 60/)).toBeInTheDocument();
    expect(activeName()).toContain("Person 01");
  });

  it("does nothing past the first or last page", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("[[");
    expect(screen.getByText(/Showing 1–25 of 60/)).toBeInTheDocument();
    await user.keyboard("]]]");
    expect(screen.getByText(/Showing 51–60 of 60/)).toBeInTheDocument();
  });

  it("resets the highlight when the page changes with the mouse, and when the sort changes", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("jjjj");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(activeName()).toContain("Person 26");
    await user.keyboard("jj");
    await user.click(screen.getByRole("columnheader", { name: /Name/ }));
    // Sorting returns the table to page 1, and the highlight to its first row.
    expect(activeName()).toContain("Person 01");
    expect(activeRows()).toHaveLength(1);
  });

  it("keeps going when the table remounts with the new page (server paging)", async () => {
    const user = userEvent.setup();
    function Remounting() {
      const table = useDataTable<Row, "name">({ rows: ROWS, getSortValue: (r) => r.name, pageSize: 25 });
      return (
        <TableKeyboardNav key={table.pagination?.page} table={table} label="Members">
          <table>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKeyboardNav>
      );
    }
    render(<Remounting />);
    await user.keyboard("j]");
    expect(activeName()).toContain("Person 26");
    expect(region()).toHaveFocus();
  });

  it("ignores the page keys on a table with one page", async () => {
    const user = userEvent.setup();
    render(<Fixture rows={ROWS.slice(0, 5)} />);
    await focusRegion(user);
    expect(fireEvent.keyDown(region(), { key: "]" })).toBe(true);
    await user.keyboard("j");
    expect(activeName()).toContain("Person 01");
  });
});

describe("TableKeyboardNav is quiet when it should be", () => {
  it("ignores the keys while typing in the search box", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.click(screen.getByLabelText("Search"));
    await user.keyboard("jk[[]");
    expect(screen.getByLabelText("Search")).toHaveValue("jk[]");
    expect(activeRows()).toEqual([]);
  });

  it("ignores the keys with a dialog open", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Fixture />
        <div role="dialog" aria-label="Edit" />
      </>
    );
    await focusRegion(user);
    await user.keyboard("j");
    expect(activeRows()).toEqual([]);
  });

  it("ignores the keys while a combobox is open", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Fixture />
        <input role="combobox" aria-expanded="true" aria-label="Pick" readOnly />
      </>
    );
    await focusRegion(user);
    await user.keyboard("j");
    expect(activeRows()).toEqual([]);
  });

  it("ignores the keys with Ctrl, Cmd or Alt held", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await focusRegion(user);
    await user.keyboard("{Control>}j{/Control}{Meta>}k{/Meta}{Alt>}]{/Alt}");
    expect(activeRows()).toEqual([]);
    expect(screen.getByText(/Showing 1–25 of 60/)).toBeInTheDocument();
  });

  it("ignores a key that something else already handled", async () => {
    render(<Fixture />);
    region().focus();
    const handled = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", handled, true);
    fireEvent.keyDown(region(), { key: "j" });
    window.removeEventListener("keydown", handled, true);
    expect(activeRows()).toEqual([]);
  });
});

describe("TableKeyboardNav starts from nothing (Gmail style)", () => {
  it("j starts at the first row and moves focus into the table when it is the page's only table", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    expect(document.body).toHaveFocus();
    await user.keyboard("j");
    expect(activeName()).toContain("Person 01");
    expect(region()).toHaveFocus();
    await user.keyboard("j");
    expect(activeName()).toContain("Person 02");
  });

  it("k starts at the last row", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.keyboard("k");
    expect(activeName()).toContain("Person 25");
  });

  it("does not start when the page has two tables", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Fixture label="First" />
        <Fixture label="Second" />
      </>
    );
    await user.keyboard("j");
    expect(activeRows()).toEqual([]);
  });

  it("starts in the one table that has rows when the other is empty", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Fixture rows={[]} label="Empty" />
        <Fixture label="Full" />
      </>
    );
    await user.keyboard("j");
    expect(activeName()).toContain("Person 01");
    expect(region("Full")).toHaveFocus();
  });

  it("with two tables, Tab reaches each one's region and the keys act on the focused table only", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <Fixture label="First" />
        <Fixture label="Second" />
      </>
    );
    screen.getByRole("button", { name: "Before" }).focus();
    await user.tab();
    // The first table's search box comes first; the region follows it.
    await user.tab();
    expect(region("First")).toHaveFocus();
    await user.keyboard("jj");
    expect(within(region("First")).getAllByRole("row").filter((r) => r.getAttribute("data-kbd-active") === "true")).toHaveLength(1);
    region("Second").focus();
    await user.keyboard("j]");
    // Each table keeps its own highlight and its own page.
    expect(activeRows()).toHaveLength(2);
    expect(within(region("Second")).getByText(/Showing 26–50 of 60/)).toBeInTheDocument();
    expect(within(region("First")).getByText(/Showing 1–25 of 60/)).toBeInTheDocument();
    expect(within(region("First")).getByRole("link", { name: "Person 02" }).closest("tr")).toHaveAttribute("data-kbd-active", "true");
  });

  it("does not start while something else has focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Other</button>
        <Fixture />
      </>
    );
    screen.getByRole("button", { name: "Other" }).focus();
    await user.keyboard("j");
    expect(activeRows()).toEqual([]);
  });

  it("does not start with the arrow keys, which belong to the page's scrolling", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.keyboard("{ArrowDown}");
    expect(activeRows()).toEqual([]);
  });

  it("stays out of a page that has its own single-key shortcuts, and the calendar's keys still work there", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CalendarKeyboardNav prevHref="/prev" nextHref="/next" todayHref="/today" />
        <Fixture />
      </>
    );
    await user.keyboard("j");
    expect(activeRows()).toEqual([]);
    expect(push).toHaveBeenCalledWith("/next");
  });

  it("when both are mounted, a key the focused table handled is not also a week change", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CalendarKeyboardNav prevHref="/prev" nextHref="/next" todayHref="/today" />
        <Fixture />
      </>
    );
    region().focus();
    await user.keyboard("jk");
    expect(push).not.toHaveBeenCalled();
    expect(activeName()).toContain("Person 01");
    await user.keyboard("t");
    expect(push).toHaveBeenCalledWith("/today");
  });
});

describe("TableKeyboardNav markup, hints and shortcut list", () => {
  it("makes the region one labelled tab stop and leaves the table markup alone", () => {
    render(<Fixture />);
    expect(region()).toHaveAttribute("tabindex", "0");
    expect(within(region()).getByRole("table")).toBeInTheDocument();
    expect(within(region()).getAllByRole("row").length).toBeGreaterThan(25);
    expect(region()).toHaveAccessibleDescription(/j and k.*Enter.*Space.*brackets/);
  });

  it("shows hints only for what the table can do", () => {
    const { unmount } = render(<Fixture />);
    expect(region().querySelector("[data-kbd]")).not.toBeNull();
    const text = () => [...region().querySelectorAll("kbd")].map((k) => k.textContent).join(" ");
    expect(text()).toContain("↵");
    expect(text()).toContain("Space");
    expect(text()).toContain("[");
    unmount();
    render(<Fixture rows={ROWS.slice(0, 3)} checkboxes={false} links={false} />);
    expect(text()).not.toContain("↵");
    expect(text()).not.toContain("Space");
    expect(text()).not.toContain("[");
    expect(text()).toContain("J");
  });

  it("puts the page keys on the pager buttons, and only inside a keyboard table", () => {
    render(<Fixture />);
    expect(screen.getByRole("button", { name: /Next/ })).toHaveAttribute("aria-keyshortcuts", "]");
    expect(screen.getByRole("button", { name: /Prev/ })).toHaveAttribute("aria-keyshortcuts", "[");
    cleanup();
    function Plain() {
      const table = useDataTable<Row, "name">({ rows: ROWS, getSortValue: (r) => r.name, pageSize: 25 });
      return <DataTablePager table={table} />;
    }
    render(<Plain />);
    expect(screen.getByRole("button", { name: /Next/ })).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("declares its shortcuts as keys and labels for the shortcut panel", () => {
    expect(TABLE_KEYBOARD_SHORTCUTS.length).toBeGreaterThan(8);
    for (const shortcut of TABLE_KEYBOARD_SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.label).not.toBe("");
    }
  });
});

describe("src/lib/keyboard guards", () => {
  it("treats text fields as typing and checkboxes and buttons as not", () => {
    const text = document.createElement("input");
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(isTypingTarget(text)).toBe(true);
    expect(isTypingTarget(box)).toBe(false);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("sees an open dialog or combobox", () => {
    const root = document.createElement("div");
    expect(isOverlayOpen(root)).toBe(false);
    root.innerHTML = '<div role="combobox" aria-expanded="false"></div>';
    expect(isOverlayOpen(root)).toBe(false);
    root.innerHTML = '<div role="combobox" aria-expanded="true"></div>';
    expect(isOverlayOpen(root)).toBe(true);
    root.innerHTML = '<div aria-modal="true"></div>';
    expect(isOverlayOpen(root)).toBe(true);
  });
});
