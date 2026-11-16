import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";

/**
 * Whether this viewer gets cards for links to the Hub (the `chat_link_cards` feature): their own flags, or the sudo'd member's in sudo, so an
 * admin sees what that member would. As a function, so the loader asks only when a message has such a link; the answer is kept for the call.
 */
export function hubLinkCardsFor(caller: { userId: string; identity: { memberId: string; isSudo: boolean } }): () => Promise<boolean> {
  let answer: Promise<boolean> | null = null;
  return () => (answer ??= getUserFeaturePreviews(caller.userId).then((own) => effectiveMemberHasFeature("chat_link_cards", caller.identity, own)));
}
