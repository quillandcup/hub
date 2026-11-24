// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Section } from "@/components/landing/blocks";

const Content = () => <p>Words</p>;
const base = { background: "none", overlay: "none", width: "narrow", align: "left", card: false, fadeIn: false, content: Content } as const;
const picture = { backgroundImageAssetId: "media_AAAAAAAAAAA1" } as const;
const band = (c: HTMLElement) => c.querySelector("section")!;

describe("a Section's picture framing", () => {
  it("keeps the middle of the picture unless told otherwise, and scrolls with the band", () => {
    const { container } = render(<Section {...base} {...picture} />);
    expect(band(container).style.backgroundPosition).toBe("center center");
    expect(band(container).className).not.toContain("bg-fixed");
  });

  it("can keep the top of the picture, and keep it still on a computer only", () => {
    const { container } = render(<Section {...base} {...picture} backgroundPosition="top" backgroundFixed />);
    expect(band(container).style.backgroundPosition).toBe("center top");
    expect(band(container).className).toContain("@split:bg-fixed");
    expect(band(container).className).not.toMatch(/(^|\s)bg-fixed/);
  });

  it("ignores a fixed picture when there is no picture, and a position it does not know", () => {
    expect(band(render(<Section {...base} backgroundFixed />).container).className).not.toContain("bg-fixed");
    expect(band(render(<Section {...base} {...picture} backgroundPosition={"left" as never} />).container).style.backgroundPosition).toBe("center center");
  });
});

describe("a Section's plum text", () => {
  it("reaches into the card, which sets its own text colour", () => {
    const plum = render(<Section {...base} card textTone="plum" />).container.querySelector(".rounded-xl")!;
    expect(plum.className).toContain("text-accent-ink");
    expect(plum.className).not.toContain("text-ink");
    const themed = render(<Section {...base} card cardColor="blush" textTone="plum" />).container.querySelector(".rounded-xl")!;
    expect(themed.className).toContain("text-accent-ink");
    expect(render(<Section {...base} card />).container.querySelector(".rounded-xl")!.className).toContain("text-ink");
  });
});
