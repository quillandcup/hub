import type { StyleTokens } from "./style";

/**
 * Whether the site's button style is readable (docs/product/LANDING_PAGES.md, "Buttons"). The style guide's lists hold no free colour,
 * but a button's text still sits on the primary colour (solid) and an outline button's words sit on the page, so some choices
 * fail WCAG AA (4.5:1): white on a pale primary in dark mode, a brown outline on a mist page. The colours below are the
 * ones `app/globals.css` draws (`--lp-page`, `--lp-accent`, `--lp-accent-ink`, `--lp-on-accent`); a test reads that file and fails
 * when they drift apart.
 */
type Rgb = readonly [number, number, number];
type Mode = "light" | "dark";

const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [15, 23, 42];
const PLUM_600: Rgb = [166, 77, 121];

/** The page behind a button: a fixed light colour for a chosen background, the theme's own for "default". */
export const PAGE_RGB: Record<StyleTokens["pageBackground"], Record<Mode, Rgb>> = {
  default: { light: [244, 242, 243], dark: [2, 6, 23] },
  white: { light: [255, 255, 255], dark: [255, 255, 255] },
  cream: { light: [244, 236, 232], dark: [244, 236, 232] },
  blush: { light: [234, 218, 218], dark: [234, 218, 218] },
  mist: { light: [199, 223, 223], dark: [199, 223, 223] },
};

/** Per primary colour: the fill of a solid button (`accent`) and the colour of outline text and links (`ink`), in light and dark mode. */
export const PRIMARY_RGB: Record<StyleTokens["primary"], Record<Mode, { accent: Rgb; ink: Rgb }>> = {
  plum: { light: { accent: PLUM_600, ink: [139, 62, 100] }, dark: { accent: PLUM_600, ink: [220, 164, 192] } },
  brown: { light: { accent: [142, 88, 61], ink: [142, 88, 61] }, dark: { accent: [193, 157, 133], ink: [193, 157, 133] } },
  teal: { light: { accent: [67, 114, 115], ink: [56, 93, 94] }, dark: { accent: [116, 168, 169], ink: [163, 200, 200] } },
  charcoal: { light: { accent: [77, 77, 77], ink: [77, 77, 77] }, dark: { accent: [203, 213, 225], ink: [203, 213, 225] } },
};

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const MIN_BUTTON_CONTRAST = 4.5;

/** The text colour on a solid button in the primary colour: the chosen one, or (automatic) white, except dark text on the pale fills of dark mode. */
export function solidButtonText(style: Pick<StyleTokens, "primary" | "buttonText">, mode: Mode): Rgb {
  if (style.buttonText === "light") return WHITE;
  if (style.buttonText === "dark") return INK;
  return mode === "dark" && style.primary !== "plum" ? INK : WHITE;
}

const modesOf = (style: Pick<StyleTokens, "pageBackground">): Mode[] => (style.pageBackground === "default" ? ["light", "dark"] : ["light"]);
const where = (mode: Mode, style: Pick<StyleTokens, "pageBackground">) => (style.pageBackground === "default" ? ` in ${mode} mode` : "");

/**
 * What is unreadable about the buttons this style gives every button that doesn't choose its own look, in words for the person
 * choosing: a solid button's text on the primary colour, or an outline button's words on the page background. Empty when fine.
 */
export function buttonStyleProblems(style: StyleTokens): string[] {
  const problems: string[] = [];
  for (const mode of modesOf(style)) {
    const colors = PRIMARY_RGB[style.primary][mode];
    if (style.buttonStyle === "outline") {
      const ratio = contrastRatio(colors.ink, PAGE_RGB[style.pageBackground][mode]);
      if (ratio < MIN_BUTTON_CONTRAST) problems.push(`Outline buttons are hard to read${where(mode, style)}: the primary colour on this page background has a contrast of ${ratio.toFixed(1)} to 1 (it needs ${MIN_BUTTON_CONTRAST}). Pick another primary colour or page background, or use solid buttons.`);
    } else {
      const ratio = contrastRatio(solidButtonText(style, mode), colors.accent);
      if (ratio < MIN_BUTTON_CONTRAST) problems.push(`Button text is hard to read${where(mode, style)}: it has a contrast of ${ratio.toFixed(1)} to 1 on the primary colour (it needs ${MIN_BUTTON_CONTRAST}). Pick another button text colour or primary colour.`);
    }
  }
  return problems;
}
