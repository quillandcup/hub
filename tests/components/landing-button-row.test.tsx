// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ButtonRow, RowButton, buttonClasses, type RowButtonProps } from "@/components/landing/blocks";
import { BLOCK_DEFAULTS, BLOCK_LABELS, SLOT_ALLOW, renderConfig } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";
import { checkLandingPage } from "@/lib/landing/a11y";
import { starterData } from "@/lib/landing/starters";
import { itemsSlot } from "./landing-items-slot";

afterEach(cleanup);

const item = (props: Partial<RowButtonProps> = {}): Partial<RowButtonProps> => ({ label: "Join", href: "https://example.com/join", look: "solid", color: "plum", shape: "pill", ...props });
const row = (list: Partial<RowButtonProps>[], extra: { align?: "left" | "center"; gap?: "small" | "medium"; editing?: boolean } = {}) => <ButtonRow items={itemsSlot(RowButton, list)} align={extra.align ?? "left"} gap={extra.gap ?? "medium"} editing={extra.editing} />;

describe("ButtonRow block", () => {
  it("renders each button as a link with the Button block's classes, in a row that wraps", () => {
    const { container } = render(row([item(), item({ label: "More", href: "/more", look: "outline", color: "light", shape: "rect" })]));
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://example.com/join");
    expect(screen.getByRole("link", { name: "Join" })).toHaveClass(...buttonClasses("solid", "plum", "pill", false).split(" ").filter(Boolean));
    expect(screen.getByRole("link", { name: "More" })).toHaveClass(...buttonClasses("outline", "light", "rect", false).split(" ").filter(Boolean));
    const list = container.firstElementChild as HTMLElement;
    expect(list.tagName).toBe("UL");
    expect(list).toHaveClass("flex", "flex-wrap", "gap-3", "justify-start");
    expect(list.className).not.toMatch(/\b(sm|md|lg|xl):/);
  });

  it("centres the row and tightens the gap when asked", () => {
    const { container } = render(row([item()], { align: "center", gap: "small" }));
    expect(container.firstElementChild).toHaveClass("justify-center", "gap-2");
  });

  it("shows a button with no link, or an unsafe one, as disabled text rather than a link", () => {
    render(row([item({ label: "Empty", href: "" }), item({ label: "Bad", href: "javascript:alert(1)" }), item({ label: "Fine" })]));
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("Empty")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Bad")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Empty")).toHaveClass("opacity-50");
  });

  it("draws nothing for a button with no label, hides the row when it has none, and hides what is past three", () => {
    const { container } = render(row([item({ label: "" }), item({ label: "A" }), item({ label: "B" }), item({ label: "C" }), item({ label: "D" })]));
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["A", "B", "C", "D"]);
    expect(container.firstElementChild!.className).toContain("[&>:nth-child(n+4)]:hidden");
    cleanup();
    const empty = render(row([item({ label: "" })]));
    expect(empty.container.querySelector("li")).toBeNull();
    expect(empty.container.firstElementChild!.className).toContain("empty:hidden");
  });

  it("keeps an empty button as a faded placeholder while editing, so it can be selected and dragged", () => {
    const { container } = render(row([item({ label: "", editing: true })], { editing: true }));
    expect(container.querySelector("li [aria-disabled='true']")).toHaveTextContent("Button");
    expect(container.firstElementChild!.className).not.toContain("empty:hidden");
  });
});

describe("ButtonRow registration and editor fields", () => {
  it("is in the Links group with defaults and a label, and its buttons are blocks of their own", () => {
    expect(BLOCK_LABELS.ButtonRow).toBe("Buttons");
    expect(BLOCK_DEFAULTS.ButtonRow.items.length).toBeGreaterThanOrEqual(1);
    expect(renderConfig.categories.links.components).toContain("ButtonRow");
    expect(SLOT_ALLOW.ButtonRow).toEqual({ items: ["RowButton"] });
  });

  it("labels every field, including each button's", () => {
    const fields = editorConfig.components.ButtonRow.fields as Record<string, { label?: string; type: string; allow?: string[] }>;
    for (const field of Object.values(fields)) expect(field.label).toBeTruthy();
    expect(fields.items).toMatchObject({ type: "slot", allow: ["RowButton"] });
    const buttonFields = editorConfig.components.RowButton.fields as Record<string, { label?: string }>;
    for (const field of Object.values(buttonFields)) expect(field.label).toBeTruthy();
    expect(Object.keys(buttonFields).sort()).toEqual(["color", "href", "label", "look", "shape"]);
  });
});

describe("ButtonRow accessibility checks", () => {
  let n = 0;
  const page = (...buttons: Record<string, unknown>[]) => ({
    content: [
      { type: "Heading", props: { id: "h", text: "Title", level: "h1", align: "left" } },
      { type: "ButtonRow", props: { id: "r", items: buttons.map((props) => ({ type: "RowButton", props: { id: `b${n++}`, ...props } })), align: "left", gap: "medium" } },
    ],
    root: {},
  });

  it("errors on a button with a label but no usable link", () => {
    const errors = checkLandingPage(page({ label: "Go", href: "javascript:x" }, { label: "Other", href: "" }, { label: "", href: "" })).filter((i) => i.severity === "error");
    expect(errors.map((e) => e.message)).toEqual(['The button "Go" has no link.', 'The button "Other" has no link.']);
    expect(errors[0].block).toBe("Buttons");
  });

  it("warns about vague button text and is quiet for good buttons", () => {
    const warnings = checkLandingPage(page({ label: "Click here", href: "/x" })).filter((i) => i.severity === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("doesn't say where it goes");
    expect(checkLandingPage(page({ label: "Join the club", href: "/join" }))).toEqual([]);
  });

  it("warns about a row with no button, and about more than three", () => {
    expect(checkLandingPage(page()).map((i) => i.message)).toEqual(['Buttons has no buttons, so it shows nothing. Drag one in from "Parts of a block".']);
    const four = Array.from({ length: 4 }, (_, i) => ({ label: `Go ${i}`, href: "/x" }));
    expect(checkLandingPage(page(...four)).map((i) => i.message)).toEqual(["Buttons shows 3 buttons at most; the 1 after that are hidden."]);
  });
});

describe("Homepage starter opening", () => {
  it("has the two buttons in one ButtonRow, primary solid and secondary outline, both light", () => {
    const content = starterData("home").content as { type: string; props: Record<string, unknown> }[];
    const section = content[1];
    const columns = (section.props.content as { props: Record<string, unknown> }[])[0];
    const buttons = (columns.props.col1 as { type: string; props: Record<string, unknown> }[]).find((b) => b.type === "ButtonRow")!;
    expect(buttons.props.align).toBe("left");
    expect((buttons.props.items as { type: string; props: Record<string, unknown> }[]).map(({ type, props: { id: _id, ...rest } }) => ({ type, ...rest }))).toEqual([
      { type: "RowButton", label: "Start your first prickle", href: "", look: "solid", color: "light", shape: "pill" },
      { type: "RowButton", label: "Drop in now", href: "", look: "outline", color: "light", shape: "pill" },
    ]);
  });
});
