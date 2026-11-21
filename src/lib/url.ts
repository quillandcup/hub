// Only allow http(s) links out to member-supplied URLs (book covers, purchase links, social
// links) -- rejects javascript:, data:, and other schemes that could be used for an XSS link.
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
