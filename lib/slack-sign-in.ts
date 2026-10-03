import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WebClient } from "@slack/web-api";
import {
  SLACK_CODE_ALPHABET,
  SLACK_CODE_LENGTH,
  formatSlackSignInCode,
  normalizeSlackSignInCode,
} from "@/lib/slack-sign-in-code";
import type { RateLimit } from "@/lib/rate-limit";
import type { FeatureKey } from "@/lib/features";
import type { Button, KnownBlock } from "@slack/types";

/**
 * "Sign in from Slack": the Slack app's Home tab and /hub command give a member a one-click
 * "Open Hedgie Hub" button, plus a short code for signing in on a different browser, so they
 * never wait for a magic-link email.
 *
 * Identity: Slack signs every event/command/interaction it sends us (verifySlackSignature), and
 * the signed payload carries the member's immutable Slack user id (U...). That id is the key:
 * public.slack_identities says which Hub account it may sign in as. A binding is only ever created
 * server-side from proof on both sides -- currently, the first time a Slack user's
 * Slack-verified profile email matches a Hub account (sign-in email, the member's canonical
 * email, or one of their active email aliases; see findProfileForSlackEmail); after that the
 * binding holds by id even if either email changes. Never handles, display names or member-managed
 * aliases, and never the fuzzy name matching lib/slack-matching.ts uses for analytics. Admins are
 * left out by default: they keep the normal email login, because Slack sign-in hands their whole
 * admin account to whoever can use their Slack. An admin can opt in for themselves with the
 * slack_admin_sign_in feature preview (only their own user_feature_previews row counts, never the
 * global switch or a segment); their links then last SLACK_ADMIN_SIGN_IN_TTL_MINUTES. Turning the
 * preview off revokes outstanding links, since the role and opt-in are re-checked when one is spent.
 *
 * Credentials: each issue creates one row in public.slack_sign_in_tokens holding the hash of a
 * 256-bit URL token (the button) and of a 10-character code (for typing into /login elsewhere --
 * Slack on iOS opens links in an in-app browser whose cookies Safari doesn't share). Either one
 * spends the row, once, within SLACK_SIGN_IN_TTL_MINUTES. The Hub account is re-resolved from
 * slack_identities when it's spent, so removing a binding revokes outstanding tokens too.
 */

export const SLACK_SIGN_IN_TTL_MINUTES = 60;
/** Shorter-lived links for admins who opted in: a stray admin link is worth more. */
export const SLACK_ADMIN_SIGN_IN_TTL_MINUTES = 10;
const ADMIN_OPT_IN_FEATURE: FeatureKey = "slack_admin_sign_in";
export const SLACK_REFRESH_ACTION_ID = "hub_refresh_sign_in";
export const SLACK_SEND_LINK_ACTION_ID = "hub_send_sign_in_link";

/**
 * Limits on typed-code attempts (every attempt counts). Codes are 50 bits and live an hour, so
 * guessing is already infeasible; these stop scripted hammering. The global bucket also catches
 * guesses spread across many IPs -- if it trips, members can still use the Slack button or email.
 */
export function slackCodeRateLimits(clientIp: string): RateLimit[] {
  return [
    { bucket: `slack_code:ip:${clientIp}`, windowSeconds: 15 * 60, maxHits: 10 },
    { bucket: "slack_code:global", windowSeconds: 15 * 60, maxHits: 300 },
  ];
}
export { normalizeSlackSignInCode, formatSlackSignInCode };

export type SlackSignInResolution =
  /** `admin` is set only for an admin who opted in; their links use the admin TTL. */
  | { status: "ok"; userId: string; email: string; admin?: true }
  | { status: "admin" }
  | { status: "no_account" };

export interface IssuedSlackSignIn {
  url: string;
  code: string;
  expiresAt: Date;
  ttlMinutes: number;
}

