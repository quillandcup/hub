// @vitest-environment jsdom
/** The site-wide button style (docs/product/LANDING_PAGES.md, "Buttons"): the style guide's fields and preview, and every button taking its look from the frame unless it chooses its own. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/media/MediaPicker", () => ({ default: () => <div /> }));

import { Button, ButtonRow, CardGrid, CtaBanner, Hero, LinkList, OptInFormBlock } from "@/components/landing/blocks";
import { FinishLineCard } from "@/components/landing/homepage-blocks";
import { BLOCK_DEFAULTS, PageFrame, type FrameContext } from "@/components/landing/config";
import { StyleFields } from "@/components/landing/style-fields";
import { SiteHeaderView } from "@/components/landing/site-frame";
import { normalizeSiteTemplate } from "@/lib/landing/site-template";
import { STYLE_DEFAULTS, type StyleTokens } from "@/lib/landing/style";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
});

const frameClasses = (container: HTMLElement) => (container.querySelector("[data-lp-frame]") as HTMLElement).className;
const link = (name: string | RegExp) => screen.getByRole("link", { name }).className;
const follows = (cls: string) => cls.split(" ").includes("lp-btn-inherit");

describe("the style guide's button fields", () => {
  const change = vi.fn();
  const open = (value: StyleTokens = STYLE_DEFAULTS, disabled = false) => render(<StyleFields value={value} onChange={change} disabled={disabled} />);

  it("has a style (solid or outline) and a text colour beside size and corners, each a short list", () => {
    open();
    const style = screen.getByLabelText("Button style");
    expect([...style.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Solid (filled)", "Outline"]);
    const text = screen.getByLabelText("Button text colour (solid buttons)");
    expect([...text.querySelectorAll("option")].map((o) => o.value)).toEqual(["auto", "light", "dark"]);
    expect(screen.getByLabelText("Button size")).toBeInTheDocument();
    expect(screen.getByLabelText("Button corners")).toBeInTheDocument();
  });

  it("reports a change by token, and shows the values without changing them when disabled", () => {
    open();
    fireEvent.change(screen.getByLabelText("Button style"), { target: { value: "outline" } });
    expect(change).toHaveBeenCalledWith("buttonStyle", "outline");
    fireEvent.change(screen.getByLabelText("Button text colour (solid buttons)"), { target: { value: "dark" } });
    expect(change).toHaveBeenCalledWith("buttonText", "dark");
    cleanup();
    open({ ...STYLE_DEFAULTS, buttonStyle: "outline" }, true);
    expect(screen.getByLabelText("Button style")).toHaveValue("outline");
    expect(screen.getByLabelText("Button style")).toBeDisabled();
  });

  it("previews a sample button drawn with the chosen style, in a frame of its own", () => {
    open({ ...STYLE_DEFAULTS, buttonStyle: "outline", buttonText: "dark", buttonSize: "large", buttonRadius: "square" });
    const preview = screen.getByTestId("button-preview");
    for (const name of ["lp-btn-style-outline", "lp-btn-text-dark", "lp-btn-size-large", "lp-btn-radius-square"]) expect(preview.className).toContain(name);
    const sample = screen.getByText("Sample button");
    expect(follows(sample.className)).toBe(true);
    expect(preview.contains(sample)).toBe(true);
  });

  it("previews the plain solid button for the defaults", () => {
    open();
    expect(screen.getByTestId("button-preview").className).not.toMatch(/lp-btn-(style|text)/);
  });
});

describe("a button's look comes from the site unless the button chooses its own", () => {
  const site = (style: Record<string, string>) => normalizeSiteTemplate({ style });
  const frame = (style: Record<string, string>): FrameContext => ({ pageType: "website", site: site(style) });

  it("puts the site's button style and text colour on the frame, and a page's own over them", () => {
    const outlined = render(<PageFrame frame={frame({ buttonStyle: "outline", buttonText: "dark" })}>x</PageFrame>);
    expect(frameClasses(outlined.container)).toContain("lp-btn-style-outline");
    expect(frameClasses(outlined.container)).toContain("lp-btn-text-dark");
    cleanup();
    const own = render(<PageFrame frame={frame({ buttonStyle: "outline" })} styleOverride={{ buttonStyle: "solid" }}>x</PageFrame>);
    expect(frameClasses(own.container)).not.toContain("lp-btn-style-outline");
    cleanup();
    const follows_ = render(<PageFrame frame={frame({ buttonStyle: "outline" })} styleOverride={{ primary: "teal" }}>x</PageFrame>);
    expect(frameClasses(follows_.container)).toContain("lp-btn-style-outline");
  });

  it("marks the Button block as following the site by default, and not when it says solid or outline", () => {
    const props = { label: "Join", href: "/join", color: "plum", shape: "pill", align: "left", full: false } as const;
    render(
      <>
        <Button {...props} look="inherit" />
        <Button {...props} label="Solid" look="solid" />
        <Button {...props} label="Outline" look="outline" />
        <Button {...props} label="Old" look={undefined as never} />
      </>,
    );
    expect(follows(link("Join"))).toBe(true);
    expect(follows(link("Old"))).toBe(true);
    expect(follows(link("Solid"))).toBe(false);
    expect(follows(link("Outline"))).toBe(false);
    expect(link("Join")).toContain("lp-btn-primary");
    expect(link("Join")).toContain("lp-btn-c-plum");
    expect(link("Solid")).toContain("lp-btn-primary");
    expect(link("Outline")).not.toContain("lp-btn-primary");
    expect(link("Outline")).toContain("border-2");
  });

  it("has every kind of button in the blocks follow the site by default", () => {
    render(
      <>
        <ButtonRow items={[{ label: "Row one", href: "/a", look: "inherit", color: "plum", shape: "pill" }, { label: "Row two", href: "/b", look: "outline", color: "plum", shape: "pill" }]} align="left" gap="medium" />
        <LinkList items={[{ label: "A list link", href: "/c" }]} look="inherit" color="plum" />
        <CardGrid columns="3" items={[{ alt: "", title: "Card", description: "", price: "", icon: "", buttonLabel: "Card button", href: "/d" }]} />
        <Hero {...(BLOCK_DEFAULTS.Hero as unknown as Parameters<typeof Hero>[0])} primary={{ label: "Hero primary", href: "/e" }} secondary={{ label: "Hero secondary", href: "/f" }} />
        <CtaBanner {...(BLOCK_DEFAULTS.CtaBanner as unknown as Parameters<typeof CtaBanner>[0])} label="Banner button" href="/g" />
        <FinishLineCard {...({ title: "Finish", buttonLabel: "Card link", href: "/h" } as unknown as Parameters<typeof FinishLineCard>[0])} />
      </>,
    );
    for (const name of ["Row one", "A list link", "Card button", "Hero primary", "Banner button"]) expect(follows(link(name)), name).toBe(true);
    expect(follows(link("Row two"))).toBe(false);
    expect(follows(link("Hero secondary"))).toBe(false);
  });

  it("has the sign-up form's button and the header's call to action follow the site, or choose their own", () => {
    render(<OptInFormBlock {...({ ...BLOCK_DEFAULTS.OptInForm, kajabiFormId: "form1" } as unknown as Parameters<typeof OptInFormBlock>[0])} />);
    expect(follows(screen.getByRole("button", { name: /Sign me up/ }).className)).toBe(true);
    cleanup();
    const header = normalizeSiteTemplate({
      header: { show: true, items: [{ id: "c", type: "cta", label: "Join us", href: "/join" }, { id: "s", type: "signin", label: "Sign in", look: "inherit" }, { id: "o", type: "cta", label: "Own", href: "/own", look: "solid" }] },
    }).header;
    render(<>{SiteHeaderView({ header })}</>);
    expect(follows(screen.getAllByRole("link", { name: "Join us" })[0].className)).toBe(true);
    expect(follows(screen.getAllByRole("link", { name: "Sign in" })[0].className)).toBe(true);
    expect(follows(screen.getAllByRole("link", { name: "Own" })[0].className)).toBe(false);
  });

  it("draws the same classes in light and dark theme: the theme is CSS (tested against app/globals.css), not a class on the button", () => {
    const props = { label: "Join", href: "/join", look: "inherit", color: "plum", shape: "pill", align: "left", full: false } as const;
    const light = render(<Button {...props} />);
    const lightClass = link("Join");
    light.unmount();
    document.documentElement.classList.add("dark");
    render(<Button {...props} />);
    expect(link("Join")).toBe(lightClass);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
