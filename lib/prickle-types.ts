import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";

/**
 * Normalize prickle type name for matching
 * Examples:
 * - "HEADS DOWN" → "heads-down"
 * - "Heads Down Prickle" → "heads-down"
 * - "Sprint PRICKLE" → "sprint-prickle"
 */
export function normalizePrickleType(rawType: string): string {
  return rawType
    .toLowerCase()
    .replace(/(?<!\s)\s*prickle\s*/gi, "") // Remove "prickle" suffix/prefix
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special chars except hyphen
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens
}

/**
 * Extract prickle type and host from calendar event summary
 * Patterns:
 * - "Prickle w/Lili" → { type: null (default Progress Prickle), host: "Lili" }
 * - "HEADS DOWN w/Cody" → { type: "HEADS DOWN", host: "Cody" }
 * - "Pitch Prickle w/Sarah" → { type: "Pitch Prickle", host: "Sarah" }
 * - "Open Table Prickle" → { type: "Open Table Prickle", host: null }
 * - "'Midnight Crew' w/member13-display" → { type: "Midnight Crew", host: "member13-display" }
 */
/**
 * Splits a calendar summary at the host separator: "w/" (the first one), or else a standalone
 * "with" (the last one, so "Writing with Friends with Ania" keeps the title whole). Null when neither.
 */
function splitAtHost(cleaned: string): { before: string; host: string } | null {
  const slash = cleaned.match(/^(.+?)\s*\bw\/\s*(.+?)$/i);
  if (slash) return { before: slash[1], host: slash[2] };
  const word = cleaned.match(/^(.+)\s+with\s+(\S.*?)$/i);
  return word ? { before: word[1], host: word[2] } : null;
}

