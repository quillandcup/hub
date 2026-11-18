import Link from "next/link";
import PageBanner from "@/components/PageBanner";

/**
 * The line at the top of a one-on-one DM that is tracked in a Hedgie Care plan of its member (open or past): the team can read what is
 * sent in it during a plan. Everyone in the conversation sees it, so nobody is surprised. What it says rests on `chat_dm_in_care_plan`
 * (which conversations) and `lib/care-messages.ts` (which messages: those sent from a plan's start to its close, read in Hedgie Care by
 * admins and community managers, with an audit entry) and is the same promise as /privacy, "Messages in a Hedgie Care plan"; change
 * them together. Slack's own app shows no such line.
 */
export default function CarePlanNotice() {
  return (
    <PageBanner>
      Our community manager and admins can read what is sent in this conversation during a Hedgie Care plan, our way of staying in touch with members.{" "}
      <Link href="/privacy#care-plan-messages" className="underline">
        How we handle messages
      </Link>
    </PageBanner>
  );
}
