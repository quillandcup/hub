import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { SUPPORT_EMAIL } from "@/lib/config";
import { RETENTION } from "@/lib/retention";

export const metadata: Metadata = {
  title: "Privacy",
};

/**
 * What staff can and can't see: Slack and Hub chat, how course videos are watched, and where
 * members connect from.
 *
 * Behind the `message_privacy` flag so it can be turned on for everyone together with chat. Every
 * statement here must be true when it is on, and must be updated if the chat design changes (see
 * docs/SLACK_BRIDGED_CHAT.md). What is true of the code today: staff read chat content only where RLS
 * lets admins (`chat_can_read_content`: public and non-restricted private channels); restricted channels,
 * DMs and group DMs have no admin read path at all; deleted messages stay out of activity. The break-glass
 * section is the commitment for the rare case, not a screen: there is no in-app break-glass tool yet, so
 * until there is, anything done under it is done by hand and has to follow what that section promises.
 * Also true of the code (checked 2026-10-25): admins' read access covers every conversation's metadata
 * (`chat_can_see_channel`: members, who wrote and reacted and when, `last_read_at`) but never a deleted
 * message's content (`chat_message_contents` policy requires `deleted_at IS NULL`), and files follow the
 * content policy.
 *
 * Added with the usage log, notifications and retention sections (checked 2026-10-26): what is recorded
 * and when (`lib/analytics/events.ts`, `lib/analytics/receive.ts`), the consent rule (`components/ConsentBanner.tsx`,
 * `lib/analytics/consent.ts`), the `hub_sid` cookie (`lib/analytics/session-cookie.ts`), notification sends and
 * opens (`lib/notifications/notify.ts`, `lib/notifications/attribution.ts`), and which deletes keep a record
 * (members' projects, goals, progress entries, books and awards are real deletes; `audit_log` keeps what they said).
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

  return (
    <div className="container mx-auto px-6 py-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Privacy</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">
        What Quill &amp; Cup staff can and can&apos;t see: when you talk with other hedgies in Slack or in the Hub, how you
        watch course videos, where you connect from, and how we measure what is useful. And how long we keep it all, and how
        to ask us to remove it.
      </p>

      <Section title="Content vs. activity">
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
      </Section>

      <Section title="What staff can see">
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
      </Section>

      <Section title="Break-glass access">
        <p>
          In rare cases, such as a safety or conduct report, an admin may need to read the content of a specific
          restricted channel or group DM. We will do that only for that one conversation and only for as long as it
          takes, and we will record who looked, why and when. You won&apos;t receive an automatic notification when
          this happens.
        </p>
      </Section>

      <Section title="Connecting your Slack account">
        <p>
          Hub chat needs your Slack account connected. That lets the Hub act as you in Slack and only as you: post your
          messages and reactions, edit and delete the ones you wrote, join and leave channels, add people to a channel,
          and mark conversations read. It doesn&apos;t give the Hub access to your one-on-one Slack direct messages, and
          the Hub does nothing in Slack you didn&apos;t ask for there. The connection is kept encrypted and used only by the Hub&apos;s
          server. You can disconnect it in Settings at any time (chat then stays closed until you reconnect), and Slack
          shows it under your authorized apps.
        </p>
      </Section>

      <Section title="Viewing the Hub as you">
        <p>
          To help with support, an admin can view the Hub as a member. In chat that is read-only and shows what you can
          see with restricted channels and group DMs left out.
        </p>
      </Section>

      <Section title="Course videos">
        <p>
          When you watch a lesson video, we record where you stopped (so it can pick up there next time), which parts you
          watched, how fast, whether captions were on, whether the tab was in view, and the device and browser you used.
          Staff can see this by name for each visit, to learn which lessons work and where people drop off. The video
          itself is streamed from our video provider, Mux. This is removed if your account is removed.
        </p>
      </Section>

      <Section title="Where you connect from">
        <p>
          Each time you use the Hub, we record the IP address your connection comes from and the city, region and country
          it appears to be in, along with the page you opened and your browser. Staff can see it. We use it to understand
          where our community writes from, and to know which device and place a visit came from. These locations are
          approximate (a VPN or a mobile carrier can make them wrong). We remove the exact IP address and your browser&apos;s
          identification string after {RETENTION.rawNetworkDays} days, and keep the approximate place and the type of browser and
          device. The rest is removed if your account is removed.
        </p>
      </Section>


      <Section title="How we measure what is useful">
        <p>
          We keep a log of how the Hub is used, so we can fix what is confusing and build what helps. It records which
          pages you open, which buttons and links you use, how you use search (what kind of search and how many results,
          <strong> never the words you typed</strong>), whether the things you try to do work (saved, or didn&apos;t), and
          what kind of device, browser and screen you use. It does not record what you type into search, forms or
          messages, and we take care that the button and link names it records are the app&apos;s own, such as
          &ldquo;Save&rdquo; or &ldquo;Log progress&rdquo;, not people&apos;s names or email addresses.
        </p>
        <p>
          <strong>If you are in the EU, EEA or UK</strong> we ask before we start, with the banner at the bottom of the
          page, and if you decline we don&apos;t record any of this. Elsewhere it is on. <strong>Wherever you are, you can ask us to
          leave you out</strong> and to remove what we have (see &ldquo;Asking us&rdquo; below). We also use Google Analytics, only
          where you have allowed it, and our host, Vercel, counts visits and page speed in aggregate.
        </p>
        <p>
          We keep these records for {RETENTION.usageMonths} months. After that the individual records are removed and only
          anonymous totals remain (for example &ldquo;this page was opened 300 times in March&rdquo;), which is how we see
          trends over several years.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          The Hub uses a few cookies and similar storage. <strong>Signing in</strong> needs its own cookies to keep you
          signed in. <strong>Your choice on the banner</strong> is remembered on your device. When usage statistics are on
          (above), a short-lived random <strong>visit number</strong> is kept so the things you do in one visit can be
          grouped; it expires after 30 minutes without activity and holds nothing about you. Google Analytics sets its own
          cookie, only if you have allowed it.
        </p>
      </Section>

      <Section title="Notifications">
        <p>
          The Hub can notify you in four places: a direct message from Billie Bot in Slack, email, the bell and banners inside
          the Hub, and browser notifications on a device you turn them on for. You choose which, for each kind of
          notification, in Settings, and every email has an unsubscribe link for that kind.
        </p>
        <p>
          We keep a record that we sent you each notification. Whether you opened it is part of the usage statistics above,
          so it is recorded only where those are on: by clicking it in the Hub, or by arriving through a link in it. Links in
          Slack messages, emails and browser notifications carry a short tag saying which notification they came from; the Hub
          takes the tag off the address as soon as you arrive.
        </p>
      </Section>

      <Section title="Deleted messages and reactions">
        <p>
          When you delete a message or remove a reaction, it disappears for everyone, but we keep a record rather
          than erasing it. Deleted messages and removed reactions no longer count toward your activity. Staff can&apos;t
          read a deleted message&apos;s text or files in the Hub; the only way to read one is break-glass access, the same
          as for a restricted conversation.
        </p>
      </Section>

      <Section title="When you delete something else">
        <p>
          When you delete a writing project, goal, progress entry, book or award, it is gone from the Hub for you and for
          everyone else. Our change history keeps a record that it existed and what it said (such as its title) until you ask
          us to remove that too.
        </p>
      </Section>

      <Section title="How long we keep things">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
              <th className="py-2 pr-4 font-semibold">What</th>
              <th className="py-2 font-semibold">How long</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <KeepRow
              what="What you do in the Hub: your projects, check-ins, commitments, sign-ins, the notifications we sent you, and your history as a member"
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
            <KeepRow what="Course viewing" keep="Until you ask us to remove it, or your account is removed" />
            <KeepRow what="Chat" keep="As described above" />
          </tbody>
        </table>
        <p>
          Removed data can stay in our database provider&apos;s backups for a limited time before they expire.
        </p>
      </Section>

      <Section title="Asking us">
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

      <Section title="Services that help us run the Hub">
        <p>
          Your information passes through the services the Hub is built on: Supabase (the database and sign-in), Vercel
          (hosting, and visit and speed counts), an error-reporting provider (error reports, held in the EU), Google Analytics (only where you
          allow it), Mux (course video), Slack, and our email provider. We use them to run the Hub and not for anything else.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 space-y-3 text-slate-700 dark:text-slate-300">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      {children}
    </section>
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
