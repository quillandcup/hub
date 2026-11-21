/**
 * Turning what a person pastes (or what a discovery source hands over) into prospect candidates.
 * Pure and deterministic: no network, no database.
 */

export type ProspectCandidate = {
  /** Lowercase, no "@". */
  handle: string;
  bio: string | null;
  followerCount: number | null;
  /** Lowercase, no "#". */
  hashtags: string[];
  externalUrl: string | null;
};

const HANDLE = /^[a-z0-9._]{1,30}$/;
// First path segments on instagram.com that are pages, not profiles.
const RESERVED_PATHS = new Set(["p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "about", "legal", "web"]);

/** "@Jane.Writes", "jane.writes" or a profile URL -> "jane.writes"; null when it is not a plausible handle. */
export function normalizeHandle(input: string): string | null {
  let value = input.trim();
  const url = value.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (url) {
    value = url[1];
    if (RESERVED_PATHS.has(value.toLowerCase())) return null;
  } else if (/^(?:https?:\/\/|www\.)/i.test(value)) {
    return null;
  }
  value = value.replace(/^@/, "").toLowerCase();
  if (!HANDLE.test(value) || /^\.|\.$|\.\./.test(value)) return null;
  return value;
}

/** "2,300 followers", "2.3k followers", "1.2M followers" -> a count; null when none is stated. */
export function parseFollowerCount(text: string): number | null {
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*([km])?\s*followers/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const factor = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return Math.round(base * factor);
}

export function extractHashtags(text: string): string[] {
  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(tags.map((t) => t.slice(1).toLowerCase()))];
}

const URL_IN_TEXT = /https?:\/\/[^\s)]+/i;

export type ParsedPaste = {
  candidates: ProspectCandidate[];
  /** Non-empty lines whose first word was not a handle or profile URL. */
  rejectedLines: string[];
};

/**
 * One prospect per line: an @handle or profile URL first (a bare word only when alone on its line), then anything copied from their profile
 * (bio, "2.3k followers", #hashtags, a link). The same handle on several lines is merged into one.
 */
export function parsePastedProspects(text: string): ParsedPaste {
  const byHandle = new Map<string, ProspectCandidate>();
  const rejectedLines: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [first, ...rest] = line.split(/\s+/);
    // A bare word is only a handle on its own line; before other words it is more likely prose.
    const bareWord = !first.startsWith("@") && !/instagram\.com/i.test(first);
    const handle = bareWord && rest.length > 0 ? null : normalizeHandle(first);
    if (!handle) {
      rejectedLines.push(line);
      continue;
    }
    const remainder = rest.join(" ").trim();
    const existing = byHandle.get(handle);
    const url = remainder.match(URL_IN_TEXT)?.[0] ?? null;
    byHandle.set(handle, {
      handle,
      bio: [existing?.bio, remainder || null].filter(Boolean).join(" ") || null,
      followerCount: existing?.followerCount ?? parseFollowerCount(remainder),
      hashtags: [...new Set([...(existing?.hashtags ?? []), ...extractHashtags(remainder)])],
      externalUrl: existing?.externalUrl ?? url,
    });
  }

  return { candidates: [...byHandle.values()], rejectedLines };
}