interface ProfileRow {
  id: string;
  email: string | null;
  role: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Escape LIKE wildcards so an email containing `_` or `%` only matches itself under ilike. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function randomCode(): string {
  // 256 is a multiple of 32, so masking each byte to 5 bits is unbiased.
  return [...randomBytes(SLACK_CODE_LENGTH)].map((b) => SLACK_CODE_ALPHABET[b & 31]).join("");
}

/** The email on the Slack user's live profile (needs the bot's users:read.email scope). */
async function fetchSlackEmail(slackUserId: string): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("slack-sign-in: SLACK_BOT_TOKEN not configured");
    return null;
  }
  try {
    const result = await new WebClient(token).users.info({ user: slackUserId });
    const user = result.user;
    if (!user || user.deleted || user.is_bot) return null;
    return user.profile?.email?.trim().toLowerCase() || null;
  } catch (error) {
    console.error("slack-sign-in: users.info failed for %s", slackUserId, error);
    return null;
  }
}

async function findProfileById(service: SupabaseClient, userId: string): Promise<ProfileRow | null> {
  const { data } = await service.from("user_profiles").select("id, email, role").eq("id", userId).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

/** A single row matching `column` case-insensitively, or null (none, several, or an error). */
async function findOneByEmail<T>(
  service: SupabaseClient,
  table: string,
  select: string,
  column: string,
  email: string,
  filter?: (q: any) => any // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<T | null> {
  let query = service.from(table).select(select).ilike(column, escapeLike(email));
  if (filter) query = filter(query);
  const { data, error } = await query.limit(2);
  if (error) {
    console.error("slack-sign-in: %s lookup by email failed:", table, error);
    return null;
  }
  return data?.length === 1 ? (data[0] as T) : null;
}

/**
 * The Hub account a Slack-verified email belongs to, and how it matched. In order:
 * 1. the account's own sign-in email (user_profiles.email);
 * 2. the member's canonical email (members.email -> members.user_id), which can differ from
 *    the sign-in email when their Kajabi email changed;
 * 3. one of the member's active email aliases (member_email_aliases.member_id). Members can add
 *    aliases themselves, but only to their own record, so an alias can only ever let someone into
 *    the account of the member who added it (or an admin did).
 */
async function findProfileForSlackEmail(
  service: SupabaseClient,
  email: string
): Promise<{ profile: ProfileRow; via: "email_match" | "email_alias" } | null> {
  const direct = await findOneByEmail<ProfileRow>(service, "user_profiles", "id, email, role", "email", email);
  if (direct) return { profile: direct, via: "email_match" };

  const member = await findOneByEmail<{ user_id: string | null }>(service, "members", "user_id", "email", email);
  if (member?.user_id) {
    const profile = await findProfileById(service, member.user_id);
    if (profile) return { profile, via: "email_match" };
  }

  const alias = await findOneByEmail<{ member_id: string | null }>(
    service,
    "member_email_aliases",
    "member_id",
    "alias_email",
    email,
    (q) => q.eq("active", true)
  );
  if (alias?.member_id) {
    const { data: aliased } = await service.from("members").select("user_id").eq("id", alias.member_id).maybeSingle();
    const profile = aliased?.user_id ? await findProfileById(service, aliased.user_id as string) : null;
    if (profile) return { profile, via: "email_alias" };
  }
  return null;
}

/** The Hub account bound to this Slack user id, if any. */
async function findBoundProfile(service: SupabaseClient, slackUserId: string): Promise<ProfileRow | null> {
  const { data: binding } = await service
    .from("slack_identities")
    .select("user_id")
    .eq("slack_user_id", slackUserId)
    .maybeSingle();
  return binding?.user_id ? findProfileById(service, binding.user_id as string) : null;
}

/** Whether this admin turned on Slack sign-in for themselves (their own preview row only). */
async function adminOptedIn(service: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await service
    .from("user_feature_previews")
    .select("user_id")
    .eq("user_id", userId)
    .eq("feature_key", ADMIN_OPT_IN_FEATURE)
    .maybeSingle();
  if (error) {
    console.error("slack-sign-in: admin opt-in lookup failed for %s:", userId, error);
    return false;
  }
  return data !== null;
}

async function toResolution(service: SupabaseClient, profile: ProfileRow | null): Promise<SlackSignInResolution> {
  if (!profile?.email) return { status: "no_account" };
  if (profile.role === "admin") {
    if (!(await adminOptedIn(service, profile.id))) return { status: "admin" };
    return { status: "ok", userId: profile.id, email: profile.email, admin: true };
  }
  return { status: "ok", userId: profile.id, email: profile.email };
}

/** Link lifetime for a resolved account. */
export function slackSignInTtlMinutes(resolution: SlackSignInResolution): number {
  return resolution.status === "ok" && resolution.admin ? SLACK_ADMIN_SIGN_IN_TTL_MINUTES : SLACK_SIGN_IN_TTL_MINUTES;
}

/**
 * Resolve a Slack-verified user id to the Hub account they may sign in as, binding it on first
 * sight when their Slack email matches a Hub account's email.
 */
export async function resolveHubUserForSlackUser(
  service: SupabaseClient,
  slackUserId: string
): Promise<SlackSignInResolution> {
  const bound = await findBoundProfile(service, slackUserId);
  if (bound) return toResolution(service, bound);

  const slackEmail = await fetchSlackEmail(slackUserId);
  const match = slackEmail ? await findProfileForSlackEmail(service, slackEmail) : null;
  const resolution = await toResolution(service, match?.profile ?? null);
  if (resolution.status !== "ok" || !match) return resolution;

  const { error } = await service
    .from("slack_identities")
    .insert({ slack_user_id: slackUserId, user_id: resolution.userId, linked_via: match.via });
  if (error) {
    // 23505 on user_id: this Hub account is already bound to a different Slack user. Don't
    // guess which one is right.
    console.error("slack-sign-in: could not bind %s to user %s:", slackUserId, resolution.userId, error);
    return { status: "no_account" };
  }
  return resolution;
}

/** Issue a fresh single-use button URL + code for this Slack user. */
export async function issueSlackSignIn(
  service: SupabaseClient,
  params: { slackUserId: string; origin: string; ttlMinutes?: number }
): Promise<IssuedSlackSignIn> {
  const token = randomBytes(32).toString("base64url");
  const code = randomCode();
  const now = Date.now();
  const ttlMinutes = params.ttlMinutes ?? SLACK_SIGN_IN_TTL_MINUTES;
  const expiresAt = new Date(now + ttlMinutes * 60_000);

  const { error } = await service.from("slack_sign_in_tokens").insert({
    token_hash: sha256(token),
    code_hash: sha256(code),
    slack_user_id: params.slackUserId,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`Failed to store Slack sign-in token: ${error.message}`);

  // Housekeeping: drop this user's rows that expired more than a day ago.
  await service
    .from("slack_sign_in_tokens")
    .delete()
    .eq("slack_user_id", params.slackUserId)
    .lt("expires_at", new Date(now - 24 * 60 * 60_000).toISOString());

  const url = new URL("/auth/slack", params.origin);
  url.searchParams.set("token", token);
  return { url: url.toString(), code, expiresAt, ttlMinutes };
}

/**
 * Spend a button token or a code: one conditional UPDATE, so two concurrent attempts can't both
 * succeed. Returns the Slack user id it was issued to, or null if unknown, expired or used.
 */
export async function consumeSlackSignIn(
  service: SupabaseClient,
  credential: { token: string } | { code: string }
): Promise<string | null> {
  let column: "token_hash" | "code_hash";
  let value: string;
  if ("token" in credential) {
    column = "token_hash";
    value = credential.token;
  } else {
    column = "code_hash";
    value = normalizeSlackSignInCode(credential.code);
    if (value.length !== SLACK_CODE_LENGTH) return null;
  }
  if (!value) return null;

  const nowIso = new Date().toISOString();
  const { data, error } = await service
    .from("slack_sign_in_tokens")
    .update({ used_at: nowIso })
    .eq(column, sha256(value))
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("slack_user_id");
  if (error) {
    console.error("slack-sign-in: spending credential failed:", error);
    return null;
  }
  return (data?.[0]?.slack_user_id as string | undefined) ?? null;
}

/** Who a button token was issued to, whatever its state -- to refresh their Home tab on expiry. */
export async function findSlackUserForToken(service: SupabaseClient, token: string): Promise<string | null> {
  if (!token) return null;
  const { data } = await service
    .from("slack_sign_in_tokens")
    .select("slack_user_id")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  return (data?.slack_user_id as string | undefined) ?? null;
}

/** Minimal slice of a Supabase client that can verify an OTP and store the session (SSR client). */
export interface SessionClient {
  auth: Pick<SupabaseClient["auth"], "verifyOtp">;
}

/**
 * Create a Hub session for the account bound to this Slack user on `sessionClient` (the SSR
 * client, which writes the session cookies). Mints a magic-link token server-side and verifies
 * it straight away -- no email is sent. Re-checks the binding and role at this moment.
 */
export async function signInSlackUser(
  service: SupabaseClient,
  sessionClient: SessionClient,
  slackUserId: string
): Promise<{ ok: true } | { ok: false; reason: "unavailable" | "failed" }> {
  const resolution = await toResolution(service, await findBoundProfile(service, slackUserId));
  if (resolution.status !== "ok") return { ok: false, reason: "unavailable" };
  if (resolution.admin) console.info("slack-sign-in: admin %s signing in from Slack (%s)", resolution.userId, slackUserId);

  const { data: link, error: linkError } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: resolution.email,
  });
  if (linkError || !link?.properties?.hashed_token) {
    console.error("slack-sign-in: generateLink failed for %s:", resolution.userId, linkError);
    return { ok: false, reason: "failed" };
  }

  // "email" rather than "magiclink": it verifies both magic-link and signup-confirmation tokens,
  // so invited members who have never signed in work too (see tests/api/slack-sign-in.test.ts).
  const { error: verifyError } = await sessionClient.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError) {
    console.error("slack-sign-in: verifyOtp failed for %s:", resolution.userId, verifyError);
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}

