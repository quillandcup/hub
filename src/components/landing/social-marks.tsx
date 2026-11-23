import { BRAND_ICONS } from "./brand-icons.generated";
import { DRAWN_MARKS, type DrawnMark } from "./brand-icons.drawn";
import type { SocialLook, SocialNetwork } from "./social-networks";

/**
 * The marks of the Social icons block, and of the site header and footer's social links. Brand marks are not in lucide
 * (`.claude/rules/icons.md`: a brand mark is a custom drawing), so they live in two files: `brand-icons.generated.ts`, the networks' real
 * marks with their official colours (simple-icons, CC0-1.0, made by `pnpm brand-icons:update`), and `brand-icons.drawn.ts`, the few that
 * package does not have (LinkedIn, Email, Website), drawn by hand. A mark is never redrawn, stretched or recoloured: it is in its own
 * colour (the default, on a light round badge), or in the network's black or white version (no badge). The link's name is always the
 * network's own ("Instagram"), never the picture alone.
 */
type Mark = DrawnMark;
const MARKS: Record<SocialNetwork, Mark> = {
  ...BRAND_ICONS,
  ...DRAWN_MARKS,
};

const BLACK = "000000";
const WHITE = "FFFFFF";

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(parseInt(hex.slice(0, 2), 16)) + 0.7152 * channel(parseInt(hex.slice(2, 4), 16)) + 0.0722 * channel(parseInt(hex.slice(4, 6), 16));
/** WCAG contrast ratio of two six-digit colours (no `#`). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** The least contrast a graphic needs against what it sits on (WCAG 1.4.11). */
export const MIN_GRAPHIC_CONTRAST = 3;

/** A network's official colour (no `#`). */
export const brandHex = (network: SocialNetwork): string => MARKS[network].hex;
/** What a network's mark is drawn in, per look. In colour it is the brand's own, on the white badge; where that colour is too faint against white (Substack's orange), the network's black version. */
export function markHex(network: SocialNetwork, look: SocialLook = "colour"): string {
  if (look === "dark") return BLACK;
  if (look === "light") return WHITE;
  const hex = MARKS[network].hex;
  return contrast(hex, WHITE) >= MIN_GRAPHIC_CONTRAST ? hex : BLACK;
}
/** The networks whose own colour is too faint on the white badge, so their black version is used. */
export const BLACK_ON_BADGE = (Object.keys(MARKS) as SocialNetwork[]).filter((n) => markHex(n) !== MARKS[n].hex);

/** The mark of a network, hidden from screen readers (the link carries the name). Size comes from the class; the colour from `look`, which a row can also override with CSS (`!text-black`). */
export function SocialMark({ network, look = "colour", className = "h-5 w-5" }: { network: SocialNetwork; look?: SocialLook; className?: string }) {
  const mark = MARKS[network];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ color: `#${markHex(network, look)}` }}
      data-network={network}
      {...(mark.stroke ? { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const } : { fill: "currentColor" })}
    >
      <path d={mark.path} {...(mark.evenodd ? { fillRule: "evenodd" as const } : {})} />
    </svg>
  );
}
