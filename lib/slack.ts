import { WebClient } from "@slack/web-api";
import { createSlackClient } from "@/lib/slack-client";
import { APP_URL, celebrationChannel, isProduction } from "@/lib/config";
import { getSlackBotToken } from "@/lib/slack-bot-token";

/**
 * Whether outbound Slack DMs sent via this module should be redirected to SLACK_DEV_USER_ID
 * instead of their real recipient. Safe-by-default: unset SLACK_TEST_MODE means "redirect
 * everywhere except production" -- a deploy has to explicitly opt OUT of redirecting (set
 * SLACK_TEST_MODE=false) to send for real outside prod, and explicitly opt IN (set =true) to
 * dry-run inside prod.
 */
export function isSlackTestMode(): boolean {
  if (process.env.SLACK_TEST_MODE) return process.env.SLACK_TEST_MODE === "true";
  return !isProduction;
}

export interface SendSlackDMParams {
  slackUserId: string;
  text: string;
  blocks?: any[];
}

/**
 * Low-level Slack DM sender. Member notifications don't call this directly: they go through
 * createNotifier (lib/notifications/notify.ts), whose Slack channel uses it, so they honor the
 * member's notification settings. wheel-of-wonder/actions.ts and feedback/route.ts keep their own
 * WebClient calls, so their sends are unaffected by SLACK_TEST_MODE.
 */
export async function sendSlackDM(params: SendSlackDMParams): Promise<void> {
  const token = await getSlackBotToken();
  if (!token) {
    throw new Error("sendSlackDM: SLACK_BOT_TOKEN not configured");
  }

  let { slackUserId, text } = params;
  const { blocks } = params;

  if (isSlackTestMode()) {
    const devUserId = process.env.SLACK_DEV_USER_ID;
    if (!devUserId) {
      throw new Error("sendSlackDM: SLACK_TEST_MODE is on but SLACK_DEV_USER_ID is unset");
    }
    text = `🧪 [test mode — would have gone to ${slackUserId}]\n${text}`;
    slackUserId = devUserId;
  }

  const slack = createSlackClient(token);
  await slack.chat.postMessage({ channel: slackUserId, text, blocks, unfurl_links: false, unfurl_media: false });
}


/** Slack mrkdwn writes `&`, `<` and `>` as entities; text we send is escaped so a title like "Q&A <beta>" shows as typed. */
export function escapeSlackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Posts to a shared channel (not a DM, not staff-only): the weekly changelog digest. Outside production
 * (SLACK_TEST_MODE, see isSlackTestMode) nothing is posted, only logged, so a local or preview run never
 * writes to a real channel. No link previews. Throws when Slack refuses, so the caller can give its claim back.
 */
export async function postToSlackChannel(params: { channel: string; text: string; blocks?: any[] }): Promise<boolean> {
  if (isSlackTestMode()) {
    console.log("[slack] test mode: not posting to channel", JSON.stringify({ channel: params.channel, text: params.text }));
    return false;
  }
  const token = await getSlackBotToken();
  if (!token) throw new Error("No Slack bot token is configured");
  const slack = createSlackClient(token);
  await slack.chat.postMessage({ channel: params.channel, text: params.text, blocks: params.blocks, unfurl_links: false, unfurl_media: false });
  return true;
}

export interface CelebrateNewBookParams {
  title: string;
  memberId: string;
  /** The name the community knows them by (display name), not the legal name. */
  memberName: string;
  purchaseUrl?: string | null;
}

/**
 * Celebrates a new book in the community's cheering channel (app.config.ts `slack.celebrationsChannelId`) when a member adds one --
 * the standalone "Add a Book" flow or the book step of publishing a tracked project. Links to the member's public
 * profile, never an admin page, since everyone in the channel sees it. Posts only in production (postToSlackChannel).
 */
export async function celebrateNewBook(params: CelebrateNewBookParams): Promise<void> {
  const { title, memberId, memberName, purchaseUrl } = params;
  const memberLink = `${APP_URL}/members/${memberId}`;

  const text = [
    `📚 New book added: *${escapeSlackText(title)}* by ${escapeSlackText(memberName)}`,
    purchaseUrl ? `<${purchaseUrl}|Where to buy>  ·  <${memberLink}|View member>` : `<${memberLink}|View member>`,
  ].join("\n");

  await postToSlackChannel({ channel: celebrationChannel("book"), text });
}

export interface CelebrateNewAwardParams {
  awardName: string;
  workTitle: string;
  memberId: string;
  /** The name the community knows them by (display name), not the legal name. */
  memberName: string;
  url?: string | null;
}

/** Celebrates a member's self-reported award or competition win in the same channel as celebrateNewBook. */
export async function celebrateNewAward(params: CelebrateNewAwardParams): Promise<void> {
  const { awardName, workTitle, memberId, memberName, url } = params;
  const memberLink = `${APP_URL}/members/${memberId}`;

  const text = [
    `🏆 ${escapeSlackText(memberName)} won *${escapeSlackText(awardName)}* for "${escapeSlackText(workTitle)}"`,
    url ? `<${url}|Details>  ·  <${memberLink}|View member>` : `<${memberLink}|View member>`,
  ].join("\n");

  await postToSlackChannel({ channel: celebrationChannel("award"), text });
}