/** slack:// link that opens one of the app's tabs (desktop and mobile), or null if not configured. */
function slackAppDeepLink(tab: "home" | "messages"): string | null {
  const team = process.env.SLACK_TEAM_ID;
  const app = process.env.SLACK_APP_ID;
  if (!team || !app) return null;
  return `slack://app?team=${encodeURIComponent(team)}&id=${encodeURIComponent(app)}&tab=${tab}`;
}

export function slackHomeDeepLink(): string | null {
  return slackAppDeepLink("home");
}

/** Block Kit for the Home tab (withRefresh) and the /hub reply, for a given resolution. */
export function buildSlackSignInBlocks(
  resolution: SlackSignInResolution,
  issued: IssuedSlackSignIn | null,
  origin: string,
  { withRefresh }: { withRefresh: boolean }
): KnownBlock[] {
  const loginUrl = new URL("/login", origin).toString();
  const loginHost = new URL(origin).host;

  if (resolution.status !== "ok" || !issued) {
    const text =
      resolution.status === "admin"
        ? `Admins sign in to Hedgie Hub by email: <${loginUrl}|go to the sign-in page>. To sign in from here instead, turn on *Slack Sign-In for Admins* in your Feature Previews.`
        : `We couldn't match your Slack account to a Hedgie Hub account. If your Slack email is different from your Hedgie Hub one, <${loginUrl}|sign in by email>, add your Slack email under *Email Aliases* in <${new URL("/settings", origin).toString()}|Settings>, then come back here. Or ask the Quill & Cup team for help.`;
    return [{ type: "section", text: { type: "mrkdwn", text } }];
  }

  const expires = expiryMarkup(issued);
  // A button with a url still posts block_actions, so one click DMs the link and, where the
  // deep link is configured, flips the member to the Messages tab to find it.
  const messagesLink = slackAppDeepLink("messages");
  const buttons: Button[] = [
    {
      type: "button",
      action_id: "hub_sign_in",
      text: { type: "plain_text", text: "Open Hedgie Hub", emoji: true },
      style: "primary",
      url: issued.url,
    },
    {
      type: "button",
      action_id: SLACK_SEND_LINK_ACTION_ID,
      text: { type: "plain_text", text: "Send me a link I can copy", emoji: true },
      value: "send",
      ...(messagesLink ? { url: messagesLink } : {}),
    },
  ];
  if (withRefresh) {
    buttons.push({
      type: "button",
      action_id: SLACK_REFRESH_ACTION_ID,
      text: { type: "plain_text", text: "Get a fresh link", emoji: true },
      value: "refresh",
    });
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Hedgie Hub* — your prickles, writing projects and fellow hedgies, one click away.",
      },
    },
    { type: "actions", elements: buttons },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Signs you in as ${resolution.email}. Just for you: works once, until ${expires}. ${
            withRefresh ? "Reopening this tab also gets you a fresh one." : "Run `/hub` again for a fresh one."
          }`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Using a different browser, like Safari on iPhone?* Tap *Send me a link I can copy*, then press and hold the link in that message and choose *Open in Browser*. Or enter this code on <${loginUrl}|${loginHost}/login>:\n\`${formatSlackSignInCode(issued.code)}\``,
      },
    },
  ];
}

