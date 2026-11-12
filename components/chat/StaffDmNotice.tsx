import Link from "next/link";
import PageBanner from "@/components/PageBanner";

/**
 * The line at the top of a direct or group message that has a member of the Quill & Cup team in it: the whole team (every
 * admin and community manager) can read it, with no special access. Everyone in the conversation sees it, so nobody is
 * surprised. A person from the team who is reading it without being in it is told that their reading is recorded.
 * What it says rests on `chat_staff_can_read_dm` and `chat_log_staff_dm_read` (20270705000000) and is the same promise as
 * /privacy, "Direct messages with the Quill & Cup team"; change them together. Slack's own app shows no such line.
 */
export default function StaffDmNotice({ staffReader }: { staffReader: boolean }) {
  return (
    <PageBanner>
      {staffReader
        ? "You're reading this as a member of the team, and you're not in it. That you opened it is recorded in the audit log, without the messages."
        : "Someone from the Quill & Cup team is in this conversation, so the team can read it."}{" "}
      <Link href="/privacy#staff-messages" className="underline">
        How we handle messages
      </Link>
    </PageBanner>
  );
}
