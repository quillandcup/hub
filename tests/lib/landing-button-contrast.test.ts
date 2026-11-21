import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkLandingPage } from "@/lib/landing/a11y";
import { MIN_BUTTON_CONTRAST, PAGE_RGB, PRIMARY_RGB, buttonStyleProblems, contrastRatio, solidButtonText } from "@/lib/landing/button-contrast";
import { EMPTY_SITE_TEMPLATE, normalizeSiteTemplate, siteTemplateIssues } from "@/lib/landing/site-template";
import { PAGE_BACKGROUNDS, PRIMARY_COLORS, STYLE_DEFAULTS, type StyleTokens } from "@/lib/landing/style";

const style = (over: Partial<StyleTokens>): StyleTokens => ({ ...STYLE_DEFAULTS, ...over });

describe("contrastRatio", () => {
  it("is 21 for black on white, 1 for the same colour, and the same either way round", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([10, 20, 30], [10, 20, 30])).toBeCloseTo(1, 5);
    expect(contrastRatio([166, 77, 121], [255, 255, 255])).toBeCloseTo(contrastRatio([255, 255, 255], [166, 77, 121]), 10);
  });
});

describe("buttonStyleProblems: the site's own buttons", () => {
  it("passes the defaults, and every primary colour with automatic text on every page background", () => {
    expect(buttonStyleProblems(STYLE_DEFAULTS)).toEqual([]);
    for (const primary of PRIMARY_COLORS.map((p) => p.value)) {
      for (const pageBackground of PAGE_BACKGROUNDS.map((b) => b.value)) {
        expect(buttonStyleProblems(style({ primary, pageBackground, buttonStyle: "solid", buttonText: "auto" })), `${primary} solid on ${pageBackground}`).toEqual([]);
      }
    }
  });

  it("refuses white text on the pale fill dark mode gives the brown, teal and charcoal primaries, and says it is dark mode", () => {
    const problems = buttonStyleProblems(style({ primary: "teal", buttonText: "light" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Button text is hard to read in dark mode.*to 1 on the primary colour.*needs 4\.5/);
  });

  it("refuses dark text on the dark fills of light mode, in light mode", () => {
    const problems = buttonStyleProblems(style({ primary: "charcoal", pageBackground: "cream", buttonText: "dark" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Button text is hard to read\b(?! in)/);
  });

  it("checks both modes only when the page follows the theme, and light only for a chosen background", () => {
    expect(buttonStyleProblems(style({ primary: "teal", buttonText: "light" }))).toHaveLength(1);
    expect(buttonStyleProblems(style({ primary: "teal", buttonText: "light", pageBackground: "white" }))).toEqual([]);
    expect(buttonStyleProblems(style({ primary: "teal", buttonText: "dark", pageBackground: "white" }))).toHaveLength(1);
  });

  it("for outline buttons, checks the primary colour against the page, and ignores the text colour", () => {
    expect(buttonStyleProblems(style({ buttonStyle: "outline" }))).toEqual([]);
    expect(buttonStyleProblems(style({ buttonStyle: "outline", buttonText: "dark" }))).toEqual([]);
    const problems = buttonStyleProblems(style({ buttonStyle: "outline", primary: "brown", pageBackground: "mist" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Outline buttons are hard to read.*primary colour on this page background/);
    expect(problems[0]).not.toMatch(/dark mode/);
  });

  it("agrees with the numbers: every problem is under the AA minimum and every pass is at or above it", () => {
    for (const primary of PRIMARY_COLORS.map((p) => p.value)) {
      for (const buttonText of ["auto", "light", "dark"] as const) {
        for (const mode of ["light", "dark"] as const) {
          const ratio = contrastRatio(solidButtonText({ primary, buttonText }, mode), PRIMARY_RGB[primary][mode].accent);
          const flagged = buttonStyleProblems(style({ primary, buttonText })).some((m) => (mode === "dark" ? /in dark mode/.test(m) : !/in dark mode/.test(m)));
          expect(flagged, `${primary} ${buttonText} ${mode} ${ratio.toFixed(2)}`).toBe(ratio < MIN_BUTTON_CONTRAST);
        }
      }
    }
  });
});

describe("the colours match app/globals.css", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const triple = (value: string) => value.trim().split(/\s+/).map(Number);

  it("has the page and primary colours the check assumes", () => {
    for (const [name, value] of [["white", PAGE_RGB.white.light], ["cream", PAGE_RGB.cream.light], ["blush", PAGE_RGB.blush.light], ["mist", PAGE_RGB.mist.light]] as const) {
      const match = css.match(new RegExp(`\\.lp-bg-${name}\\.landing-light \\{ --lp-page: ([\\d ]+);`));
      expect(triple(match![1]), name).toEqual([...value]);
    }
    for (const primary of ["brown", "teal", "charcoal"] as const) {
      const light = css.match(new RegExp(`^\\.lp-primary-${primary} \\{ --lp-accent: ([\\d ]+); --lp-accent-ink: ([\\d ]+);`, "m"))!;
      const dark = css.match(new RegExp(`^\\.dark \\.lp-primary-${primary} \\{ --lp-accent: ([\\d ]+); --lp-accent-ink: ([\\d ]+);`, "m"))!;
      expect([triple(light[1]), triple(light[2])], `${primary} light`).toEqual([[...PRIMARY_RGB[primary].light.accent], [...PRIMARY_RGB[primary].light.ink]]);
      expect([triple(dark[1]), triple(dark[2])], `${primary} dark`).toEqual([[...PRIMARY_RGB[primary].dark.accent], [...PRIMARY_RGB[primary].dark.ink]]);
    }
  });

  it("puts dark text on the pale dark-mode fills (automatic) and lets the chosen text colour win", () => {
    expect(css).toMatch(/\.dark :is\(\.lp-primary-brown, \.lp-primary-teal, \.lp-primary-charcoal\):not\(\.landing-light\):not\(\.lp-btn-text-light\):not\(\.lp-btn-text-dark\) \{ --lp-on-accent: 15 23 42; \}/);
    expect(css).toMatch(/\.lp-btn-text-light \{ --lp-on-accent: 255 255 255; \}/);
    expect(css).toMatch(/\.lp-btn-text-dark \{ --lp-on-accent: 15 23 42; \}/);
    for (const mode of ["light", "dark"] as const) {
      expect(solidButtonText({ primary: "plum", buttonText: "auto" }, mode)).toEqual([255, 255, 255]);
    }
    expect(solidButtonText({ primary: "teal", buttonText: "auto" }, "dark")).toEqual([15, 23, 42]);
    expect(solidButtonText({ primary: "teal", buttonText: "auto" }, "light")).toEqual([255, 255, 255]);
  });

  it("turns a button that follows the site into an outline when the site says so, and leaves a button with its own look alone", () => {
    expect(css).toMatch(/\.lp-btn-style-outline \.lp-btn-inherit\.lp-btn \{ background-color: transparent;/);
    expect(css).not.toMatch(/\.lp-btn-style-outline \.lp-btn:not/);
  });
});

describe("publishing the site design", () => {
  it("reports an unreadable button style among the issues that stop the publish", () => {
    expect(siteTemplateIssues(EMPTY_SITE_TEMPLATE)).toEqual([]);
    const site = normalizeSiteTemplate({ style: { primary: "teal", buttonText: "light" } });
    expect(siteTemplateIssues(site).some((m) => /Button text is hard to read/.test(m))).toBe(true);
    expect(siteTemplateIssues(normalizeSiteTemplate({ style: { primary: "teal" } }))).toEqual([]);
  });
});

describe("a landing page's own style in the publish check", () => {
  const page = (styleOverride?: unknown) => ({ content: [{ type: "Heading", props: { id: "h", text: "Hello", level: "h1", align: "left" } }], root: { props: { ...(styleOverride ? { styleOverride } : {}) } } });

  it("says nothing for a page that follows the site, even when the site's style would be unreadable (the site's own check covers it)", () => {
    expect(checkLandingPage(page(), { primary: "teal", buttonText: "light" }).filter((i) => i.block === "Page style")).toEqual([]);
  });

  it("warns, without blocking, when the page's own style is unreadable", () => {
    const issues = checkLandingPage(page({ buttonText: "dark", primary: "charcoal", pageBackground: "white" })).filter((i) => i.block === "Page style");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].message).toMatch(/Button text is hard to read/);
  });

  it("judges an override of one token together with the site's other tokens, and the defaults without a site", () => {
    expect(checkLandingPage(page({ buttonText: "light" }), { primary: "teal" }).filter((i) => i.block === "Page style")).toHaveLength(1);
    expect(checkLandingPage(page({ buttonText: "light" })).filter((i) => i.block === "Page style")).toEqual([]);
    expect(checkLandingPage(page({ buttonStyle: "outline" }), { primary: "brown", pageBackground: "mist" }).filter((i) => i.block === "Page style")).toHaveLength(1);
  });

  it("is quiet for a readable own style", () => {
    expect(checkLandingPage(page({ primary: "brown", buttonStyle: "outline", pageBackground: "white" })).filter((i) => i.block === "Page style")).toEqual([]);
  });
});
