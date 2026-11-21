import { decodeEntities } from "@/lib/chat/render";
import { safeLinkUrl } from "@/lib/chat/unfurls";

/**
 * The addresses written in a message's text, in order, for the places that turn a link into a card (link previews of other sites, cards for
 * links to the Hub itself). Pure: no network. Code is shown as written, so an address inside it is an example and not counted.
 */
export function writtenLinks(body: string): string[] {
  const text = body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const found: { at: number; url: string }[] = [];
  // Slack's token for a link, `<https://example.com|label>`, and a bare address typed into the text.
  for (const m of text.matchAll(/<(https?:\/\/[^<>|\s]+)(?:\|[^<>]*)?>|(https?:\/\/[^\s<>|]+)/gi)) {
    const raw = m[1] ?? m[2];
    // A bare address ends before the punctuation that follows it in a sentence.
    const url = safeLinkUrl(decodeEntities(m[1] ? raw : raw.replace(/[.,;:!?)\]}'"]+$/, "")));
    if (url) found.push({ at: m.index ?? 0, url });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.url);
}
