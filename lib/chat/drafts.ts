import { fromEditableText, toEditableText } from "@/lib/chat/render";

/** How long after the last keystroke a draft is saved. */
export const DRAFT_SAVE_DELAY_MS = 800;

/**
 * What is stored for a draft: the text as it will be sent (mentions and channels as Slack markup),
 * each one labelled with the name shown (`<@U1|Ania Ray>`), so it can be shown by name again without
 * looking anyone up.
 */
export function toDraftBody(typed: string, tokens: Map<string, string>): string {
  const labelled = new Map([...tokens].map(([shown, token]) => [shown, token.replace(/>$/, `|${shown.slice(1)}>`)]));
  return fromEditableText(typed, labelled, { plain: true });
}

/** A stored draft as the box shows it: names for mentions, and the markup each one is sent as (without the label). */
export function fromDraftBody(body: string): { text: string; tokens: Map<string, string> } {
  const { text, tokens } = toEditableText(body, { userNames: {}, channelNames: {} }, { plain: true });
  return { text, tokens: new Map([...tokens].map(([shown, token]) => [shown, token.replace(/\|[^>]*>$/, ">")])) };
}
