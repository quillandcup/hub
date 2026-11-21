const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** A one-line plain-text teaser of a lesson's (already sanitized) HTML body, for the course outline. */
export function lessonExcerpt(html: string | null | undefined, max = 160): string | null {
  if (!html) return null;
  // Strip repeatedly so nested fragments like "<<b>script>" can't reassemble into a tag.
  let stripped = html.replace(/<\/(p|div|li|h[1-6]|br)>|<br\s*\/?>/gi, " ");
  for (let prev = ""; prev !== stripped; ) {
    prev = stripped;
    stripped = stripped.replace(/<[^>]*>/g, "");
  }
  const text = stripped
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, "")}…`;
}
