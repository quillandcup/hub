import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserFeaturePreviews } from "@/lib/features.server";

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
        watch course videos, and where you connect from.
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
      </Section>

      <Section title="Break-glass access">
        <p>
          In rare cases, such as a safety or conduct report, an admin may need to read the content of a specific
          restricted channel or group DM. We will do that only for that one conversation and only for as long as it
          takes, and we will record who looked, why and when. You won&apos;t receive an automatic notification when
          this happens.
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
          approximate (a VPN or a mobile carrier can make them wrong). This is removed if your account is removed.
        </p>
      </Section>

      <Section title="Deleted messages and reactions">
        <p>
          When you delete a message or remove a reaction, it disappears for everyone, but we keep a record rather
          than erasing it. Deleted messages and removed reactions no longer count toward your activity. Staff can see a
          deleted message&apos;s content only where they could see the original: in public and unrestricted channels
          they can, and in restricted channels and group DMs only through break-glass access.
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

function Row({ where, activity, content }: { where: string; activity: string; content: string }) {
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800">
      <td className="py-2 pr-4">{where}</td>
      <td className="py-2 pr-4">{activity}</td>
      <td className="py-2">{content}</td>
    </tr>
  );
}
