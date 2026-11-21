import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The landing pages take their light and dark colours from the semantic tokens (`bg-page`, `bg-card`, `text-ink`...),
 * defined once in app/globals.css. A `dark:` variant or a raw slate colour in a block would bring back a second place
 * to change them (docs/product/LANDING_PAGES.md, "Dark mode"). Brand colours that do not change with the theme (plum bands,
 * the plum button) stay as they are.
 */
const PAGE_FILES = ["blocks.tsx", "config.tsx", "theme.ts", "homepage-blocks.tsx", "Countdown.tsx", "OptInForm.tsx"];

describe("landing page colours", () => {
  it.each(PAGE_FILES)("%s uses the tokens, not dark: variants or slate colours", (file) => {
    const src = readFileSync(`components/landing/${file}`, "utf8");
    expect(src).not.toMatch(/\bdark:[a-z!\[-]/);
    expect(src).not.toMatch(/\b(?:bg|text|border|divide|ring|placeholder:text)-slate-/);
  });

  it("defines every token for both modes, and for a band that stays light", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const tokens = ["page", "card", "tile", "ink", "ink-muted", "accent", "accent-ink", "warm"];
    for (const selector of [":root,\n.landing-light", ".dark", ".dark .landing-light"]) {
      const start = css.indexOf(`${selector} {\n  --lp-page:`);
      expect(start, selector).toBeGreaterThan(-1);
      const block = css.slice(start, css.indexOf("}", start));
      for (const t of tokens) expect(block, `${selector} ${t}`).toContain(`--lp-${t}:`);
    }
  });
});
