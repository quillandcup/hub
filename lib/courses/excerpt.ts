const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** A one-line plain-text teaser of a lesson's (already sanitized) HTML body, for the course outline. */
export function lessonExcerpt(html: string | null | undefined, max = 160): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\/(p|div|li|h[1-6]|br)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
