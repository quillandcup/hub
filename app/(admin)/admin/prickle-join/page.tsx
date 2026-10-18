import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { ORG_TIMEZONE } from "@/lib/config";
import { firstOfNextMonth, joinAt, loadPrickleJoinSettings, tomorrowIn } from "@/lib/prickle-join";
import PrickleJoinForm from "./PrickleJoinForm";
import RemoveScheduledButton from "./RemoveScheduledButton";

export const metadata: Metadata = {
  title: "Prickle Zoom Link",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: ORG_TIMEZONE, dateStyle: "medium", timeStyle: "short" });

export default async function PrickleJoinPage() {
  await requireAdminPage();
  const settings = await loadPrickleJoinSettings(await createClient());
  const now = Date.now();
  const current = joinAt(settings);

  return (
    <div className="container mx-auto space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Prickle Zoom Link</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          The room link, meeting ID and passcode members see after checking in, in check-in DMs, and in their calendar feed. Each prickle uses the
          link in effect when it starts, so a change never alters earlier prickles. Remember to update the daily #prickle-times post too.
        </p>
      </div>
      <PrickleJoinForm
        url={current?.url ?? ""} meetingId={current?.meetingId ?? ""} passcode={current?.passcode ?? ""} timeZone={ORG_TIMEZONE}
        defaultStartDate={firstOfNextMonth(new Date(now), ORG_TIMEZONE)}
        minStartDate={tomorrowIn(new Date(now), ORG_TIMEZONE)}
      />
      {settings.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">History</h2>
          <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
            {settings.map((s, i) => {
              const scheduled = new Date(s.effectiveFrom).getTime() > now;
              // `settings` is newest first, so the row above is the one that replaces this.
              const until = i > 0 ? `to ${when(settings[i - 1].effectiveFrom)}` : "onward";
              return (
                <li key={s.id}>
                  {when(s.effectiveFrom)} {until}: meeting ID {s.meetingId ?? "none"}, passcode {s.passcode ?? "none"}
                  {scheduled && " (scheduled)"}
                  {scheduled && <RemoveScheduledButton id={s.id} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
