import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { withRefreshLease } from "@/lib/slack-token-refresh";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The bot's token (Billie Bot), for everything the Hub does as the app itself.
 *
 * Until the Slack app opts into token rotation the token is the `SLACK_BOT_TOKEN` environment variable and
 * nothing here touches the database. Once it has (docs/SECRET_ROTATION.md, "Moving the bot to rotating
 * tokens"), `SLACK_BOT_TOKEN_ROTATION` is turned on and the token is a 12-hour credential kept in Vault
 * (`slack_bot_token`): read from there, and refreshed with its refresh token shortly before it expires,
 * under a lease so that concurrent requests never refresh it twice (lib/slack-token-refresh.ts). Until the
 * one-time exchange has stored a credential, the environment variable is still what is used, so turning the
 * switch on early is harmless.
 *
 * Every use of the bot calls `getSlackBotToken()` for each operation (or batch); never cache the string.
 */

/** Refresh when this little of the token's life is left: an hour, so a failed attempt has many retries. */
const REFRESH_WITHIN_MS = 60 * 60 * 1000;

export const rotationEnabled = (): boolean => ["1", "true", "on"].includes((process.env.SLACK_BOT_TOKEN_ROTATION ?? "").trim().toLowerCase());

interface Stored {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

let cached: { token: string; refreshAt: number } | null = null;

/** Forget what this server instance holds, so the next call reads it again (tests; a token Slack rejected). */
export function forgetSlackBotToken(): void {
  cached = null;
}

async function readStored(service: SupabaseClient): Promise<Stored | null> {
  const { data, error } = await service.rpc("slack_bot_token_get");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { access_token: string; refresh_token: string | null; expires_at: string | null } | undefined;
  if (!row) return null;
  return { accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at ? Date.parse(row.expires_at) : null };
}

const fresh = (s: Stored): boolean => s.expiresAt === null || s.expiresAt - clock.now() > REFRESH_WITHIN_MS;
const usable = (s: Stored): boolean => s.expiresAt === null || s.expiresAt - clock.now() > 60 * 1000;

/** Exchange the refresh token for a new credential and store it, retrying the save: the old refresh token is spent. A save that never works is logged and the new token is used anyway. */
async function refreshAndSave(service: SupabaseClient, current: Stored): Promise<Stored> {
  if (!current.refreshToken) throw new Error("the stored Slack bot token has no refresh token");
  const result = await new WebClient().oauth.v2.access({
    client_id: process.env.SLACK_CLIENT_ID ?? "",
    client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });
  if (!result.ok || !result.access_token || !result.refresh_token || !result.expires_in) throw new Error("Slack did not return a refreshed bot token");
  const stored: Stored = { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: clock.now() + result.expires_in * 1000 };

  // The refresh token we just used is spent, so this save is the only copy of the new one: try hard.
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await clock.sleep(250 * attempt);
    const { error } = await service.rpc("slack_bot_token_save", {
      p_access_token: stored.accessToken,
      p_refresh_token: stored.refreshToken as string,
      p_expires_at: new Date(stored.expiresAt as number).toISOString(),
    });
    if (!error) return stored;
    lastError = error;
  }
  // Slack has already honoured the refresh, so this request (and this server instance) can use the new token
  // for its 12 hours even though it isn't stored: far better than failing every bot call. Others still read the
  // old one, and the next refresh uses the old refresh token if Slack still accepts it. Loud, because it needs fixing.
  console.error("CRITICAL: refreshed the Slack bot token but could not store it; the new token is used by this instance only:", lastError);
  return stored;
}

/**
 * The bot token to use now, or undefined when none is configured (callers treat that as "Slack isn't set up").
 * Throws only when rotation is on, the stored token has expired and could not be refreshed.
 */
export async function getSlackBotToken(service?: SupabaseClient): Promise<string | undefined> {
  const fromEnv = process.env.SLACK_BOT_TOKEN || undefined;
  if (!rotationEnabled()) return fromEnv;
  if (cached && clock.now() < cached.refreshAt) return cached.token;

  const db = service ?? createServiceRoleClient();
  const stored = await readStored(db);
  if (!stored) return fromEnv; // not exchanged yet
  if (fresh(stored)) {
    cached = { token: stored.accessToken, refreshAt: stored.expiresAt === null ? Number.MAX_SAFE_INTEGER : stored.expiresAt - REFRESH_WITHIN_MS };
    return stored.accessToken;
  }

  let result: Stored | null;
  try {
    result = await withRefreshLease<Stored>(db, "bot", {
      fallback: usable(stored) ? stored : null,
      reread: async () => {
        const again = await readStored(db);
        return again && fresh(again) ? again : null;
      },
      // Read again now that this request holds the lease: another may have refreshed (and spent the refresh token
      // we read above) between our read and our claim.
      refresh: async () => {
        const latest = await readStored(db);
        if (latest && fresh(latest)) return latest;
        return refreshAndSave(db, latest ?? stored);
      },
    });
  } catch (error) {
    // A failed refresh isn't fatal while the token still works; the next call tries again.
    console.error("Refreshing the Slack bot token failed:", error);
    result = usable(stored) ? stored : null;
  }
  if (!result) throw new Error("The Slack bot token has expired and could not be refreshed");
  cached = fresh(result) ? { token: result.accessToken, refreshAt: (result.expiresAt as number) - REFRESH_WITHIN_MS } : null;
  return result.accessToken;
}

/**
 * One-time: turn the bot's long-lived token into a rotating one (`oauth.v2.exchange`, after the app has opted
 * into rotation) and store it. Each long-lived token can be exchanged once; the old one stops working after the
 * first refresh. Returns the new expiry. Run by scripts/slack-bot-token.ts.
 */
export async function exchangeBotToken(service: SupabaseClient, botToken: string): Promise<{ expiresAt: Date }> {
  const result = await new WebClient().oauth.v2.exchange({
    client_id: process.env.SLACK_CLIENT_ID ?? "",
    client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
    token: botToken,
  });
  if (!result.ok || !result.access_token || !result.refresh_token || !result.expires_in) throw new Error("Slack did not return a rotating token");
  const expiresAt = new Date(clock.now() + result.expires_in * 1000);
  const { error } = await service.rpc("slack_bot_token_save", {
    p_access_token: result.access_token,
    p_refresh_token: result.refresh_token,
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`Slack returned a rotating token but it could not be stored (${error.message}). The exchange can't be repeated for this token.`);
  return { expiresAt };
}

/**
 * Recovery: store a credential you got another way (a reinstall's tokens), replacing whatever is stored. It is stored as
 * already expired, so the first use refreshes it with the refresh token and the app stores the pair it gets back.
 */
export async function seedBotToken(service: SupabaseClient, accessToken: string, refreshToken: string): Promise<void> {
  const { error } = await service.rpc("slack_bot_token_save", {
    p_access_token: accessToken,
    p_refresh_token: refreshToken,
    p_expires_at: new Date(clock.now()).toISOString(),
  });
  if (error) throw new Error(`Could not store the tokens: ${error.message}`);
  forgetSlackBotToken();
}

/** When the stored credential expires, for the script's status command; null when nothing is stored. */
export async function botTokenStatus(service: SupabaseClient): Promise<{ expiresAt: Date | null } | null> {
  const stored = await readStored(service);
  return stored ? { expiresAt: stored.expiresAt === null ? null : new Date(stored.expiresAt) } : null;
}
