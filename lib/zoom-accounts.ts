import type { Database } from "@/lib/data/database.types";

/**
 * Which Zoom meetings the Hub keeps, and where each Zoom account's credentials live.
 * Rules and the reasons for them: docs/ZOOM_ACCOUNTS.md.
 */

/** Whether an account's meetings are kept unless ignored (`keep`) or left out unless kept (`exclude`). */
export type ZoomDefaultPolicy = "keep" | "exclude";
/** An admin's decision about a meeting. */
export type ZoomDecision = "kept" | "ignored";
/** `instance` is one occurrence (the meeting's uuid), `series` every occurrence of a link (Zoom's meeting id). */
export type ZoomDecisionScope = "instance" | "series";
/** What a meeting is: a decision, or `undecided` (the account's default applies). */
export type ZoomMeetingState = ZoomDecision | "undecided";

/** The slug of the account that has always been there; its default is to keep. */
export const PRIMARY_ZOOM_ACCOUNT_SLUG = "primary";

/** The primary account's fixed id: the migration seeds it and the Bronze `zoom_account` columns default to it. */
export const PRIMARY_ZOOM_ACCOUNT_ID = "zacc_Primary1Acct";

/** The primary account as its table row (the in-memory twin starts with it, like a migrated database). */
export function primaryZoomAccountRow(): Database["public"]["Tables"]["zoom_accounts"]["Row"] {
  return {
    id: PRIMARY_ZOOM_ACCOUNT_ID,
    slug: PRIMARY_ZOOM_ACCOUNT_SLUG,
    label: "Primary account",
    host_email: null,
    default_policy: "keep",
    credentials_prefix: "ZOOM",
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  };
}

export interface ZoomAccountPolicy {
  id: string;
  defaultPolicy: ZoomDefaultPolicy;
}

export interface ZoomDecisionRef {
  zoomAccount: string;
  scope: ZoomDecisionScope;
  zoomKey: string;
  decision: ZoomDecision;
}

/** What identifies a meeting (or a row that belongs to one) for the keep/ignore rules. */
export interface ZoomMeetingRef {
  /** The account's id. A row written before accounts existed has none and belongs to the primary account. */
  zoomAccount: string | null | undefined;
  meetingUuid: string | null | undefined;
  meetingId: string | null | undefined;
}

/** Everything the rules read, loaded once per run. */
export interface ZoomKeepPolicy {
  primaryAccountId: string | null;
  accounts: Map<string, ZoomAccountPolicy>;
  decisions: Map<string, ZoomDecision>;
}

export function decisionKey(zoomAccount: string, scope: ZoomDecisionScope, zoomKey: string): string {
  return `${zoomAccount}|${scope}|${zoomKey}`;
}

export function buildKeepPolicy(
  accounts: { id: string; slug: string; defaultPolicy: ZoomDefaultPolicy }[],
  decisions: ZoomDecisionRef[]
): ZoomKeepPolicy {
  return {
    primaryAccountId: accounts.find((a) => a.slug === PRIMARY_ZOOM_ACCOUNT_SLUG)?.id ?? null,
    accounts: new Map(accounts.map((a) => [a.id, { id: a.id, defaultPolicy: a.defaultPolicy }])),
    decisions: new Map(decisions.map((d) => [decisionKey(d.zoomAccount, d.scope, d.zoomKey), d.decision])),
  };
}

/** The decision that applies to a meeting: its own (instance) first, then its link's (series); `undecided` when neither. */
export function meetingState(policy: ZoomKeepPolicy, ref: ZoomMeetingRef): ZoomMeetingState {
  const account = ref.zoomAccount ?? policy.primaryAccountId;
  if (!account) return "undecided";
  if (ref.meetingUuid) {
    const own = policy.decisions.get(decisionKey(account, "instance", ref.meetingUuid));
    if (own) return own;
  }
  if (ref.meetingId) {
    const series = policy.decisions.get(decisionKey(account, "series", ref.meetingId));
    if (series) return series;
  }
  return "undecided";
}

/**
 * Whether the Silver layer takes a meeting in: kept, or undecided on an account whose default is to keep.
 * An account the policy does not know is treated as the primary one would be only when the row names none.
 */
export function isMeetingKept(policy: ZoomKeepPolicy, ref: ZoomMeetingRef): boolean {
  const state = meetingState(policy, ref);
  if (state !== "undecided") return state === "kept";
  const account = ref.zoomAccount ?? policy.primaryAccountId;
  const known = account ? policy.accounts.get(account) : undefined;
  // An unknown account is left out: nothing reaches members from an account an admin never set up.
  return known?.defaultPolicy === "keep";
}

/** The credential environment variable names of an account, from its prefix. */
export function zoomCredentialNames(prefix: string) {
  return {
    accountId: `${prefix}_ACCOUNT_ID`,
    clientId: `${prefix}_CLIENT_ID`,
    clientSecret: `${prefix}_CLIENT_SECRET`,
    userEmail: `${prefix}_USER_EMAIL`,
    webhookSecret: `${prefix}_WEBHOOK_SECRET_TOKEN`,
  };
}

export interface ZoomCredentials {
  accountId: string;
  clientId: string;
  clientSecret: string;
  userEmail: string;
}

/** The API credentials of an account, or null when any of them is not set (the account is then skipped). */
export function zoomCredentials(prefix: string, env: Record<string, string | undefined> = process.env): ZoomCredentials | null {
  const names = zoomCredentialNames(prefix);
  const accountId = env[names.accountId];
  const clientId = env[names.clientId];
  const clientSecret = env[names.clientSecret];
  const userEmail = env[names.userEmail];
  if (!accountId || !clientId || !clientSecret || !userEmail) return null;
  return { accountId, clientId, clientSecret, userEmail };
}

/** The webhook secret token of an account, or null when it is not set. */
export function zoomWebhookSecret(prefix: string, env: Record<string, string | undefined> = process.env): string | null {
  return env[zoomCredentialNames(prefix).webhookSecret] || null;
}
