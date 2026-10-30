import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { isAnalyticsOptedOut } from "@/lib/analytics/opt-out";
import { SUPPORT_EMAIL } from "@/lib/config";
import { RETENTION } from "@/lib/retention";
import { StatsOptOutSwitch } from "./StatsOptOutSwitch";

export const metadata: Metadata = {
  title: "Privacy",
};

/** When the wording below was last checked against the code. Bump it whenever the page changes. */
export const PRIVACY_REVIEWED = "2026-10-30";

/**
 * What the Hub collects, who can see it, how long it is kept and what a member can do about it.
 *
 * Behind the `message_privacy` flag so it can be turned on for everyone together with chat. Every
 * statement here must be true when it is on, so change it with the code. It states policy and lists no
 * resources one by one (what a delete keeps, for instance), so it does not need an edit for every new
 * feature. What is true of the code today (checked 2026-10-30):
 *
 * - Chat: staff read chat content only where RLS lets admins (`chat_can_read_content`: public and
 *   non-restricted private channels); restricted channels, DMs and group DMs have no admin read path at all;
 *   admins' read access covers every conversation's metadata (`chat_can_see_channel`: members, who wrote and
 *   reacted and when, `last_read_at`) but never a deleted message's content (`chat_message_contents` policy
 *   requires `deleted_at IS NULL`); files follow the content policy. The break-glass section is the
 *   commitment for the rare case, not a screen: there is no in-app tool yet, so anything done under it is done
 *   by hand and has to follow what that section promises (docs/SLACK_BRIDGED_CHAT.md).
 * - Usage log: what is recorded and when (`lib/analytics/events.ts`, `lib/analytics/receive.ts`), the consent
 *   rule (`components/ConsentBanner.tsx`, `lib/analytics/consent.ts`), the visit cookie
 *   (`lib/analytics/session-cookie.ts`), notification sends and opens (`lib/notifications/notify.ts`,
 *   `lib/notifications/attribution.ts`), and the "leave me out" switch (`lib/analytics/opt-out.ts`: the browser,
 *   the receiver, the server-side recorders and Google Analytics all follow it, and turning it on deletes the
 *   account's stored usage events).
 * - Deletes: deleted things are kept until the member asks, as soft deletes or in the audit log.
 *
 * **Retention promises that need a job before they can be broken.** The page promises the numbers in
 * `lib/retention.ts`. Nothing enforces them yet: the job is phase 0 of docs/EVENT_LOG.md. It is safe to turn the
 * flag on now because no row is old enough to break them: the oldest possible raw user agent in `access_events`
 * dates from the table's creation (2026-08-27), so the first row passes 90 days on 2026-11-25; raw IPs have
 * been stored only since 2026-10-20, so the first passes on 2027-01-18; usage events pass 13 months in late 2027.
 * **The job must be deployed before 2026-11-25.** Nothing below promises more than that.
 */
