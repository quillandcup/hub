import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getViewerTimeZone } from "@/lib/timezone";
import ZoomMeetingsReview from "./ZoomMeetingsReview";

export const metadata: Metadata = {
  title: "Zoom Meetings",
};

export const dynamic = "force-dynamic";

export default async function ZoomMeetingsPage() {
  await requireAdminPage();
  const timeZone = await getViewerTimeZone();
  const zoom = createRepos(await createClient()).zoom;
  const [accounts, meetings] = await Promise.all([zoom.accounts(), zoom.reviewMeetings()]);
  const labels = new Map(accounts.map((a) => [a.id, a.label]));
  const reviewed = accounts.filter((a) => a.defaultPolicy === "exclude");

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Zoom Meetings</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Meetings from Zoom accounts that are not all community business. Until you keep one, it makes no prickle, no attendance and no
          member match; ignoring it keeps it out. Nothing is deleted, so you can change your mind.
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
          {reviewed.length === 0
            ? "Every Zoom account is set to keep its meetings, so there is nothing to review."
            : `Accounts reviewed here: ${reviewed.map((a) => a.label).join(", ")}.`}
        </p>
      </div>
      <ZoomMeetingsReview
        timeZone={timeZone}
        accounts={reviewed.map((a) => ({ id: a.id, label: a.label }))}
        rows={meetings.map((m) => ({
          zoomAccount: m.zoomAccount,
          accountLabel: labels.get(m.zoomAccount) ?? "Unknown account",
          meetingUuid: m.meetingUuid,
          meetingId: m.meetingId,
          topic: m.topic,
          startTime: m.startTime,
          participantCount: m.participantCount,
          state: m.state,
        }))}
      />
    </div>
  );
}
