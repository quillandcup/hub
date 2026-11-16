import { parseLinkShared, unfurlHubLinks } from "@/lib/chat/slack-link-unfurl";
import { isFeatureOnForEveryone } from "@/lib/features.server";
import { createRepos } from "@/lib/data/repos";
import { createSlackClient } from "@/lib/slack-client";
import { getSlackBotToken } from "@/lib/slack-bot-token";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The webhook's handling of a `link_shared` event (docs/SLACK_BRIDGED_CHAT.md, "Hub links in Slack"), run after the response so Slack's three
 * seconds are never spent on lookups. The event has already passed the webhook's signature check. Nothing here is stored: an unfurl is
 * rebuilt from the link every time, so there is nothing for the nightly import to catch up on. Never throws.
 */
export async function handleLinkShared(rawEvent: unknown): Promise<void> {
  try {
    const event = parseLinkShared(rawEvent);
    if (!event) return;
    const service = createServiceRoleClient();
    const repos = createRepos(service);
    const token = await getSlackBotToken(service);
    if (!token) {
      console.error("[slack] link_shared: no bot token, so nothing was unfurled");
      return;
    }
    // Cards may say what a page is only once `chat_link_cards` is on for everyone: a card in Slack is read by the whole conversation, so
    // it is not a per-reader decision. Until then every Hub link gets the neutral card.
    const descriptive = await isFeatureOnForEveryone(repos, "chat_link_cards").catch(() => false);
    const result = await unfurlHubLinks(event, { repos, slack: createSlackClient(token), descriptive });
    if (result.status === "failed") console.error("[slack] link_shared: chat.unfurl said %s", result.code);
    else console.info("[slack] link_shared: %s", result.status === "unfurled" ? `${result.count} link(s) unfurled` : "no Hub links to unfurl");
  } catch (error) {
    console.error("[slack] link_shared failed:", error instanceof Error ? error.message : "unknown error");
  }
}
