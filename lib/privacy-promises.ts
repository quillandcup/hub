import type { ComplianceStatus } from "@/lib/compliance";
import { privacyText } from "@/lib/privacy";
import { RETENTION } from "@/lib/retention";

/**
 * What the Privacy page promises, one row per promise, with where the code keeps it: the list behind the staff
 * view (`/admin/privacy`). What members read is written once, in `lib/privacy.ts`, and the page renders it; a row
 * here names the items it is about (`reads`) and `member` is those items' text, so the staff page shows exactly
 * what the page says and a change to the wording changes both.
 *
 * Every row must be true of the code today. The staff detail is public-safe on purpose (the repo is public):
 * where a thing is enforced and tested, when it was last checked, and what is still open. Never a name, an
 * account, a key or a host. Numbers come from `lib/retention.ts`, the same constants the page and the nightly
 * job use, so they cannot drift.
 */

export const PRIVACY_PROMISES_EFFECTIVE = "2026-11-18";

export interface PrivacyPromise {
  id: string;
  title: string;
  status: ComplianceStatus;
  /** The ids in `lib/privacy.ts` of the sentences or table rows that make this promise on the page. */
  reads: readonly string[];
  /** The promise exactly as the Privacy page says it: the text of `reads`, from `lib/privacy.ts`. */
  member: string;
  /** How the code keeps it, for the team. */
  how: string;
  evidence: readonly string[];
  /** When this row was last checked against the code (YYYY-MM-DD, Eastern). */
  checked: string;
  open: readonly string[];
}

export interface PrivacyGroup {
  id: string;
  title: string;
  intro: string;
  rows: readonly PrivacyPromise[];
}

type PromiseDef = Omit<PrivacyPromise, "member">;
type GroupDef = Omit<PrivacyGroup, "rows"> & { rows: readonly PromiseDef[] };

