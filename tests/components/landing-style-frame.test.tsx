// @vitest-environment jsdom
/** The style guide on a page's frame, for the editor's canvas and a visitor alike: inheritance both ways, and the editor-only design tools. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PageFrame, type FrameContext } from "@/components/landing/config";
import { setDesignTools } from "@/components/landing/design-tools";
import { normalizeSiteTemplate } from "@/lib/landing/site-template";

const site = normalizeSiteTemplate({ style: { pageBackground: "cream", primary: "teal", fontFamily: "serif" } });
const classesOf = (container: HTMLElement) => (container.querySelector("[data-lp-frame]") as HTMLElement).className;

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  act(() => setDesignTools({ guides: false, grid: false }));
});

function frameOf(frame: FrameContext, root: Record<string, unknown> = {}) {
  return render(
    <PageFrame {...root} frame={frame}>
      <p>Body</p>
    </PageFrame>,
  );
}

describe("the frame's style", () => {
  it("is the site's style on a website page and on a landing page with no override of its own", () => {
    for (const pageType of ["website", "landing"] as const) {
      const { container } = frameOf({ pageType, site });
      for (const name of ["landing-light", "lp-bg-cream", "lp-primary-teal", "lp-font-serif"]) expect(classesOf(container)).toContain(name);
      cleanup();
    }
  });

  it("has no style classes before the site has a style, or without a frame", () => {
    expect(classesOf(frameOf({ pageType: "landing", site: null }).container)).not.toMatch(/lp-/);
    cleanup();
    expect(classesOf(render(<PageFrame>x</PageFrame>).container)).not.toMatch(/lp-/);
  });

  it("takes a landing page's own tokens over the site's, and the site's for the tokens it leaves alone", () => {
    const { container } = frameOf({ pageType: "landing", site }, { styleOverride: { primary: "brown" } });
    expect(classesOf(container)).toContain("lp-primary-brown");
    expect(classesOf(container)).not.toContain("lp-primary-teal");
    expect(classesOf(container)).toContain("lp-bg-cream");
  });

  it("follows the site again once the override is gone, and when the site changes", () => {
    const own = frameOf({ pageType: "landing", site }, { styleOverride: { primary: "brown" } });
    expect(classesOf(own.container)).toContain("lp-primary-brown");
    own.rerender(
      <PageFrame frame={{ pageType: "landing", site }}>
        <p>Body</p>
      </PageFrame>,
    );
    expect(classesOf(own.container)).toContain("lp-primary-teal");
    const changed = normalizeSiteTemplate({ style: { primary: "charcoal" } });
    own.rerender(
      <PageFrame frame={{ pageType: "landing", site: changed }}>
        <p>Body</p>
      </PageFrame>,
    );
    expect(classesOf(own.container)).toContain("lp-primary-charcoal");
    expect(classesOf(own.container)).not.toContain("lp-bg-cream");
  });

  it("ignores a stored override that holds anything off the lists", () => {
    const { container } = frameOf({ pageType: "landing", site }, { styleOverride: { primary: "#ff0000", fontFamily: "Comic Sans" } });
    expect(classesOf(container)).toContain("lp-primary-teal");
    expect(classesOf(container)).not.toContain("ff0000");
  });

  it("gives a landing page's own header and footer the same frame, so they take their look from the style", () => {
    const { container } = frameOf({ pageType: "landing", site }, { showHeader: true, navLinks: [{ label: "Home", href: "/" }], showFooter: true, footerText: "Own footer" });
    const frame = container.querySelector("[data-lp-frame]")!;
    expect(frame.querySelector("header")).not.toBeNull();
    expect(frame.querySelector("footer")).not.toBeNull();
    expect(frame.className).toContain("lp-primary-teal");
  });
});

describe("the editor's design tools", () => {
  it("draw nothing for a visitor, even if the browser has them on", () => {
    act(() => setDesignTools({ guides: true, grid: true }));
    const { container } = frameOf({ pageType: "website", site });
    expect(container.querySelector("[data-lp-grid]")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
  });

  it("draw the grid and the guides in the editor when they are on, and stop when they are off", () => {
    const { container } = frameOf({ pageType: "landing", site, editing: true });
    expect(container.querySelector("[data-lp-grid]")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    act(() => setDesignTools({ grid: true }));
    expect(container.querySelectorAll("[data-lp-grid] > span")).toHaveLength(12);
    act(() => setDesignTools({ guides: true }));
    expect(container.querySelector("style")?.textContent).toContain("[data-lp-frame] *");
    act(() => setDesignTools({ grid: false, guides: false }));
    expect(container.querySelector("[data-lp-grid]")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
  });

  it("are kept in this browser", () => {
    act(() => setDesignTools({ guides: true }));
    expect(JSON.parse(window.localStorage.getItem("landing-design-tools") ?? "{}")).toEqual({ guides: true, grid: false });
  });
});
