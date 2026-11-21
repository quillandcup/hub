// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ButtonRow, buttonClasses, type ButtonRowItem } from "@/components/landing/blocks";
import { BLOCK_DEFAULTS, BLOCK_LABELS, renderConfig } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";
import { checkLandingPage } from "@/lib/landing/a11y";
import { starterData } from "@/lib/landing/starters";

afterEach(cleanup);

const item = (props: Partial<ButtonRowItem> = {}): ButtonRowItem => ({ label: "Join", href: "https://example.com/join", look: "solid", color: "plum", shape: "pill", ...props });

describe("ButtonRow block", () => {
  it("renders each button as a link with the Button block's classes, in a row that wraps", () => {
    const { container } = render(<ButtonRow items={[item(), item({ label: "More", href: "/more", look: "outline", color: "light", shape: "rect" })]} align="left" gap="medium" />);
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://example.com/join");
    expect(screen.getByRole("link", { name: "Join" })).toHaveClass(...buttonClasses("solid", "plum", "pill", false).split(" ").filter(Boolean));
    expect(screen.getByRole("link", { name: "More" })).toHaveClass(...buttonClasses("outline", "light", "rect", false).split(" ").filter(Boolean));
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveClass("flex", "flex-wrap", "gap-3", "justify-start");
    expect(row.className).not.toMatch(/\b(sm|md|lg|xl):/);
  });

  it("centres the row and tightens the gap when asked", () => {
    const { container } = render(<ButtonRow items={[item()]} align="center" gap="small" />);
    expect(container.firstElementChild).toHaveClass("justify-center", "gap-2");
  });

  it("shows a button with no link, or an unsafe one, as disabled text rather than a link", () => {
    render(<ButtonRow items={[item({ label: "Empty", href: "" }), item({ label: "Bad", href: "javascript:alert(1)" }), item({ label: "Fine" })]} align="left" gap="medium" />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("Empty")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Bad")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Empty")).toHaveClass("opacity-50");
  });

  it("skips buttons with no label, shows at most three, and renders nothing when none is left", () => {
    render(<ButtonRow items={[item({ label: "" }), item({ label: "A" }), item({ label: "B" }), item({ label: "C" }), item({ label: "D" })]} align="left" gap="medium" />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["A", "B", "C"]);
    cleanup();
    const { container } = render(<ButtonRow items={[item({ label: "" })]} align="left" gap="medium" />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const bad = render(<ButtonRow items={undefined as never} align="left" gap="medium" />);
    expect(bad.container).toBeEmptyDOMElement();
  });
});

describe("ButtonRow registration and editor fields", () => {
  it("is in the Links group with defaults and a label", () => {
    expect(BLOCK_LABELS.ButtonRow).toBe("Buttons");
    expect(BLOCK_DEFAULTS.ButtonRow.items.length).toBeGreaterThanOrEqual(1);
    expect(renderConfig.categories.links.components).toContain("ButtonRow");
  });

  it("labels every field, including each button's, and caps the list at three", () => {
    const fields = editorConfig.components.ButtonRow.fields as Record<string, { label?: string; max?: number; arrayFields?: Record<string, { label?: string }>; getItemSummary?: (i: { label?: string }) => string }>;
    for (const field of Object.values(fields)) expect(field.label).toBeTruthy();
    expect(fields.items.max).toBe(3);
    for (const field of Object.values(fields.items.arrayFields ?? {})) expect(field.label).toBeTruthy();
    expect(Object.keys(fields.items.arrayFields ?? {}).sort()).toEqual(["color", "href", "label", "look", "shape"]);
    expect(fields.items.getItemSummary?.({ label: "Join" })).toBe("Join");
    expect(fields.items.getItemSummary?.({})).toBe("Button");
  });
});

describe("ButtonRow accessibility checks", () => {
  const page = (...buttons: Record<string, unknown>[]) => ({
    content: [
      { type: "Heading", props: { id: "h", text: "Title", level: "h1", align: "left" } },
      { type: "ButtonRow", props: { id: "r", items: buttons, align: "left", gap: "medium" } },
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
});

describe("Homepage starter opening", () => {
  it("has the two buttons in one ButtonRow, primary follows the site and secondary is outline, both light", () => {
    const content = starterData("home").content as { type: string; props: Record<string, unknown> }[];
    const section = content[1];
    const columns = (section.props.content as { props: Record<string, unknown> }[])[0];
    const row = (columns.props.col1 as { type: string; props: Record<string, unknown> }[]).find((b) => b.type === "ButtonRow")!;
    expect(row.props.align).toBe("left");
    expect(row.props.items).toEqual([
      { label: "Start your first prickle", href: "", look: "inherit", color: "light", shape: "pill" },
      { label: "Drop in now", href: "", look: "outline", color: "light", shape: "pill" },
    ]);
  });
});
