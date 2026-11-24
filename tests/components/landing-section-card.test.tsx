// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { Section } from "@/components/landing/blocks";
import { CORE_DEFAULTS } from "@/components/landing/core-blocks";
import { checkLandingPage } from "@/lib/landing/a11y";
import { LANDING_SCHEMA_VERSION } from "@/lib/landing/migrations";
import { normalizeLandingData } from "@/lib/landing/data";
import { pruneToKnownBlocks } from "@/lib/landing/json-transfer";

const Content = () => <p>Words</p>;
const base = { background: "none", overlay: "none", width: "narrow", align: "left", card: false, fadeIn: false, content: Content } as const;
const picture = { backgroundImageAssetId: "media_AAAAAAAAAAA1" } as const;
const band = (c: HTMLElement) => c.querySelector("section")!;

describe("a Section's soft cream shade", () => {
  it("is a light shade with dark text and the light scope, like the light one but let the picture show more", () => {
    const { container } = render(<Section {...base} {...picture} overlay="cream" />);
    expect(container.querySelector("section > div[aria-hidden]")!.className).toContain("bg-cream/50");
    expect(band(container).className).toContain("text-ink");
    expect(band(container).className).toContain("landing-light");
    const dark = render(<Section {...base} {...picture} overlay="dark" />);
    expect(band(dark.container).className).toContain("text-white");
  });
});

describe("a Section's card", () => {
  it("is the standard white card with nothing set (a page saved before the options looks the same)", () => {
    const { container } = render(<Section {...base} card />);
    const card = container.querySelector(".rounded-xl")!;
    expect(card.className).toContain("bg-card");
    expect(card.className).toContain("text-ink");
    expect(card.className).not.toContain("/80");
  });

  it("is a theme colour with that colour's own readable text, solid or softened", () => {
    const solid = render(<Section {...base} card cardColor="blush" />);
    expect(solid.container.querySelector(".rounded-xl")!.className).toMatch(/bg-blush(?!\/)/);
    expect(solid.container.querySelector(".rounded-xl")!.className).toContain("landing-light");
    const soft = render(<Section {...base} card cardColor="charcoal" cardSoft />);
    const card = soft.container.querySelector(".rounded-xl")!;
    expect(card.className).toContain("bg-cup/80");
    expect(card.className).toContain("text-white");
    expect(render(<Section {...base} card cardSoft />).container.querySelector(".rounded-xl")!.className).toContain("bg-card/80");
  });

  it("falls back to the standard card for a colour it does not know", () => {
    expect(render(<Section {...base} card cardColor="hotpink" />).container.querySelector(".rounded-xl")!.className).toContain("bg-card");
  });
});

describe("where a Section's content sits", () => {
  it("is the middle by default, in the Section's own width", () => {
    const { container } = render(<Section {...base} width="narrow" />);
    const wrap = band(container).firstElementChild!;
    expect(wrap.className).toContain("mx-auto");
    expect(wrap.className).toContain("max-w-xl");
  });

  it("is the left or right of the wide column when it says so, as wide as the Section's width", () => {
    const left = render(<Section {...base} width="narrow" place="left" />);
    const frame = band(left.container).firstElementChild!;
    expect(frame.className).toContain("max-w-5xl");
    expect(frame.firstElementChild!.className).toContain("max-w-xl");
    expect(frame.firstElementChild!.className).toContain("mr-auto");
    const right = render(<Section {...base} width="medium" place="right" />);
    expect(band(right.container).firstElementChild!.firstElementChild!.className).toContain("ml-auto");
  });

  it("is not narrower than the page when the width is the wide column (nothing to place)", () => {
    expect(render(<Section {...base} width="wide" place="left" />).container.querySelector(".max-w-5xl .max-w-5xl")).not.toBeNull();
  });
});

describe("a Section's text tone", () => {
  it("is plum when asked, and the background's own otherwise", () => {
    expect(band(render(<Section {...base} textTone="plum" />).container).firstElementChild!.className).toContain("text-accent-ink");
    expect(band(render(<Section {...base} textTone="auto" />).container).firstElementChild!.className).not.toContain("text-accent-ink");
  });
});

