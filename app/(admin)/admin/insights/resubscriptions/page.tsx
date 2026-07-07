import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ResubscriptionsChart from "./ResubscriptionsChart";
import { fetchResubscriptionsData } from "@/lib/resubscription-data";
import type { ResubscribingMember } from "@/lib/resubscription-data";

export const maxDuration = 60;

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function GapBadge({ days }: { days: number }) {
  const months = Math.round(days / 30);
  const label = months < 1 ? `${days}d gap` : months === 1 ? "1 mo gap" : `${months} mo gap`;
  return (
    <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">({label})</span>
  );
}

function MemberRow({ member }: { member: ResubscribingMember }) {
  const profileHref = member.memberId ? `/admin/members/${member.memberId}` : null;

  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {profileHref ? (
            <Link href={profileHref} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
              {member.memberName}
            </Link>
          ) : (
            <span className="font-medium text-slate-700 dark:text-slate-300">{member.memberName}</span>
          )}
          {member.isCurrentlyActive ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
              active
            </span>
          ) : (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
              cancelled
            </span>
          )}
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{member.memberEmail}</div>
      </td>
      <td className="px-4 py-3 text-center text-sm font-medium text-slate-700 dark:text-slate-300">
        {member.resubscriptions.length}
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1">
          {member.resubscriptions.map((event, i) => (
            <div key={i} className="text-sm text-slate-600 dark:text-slate-400">
              <span className="text-slate-400 dark:text-slate-500 text-xs">Cancelled</span>{" "}
              {formatDate(event.cancelledAt)}
              <span className="mx-2 text-slate-300 dark:text-slate-600">→</span>
              <span className="text-slate-400 dark:text-slate-500 text-xs">Rejoined</span>{" "}
              <span className="text-green-600 dark:text-green-400 font-medium">{formatDate(event.resubscribedAt)}</span>
              <GapBadge days={event.gapDays} />
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

export default async function ResubscriptionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await fetchResubscriptionsData(supabase);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Cancellations &amp; Resubscriptions
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Members who cancelled and later rejoined — a signal of re-engagement over time.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-8">
        <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard
                value={data.totalResubscribingMembers}
                label="Members who resubscribed"
                sub="at least once after cancelling"
              />
              <StatCard
                value={pct(data.totalResubscribingMembers, data.totalMembersEver)}
                label="of all members"
                sub={`out of ${data.totalMembersEver} total members`}
                isText
              />
            </div>

            {/* Cohort chart */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">
                Resubscriptions by Month
              </h2>
              <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
                When former members rejoined. An upward trend suggests improving re-engagement.
              </p>
              <ResubscriptionsChart data={data.cohortByMonth} />
            </div>

            {/* Member table */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                  Resubscribing Members
                </h2>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  {data.members.length} member{data.members.length !== 1 ? "s" : ""} with at least one resubscription
                </p>
              </div>

              {data.members.length === 0 ? (
                <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                  No resubscriptions found yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Member
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Times
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          History
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.members.map((member) => (
                        <MemberRow key={member.memberEmail} member={member} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
        </>
      </main>
    </div>
  );
}

function StatCard({
  value,
  label,
  sub,
  isText,
}: {
  value: number | string;
  label: string;
  sub?: string;
  isText?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 text-center">
      <div className={`text-4xl font-bold text-blue-600 dark:text-blue-400 ${isText ? "" : "tabular-nums"}`}>{value}</div>
      <div className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-1">{label}</div>
      {sub && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