function expiryMarkup(issued: IssuedSlackSignIn): string {
  const expiresUnix = Math.floor(issued.expiresAt.getTime() / 1000);
  return `<!date^${expiresUnix}^{time}|in ${issued.ttlMinutes} minutes>`;
}

/**
 * "Send me a link I can copy": DM the member a fresh one-time link and code as an ordinary
 * message. Slack's in-app browser on iOS doesn't share cookies with Safari, and Block Kit buttons
 * can't be copied, but a link in a message can (long-press → Copy Link), then pasted on the
 * sign-in page. Goes straight to the requesting user with the bot token -- deliberately not via
 * sendSlackDM, whose test mode would redirect someone's sign-in link to the dev user. Link
 * unfurling is off, and wouldn't spend the token anyway (see app/auth/slack/route.ts).
 */
export async function sendSlackSignInMessage(service: SupabaseClient, slackUserId: string, origin: string): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken || !assertSigningSecret()) return;

  const resolution = await resolveHubUserForSlackUser(service, slackUserId);
  if (resolution.status !== "ok") return;
  const issued = await issueSlackSignIn(service, { slackUserId, origin, ttlMinutes: slackSignInTtlMinutes(resolution) });

  const text = `Your one-time Hedgie Hub sign-in link (works once, until ${expiryMarkup(issued)}):\n${issued.url}\n\nOr enter this code on the sign-in page: \`${formatSlackSignInCode(issued.code)}\`\n\nOn iPhone: press and hold the link, then tap *Open in Browser*.`;
  await new WebClient(botToken).chat.postMessage({
    channel: slackUserId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
}

function assertSigningSecret(): boolean {
  // verifySlackSignature skips verification when the secret is unset; never hand out a sign-in
  // credential on an unverified Slack user id.
  if (process.env.SLACK_SIGNING_SECRET) return true;
  console.error("slack-sign-in: SLACK_SIGNING_SECRET not configured -- refusing to issue sign-in links");
  return false;
}

/** Resolve, issue if allowed, and build blocks. Null when Slack sign-in is disabled. */
export async function prepareSlackSignIn(
  service: SupabaseClient,
  slackUserId: string,
  origin: string,
  options: { withRefresh: boolean }
): Promise<{ blocks: KnownBlock[]; text: string } | null> {
  if (!assertSigningSecret()) return null;

  const resolution = await resolveHubUserForSlackUser(service, slackUserId);
  const issued =
    resolution.status === "ok"
      ? await issueSlackSignIn(service, { slackUserId, origin, ttlMinutes: slackSignInTtlMinutes(resolution) })
      : null;

  return {
    blocks: buildSlackSignInBlocks(resolution, issued, origin, options),
    text: issued ? "Open Hedgie Hub" : "Hedgie Hub sign-in",
  };
}

/** (Re)publish this Slack user's Home tab with a fresh sign-in button and code. */
export async function publishSlackHome(service: SupabaseClient, slackUserId: string, origin: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("slack-sign-in: SLACK_BOT_TOKEN not configured, can't publish Home tab");
    return;
  }
  const prepared = await prepareSlackSignIn(service, slackUserId, origin, { withRefresh: true });
  if (!prepared) return;
  await new WebClient(token).views.publish({
    user_id: slackUserId,
    view: { type: "home", blocks: prepared.blocks },
  });
}
