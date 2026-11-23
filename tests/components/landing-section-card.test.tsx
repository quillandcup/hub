// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
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
