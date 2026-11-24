// @vitest-environment jsdom
/** The one-line text field with placeholders as pills: what it stores, how pills are added, edited and removed, and that it stays one line. */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import PlaceholderTextField from "@/components/landing/PlaceholderTextField";
import { FOOTER_TEXT_PLACEHOLDERS, type PlaceholderName } from "@/lib/landing/placeholders";
import { useFakeClock } from "../helpers/fake-clock";

const NOV_2026 = Date.UTC(2026, 10, 23, 15, 0);

function Harness({ initial = "", onSubmit = vi.fn() }: { initial?: string; onSubmit?: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <PlaceholderTextField label="Footer text" value={value} onChange={setValue} placeholders={FOOTER_TEXT_PLACEHOLDERS} />
      <output data-testid="stored">{value}</output>
      <button type="button" onClick={() => setValue("© {year:2020} Replaced")}>
        Replace from outside
      </button>
    </form>
  );
}

const stored = () => screen.getByTestId("stored").textContent;
const box = async () => (await screen.findByRole("textbox", { name: "Footer text" })) as HTMLElement & { editor: Editor };

/** TipTap focuses on the next frame, and the keys go to whatever has focus. */
async function focusEditor(editor: HTMLElement & { editor: Editor }, where: "start" | "end" | null = null) {
  editor.editor.commands.focus(where);
  await waitFor(() => expect(editor).toHaveFocus());
}

