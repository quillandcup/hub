/**
 * "Ask me about ..." topics on a member profile. Mirrors the CHECK on
 * member_ask_me_about.topics (public.valid_ask_me_about_topics), so the form
 * can reject bad input before the database does.
 */

export const MAX_TOPICS = 30;
export const MAX_TOPIC_LENGTH = 40;

/** Collapse inner whitespace and trim, so "  plot   twists " and "plot twists" are the same topic. */
export function cleanTopic(topic: string): string {
  return topic.replace(/\s+/g, " ").trim();
}

/**
 * Split typed text into topics on commas and newlines, e.g. pasting
 * "cozy mysteries, querying agents" adds two.
 */
export function splitTopicInput(input: string): string[] {
  return input.split(/[,\n]/).map(cleanTopic).filter(Boolean);
}

/**
 * Clean a whole list for saving: trims each topic, drops blanks and
 * case-insensitive duplicates (keeping the first spelling and the member's
 * order), then enforces the length and count limits.
 */
export function normalizeTopics(topics: readonly string[]): { topics: string[] } | { error: string } {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of topics) {
    const topic = cleanTopic(raw ?? "");
    if (!topic) continue;
    if (topic.length > MAX_TOPIC_LENGTH) {
      return { error: `"${topic.slice(0, 20)}…" is too long — keep each topic under ${MAX_TOPIC_LENGTH} characters` };
    }
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(topic);
  }
  if (result.length > MAX_TOPICS) return { error: `That's more than ${MAX_TOPICS} topics — trim a few` };
  return { topics: result };
}
