import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { isAnalyticsOptedOut } from "@/lib/analytics/opt-out";
import {
  PRIVACY_NAV,
  PRIVACY_SECTIONS,
  PRIVACY_SUMMARY,
  PRIVACY_SUMMARY_TITLE,
  PRIVACY_TAGLINE,
  PRIVACY_TITLE,
  type PrivacyBlock,
} from "@/content/privacy";
import { RichText, TrustAside, TrustDetail, TrustNav, TrustSection, TrustSubheading, TrustTable } from "@/components/trust/Trust";
import { StatsOptOutSwitch } from "./StatsOptOutSwitch";

export const metadata: Metadata = {
  title: PRIVACY_TITLE,
};

/** When the wording was last checked against the code. Bump it whenever the page or `src/content/privacy.ts` changes. */
export const PRIVACY_EFFECTIVE = "2026-11-18";

/**
 * What the Hub collects, who can see it, how long it is kept and what a member can do about it.
 *
 * The sentences are not here: they are data in `src/content/privacy.ts`, which this page renders and which the staff page
 * (`/admin/privacy`, `src/lib/privacy-promises.ts`) reads too, with where each promise is enforced. Providers are described
 * by role, never named (`tests/lib/trust-no-provider-names.test.ts`).
 *
 * On for every signed-in member (it was behind the `message_privacy` flag until 2026-10-30). Every
 * statement must be true, so change it with the code. It states policy and lists no
 * resources one by one (what a delete keeps, for instance), so it does not need an edit for every new
 * feature. What is true of the code today (last checked in full 2026-11-03; reworded on 2026-11-17 and 2026-11-18 (the DM bridge is no longer described as rolling out)):
 *
 * - Chat: staff read chat content only where RLS lets admins (`chat_can_read_content`: public and
 *   non-restricted private channels); restricted channels, DMs and group DMs have no admin read path at all;
 *   admins' read access covers every conversation's metadata (`chat_can_see_channel`: members, who wrote and
 *   reacted and when, `last_read_at`) but never a deleted message's content (`chat_message_contents` policy
 *   requires `deleted_at IS NULL`); files follow the content policy. The break-glass section is the
 *   commitment for the rare case, not a screen: there is no in-app tool yet, so anything done under it is done
 *   by hand and has to follow what that section promises (docs/product/SLACK_BRIDGED_CHAT.md).
 * - One-on-one Slack DMs (the `slack_dm_bridge` feature, docs/product/SLACK_BRIDGED_CHAT.md), on for every member since 2026-11-13 (production flag): their
 *   own Slack token lists and reads their DMs (when they open chat, on a live event, nightly; `src/lib/chat/slack-dms.ts`,
 *   `src/lib/chat/slack-dm-events.ts`, `/api/reconcile/slack-dms`), into Bronze (service role only, never shown to admins as text) and
 *   the chat as a private, restricted `dm` conversation: the Hub members in it who have pulled their own DMs (each is
 *   added by their own pull, `slack_dm_member_pulled`; the other person only once theirs finds it) can read it, admins see only that it exists and its metadata, sudo never shows it. A DM with a
 *   non-member keeps their messages under their Slack name; nothing else about them. The page's DM statements must
 *   change with that code, in particular if the feature is ever switched off for some members again.
 * - Hedgie Care plan messages (decided 2026-11-12, docs/product/HEDGIE_CARE.md "Plan messages"): the one exception to the above. Admins and
 *   community managers (never an assistant: `requireActionPermission("care.member_activity.read")`) see, inside Hedgie Care, the full text of the
 *   one-on-one Slack DM(s) tracked with a member (`care_tracked_dms`; tracking comes automatically with a care plan and nothing
 *   untracks it), sent in the window of each of that member's care plans (the plan's start to its close, or now while open), across all
 *   the member's plans and owners; read with the service role from Bronze by `src/lib/care-messages.ts`, deleted messages left out. No chat
 *   policy changed: a DM with a staff member is otherwise break-glass only. Opening them writes an audit entry (`care_dm_read`,
 *   `care_log_messages_read`; one per reader and member per hour, no text) shown in the Activity Log's Privacy view, and a tracked DM
 *   shows a note at the top in Hub Chat (`CarePlanNotice`). Slack's own app shows no such note, and the page says so.
 * - Usage log: what is recorded and when (`src/lib/analytics/events.ts`, `src/lib/analytics/receive.ts`), the consent
 *   rule (`src/components/ConsentBanner.tsx`, `src/lib/analytics/consent.ts`), the visit cookie
 *   (`src/lib/analytics/session-cookie.ts`), notification sends and opens (`src/lib/notifications/notify.ts`,
 *   `src/lib/notifications/attribution.ts`), and the "Share usage statistics" switch (off = left out) (`src/lib/analytics/opt-out.ts`: the browser,
 *   the receiver, the server-side recorders and Google Analytics all follow it, and turning it on deletes the
 *   account's stored usage events).
 * - Deletes: deleted things are kept until the member asks, as soft deletes or in the audit log.
 *
 * **Retention promises that need a job before they can be broken.** The page promises the numbers in
 * `src/lib/retention.ts`, and the nightly job in docs/architecture/EVENT_LOG.md phase 0 enforces them (deployed 2026-10-31; no row was old
 * enough to break them before it ran). Checked against production on 2026-10-30: the oldest raw user agent
 * in `access_events` is from 2026-10-18 (the column is newer than the table), the oldest raw IP from 2026-10-21, and
 * the oldest user agent in a usage event from 2026-10-20, so the first value passes 90 days on 2027-01-16; usage events
 * pass 13 months in late 2027. (An earlier note here said 2026-11-25, assuming user agents went back to the table's
 * creation; they don't.)
 * **The job (`/api/reconcile/retention`, src/lib/retention/network-details.ts) must be deployed before 2027-01-16.** It covers the
 * visit log (`access_events`), the usage log and course viewing, which is what the "How long we keep things" row says. The same
 * job rolls usage events up into anonymous totals and removes them after `usageMonths` (src/lib/retention/usage-events.ts); the first
 * reach that in late 2027 and are removed only once their totals are kept. The
 * browser string attached to a push subscription or to feedback a member submits is not covered, and the row does not claim it.
 */
