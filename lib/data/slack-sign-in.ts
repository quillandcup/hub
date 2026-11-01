import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { must } from "./query";

/** How a Slack user came to be bound to a Hub account (`slack_identities.linked_via`). */
export type SlackIdentity = { slackUserId: string; userId: string; linkedVia: string };

/** What a sign-in credential row holds: only hashes, never the token or code. */
export type NewSignInToken = { tokenHash: string; codeHash: string; slackUserId: string; expiresAt: Date };

/** The hash of the button token or of the typed code that is being spent. */
export type SignInCredentialHash = { tokenHash: string } | { codeHash: string };

/**
 * Which Hub account each Slack user may sign in as (`slack_identities`) and the single-use sign-in
 * credentials the Slack app hands out (`slack_sign_in_tokens`). Service role only: both tables
 * grant nothing to signed-in users. Tokens and codes are stored and compared as SHA-256 hashes;
 * nothing here ever sees (or logs) the secret itself. See `lib/slack-sign-in.ts`.
 *
 * Methods throw `new Error(<database message>)` on a database error, so the caller decides whether
 * that fails the request or falls back (a unique violation on a binding is an expected throw).
 */
export interface SlackSignInRepository {
  /** The binding of this Slack user, or null. */
  identityBySlackUser(slackUserId: string): Promise<SlackIdentity | null>;
  /** The binding of this Hub account, or null. */
  identityByUser(userId: string): Promise<SlackIdentity | null>;
  /**
   * Binds a Slack user to a Hub account. Throws when either side is already bound (each is unique),
   * so a first sight never replaces an existing binding.
   */
  bind(slackUserId: string, userId: string, linkedVia: string): Promise<void>;
  /** Binds a Slack user to a Hub account as "slack_connect", replacing a binding of the same Slack user. */
  connect(slackUserId: string, userId: string): Promise<void>;
  /** Removes the binding of a Slack user or of a Hub account. */
  unbind(by: { slackUserId: string } | { userId: string }): Promise<void>;
  /** Stores a freshly issued credential (hashes only). */
  storeToken(token: NewSignInToken): Promise<void>;
  /** Deletes this Slack user's credentials that expired before `before`. */
  deleteExpiredTokens(slackUserId: string, before: Date): Promise<void>;
  /**
   * Spends the credential: one conditional UPDATE (`used_at` is null and not expired at `now`) that
   * sets `used_at`, so two concurrent attempts cannot both succeed. Returns the Slack user it was
   * issued to, or null when it is unknown, expired or already used.
   */
  consumeToken(credential: SignInCredentialHash, now: Date): Promise<string | null>;
  /** Who a button token was issued to, whatever its state (used, expired). */
  slackUserForToken(tokenHash: string): Promise<string | null>;
}

type IdentityRow = { slack_user_id: string; user_id: string; linked_via: string };
const toIdentity = (row: IdentityRow): SlackIdentity => ({ slackUserId: row.slack_user_id, userId: row.user_id, linkedVia: row.linked_via });

export class SupabaseSlackSignInRepository implements SlackSignInRepository {
  constructor(private readonly db: Db) {}

  async identityBySlackUser(slackUserId: string) {
    const row = must(await this.db.from("slack_identities").select("slack_user_id, user_id, linked_via").eq("slack_user_id", slackUserId).maybeSingle());
    return row ? toIdentity(row) : null;
  }

  async identityByUser(userId: string) {
    const row = must(await this.db.from("slack_identities").select("slack_user_id, user_id, linked_via").eq("user_id", userId).maybeSingle());
    return row ? toIdentity(row) : null;
  }

  async bind(slackUserId: string, userId: string, linkedVia: string) {
    must(await this.db.from("slack_identities").insert({ slack_user_id: slackUserId, user_id: userId, linked_via: linkedVia }));
  }

  async connect(slackUserId: string, userId: string) {
    must(await this.db.from("slack_identities").upsert({ slack_user_id: slackUserId, user_id: userId, linked_via: "slack_connect" }, { onConflict: "slack_user_id" }));
  }

  async unbind(by: { slackUserId: string } | { userId: string }) {
    const query = this.db.from("slack_identities").delete();
    must(await ("slackUserId" in by ? query.eq("slack_user_id", by.slackUserId) : query.eq("user_id", by.userId)));
  }