describe("the publish check for a Section's text tone", () => {
  const title = { type: "Heading", props: { id: "h", text: "Page", level: "h1", align: "center" } };
  const warnings = (props: Record<string, unknown>) => checkLandingPage({ content: [title, { type: "Section", props: { id: "s", ...CORE_DEFAULTS.Section, ...props, content: [] } }], root: { props: {} }, schemaVersion: LANDING_SCHEMA_VERSION }).filter((i) => i.block === "Section" && /plum/i.test(i.message));

  it("warns about plum text on a dark background or a dark card, not on a light one", () => {
    expect(warnings({ textTone: "plum", background: "charcoal" })).toHaveLength(1);
    expect(warnings({ textTone: "plum", background: "none", card: true, cardColor: "plum" })).toHaveLength(1);
    expect(warnings({ textTone: "plum", background: "plum", card: true, cardColor: "blush" })).toEqual([]);
    expect(warnings({ textTone: "plum", background: "blush" })).toEqual([]);
    expect(warnings({ textTone: "auto", background: "charcoal" })).toEqual([]);
  });

  it("warns about plum text over a picture with a dark shade, not with a light one", () => {
    expect(warnings({ textTone: "plum", backgroundImageAssetId: "media_AAAAAAAAAAA1", overlay: "dark" })).toHaveLength(1);
    expect(warnings({ textTone: "plum", backgroundImageAssetId: "media_AAAAAAAAAAA1", overlay: "cream" })).toEqual([]);
  });
});

describe("a Section's new options in an exported file", () => {
  it("keeps them through the import pruning", () => {
    const props = { id: "s", ...CORE_DEFAULTS.Section, overlay: "cream", card: true, cardColor: "blush", cardSoft: true, place: "left", textTone: "plum", content: [] };
    const { data, droppedProps } = pruneToKnownBlocks(normalizeLandingData({ content: [{ type: "Section", props }], root: {}, schemaVersion: LANDING_SCHEMA_VERSION }));
    expect(droppedProps).toBe(0);
    expect((data.content[0] as unknown as { props: Record<string, unknown> }).props).toMatchObject({ overlay: "cream", cardColor: "blush", cardSoft: true, place: "left", textTone: "plum" });
  });
});

describe("a Section that fills the page", () => {
  it("is off by default and for a page saved before the option: no marker, no column, no full width", () => {
    const { container } = render(<Section {...base} />);
    expect(CORE_DEFAULTS.Section.fill).toBe(false);
    expect(band(container).className).not.toContain("lp-fill");
    expect(band(container).className).not.toContain("flex");
    expect(band(container).querySelector(":scope > div")!.className).not.toContain("w-full");
    expect(render(<Section {...base} fill={"yes" as never} />).container.querySelector("section")!.className).not.toContain("lp-fill");
  });

  it("puts the content at the top, the middle (also when unset or unknown) or the bottom of a grown section", () => {
    const cls = (v?: string) => band(render(<Section {...base} fill verticalAlign={v as never} />).container).className.split(" ");
    expect(cls("top")).toContain("justify-start");
    expect(cls("bottom")).toContain("justify-end");
    expect(cls("center")).toContain("justify-center");
    expect(cls(undefined)).toContain("justify-center");
    expect(cls("sideways")).toContain("justify-center");
    expect(band(render(<Section {...base} verticalAlign="bottom" />).container).className).not.toContain("justify-end");
  });

  it("is a column that centres its content, marked for the frame to grow, and keeps its padding, width and placing", () => {
    const { container } = render(<Section {...base} fill background="plum" place="right" width="narrow" paddingDesktop={{ top: 70, bottom: 70, left: 10, right: 10 }} />);
    const section = band(container);
    for (const cls of ["lp-fill", "flex", "flex-col", "justify-center"]) expect(section.className.split(" ")).toContain(cls);
    expect(section.style.getPropertyValue("--sp-t-d")).toBe("70px");
    const inner = section.querySelector(":scope > div")!;
    expect(inner.className).toContain("w-full");
    expect(inner.querySelector(":scope > div")!.className).toContain("ml-auto");
    expect(section.className).toMatch(/bg-/);
  });

  it("comes back as a flex box, not a block, when it is hidden on one size", () => {
    expect(band(render(<Section {...base} fill hideOnMobile />).container).className).toContain("hidden @split:flex");
    expect(band(render(<Section {...base} fill hideOnMobile />).container).className).not.toContain("@split:block");
    expect(band(render(<Section {...base} hideOnMobile />).container).className).toContain("@split:block");
  });

  it("is grown by the stylesheet: every wrapper between the page and a top-level section, and the section, take the free height", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/main:has\(\.lp-fill:not\(section \*\)\)/);
    expect(css).toMatch(/main :not\(section \*\):has\(\.lp-fill:not\(section \*\)\)[^}]*flex-grow: 1/);
    expect(css).toMatch(/main \.lp-fill:not\(section \*\) \{\s*flex-grow: 1/);
  });

  it("survives the import pruning, and a document without it gets false", () => {
    const props = { id: "s", ...CORE_DEFAULTS.Section, fill: true, content: [] };
    const { data, droppedProps } = pruneToKnownBlocks(normalizeLandingData({ content: [{ type: "Section", props }], root: {}, schemaVersion: LANDING_SCHEMA_VERSION }));
    expect(droppedProps).toBe(0);
    expect((data.content[0] as unknown as { props: Record<string, unknown> }).props.fill).toBe(true);
  });
});
