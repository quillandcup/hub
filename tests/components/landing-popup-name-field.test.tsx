// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PopupNameField, PopupNamesContext } from "@/components/landing/PopupNameField";
import { collectPopupNames, pagesSharing, popupNameOptions, resolvePopupName, type PopupSource } from "@/lib/landing/popup-names";

const popup = (name: unknown) => ({ type: "ExitPopup", props: { id: "p", popupName: name, content: [] } });
const doc = (...blocks: unknown[]) => ({ content: blocks, root: { props: {} } });
const sources: PopupSource[] = [
  { slug: "spring", title: "Spring sale", draft_data: doc(popup("Newsletter")), published_data: null },
  { slug: "autumn", title: "Autumn", draft_data: doc({ type: "Section", props: { id: "s", content: [popup("newsletter  ")] } }), published_data: doc(popup("Welcome")) },
  { slug: "plain", title: "Plain", draft_data: doc(popup(""), popup(7), { type: "Heading", props: { id: "h", popupName: "Ignored" } }), published_data: null },
];
const uses = collectPopupNames(sources);

describe("popup names in use", () => {
  it("are read from drafts and published copies, deep in the page, one per name whatever the case, as first spelled", () => {
    expect(uses.map((u) => u.name)).toEqual(["Newsletter", "Welcome"]);
    expect(uses[0].pages.map((p) => p.slug)).toEqual(["spring", "autumn"]);
    expect(uses[1].pages.map((p) => p.slug)).toEqual(["autumn"]);
    expect(collectPopupNames([])).toEqual([]);
  });

  it("make the dropdown: this page only first, then the names, plus the block's own name when no page has it yet", () => {
    expect(popupNameOptions(uses, "")).toEqual([
      { label: "This page only", value: "" },
      { label: "Newsletter", value: "Newsletter" },
      { label: "Welcome", value: "Welcome" },
    ]);
    expect(popupNameOptions(uses, "NEWSLETTER")).toHaveLength(3);
    expect(popupNameOptions(uses, " Brand new ").at(-1)).toEqual({ label: "Brand new", value: "Brand new" });
  });

  it("reuse the existing spelling for a new name that differs only in case or spacing, and take anything else as typed", () => {
    expect(resolvePopupName("  newsletter ", uses)).toBe("Newsletter");
    expect(resolvePopupName("WELCOME", uses)).toBe("Welcome");
    expect(resolvePopupName("  Spring   Offer ", uses)).toBe("Spring Offer");
    expect(resolvePopupName("x".repeat(100), uses)).toHaveLength(60);
    expect(resolvePopupName("   ", uses)).toBe("");
  });

  it("say which other pages share a name", () => {
    expect(pagesSharing(uses, "newsletter", "spring").map((p) => p.slug)).toEqual(["autumn"]);
    expect(pagesSharing(uses, "Newsletter", "other").map((p) => p.slug)).toEqual(["spring", "autumn"]);
    expect(pagesSharing(uses, "", "spring")).toEqual([]);
    expect(pagesSharing(uses, "Unused", "spring")).toEqual([]);
  });
});

describe("PopupNameField", () => {
  afterEach(cleanup);
  const setup = (value: string, onChange = vi.fn()) => {
    render(
      <PopupNamesContext.Provider value={{ uses, currentSlug: "spring" }}>
        <PopupNameField label="Popup name" value={value} onChange={onChange} />
      </PopupNamesContext.Provider>,
    );
    return onChange;
  };

  it("is page only by default, says so, and lists the names in use after it", () => {
    setup("");
    const select = screen.getByLabelText("Popup name");
    expect(select).toHaveValue("");
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(["This page only", "Newsletter", "Welcome", "New name..."]);
    expect(screen.getByText(/this page only/)).toBeInTheDocument();
  });

  it("picks a name in use and back to this page only", async () => {
    const onChange = setup("Newsletter");
    expect(screen.getByLabelText("Popup name")).toHaveValue("Newsletter");
    expect(screen.getByText(/Shared with Autumn/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Popup name"), "Welcome");
    expect(onChange).toHaveBeenCalledWith("Welcome");
    await userEvent.selectOptions(screen.getByLabelText("Popup name"), "");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("adds a new name typed under New name, reusing an existing spelling in another case", async () => {
    const onChange = setup("");
    await userEvent.selectOptions(screen.getByLabelText("Popup name"), "New name...");
    await userEvent.type(screen.getByLabelText("New popup name"), "  Spring offer {Enter}");
    expect(onChange).toHaveBeenCalledWith("Spring offer");
    expect(screen.queryByLabelText("New popup name")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Popup name"), "New name...");
    await userEvent.type(screen.getByLabelText("New popup name"), "WELCOME");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith("Welcome");
  });

  it("changes nothing when nothing is typed, and says when no other page uses the name", async () => {
    const onChange = setup("Solo name");
    expect(screen.getByLabelText("Popup name")).toHaveValue("Solo name");
    expect(screen.getByText(/No other page uses this name yet/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Popup name"), "New name...");
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
  });
});
