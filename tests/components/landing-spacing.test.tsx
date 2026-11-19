// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Section } from "@/components/landing/blocks";
import { BLOCK_DEFAULTS, renderConfig } from "@/components/landing/config";
import { PADDING_DEFAULT_DESKTOP, PADDING_DEFAULT_MOBILE } from "@/lib/landing/layout";

afterEach(cleanup);

const Content = ({ className }: { className?: string } = {}) => <p data-testid="slot" className={className}>inside</p>;
const base = { background: "none", overlay: "none", width: "wide", align: "left", card: false, fadeIn: false, content: Content } as const;
const band = (props: Record<string, unknown> = {}) => render(<Section {...base} {...props} />).container.querySelector("section")!;

describe("Section spacing", () => {
  it("sets each side and size as a custom property, read by mobile-first classes on the named container size", () => {
    const section = band({ paddingDesktop: { top: 80, bottom: 90, left: 20, right: 30 }, paddingMobile: { top: 10, bottom: 11, left: 12, right: 13 } });
    expect(section.style.getPropertyValue("--sp-t-d")).toBe("80px");
    expect(section.style.getPropertyValue("--sp-b-d")).toBe("90px");
    expect(section.style.getPropertyValue("--sp-l-d")).toBe("20px");
    expect(section.style.getPropertyValue("--sp-r-d")).toBe("30px");
    expect(section.style.getPropertyValue("--sp-t-m")).toBe("10px");
    expect(section.style.getPropertyValue("--sp-r-m")).toBe("13px");
    // Mobile is the base; the desktop value comes in at the `split` container size, never a viewport breakpoint.
    expect(section.className).toContain("pt-[var(--sp-t-m)]");
    expect(section.className).toContain("@split:pt-[var(--sp-t-d)]");
    expect(section.className).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
  });

  it("uses the defaults for a Section with no stored spacing, and clamps a wild value", () => {
    const plain = band();
    expect(plain.style.getPropertyValue("--sp-t-d")).toBe(`${PADDING_DEFAULT_DESKTOP.top}px`);
    expect(plain.style.getPropertyValue("--sp-t-m")).toBe(`${PADDING_DEFAULT_MOBILE.top}px`);
    cleanup();
    const wild = band({ paddingDesktop: { top: 99999, bottom: -4, left: "x" } });
    expect(wild.style.getPropertyValue("--sp-t-d")).toBe("320px");
    expect(wild.style.getPropertyValue("--sp-b-d")).toBe("0px");
    expect(wild.style.getPropertyValue("--sp-l-d")).toBe(`${PADDING_DEFAULT_DESKTOP.left}px`);
  });

  it("keeps a background picture beside the spacing", () => {
    const section = band({ backgroundImageAssetId: "media_AAAAAAAAAAA1", overlay: "dark" });
    expect(section.style.backgroundImage).toContain("/api/media/media_AAAAAAAAAAA1/");
    expect(section.style.getPropertyValue("--sp-t-d")).toBe("48px");
  });

  it("hides on mobile, on desktop or on both, with the mobile style as the base", () => {
    expect(band({ hideOnMobile: true }).className).toContain("hidden @split:block");
    cleanup();
    expect(band({ hideOnDesktop: true }).className).toContain("@split:hidden");
    cleanup();
    const both = band({ hideOnDesktop: true, hideOnMobile: true }).className;
    expect(both).toMatch(/(^|\s)hidden(\s|$)/);
    cleanup();
    expect(band().className).not.toMatch(/hidden/);
  });

  it("only dims a hidden section in the editor, so it can still be selected", () => {
    const section = band({ hideOnMobile: true, editing: true });
    expect(section.className).toContain("opacity-40");
    expect(section.className).not.toMatch(/hidden/);
  });

  it("lays its blocks on a 12-column grid, and has no horizontal padding of its own beyond the spacing", () => {
    band();
    expect(screen.getByTestId("slot").className).toContain("grid-cols-12");
    expect(screen.getByTestId("slot").parentElement!.className).not.toContain("px-4");
  });
});

describe("a block's width in the page", () => {
  const render1 = (props: Record<string, unknown>) => {
    const Heading = renderConfig.components.Heading.render as unknown as (p: Record<string, unknown>) => React.ReactElement;
    return render(<Heading id="h1" text="Hello" level="h2" align="left" {...props} />).container.firstElementChild!;
  };

  it("puts every block in a box that takes the columns it was given", () => {
    const box = render1({ span: 8, spanMobile: 6 });
    expect(box.className).toContain("col-span-6");
    expect(box.className).toContain("@split:col-span-8");
    expect(box.className).toContain("min-w-0");
    expect(box.querySelector("h2")).toHaveTextContent("Hello");
  });

  it("takes the full width without them", () => {
    const box = render1({});
    expect(box.className).toContain("col-span-12");
    expect(box.className).toContain("@split:col-span-12");
  });

  it("hands Puck the box to drag when editing, and nothing on the public page", () => {
    const refs: unknown[] = [];
    const ref = (el: Element | null) => refs.push(el);
    render1({ puck: { dragRef: ref, isEditing: true } });
    expect(refs.length).toBeGreaterThan(0);
    expect((refs[0] as HTMLElement).tagName).toBe("DIV");
    cleanup();
    expect(() => render1({ puck: { isEditing: false } })).not.toThrow();
  });

  it("marks every block inline, so the box is the grid item in the editor too", () => {
    for (const name of Object.keys(BLOCK_DEFAULTS)) expect((renderConfig.components[name] as { inline?: boolean }).inline, name).toBe(true);
  });

  it("tells only a Section it is being edited", () => {
    const Sec = renderConfig.components.Section.render as unknown as (p: Record<string, unknown>) => React.ReactElement;
    const dimmed = render(<Sec id="s" {...base} hideOnMobile puck={{ isEditing: true }} />).container.querySelector("section")!;
    expect(dimmed.className).toContain("opacity-40");
    cleanup();
    const hidden = render(<Sec id="s" {...base} hideOnMobile puck={{ isEditing: false }} />).container.querySelector("section")!;
    expect(hidden.className).toContain("hidden @split:block");
  });
});