export default async function PrivacyPage() {
  // Public: anyone can read it, signed in or not. Only the usage-statistics switch needs an account.
  const user = await getCurrentUser();
  const [identity, optedOut] = user
    ? await Promise.all([getEffectiveIdentity(user), isAnalyticsOptedOut(user.id)])
    : [null, false];

  function renderBlock(block: PrivacyBlock, key: number) {
    switch (block.kind) {
      case "p":
        return (
          <p key={key} className={block.small ? "text-sm" : undefined}>
            <RichText text={block.text} />
          </p>
        );
      case "subheading":
        return (
          <TrustSubheading key={key} id={block.id}>
            {block.text}
          </TrustSubheading>
        );
      case "table":
        return <TrustTable key={key} columns={block.columns} rows={block.rows} emphasizeFirst={block.emphasizeFirst} />;
      case "details":
        return (
          <TrustDetail key={key} title={block.title}>
            {block.paragraphs.map((paragraph, i) => (
              <p key={i}>
                <RichText text={paragraph.text} />
              </p>
            ))}
          </TrustDetail>
        );
      case "list":
        return (
          <ul key={key} className={`list-disc pl-5 space-y-1${block.small ? " text-sm" : ""}`}>
            {block.items.map((item, i) => (
              <li key={i}>
                <RichText text={item.text} />
              </li>
            ))}
          </ul>
        );
      case "switch":
        return user ? (
          <StatsOptOutSwitch key={key} initialOptedOut={optedOut} readOnly={identity?.isSudo === true} />
        ) : (
          <p key={key} className="text-sm">
            <RichText text={block.signedOut} />
          </p>
        );
    }
  }

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <div className="container mx-auto px-6 py-6 max-w-5xl">
        <p className="mb-4 text-sm">
          <Link href={user ? "/dashboard" : "/login"} className="text-plum-700 dark:text-plum-300 underline">
            {user ? "Back to the Hub" : "Sign in to the Hub"}
          </Link>
        </p>
        <h1 className="text-2xl font-bold mb-1">{PRIVACY_TITLE}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">{PRIVACY_TAGLINE}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          Effective <time dateTime={PRIVACY_EFFECTIVE}>{PRIVACY_EFFECTIVE}</time>.
        </p>

        <TrustAside title={PRIVACY_SUMMARY_TITLE}>
          <ul className="list-disc pl-5 space-y-1">
            {PRIVACY_SUMMARY.map((item, i) => (
              <li key={i}>
                <RichText text={item.text} />
              </li>
            ))}
          </ul>
        </TrustAside>

        <TrustNav links={PRIVACY_NAV} />

        {PRIVACY_SECTIONS.map((section) => (
          <TrustSection key={section.id} id={section.id} title={section.title}>
            {section.blocks.map(renderBlock)}
          </TrustSection>
        ))}
      </div>
    </div>
  );
}