export const PRIVACY_GROUPS: readonly PrivacyGroup[] = ([
  {
    id: "choices",
    title: "Asking first, and your choices",
    intro: "What we ask before recording anything, and what a member can switch off.",
    rows: [
      {
        id: "consent",
        title: "We ask first in the EU, EEA and UK",
        status: "inPlace",
        reads: ["consent-rule"],
        how: "The banner is decided from the visitor's country, read from the hosting provider's header. An unknown location is treated as needing consent. Google Analytics runs in Consent Mode: where consent is needed its consent starts denied, before its script loads, and the banner updates it.",
        evidence: ["components/ConsentBanner.tsx", "lib/analytics/consent.ts", "lib/gdpr-countries.ts", "tests/components/pages/privacy-page.test.tsx"],
        checked: "2026-11-17",
        open: [],
      },
      {
        id: "opt-out",
        title: "A switch to leave usage statistics off",
        status: "inPlace",
        reads: ["summary-switch"],
        how: "One flag per account. The browser, the receiving route, the server-side recorders and Google Analytics all follow it, and turning it on deletes the account's stored usage events. While an admin views the Hub as a member the switch is read-only.",
        evidence: ["lib/analytics/opt-out.ts", "app/privacy/actions.ts", "app/privacy/StatsOptOutSwitch.tsx", "supabase/tests/database/analytics_opt_out.test.sql", "tests/lib/privacy-actions.test.ts"],
        checked: "2026-11-17",
        open: [],
      },
      {
        id: "no-typed-text",
        title: "Usage statistics never record what you type",
        status: "inPlace",
        reads: ["stats-no-typed-text"],
        how: "Search records only its kind and result count. Click labels that could identify a person (a member's name or email shown in a menu, for instance) are removed by a database function, which a pgTAP test covers.",
        evidence: ["lib/analytics/events.ts", "lib/analytics/receive.ts", "supabase/tests/database/analytics_scrub_labels.test.sql"],
        checked: "2026-11-17",
        open: [],
      },
      {
        id: "recordings",
        title: "Error recordings mask text and form fields",
        status: "inPlace",
        reads: ["stats-recordings"],
        how: "Session replay masks text, form fields and media by default (Sentry's defaults, kept on purpose); only the app's own navigation labels are unmasked. The monitoring provider scrubs on its side and does not store IP addresses.",
        evidence: ["instrumentation-client.ts", "components/SessionReplay.tsx", "sentry-config.yml", "docs/SENTRY_CONFIG.md"],
        checked: "2026-11-17",
        open: [
          "Recordings are kept up to 90 days, set by the monitoring provider's plan, not by us. The Privacy page says so; nothing here enforces it.",
        ],
      },
      {
        id: "video-quality",
        title: "Video quality measurement is anonymous",
        status: "inPlace",
        reads: ["collect-video-quality"],
        how: "No viewer id and no custom dimension that could hold a person are sent to the video provider, and its cookies are off. The same switch and banner decide whether it runs.",
        evidence: ["lib/mux-data.ts", "components/courses/LessonPlayer.tsx", "docs/MUX_CONFIG.md", "docs/ANALYTICS.md"],
        checked: "2026-11-17",
        open: [
          "The provider keeps view data up to 100 days and offers no way to edit or delete a single view; erasure is by emailing the provider and removes whole views. Linking a view to our own events is undecided (docs/TODO.md, Mux Data).",
        ],
      },
    ],
  },
  {
    id: "keeping",
    title: "How long we keep things",
    intro: "The numbers are the constants the page prints and the nightly job enforces.",
    rows: [
      {
        id: "retention-network",
        title: `Exact IP address and browser details: ${RETENTION.rawNetworkDays} days`,
        status: "inPlace",
        reads: ["keep-network"],
        how: "A nightly job strips the raw values from the visit log, the usage log and course viewing once they pass the limit. The page and the job import the same constant.",
        evidence: [
          "lib/retention.ts",
          "lib/retention/network-details.ts",
          "app/api/reconcile/retention/route.ts",
          "supabase/tests/database/retention_network_details.test.sql",
          "docs/EVENT_LOG.md (retention schedule)",
        ],
        checked: "2026-11-17",
        open: [
          "The browser string attached to a push subscription, or to feedback a member submits, is not covered by the job. The page does not claim it, but it is kept without a limit.",
        ],
      },
      {
        id: "retention-usage",
        title: `Usage statistics: ${RETENTION.usageMonths} months, then anonymous totals`,
        status: "inPlace",
        reads: ["keep-usage"],
        how: "The same job rolls usage events up into totals and removes the individual rows once their totals are kept.",
        evidence: ["lib/retention.ts", "lib/retention/usage-events.ts", "docs/EVENT_LOG.md (retention schedule)"],
        checked: "2026-11-17",
        open: ["No usage event is old enough yet for this removal to have run on real data; the first reach the limit in late 2027. Watch the first run."],
      },
      {
        id: "deletes",
        title: "What you delete stays until you ask us to remove it",
        status: "inPlace",
        reads: ["keep-deletes"],
        how: "Deleted things are soft deletes, or live in the audit log. A removal request either deletes them or takes the name off.",
        evidence: [".claude/rules/data-architecture.md (soft delete)", "docs/ACTIVITY_AND_AUDIT_LOG.md"],
        checked: "2026-11-17",
        open: ["How long the database provider keeps backups is a plan setting of theirs and is not written down in the repo."],
      },
    ],
  },
  {
    id: "chat",
    title: "Chat: who can read what",
    intro: "Chat has its own section on the Privacy page: content (what you wrote) and activity (everything around it).",
    rows: [
      {
        id: "chat-content",
        title: "Staff read chat content only where the database allows it",
        status: "inPlace",
        reads: ["chat-public", "chat-private", "chat-restricted", "chat-group", "chat-dm", "chat-planned", "chat-metadata"],
        how: "Enforced by row-level security on the message contents table (chat_can_read_content) and a separate, wider rule for metadata (chat_can_see_channel), not by the page. Files follow the content rule.",
        evidence: [
          "supabase/migrations/20261009000000_slack_content_privacy.sql",
          "supabase/migrations/20261010000000_chat_mirror.sql",
          "supabase/tests/database/chat_visible_channels.test.sql",
          "docs/SLACK_BRIDGED_CHAT.md",
        ],
        checked: "2026-11-17",
        open: [
          "Private channels the bot isn't in are listed on the page as \"not yet\" for activity and content (planned: activity yes, content restricted). Until they are brought in there is nothing to enforce.",
        ],
      },
      {
        id: "deleted-messages",
        title: "Deleted messages can't be read by staff in the Hub",
        status: "inPlace",
        reads: ["chat-deleted"],
        how: "The content table's policy requires the message not to be deleted, so there is no read path for it.",
        evidence: ["supabase/migrations/20261130000000_chat_edit_delete.sql", "supabase/migrations/20261010000000_chat_mirror.sql"],
        checked: "2026-11-17",
        open: [],
      },
      {
        id: "slack-dms",
        title: "One-on-one Slack DMs are shown only to the people in them",
        status: "inPlace",
        reads: ["dm-what", "dm-who", "dm-stop"],
        how: "Each member's own Slack token lists and reads their DMs (on opening chat, on a live event and nightly) into a service-role-only store, and a private restricted conversation is made for the members who pulled it. A non-member's messages are kept under their Slack name and nothing else about them.",
        evidence: ["lib/chat/slack-dms.ts", "lib/chat/slack-dm-events.ts", "app/api/reconcile/slack-dms/route.ts", "tests/lib/slack-dms.test.ts", "tests/lib/slack-dm-events.test.ts", "docs/SLACK_BRIDGED_CHAT.md"],
        checked: "2026-11-18",
        open: ["The page's DM statements must change with this code. The feature is on for every member (the flag has been on globally since 2026-11-13, read from production), so the page no longer says it is rolling out; if it is ever switched off again for some members, put that back."],
      },
      {
        id: "break-glass",
        title: "Break-glass access is recorded",
        status: "working",
        reads: ["chat-break-glass"],
        how: "A commitment, not a screen. There is no in-app tool, so anything done under it is done by hand and has to be recorded as the page promises.",
        evidence: ["lib/privacy.ts (emergency access, the member-facing name for break-glass)", "docs/SLACK_BRIDGED_CHAT.md"],
        checked: "2026-11-17",
        open: ["Build the in-app tool, with the record written by the tool, so the promise doesn't rest on a person remembering to write it down."],
      },
      {
        id: "view-as",
        title: "Viewing the Hub as a member is read-only in chat",
        status: "inPlace",
        reads: ["chat-view-as"],
        how: "The effective member comes from one function, so every member page reads the same identity; the stats switch is read-only while viewing as someone.",
        evidence: ["lib/sudo.ts", ".claude/rules/member-identity.md", "app/privacy/StatsOptOutSwitch.tsx"],
        checked: "2026-11-17",
        open: [],
      },
      {
        id: "slack-connection",
        title: "Your Slack connection is stored encrypted",
        status: "inPlace",
        reads: ["chat-connection"],
        how: "The token is in the database vault behind service-role-only functions, with only a pointer in our table.",
        evidence: ["lib/slack-connect.ts", "docs/TODO.md (Secrets at Rest)"],
        checked: "2026-11-17",
        open: [],
      },
    ],
  },
  {
    id: "providers",
    title: "Services, transfers and your rights",
    intro: "Who handles information for us, and how a member gets at what we hold.",
    rows: [
      {
        id: "services",
        title: "Only the services that run the Hub receive your information",
        status: "provider",
        reads: ["more-sharing", "services-transfers"],
        how: "The list is kept by hand in lib/privacy.ts. The certification status was checked against the Data Privacy Framework list; the Compliance page carries the row and its open items.",
        evidence: ["lib/privacy.ts (services)", "docs/TODO.md (the Data Privacy Framework check)"],
        checked: "2026-11-17",
        open: [
          "A new provider must be added to the page's list and checked against the certification list before it receives anything. Nothing enforces that; it is a review step.",
          "Gravatar is asked with a hash of the member's email address (MD5, Gravatar's format), so anyone who already has an address can check it against the hash. The page says \"a hash\" and names no provider.",
        ],
      },
      {
        id: "rights",
        title: "Members can ask to see, correct or remove what we hold",
        status: "working",
        reads: ["choices-asking"],
        how: "Requests come by email to the support address and are handled by a person. Removal has a staff tool: \"Remove on request\" on the admin member page shows what would be removed (a dry run), asks for the member's name to confirm, then deletes or anonymises their records in one database transaction and removes their sign-in and stored files, leaving the copies in the imports from other services to be removed at the source. Turning off usage statistics is a switch on the Privacy page.",
        evidence: [
          "lib/privacy.ts (asking us)",
          "app/(admin)/admin/members/[id]/RemoveMemberPanel.tsx",
          "app/(admin)/admin/members/[id]/removal-actions.ts",
          "lib/member-removal.ts",
          "supabase/migrations/20270411000000_remove_member_data.sql",
        ],
        checked: "2026-11-18",
        open: [
          "Removal has a tool; seeing what we hold, and correcting it, do not, so those requests are answered by hand. Nothing records that a request arrived, when it was answered or its one-month deadline, and a removal also removes the audit entries about the person, so a record has to be kept apart and without personal data (docs/TODO.md, \"Data requests: record each one and its deadline, and answer access requests\").",
        ],
      },
      {
        id: "children",
        title: "The Hub isn't for children under 13",
        status: "inPlace",
        reads: ["more-children"],
        how: "A policy statement; membership is by invitation.",
        evidence: ["lib/privacy.ts (also good to know)"],
        checked: "2026-11-17",
        open: [],
      },
    ],
  },
] satisfies readonly GroupDef[]).map((group) => ({
  ...group,
  rows: group.rows.map((row) => ({ ...row, member: privacyText(row.reads) })),
}));
