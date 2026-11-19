// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/media/MediaPicker", () => ({ default: () => null }));

import { PaddingField, SpanField } from "@/components/landing/layout-fields";
import { editorConfig } from "@/components/landing/editor-config";
import { PADDING_DEFAULT_DESKTOP, PADDING_DEFAULT_MOBILE } from "@/lib/landing/layout";

afterEach(cleanup);

describe("SpanField", () => {
  it("shows twelve squares and sets the width to the one clicked", () => {
    const onChange = vi.fn();
    render(<SpanField label="Width on desktop" value={undefined} onChange={onChange} />);
    expect(screen.getAllByRole("radio")).toHaveLength(12);
    fireEvent.click(screen.getByRole("radio", { name: "8 columns" }));
    expect(onChange).toHaveBeenLastCalledWith(8);
  });

  it("says the width in words, fills the squares up to it and offers Reset only when set", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SpanField label="Width" value={undefined} onChange={onChange} />);
    expect(screen.getByText("Full width")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    rerender(<SpanField label="Width" value={8} onChange={onChange} />);
    expect(screen.getByText("8 columns", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "8 columns" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "9 columns" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "3 columns" }).className).toContain("bg-plum-600");
    expect(screen.getByRole("radio", { name: "9 columns" }).className).not.toContain("bg-plum-600");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("is one tab stop on the chosen square, and the arrow, Home and End keys move the choice", () => {
    const onChange = vi.fn();
    render(<SpanField label="Width" value={6} onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.filter((r) => r.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(radios[5]).toHaveAttribute("tabindex", "0");
    const group = screen.getByRole("radiogroup", { name: "Width" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(7);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(group, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(group, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(12);
    onChange.mockClear();
    fireEvent.keyDown(group, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays inside 1 to 12 at the ends, and starts from full width when unset", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SpanField label="Width" value={12} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(12);
    rerender(<SpanField label="Width" value={1} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    rerender(<SpanField label="Width" value={undefined} onChange={onChange} />);
    expect(screen.getAllByRole("radio")[11]).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(11);
  });
});

describe("PaddingField", () => {
  it("edits one side at a time, keeping the others, and clamps what is typed", () => {
    const onChange = vi.fn();
    render(<PaddingField label="Space inside on desktop" size="desktop" value={PADDING_DEFAULT_DESKTOP} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Space inside on desktop, left (px)"), { target: { value: "30" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PADDING_DEFAULT_DESKTOP, left: 30 });
    fireEvent.change(screen.getByLabelText("Space inside on desktop, top (px)"), { target: { value: "5000" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PADDING_DEFAULT_DESKTOP, top: 320 });
    fireEvent.change(screen.getByLabelText("Space inside on desktop, bottom (px)"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PADDING_DEFAULT_DESKTOP, bottom: 0 });
  });

  it("shows the defaults for a Section that has none, and marks the preset that matches", () => {
    render(<PaddingField label="Space inside on mobile" size="mobile" value={undefined} onChange={() => {}} />);
    expect(screen.getByLabelText("Space inside on mobile, top (px)")).toHaveValue(PADDING_DEFAULT_MOBILE.top);
    expect(screen.getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "false");
  });

  it("sets the space above and below from a quick pick for its own size, and leaves left and right", () => {
    const onChange = vi.fn();
    const { rerender } = render(<PaddingField label="Desktop" size="desktop" value={{ ...PADDING_DEFAULT_DESKTOP, left: 20 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(onChange).toHaveBeenLastCalledWith({ top: 80, bottom: 80, left: 20, right: 16 });
    rerender(<PaddingField label="Mobile" size="mobile" value={PADDING_DEFAULT_MOBILE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...PADDING_DEFAULT_MOBILE, top: 48, bottom: 48 });
  });
});

describe("the editor's fields", () => {
  const section = editorConfig.components.Section;
  const labels = (fields: Record<string, { label?: string }> | undefined) => Object.fromEntries(Object.entries(fields ?? {}).map(([k, f]) => [k, f.label]));

  it("groups a Section's space and visibility by size, with labels that name the size", () => {
    const fields = labels(section.fields as never);
    expect(fields.paddingDesktop).toBe("Space inside on desktop");
    expect(fields.paddingMobile).toBe("Space inside on mobile");
    expect(fields.hideOnDesktop).toBe("Hide on desktop");
    expect(fields.hideOnMobile).toBe("Hide on mobile");
    expect(fields).not.toHaveProperty("padding");
  });

  it("offers the width fields only to a block inside a Section", async () => {
    for (const name of ["Heading", "Button", "Columns", "Hero"]) {
      const component = editorConfig.components[name] as never as { fields: Record<string, unknown>; resolveFields: (d: unknown, p: { fields: Record<string, unknown>; parent: { type: string } | null }) => Record<string, { label?: string }> };
      const inside = component.resolveFields({}, { fields: component.fields, parent: { type: "Section" } });
      expect(inside.span.label, name).toBe("Width on desktop");
      expect(inside.spanMobile.label, name).toBe("Width on mobile");
      expect(Object.keys(inside)).toEqual(expect.arrayContaining(Object.keys(component.fields)));
      expect(component.resolveFields({}, { fields: component.fields, parent: null })).toBe(component.fields);
      expect(component.resolveFields({}, { fields: component.fields, parent: { type: "Columns" } })).toBe(component.fields);
    }
  });

  it("renders the width field from the config and passes its value through", () => {
    const component = editorConfig.components.Heading as never as { fields: Record<string, unknown>; resolveFields: (d: unknown, p: { fields: Record<string, unknown>; parent: { type: string } }) => Record<string, { render: (p: { value: unknown; onChange: (v: unknown) => void }) => React.ReactElement }> };
    const fields = component.resolveFields({}, { fields: component.fields, parent: { type: "Section" } });
    const onChange = vi.fn();
    render(fields.span.render({ value: 4, onChange }));
    fireEvent.click(screen.getByRole("radio", { name: "10 columns" }));
    expect(onChange).toHaveBeenCalledWith(10);
  });
});