describe("PlaceholderTextField", () => {
  useFakeClock(() => NOV_2026);

  it("shows a token in the stored text as a pill, and what it will show as", async () => {
    render(<Harness initial="© {year:2019} Fern Quills" />);
    await box();
    expect(await screen.findByRole("group", { name: "Year from 2019 placeholder" })).toBeInTheDocument();
    expect(screen.getByTestId("placeholder-preview")).toHaveTextContent("© 2019–2026 Fern Quills");
    expect(stored()).toBe("© {year:2019} Fern Quills");
  });

  it("shows no 'Shows as' line when the text has no placeholder", async () => {
    render(<Harness initial="Plain {unknown} words" />);
    await box();
    expect(screen.queryByTestId("placeholder-preview")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("lists what the registry offers, and inserts a pill at the cursor", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const editor = await box();
    await user.click(editor);
    await user.keyboard("© ");
    await user.click(screen.getByRole("button", { name: "Add a placeholder" }));
    const list = screen.getByRole("dialog", { name: "Placeholders" });
    expect(within(list).getByText("Year")).toBeInTheDocument();
    expect(within(list).getByText(/turns over each New Year/)).toBeInTheDocument();
    expect(within(list).getByText("2026")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Insert Year placeholder" }));
    expect(screen.queryByRole("dialog", { name: "Placeholders" })).toBeNull();
    expect(stored()).toBe("© {year}");
    expect(screen.getByRole("group", { name: "Year placeholder" })).toBeInTheDocument();
  });

  it("closes the list on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await box();
    await user.click(screen.getByRole("button", { name: "Add a placeholder" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Placeholders" })).toBeNull();
  });

  it("removes the whole pill on Backspace beside it", async () => {
    const user = userEvent.setup();
    render(<Harness initial="A{year:2019}" />);
    const editor = await box();
    await focusEditor(editor, "end");
    await user.keyboard("{Backspace}");
    expect(stored()).toBe("A");
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("removes the whole pill on Delete beside it, and on Delete once it is selected", async () => {
    const user = userEvent.setup();
    render(<Harness initial="{year}B{year:2019}" />);
    const editor = await box();
    await focusEditor(editor, "start");
    await user.keyboard("{Delete}");
    expect(stored()).toBe("B{year:2019}");
    editor.editor.commands.setNodeSelection(2);
    await focusEditor(editor);
    await user.keyboard("{Delete}");
    expect(stored()).toBe("B");
  });

  it("removes a pill with its x, which has its own name", async () => {
    const user = userEvent.setup();
    render(<Harness initial="A {year} B" />);
    await box();
    await user.click(await screen.findByRole("button", { name: "Remove Year placeholder" }));
    expect(stored()).toBe("A  B");
  });

  it("does not add a line or submit the form on Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const editor = await box();
    await user.click(editor);
    await user.keyboard("ab{Enter}cd{Shift>}{Enter}{/Shift}ef");
    expect(stored()).toBe("abcdef");
    expect(editor.querySelectorAll("p")).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("pastes plain text on one line, and a pasted token becomes a pill", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const editor = await box();
    await user.click(editor);
    await user.paste("line one\nline two {year:2019}");
    expect(stored()).toBe("line one line two {year:2019}");
    expect(await screen.findByRole("group", { name: "Year from 2019 placeholder" })).toBeInTheDocument();
  });

  it("makes a token typed in full a pill, and leaves one that is not a known placeholder as text", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const editor = await box();
    await user.click(editor);
    await user.keyboard("a");
    await act(async () => {
      editor.editor.commands.insertContent("{member} {year}");
    });
    expect(stored()).toBe("a{member} {year}");
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });

  it("changes a pill's start year from its edit box, and clears it", async () => {
    const user = userEvent.setup();
    render(<Harness initial="© {year}" />);
    await box();
    await user.click(await screen.findByRole("button", { name: "Edit Year" }));
    const edit = screen.getByRole("dialog", { name: "Year placeholder" });
    const input = within(edit).getByLabelText("Start year");
    await user.type(input, "2019");
    expect(within(edit).getByText("2019–2026")).toBeInTheDocument();
    await user.click(within(edit).getByRole("button", { name: "Done" }));
    expect(stored()).toBe("© {year:2019}");
    expect(screen.getByTestId("placeholder-preview")).toHaveTextContent("© 2019–2026");
    // Done hands focus back to the text, on the next frame.
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Footer text" })).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Edit Year from 2019" }));
    const again = screen.getByRole("dialog", { name: "Year placeholder" });
    expect(within(again).getByLabelText("Start year")).toHaveValue("2019");
    await user.clear(within(again).getByLabelText("Start year"));
    await user.keyboard("{Enter}");
    expect(stored()).toBe("© {year}");
  });

  it("refuses a start year that is not four digits, and does not submit the form on Enter in the box", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness initial="{year}" onSubmit={onSubmit} />);
    await box();
    await user.click(await screen.findByRole("button", { name: "Edit Year" }));
    await user.type(screen.getByLabelText("Start year"), "19{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(/Four digits/);
    expect(stored()).toBe("{year}");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Year placeholder" })).toBeNull();
    expect(stored()).toBe("{year}");
  });

  it("opens the edit box on Enter once a pill is selected", async () => {
    const user = userEvent.setup();
    render(<Harness initial="{year}" />);
    const editor = await box();
    await screen.findByRole("group");
    editor.editor.commands.setNodeSelection(1);
    await focusEditor(editor);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Year placeholder" })).toBeInTheDocument();
    expect(stored()).toBe("{year}");
  });

  it("takes a value changed from outside, such as bringing a version back", async () => {
    const user = userEvent.setup();
    render(<Harness initial="old" />);
    await box();
    await user.click(screen.getByRole("button", { name: "Replace from outside" }));
    expect(await screen.findByRole("group", { name: "Year from 2020 placeholder" })).toBeInTheDocument();
    expect(stored()).toBe("© {year:2020} Replaced");
  });

  it("offers only the placeholders it is given, and no button when it is given none", async () => {
    render(<PlaceholderTextField label="Plain" value="" onChange={() => {}} placeholders={[]} />);
    await screen.findByRole("textbox", { name: "Plain" });
    expect(screen.queryByRole("button", { name: "Add a placeholder" })).toBeNull();
  });

  it("throws on a placeholder that is not in the registry", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<PlaceholderTextField label="Bad" value="" onChange={() => {}} placeholders={["nope" as PlaceholderName]} />)).toThrow(/Unknown placeholder "nope"/);
    spy.mockRestore();
  });
});