  async storeToken(token: NewSignInToken) {
    must(
      await this.db.from("slack_sign_in_tokens").insert({
        token_hash: token.tokenHash,
        code_hash: token.codeHash,
        slack_user_id: token.slackUserId,
        expires_at: token.expiresAt.toISOString(),
      }),
    );
  }

  async deleteExpiredTokens(slackUserId: string, before: Date) {
    must(await this.db.from("slack_sign_in_tokens").delete().eq("slack_user_id", slackUserId).lt("expires_at", before.toISOString()));
  }

  async consumeToken(credential: SignInCredentialHash, now: Date) {
    const nowIso = now.toISOString();
    const spend = this.db.from("slack_sign_in_tokens").update({ used_at: nowIso });
    const matching = "tokenHash" in credential ? spend.eq("token_hash", credential.tokenHash) : spend.eq("code_hash", credential.codeHash);
    const rows = must(await matching.is("used_at", null).gt("expires_at", nowIso).select("slack_user_id"));
    return rows?.[0]?.slack_user_id ?? null;
  }

  async slackUserForToken(tokenHash: string) {
    const row = must(await this.db.from("slack_sign_in_tokens").select("slack_user_id").eq("token_hash", tokenHash).maybeSingle());
    return row?.slack_user_id ?? null;
  }
}

export class InMemorySlackSignInRepository implements SlackSignInRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async identityBySlackUser(slackUserId: string) {
    const row = this.data.slackIdentities.find((i) => i.slack_user_id === slackUserId);
    return row ? toIdentity(row) : null;
  }

  async identityByUser(userId: string) {
    const row = this.data.slackIdentities.find((i) => i.user_id === userId);
    return row ? toIdentity(row) : null;
  }

  async bind(slackUserId: string, userId: string, linkedVia: string) {
    if (this.data.slackIdentities.some((i) => i.slack_user_id === slackUserId || i.user_id === userId)) {
      throw new Error('duplicate key value violates unique constraint "slack_identities"');
    }
    this.data.slackIdentities.push({ slack_user_id: slackUserId, user_id: userId, linked_via: linkedVia, created_at: new Date().toISOString() });
  }

  async connect(slackUserId: string, userId: string) {
    if (this.data.slackIdentities.some((i) => i.user_id === userId && i.slack_user_id !== slackUserId)) {
      throw new Error('duplicate key value violates unique constraint "slack_identities_user_id_key"');
    }
    const existing = this.data.slackIdentities.find((i) => i.slack_user_id === slackUserId);
    if (existing) {
      existing.user_id = userId;
      existing.linked_via = "slack_connect";
    } else {
      this.data.slackIdentities.push({ slack_user_id: slackUserId, user_id: userId, linked_via: "slack_connect", created_at: new Date().toISOString() });
    }
  }

  async unbind(by: { slackUserId: string } | { userId: string }) {
    this.data.slackIdentities = this.data.slackIdentities.filter((i) => ("slackUserId" in by ? i.slack_user_id !== by.slackUserId : i.user_id !== by.userId));
  }

  async storeToken(token: NewSignInToken) {
    if (this.data.slackSignInTokens.some((t) => t.token_hash === token.tokenHash)) {
      throw new Error('duplicate key value violates unique constraint "slack_sign_in_tokens_pkey"');
    }
    this.data.slackSignInTokens.push({
      token_hash: token.tokenHash,
      code_hash: token.codeHash,
      slack_user_id: token.slackUserId,
      expires_at: token.expiresAt.toISOString(),
      used_at: null,
      created_at: new Date().toISOString(),
    });
  }

  async deleteExpiredTokens(slackUserId: string, before: Date) {
    this.data.slackSignInTokens = this.data.slackSignInTokens.filter((t) => !(t.slack_user_id === slackUserId && Date.parse(t.expires_at) < before.getTime()));
  }

  async consumeToken(credential: SignInCredentialHash, now: Date) {
    const row = this.data.slackSignInTokens.find(
      (t) => ("tokenHash" in credential ? t.token_hash === credential.tokenHash : t.code_hash === credential.codeHash) && t.used_at === null && Date.parse(t.expires_at) > now.getTime(),
    );
    if (!row) return null;
    row.used_at = now.toISOString();
    return row.slack_user_id;
  }

  async slackUserForToken(tokenHash: string) {
    return this.data.slackSignInTokens.find((t) => t.token_hash === tokenHash)?.slack_user_id ?? null;
  }
}
