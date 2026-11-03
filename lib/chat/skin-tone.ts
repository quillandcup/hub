/**
 * Skin tones for reactions. Slack names a toned reaction `+1::skin-tone-3`: tones 2 to 6 are the
 * Fitzpatrick modifiers U+1F3FB to U+1F3FF (tone 1 is the default yellow and has no suffix).
 * Client-safe: no emoji dataset in here.
 */

export const SKIN_TONES = [
  { tone: 2, label: "Light", sample: "\u{1F44D}\u{1F3FB}" },
  { tone: 3, label: "Medium-light", sample: "\u{1F44D}\u{1F3FC}" },
  { tone: 4, label: "Medium", sample: "\u{1F44D}\u{1F3FD}" },
  { tone: 5, label: "Medium-dark", sample: "\u{1F44D}\u{1F3FE}" },
  { tone: 6, label: "Dark", sample: "\u{1F44D}\u{1F3FF}" },
] as const;

const TONE_KEY = "chat-skin-tone";
const SUFFIX = /::skin-tone-([2-6])$/;

/** The tone suffix of a reaction name (2 to 6), or null. */
export function toneOf(name: string): number | null {
  const m = SUFFIX.exec(name.toLowerCase());
  return m ? Number(m[1]) : null;
}

/** The reaction name, lower-cased, without a tone suffix (also tone 1, which Slack never sends). */
export function baseName(name: string): string {
  return name.toLowerCase().replace(/::skin-tone-\d$/, "");
}

/** `name` with the tone suffix, or unchanged when tone is null. */
export function withTone(name: string, tone: number | null): string {
  return tone ? `${name}::skin-tone-${tone}` : name;
}

/** The emoji with the tone modifier right after its first character (before any ZWJ part). */
export function tonedUnicode(unicode: string, tone: number): string {
  const [first, ...rest] = Array.from(unicode);
  const modifier = String.fromCodePoint(0x1f3fb + tone - 2);
  return [first, modifier, ...(rest[0] === "️" ? rest.slice(1) : rest)].join("");
}

export function readTone(): number | null {
  try {
    const n = Number(localStorage.getItem(TONE_KEY));
    return Number.isInteger(n) && n >= 2 && n <= 6 ? n : null;
  } catch {
    return null;
  }
}

/** Remembered per browser; storage failures are ignored. */
export function writeTone(tone: number | null): void {
  try {
    if (tone) localStorage.setItem(TONE_KEY, String(tone));
    else localStorage.removeItem(TONE_KEY);
  } catch {
    // A convenience only.
  }
}

/** The shape of a reaction chip (see ReactionSummary in load.ts, which this mirrors). */
export interface ChipReaction {
  emoji: string;
  count: number;
  mine: boolean;
  reactors?: string[];
}

/** Reactions with the same emoji and different skin tones, shown as one chip like Slack's. */
export interface ReactionGroup {
  /** The emoji without a tone: the chip shows this. */
  emoji: string;
  /** Everyone who reacted with any tone. */
  count: number;
  mine: boolean;
  /** Each tone actually used, for the hover card's "X reacted with :clap::skin-tone-3:". */
  variants: ChipReaction[];
  /** Pressing the chip: the viewer's own variant to take back, else the one to add. */
  toggleWith: string;
}

/**
 * One group per base emoji, in order of the biggest count. Pressing a group takes back the viewer's
 * own variant when there is one; otherwise it adds the base emoji, or, when the emoji has tone
 * variants in use, the viewer's chosen skin tone (`tone`, null for the default).
 */
export function groupReactions(reactions: ChipReaction[], tone: number | null): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const base = baseName(r.emoji);
    const g = groups.get(base) ?? { emoji: base, count: 0, mine: false, variants: [], toggleWith: base };
    g.count += r.count;
    g.variants.push(r);
    if (r.mine && !g.mine) {
      g.mine = true;
      g.toggleWith = r.emoji;
    }
    groups.set(base, g);
  }
  for (const g of groups.values()) {
    if (!g.mine && g.variants.some((v) => toneOf(v.emoji) !== null)) g.toggleWith = withTone(g.emoji, tone);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
