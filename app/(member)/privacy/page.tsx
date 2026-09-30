import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserFeaturePreviews } from "@/lib/features.server";

export const metadata: Metadata = {
  title: "Message Privacy",
};

/**
 * What staff can and can't see in Slack and Hub chat.
 *
 * Behind the `message_privacy` flag because it describes the Slack-bridged chat design, not
 * today's app: the content/metadata split, per-channel "restricted" flag, break-glass access
 * with its audit log, and soft-deleted messages are not built yet. Every statement here must be
 * true before the flag goes on, and must be updated if that design changes. See
 * docs/SLACK_BRIDGED_CHAT.md.
 */
export default async function PrivacyPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("message_privacy")) redirect("/dashboard");

  return (
    <div className="container mx-auto px-6 py-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Message Privacy</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-8">
        What Quill &amp; Cup staff can and can&apos;t see when you talk with other hedgies in Slack or in the Hub.
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
            <Row where="Direct messages and group DMs in the Hub" activity="Yes" content="No, except break-glass access (below)" />
            <Row where="Slack DMs, and private channels without Billie Bot" activity="No" content="No. These never reach the Hub" />
          </tbody>
        </table>
        <p>
          Each channel in the Hub shows whether staff can read its content.
        </p>
      </Section>

      <Section title="Break-glass access">
        <p>
          In rare cases, such as a safety or conduct report, an admin may need to read the content of a specific
          restricted channel or direct message. Doing so requires recording a reason, is limited to that one
          conversation for a limited time, and is permanently recorded in an audit log that staff review. You
          won&apos;t receive an automatic notification when this happens.
        </p>
      </Section>

      <Section title="Deleted messages and reactions">
        <p>
          When you delete a message or remove a reaction, it disappears for everyone, but we keep a record rather
          than erasing it. Deleted messages still count toward your activity, at a reduced weight. Staff can only see
          a deleted message&apos;s content through break-glass access.
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