export function parsePrickleFromSummary(summary: string): {
  type: string | null;
  host: string | null;
} {
  // Remove surrounding quotes if present
  const cleaned = summary.replace(/^['"](.+?)['"]$/, "$1").trim();

  // Pattern: [TYPE] w/[HOST] or [TYPE] with [HOST]
  const matchWithHost = splitAtHost(cleaned);

  if (matchWithHost) {
    const beforeW = matchWithHost.before.replace(/^['"]|['"]$/g, "").trim();
    const host = matchWithHost.host.trim();

    // If it's just "Prickle w/Host", that's a Progress Prickle
    if (beforeW.toLowerCase() === "prickle") {
      return { type: "Prickle", host };
    }

    // Otherwise extract the type
    return { type: beforeW, host };
  }

  // No "w/" or "with" found - it's a standalone prickle type (no host)
  // e.g., "Open Table Prickle", "Heads Down Prickle"
  if (cleaned) {
    return { type: cleaned, host: null };
  }

  return { type: null, host: null };
}

/**
 * The prickle's own name from its calendar summary, or null when it's just the type.
 * Hosts name special prickles ("Educational Webinar: Query Letters w/Sam", "Midnight Crew"),
 * and that name is worth keeping. The "w/Host" tail is dropped (the host is its own field),
 * as are wrapping quotes; a bare "{Type}" or "{Type} Prickle" is the standard name, so null.
 */
export function prickleTitleFromSummary(summary: string, typeName: string, aliases: string[] = []): string | null {
  const cleaned = summary.replace(/^['"](.+?)['"]$/, "$1").trim();
  let withoutHost = (splitAtHost(cleaned)?.before ?? cleaned).replace(/^['"]|['"]$/g, "").trim();
  // "EDU-PRICKLE: Make It Funny": the type's other name is the label, not part of the title.
  for (const alias of aliases) {
    const label = new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-?\\s*prickle)?\\s*:?\\s+`, "i");
    if (label.test(`${withoutHost} `)) withoutHost = `${withoutHost} `.replace(label, "").trim();
  }
  if (!withoutHost) return null;
  const lower = withoutHost.toLowerCase();
  const typeLower = typeName.toLowerCase();
  if (lower === "prickle" || lower === typeLower || lower === `${typeLower} prickle`) return null;
  return withoutHost;
}

/**
 * The type whose alias a normalized calendar type starts with: "edu-make-it-funny" is an Educational
 * Prickle when the type lists "edu". The alias must be the whole first word, so "education" is not "edu".
 */
export function typeIdByAlias<T extends { id: string; summary_aliases?: string[] | null }>(
  normalizedType: string,
  types: T[],
): string | null {
  for (const type of types) {
    for (const alias of type.summary_aliases ?? []) {
      if (normalizedType === alias || normalizedType.startsWith(`${alias}-`)) return type.id;
    }
  }
  return null;
}

/**
 * Who hosts a prickle and who is its guest speaker, from the name after "w/" on its calendar title.
 * For most types that name is the host. For a type that names a guest speaker (educational), the
 * type's default host runs the session and the name is the speaker, unless it is the default host
 * themself. A member's own name (`memberName`) is preferred over the typed one.
 */
export function assignHostAndSpeaker(input: {
  typedName: string | null;
  memberId: string | null;
  memberName: string | null;
  defaultHostId: string | null;
  namesGuestSpeaker: boolean;
  /** A host an admin picked for this event; replaces whoever the title and the type's default would give. */
  hostOverrideId?: string | null;
}): { hostId: string | null; guestSpeaker: string | null } {
  const { hostOverrideId } = input;
  const assigned = assignFromTitle(input);
  if (!hostOverrideId) return assigned;
  // Picking the member the title names as speaker makes them the host, not a guest of themselves.
  return { hostId: hostOverrideId, guestSpeaker: hostOverrideId === input.memberId ? null : assigned.guestSpeaker };
}

function assignFromTitle(input: { typedName: string | null; memberId: string | null; memberName: string | null; defaultHostId: string | null; namesGuestSpeaker: boolean }) {
  const { typedName, memberId, memberName, defaultHostId, namesGuestSpeaker } = input;
  if (!namesGuestSpeaker) return { hostId: memberId ?? defaultHostId, guestSpeaker: null };
  const hostId = defaultHostId ?? memberId;
  if (!typedName || (memberId !== null && memberId === hostId)) return { hostId, guestSpeaker: null };
  return { hostId, guestSpeaker: memberName ?? typedName };
}

const DESCRIPTION_HTML_TAGS = ["b", "strong", "i", "em", "a", "br", "p", "div", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6"];

const descriptionToMarkdown = new TurndownService({ bulletListMarker: "-", emDelimiter: "*", strongDelimiter: "**", br: "", headingStyle: "atx" });
// turndown collapses consecutive <br> into one newline, which loses the blank line Google uses between
// paragraphs, so each <br> travels through it as this marker and becomes a newline afterwards. Keeping
// the <br> element (rather than swapping it for text beforehand) leaves the lines on either side as
// separate text nodes, so a line such as "--------" is escaped instead of becoming a heading or rule.
const BR_MARKER = "\u00a7BR\u00a7";
descriptionToMarkdown.addRule("lineBreak", { filter: "br", replacement: () => BR_MARKER });

// Markdown can't bold or italicize across a line break (`**a\n**` shows the asterisks), so mark each line on its own, keeping edge whitespace outside the markers.
function emphasizeLines(marker: string, content: string): string {
  return content
    .split(/(\n|\u00a7BR\u00a7)/)
    .map((part) => {
      const core = part.trim();
      if (!core || part === BR_MARKER) return part;
      return `${part.match(/^\s*/)?.[0] ?? ""}${marker}${core}${marker}${part.match(/\s*$/)?.[0] ?? ""}`;
    })
    .join("");
}
descriptionToMarkdown.addRule("strong", { filter: ["strong", "b"], replacement: (content) => emphasizeLines("**", content) });
descriptionToMarkdown.addRule("emphasis", { filter: ["em", "i"], replacement: (content) => emphasizeLines("*", content) });
descriptionToMarkdown.addRule("listItem", { filter: "li", replacement: (content) => `- ${content.trim()}\n` });
// Calendar descriptions are written in one block, so a heading is just bold text.
descriptionToMarkdown.addRule("heading", { filter: ["h1", "h2", "h3", "h4", "h5", "h6"], replacement: (content) => `\n\n**${content.trim()}**\n\n` });

/**
 * A calendar event's description as markdown for display. Google Calendar stores rich text
 * as HTML (<br>, <p>, <b>, <i>, <a>); we reduce it to an allowlist of those tags (http(s)
 * and mailto links only), then convert it to markdown, so it is never rendered as raw HTML.
 * Returns null when nothing is left.
 */
export function plainTextDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const safe = sanitizeHtml(raw, {
    allowedTags: DESCRIPTION_HTML_TAGS,
    allowedAttributes: { a: ["href"] },
    nonTextTags: ["script", "style", "textarea", "option", "noscript"],
    // Only absolute http(s) and mailto links survive; any other href is dropped and the link text stays.
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href;
        const safe: Record<string, string> = href && /^(https?:|mailto:)/i.test(href) ? { href } : {};
        return { tagName, attribs: safe };
      },
    },
  });
  // A description with no tags at all is plain text (Google stores it that way when it was typed without
  // formatting): its newlines are the line breaks, which an HTML converter would otherwise read as spaces.
  const html = /<\/?[a-z][^>]*>/i.test(raw) ? safe : safe.replace(/\r?\n/g, "<br>");
  const text = descriptionToMarkdown.turndown(html).replaceAll(BR_MARKER, "\n").replace(/[ \t]+\n/g, "\n")
    // A line of dashes (the divider in Zoom invites) is a rule; on its own line, with blank lines around it, markdown reads it as one and not as an underlined heading.
    .replace(/^\\?-{3,}$/gm, "\n---\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}