export default async function PrivacyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("message_privacy")) redirect("/dashboard");

  const [identity, optedOut] = await Promise.all([getEffectiveIdentity(user), isAnalyticsOptedOut(user.id)]);

  return (
    <div className="container mx-auto px-6 py-6 max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">Privacy</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
        What the Hub collects about you, who can see it, how long we keep it and what you can do about it.
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-500 mb-6">
        Last reviewed <time dateTime={PRIVACY_REVIEWED}>{PRIVACY_REVIEWED}</time>.
      </p>

      <aside className="mb-8 rounded-lg border border-plum-200 dark:border-plum-800 bg-plum-50 dark:bg-plum-950/30 p-4 text-sm text-slate-800 dark:text-slate-200">
        <h2 className="text-base font-semibold mb-2">The short version</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            We keep what you do in the Hub, how you use it (the pages and buttons, never what you type), where you connect from,
            and your activity in chat.
          </li>
          <li>
            Staff can see who talks with whom, where and when, and what is said in the channels that reach the Hub. Restricted
            channels and group DMs are open to them only through break-glass access, and your one-on-one Slack DMs never reach the Hub.
          </li>
          <li>
            Your exact IP address and browser details are removed after {RETENTION.rawNetworkDays} days, and usage
            statistics after {RETENTION.usageMonths} months. What you do in the Hub is kept until you ask us to remove it.
          </li>
          <li>
            You can leave usage statistics off with a switch below, and ask us to show you, correct or remove what we hold.
          </li>
        </ul>
      </aside>

      <nav aria-label="On this page" className="mb-8 text-sm">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-plum-700 dark:text-plum-300">
          <li><a href="#collect" className="underline">What we collect</a></li>
          <li><a href="#who-sees" className="underline">Who can see it</a></li>
          <li><a href="#chat" className="underline">Chat and messages</a></li>
          <li><a href="#keep" className="underline">How long we keep things</a></li>
          <li><a href="#choices" className="underline">Your choices</a></li>
          <li><a href="#services" className="underline">Services we use</a></li>
        </ul>
      </nav>

      <Section id="collect" title="What we collect">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
              <th className="py-2 pr-4 font-semibold">What</th>
              <th className="py-2 pr-4 font-semibold">What it is</th>
              <th className="py-2 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <CollectRow
              what="Your account and what you do in it"
              detail="Your profile, projects, goals, check-ins, commitments, sign-ins, and the notifications we sent you."
              why="To run the Hub, and so your seat is kept warm through different seasons of life."
            />
            <CollectRow
              what="How you use the Hub"
              detail="Which pages you open, which buttons and links you use, what kind of search you ran and how many results (never the words), whether the things you try work, and your device, browser and screen."
              why="To fix what is confusing and build what helps. Your choice: see below."
            />
            <CollectRow
              what="Where you connect from"
              detail="The IP address your connection comes from, the city, region and country it appears to be in, the page you opened and your browser."
              why="To know where our community writes from, and which device and place you came from."
            />
            <CollectRow
              what="Course videos"
              detail="Where you stopped, which parts you watched, how fast, whether captions were on, whether the tab was in view, and your device and browser."
              why="To pick up where you left off, and to learn which lessons work."
            />
            <CollectRow
              what="Chat"
              detail="What you write, and the activity around it: who you talked with, where, when, how often, which channels you are in, and your reactions."
              why="To run chat, and to understand how the community connects."
            />
          </tbody>
        </table>
        <p className="text-sm">
          Location from your IP address is approximate (a VPN or a mobile carrier can make it wrong).
        </p>
      </Section>

      <Section id="who-sees" title="Who can see it">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
              <th className="py-2 pr-4 font-semibold">Who</th>
              <th className="py-2 font-semibold">What they can see</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <KeepRow what="You" keep="What you add yourself and your own activity, in the Hub's screens, and anything else we hold about you if you ask us." />
            <KeepRow
              what="Other members"
              keep="Your profile as you set it (including the projects and goals you choose to show), the books and awards you add, and what you post in the channels they are in. Not your usage statistics, your IP address or your private notes."
            />
            <KeepRow
              what="Quill & Cup staff"
              keep="Your account and activity, your course viewing and where you connect from (by name), and usage statistics, mostly as totals, though the individual records are tied to your account while they are kept. Chat is covered in its own section below."
            />
            <KeepRow what="The services that run the Hub" keep="Only what they need to do their job. They are listed at the bottom." />
          </tbody>
        </table>
      </Section>

      <Section id="chat" title="Chat and messages">
        <p>
          We treat two kinds of information differently. <strong>Content</strong> is what you wrote: message text,
          formatting, and files. <strong>Activity</strong> is everything around it: who you talked with, where, when,
          how often, which channels you&apos;re in, and which emoji reactions you added.
        </p>
        <p>
          Activity helps us understand how the community connects, so we can make introductions, spot hedgies who
          might be feeling isolated, and see what&apos;s working. It also counts toward your engagement, including
          messages in private channels and direct messages.
        </p>

        <h3 className="font-semibold text-slate-900 dark:text-slate-100 pt-2">What staff can see</h3>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
              <th className="py-2 pr-4 font-semibold">Where</th>
              <th className="py-2 pr-4 font-semibold">Activity</th>
              <th className="py-2 font-semibold">Content</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <Row where="Public channels" activity="Yes" content="Yes, same as every member" />
            <Row where="Private channels that include Billie Bot" activity="Yes" content="Yes, unless the channel is marked restricted" />
            <Row where="Restricted private channels" activity="Yes" content="No, except break-glass access (below)" />
            <Row where="Group DMs that include Billie Bot" activity="Yes" content="No, except break-glass access (below)" />
            <Row where="Slack DMs, and Slack group DMs or private channels without Billie Bot" activity="No" content="No. These never reach the Hub" />
          </tbody>
        </table>
        <p>
          In every conversation that reaches the Hub, restricted channels and group DMs included, staff can see who is
          in it, who wrote and reacted and when, and when you last read it (the Hub keeps that in step with Slack). Files
          shared in a conversation follow the same rule as its text. We keep a copy of files shared in the channels and
          group DMs the Hub mirrors, and the copy is removed if the file is deleted.
        </p>

        <Detail title="Break-glass access">
          In rare cases, such as a safety or conduct report, an admin may need to read the content of a specific
          restricted channel or group DM. We will do that only for that one conversation and only for as long as it
          takes, and we will record who looked, why and when. You won&apos;t receive an automatic notification when
          this happens.
        </Detail>

        <Detail title="Connecting your Slack account">
          Hub chat needs your Slack account connected. That lets the Hub act as you in Slack and only as you: post your
          messages and reactions, edit and delete the ones you wrote, join and leave channels, add people to a channel,
          and mark conversations read. It doesn&apos;t give the Hub access to your one-on-one Slack direct messages, and
          the Hub does nothing in Slack you didn&apos;t ask for there. The connection is kept encrypted and used only by the Hub&apos;s
          server. You can disconnect it in Settings at any time (chat then stays closed until you reconnect), and Slack
          shows it under your authorized apps.
        </Detail>

        <Detail title="Viewing the Hub as you">
          To help with support, an admin can view the Hub as a member. The chat is read-only and shows what you can see,
          except restricted channels and group DMs.
        </Detail>

        <Detail title="Deleted messages and reactions">
          When you delete a message or remove a reaction, it disappears for everyone, but we keep a record rather
          than erasing it. Deleted messages and removed reactions no longer count toward your activity. Staff can&apos;t
          read a deleted message&apos;s text or files in the Hub; the only way to read one is break-glass access, the same
          as for a restricted conversation.
        </Detail>
      </Section>

      <Section id="keep" title="How long we keep things">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
              <th className="py-2 pr-4 font-semibold">What</th>
              <th className="py-2 font-semibold">How long</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <KeepRow
              what="What you do in the Hub: your projects, check-ins, commitments, course viewing, chat messages and activity, sign-ins, the notifications we sent you, and your history as a member"
              keep="Until you ask us to remove it. If you leave and come back years later, your seat is still warm: your history is here."
            />
            <KeepRow
              what="Usage statistics: pages, buttons, search, and your device and screen"
              keep={`${RETENTION.usageMonths} months, then only anonymous totals`}
            />
            <KeepRow
              what="Your exact IP address and your browser's identification string"
              keep={`${RETENTION.rawNetworkDays} days. After that we keep the approximate place and the type of browser and device`}
            />
          </tbody>
        </table>
        <p>
          <strong>When you delete something</strong> you added to the Hub, it disappears for you and for everyone else. We may keep a
          copy, and our change history keeps a record of the change, until you ask us to remove it. When you ask, we either
          delete it or take your name off it. Removed data can stay in our database provider&apos;s backups for a limited time
          before they expire.
        </p>
      </Section>

      <Section id="choices" title="Your choices">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Usage statistics</h3>
        <p>
          We keep a log of how the Hub is used, so we can fix what is confusing and build what helps. It does not record what you
          type into search, forms or messages, and we take care that the button and link names it records are the app&apos;s own,
          such as &ldquo;Save&rdquo; or &ldquo;Log progress&rdquo;, not people&apos;s names or email addresses.{" "}
          <strong>If you are in the EU, EEA or UK</strong> we ask before we start, with the banner at the bottom of the page, and
          if you decline we don&apos;t record any of this. Elsewhere it is on. Our host, Vercel, also counts visits and page speed in
          aggregate, as totals with no individual profile, and that count is not part of the switch below. We use Google Analytics
          only where you have allowed it. After {RETENTION.usageMonths} months the individual
          records are removed and only anonymous totals remain (for example &ldquo;this page was opened 300 times in March&rdquo;),
          which is how we see trends over several years.
        </p>
        <StatsOptOutSwitch initialOptedOut={optedOut} readOnly={identity?.isSudo === true} />

        <h3 className="font-semibold text-slate-900 dark:text-slate-100 pt-2">Cookies</h3>
        <p>
          The Hub uses a few cookies and similar storage. <strong>Signing in</strong> needs its own cookies to keep you
          signed in. <strong>Your choice on the banner</strong> is remembered on your device. When usage statistics are on, a
          short-lived random <strong>visit number</strong> is kept so the things you do in one visit can be grouped; it expires
          after 30 minutes without activity and holds nothing about you. Google Analytics sets its own cookie, only if you have
          allowed it.
        </p>

        <h3 className="font-semibold text-slate-900 dark:text-slate-100 pt-2">Notifications</h3>
        <p>
          The Hub can notify you in more than one place, such as Slack, email, inside the Hub, or your browser. You choose
          which, for each kind of notification, in{" "}
          <Link href="/settings/notifications" className="underline">
            Settings
          </Link>
          , and every email has an unsubscribe link for that kind. We keep a record that we sent you each notification. Whether
          you opened it is part of the usage statistics, so it is recorded only where those are on: by clicking it in the Hub, or
          by arriving through a link in it. Links in Slack messages, emails and browser notifications carry a short tag saying
          which notification they came from; the Hub takes the tag off the address as soon as you arrive.
        </p>

        <h3 className="font-semibold text-slate-900 dark:text-slate-100 pt-2">Asking us</h3>
        <p>
          You can ask us at any time to show you what we hold about you, correct it, remove it, or stop using it for usage
          statistics. Email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>
          . We will answer within a month, and for removal we will either delete it or take your name off it, whichever you
          prefer.
        </p>
      </Section>

      <Section id="services" title="Services that help us run the Hub">
        <p>
          Your information passes through the services the Hub is built on: our database and sign-in provider, our hosting
          provider, Vercel (which also counts visits and page speed), an error-reporting provider (error reports, held in the EU), a
          video provider for course videos, our email provider, Google Analytics (only where you allow it), and Slack. We use
          them to run the Hub and not for anything else.
        </p>
      </Section>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 space-y-3 text-slate-700 dark:text-slate-300 scroll-mt-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {children}
    </section>
  );
}

/** Long explanations stay folded until someone wants them. */
function Detail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2">
      <summary className="cursor-pointer font-medium text-slate-900 dark:text-slate-100">{title}</summary>
      <p className="mt-2 text-sm">{children}</p>
    </details>
  );
}

function CollectRow({ what, detail, why }: { what: string; detail: string; why: string }) {
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800">
      <td className="py-2 pr-4 font-medium text-slate-900 dark:text-slate-100">{what}</td>
      <td className="py-2 pr-4">{detail}</td>
      <td className="py-2">{why}</td>
    </tr>
  );
}

function KeepRow({ what, keep }: { what: string; keep: string }) {
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800">
      <td className="py-2 pr-4">{what}</td>
      <td className="py-2">{keep}</td>
    </tr>
  );
}

function Row({ where, activity, content }: { where: string; activity: string; content: string }) {
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800">
      <td className="py-2 pr-4">{where}</td>
      <td className="py-2 pr-4">{activity}</td>
      <td className="py-2">{content}</td>
    </tr>
  );
}
