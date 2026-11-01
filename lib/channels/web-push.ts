import { createRepos, type Repos } from "@/lib/data/repos";
import webpush, { WebPushError } from "web-push";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";
import { SUPPORT_EMAIL } from "@/lib/config";
import { membersWithFeature } from "@/lib/features.server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { notificationKind, isNotificationKind } from "@/lib/notifications/registry";
import { notificationUrl } from "./in-app";
import type { ChannelAdapter, OutboundMessage, SendContext } from "./types";

/**
 * "Browser": Web Push to the devices a member turned notifications on for (push_subscriptions,
 * migration 20261014000000). The service worker in public/sw.js shows them, even with no Hub tab open.
 *
 * Behind the browser_notifications feature flag, and a member is only reachable once a device is
 * subscribed, so with the channel on by default for a kind, nobody gets anything until they opt a
 * device in. Needs the VAPID keys (env-vars.config.ts "Web Push"); without them nobody is reachable.
 * The address is the member id; send fans out to each of their live subscriptions.
 */
export const WEB_PUSH_FEATURE = "browser_notifications" as const;

/** How long a push that isn't time-sensitive waits at the push service for an offline device. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/** Don't hold up a send on a slow push service. */
const REQUEST_TIMEOUT_MS = 10_000;

/** What public/sw.js reads from the push event. */
export interface PushPayload {
  title: string;
  body: string;
  /** Hub path to open on click, or an allowed external link (the Slack workspace; see lib/notification-links.ts). */
  url: string;
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string;
}

export function vapidKeys(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

export const webPushChannel: ChannelAdapter = {
  id: "web_push",
  async resolveAddresses(repos, memberIds) {
    const reachable = new Map<string, string>();
    if (!vapidKeys() || memberIds.length === 0) return reachable;

    const flagged = await membersWithFeature(repos, WEB_PUSH_FEATURE, memberIds);
    for (const memberId of await repos.pushSubscriptions.membersWithLive([...flagged])) reachable.set(memberId, memberId);
    return reachable;
  },
  async send(memberId, message, context) {
    const keys = vapidKeys();
    if (!keys) throw new Error("Web Push isn't configured (VAPID keys missing)");
    const subscriptions = createRepos(createServiceRoleClient()).pushSubscriptions;
    const live = await subscriptions.live(memberId);
    if (!live.length) throw new Error("No live push subscriptions");

    const now = Date.now();
    const payload = JSON.stringify(pushPayload(message, context, now));
    const options = {
      vapidDetails: { subject: `mailto:${SUPPORT_EMAIL}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: ttlSeconds(message, now),
      urgency: isTimeSensitive(message, now) ? ("high" as const) : ("normal" as const),
      timeout: REQUEST_TIMEOUT_MS,
    };

    const results = await Promise.allSettled(
      live.map(async (s) => {
        if (!isAllowedPushEndpoint(s.endpoint)) throw new Error("Untrusted push subscription endpoint");
        return webpush.sendNotification({ endpoint: new URL(s.endpoint).href, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
      })
    );

    const sent: string[] = [];
    const gone: string[] = [];
    const failures: unknown[] = [];
    results.forEach((result, i) => {
      const id = live[i].id;
      if (result.status === "fulfilled") sent.push(id);
      // 404/410: the browser unsubscribed or the subscription expired. It will never work again.
      else if (result.reason instanceof WebPushError && [404, 410].includes(result.reason.statusCode)) gone.push(id);
      else failures.push(result.reason);
    });

    const stamp = new Date(now).toISOString();
    for (const result of await Promise.allSettled([subscriptions.markSent(sent, stamp), subscriptions.markGone(gone, stamp)])) {
      if (result.status === "rejected") console.error("[web-push] Updating subscriptions failed", { member: memberId, error: result.reason });
    }

    for (const reason of failures) {
      console.error("[web-push] Delivery failed", { member: memberId, kind: context.kind, reason: describe(reason) });
    }
    if (gone.length > 0) {
      console.warn("[web-push] Subscriptions expired and removed", { member: memberId, count: gone.length });
    }

    // Nothing went out: let the notifier log it (and the test button say why). A member with one
    // dead phone and one working laptop was still notified.
    if (sent.length === 0) {
      if (failures.length > 0) {
        throw new Error(`Web Push failed on ${failures.length} device(s): ${describe(failures[0])}`);
      }
      throw new Error(`Every device's subscription had expired (${gone.length} removed); turn Browser notifications back on`);
    }
  },
};

/**
 * Real server pushes to one member's devices with the payload and delivery options chosen by the
 * caller, for the admin click diagnostics (app/(admin)/admin/notifications): vary one field at a time
 * against what a check-in sends. Skips preferences, the feature flag and subscription bookkeeping.
 */
export async function sendDiagnosticPush(
  repos: Pick<Repos, "pushSubscriptions">,
  memberId: string,
  payload: PushPayload,
  delivery: { urgency: "normal" | "high"; ttlSeconds: number }
): Promise<number> {
  const keys = vapidKeys();
  if (!keys) throw new Error("Web Push isn't configured (VAPID keys missing)");
  const subscriptions = await repos.pushSubscriptions.live(memberId);
  if (!subscriptions.length) throw new Error("No live push subscriptions");

  const options = {
    vapidDetails: { subject: `mailto:${SUPPORT_EMAIL}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
    TTL: delivery.ttlSeconds,
    urgency: delivery.urgency,
    timeout: REQUEST_TIMEOUT_MS,
  };
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map(async (s) => {
      if (!isAllowedPushEndpoint(s.endpoint)) throw new Error("Untrusted push subscription endpoint");
      return webpush.sendNotification({ endpoint: new URL(s.endpoint).href, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options);
    })
  );
  const sent = results.filter((r) => r.status === "fulfilled").length;
  if (sent === 0) {
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw new Error(`Web Push failed: ${describe(failed?.reason)}`);
  }
  return sent;
}

function isTimeSensitive(message: OutboundMessage, now: number): boolean {
  return message.timeSensitiveUntil !== undefined && Date.parse(message.timeSensitiveUntil) > now;
}

/** A time-sensitive push is worthless once it's over, so don't let the push service deliver it late. */
export function ttlSeconds(message: OutboundMessage, now: number): number {
  if (!isTimeSensitive(message, now)) return DEFAULT_TTL_SECONDS;
  return Math.max(1, Math.min(DEFAULT_TTL_SECONDS, Math.floor((Date.parse(message.timeSensitiveUntil!) - now) / 1000)));
}

export function pushPayload(message: OutboundMessage, { kind }: SendContext, now: number): PushPayload {
  return {
    title: message.title ?? (isNotificationKind(kind) ? notificationKind(kind).label : "Notification"),
    body: message.text,
    url: notificationUrl(message.url) ?? "/",
    tag: message.ref ? `${kind}:${message.ref}` : undefined,
  };
}

function describe(reason: unknown): string {
  if (reason instanceof WebPushError) return `${reason.statusCode} ${reason.body}`;
  return reason instanceof Error ? reason.message : String(reason);
}

export type { PushDevice } from "@/lib/data/push-subscriptions";

/** A member's live devices, newest first. Service role: the table holds push credentials. */
export async function loadPushDevices(supabase: any, memberId: string) {
  return createRepos(supabase).pushSubscriptions.devices(memberId);
}
