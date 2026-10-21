import Link from "next/link";
import type { MentorStats, PeriodStats } from "@/lib/mentorship";
import { parseDateOnly } from "@/lib/member-tenure";

function percent(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow px-5 py-4">
      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mt-1">{label}</div>
    </div>
  );
}

const TH = "px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider";
const TD = "px-6 py-3 text-sm text-slate-600 dark:text-slate-400";

/** Conversion of trial members by big sister and over time. Counts only trials that have been
 * decided (converted or not), so a trial still in its first weeks doesn't drag a rate down. */
export default function EffectivenessPanel({
  overall,
  periods,
  mentors,
}: {
  overall: Omit<PeriodStats, "period">;
  periods: PeriodStats[];
  mentors: MentorStats[];
}) {
  return (
    <div className="space-y-8">
      <div className="@container">
        <div className="grid grid-cols-2 @2xl:grid-cols-6 gap-4">
        <Stat label="Matches" value={overall.total} />
        <Stat label="No trial" value={overall.noTrial} />
        <Stat label="Trials converted" value={overall.converted} />
        <Stat label="Did not convert" value={overall.notConverted} />
        <Stat label="Trials in progress" value={overall.inTrial} />
        <Stat label="Conversion rate" value={percent(overall.conversionRate)} />
      </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 -mt-4">
        Conversion rate is for trials only: converted ÷ (converted + did not convert), with trials still in progress left
        out. New members who joined without a trial (a direct sign-up, a rejoin, a program) are counted in Matches and
        "No trial" but have nothing to convert. With few trials per big sister, read a single rate as a hint, not a
        verdict.
      </p>

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">By quarter</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Grouped by when the trial started.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className={TH}>Quarter</th>
                <th className={TH}>Matches</th>
                <th className={TH}>Trials converted</th>
                <th className={TH}>Did not convert</th>
                <th className={TH}>In trial</th>
                <th className={TH}>No trial</th>
                <th className={TH}>Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {periods.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                    No matches yet.
                  </td>
                </tr>
              )}
              {periods.map((p) => (
                <tr key={p.period}>
                  <td className={`${TD} font-medium text-slate-900 dark:text-slate-100`}>{p.period}</td>
                  <td className={TD}>{p.total}</td>
                  <td className={TD}>{p.converted}</td>
                  <td className={TD}>{p.notConverted}</td>
                  <td className={TD}>{p.inTrial}</td>
                  <td className={TD}>{p.noTrial}</td>
                  <td className={TD}>{percent(p.conversionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">By big sister</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            “Current members” is how many of the converted are active (or on hiatus) today.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className={TH}>Big sister</th>
                <th className={TH}>Matches</th>
                <th className={TH}>Trials converted</th>
                <th className={TH}>Did not convert</th>
                <th className={TH}>In trial</th>
                <th className={TH}>No trial</th>
                <th className={TH}>Rate</th>
                <th className={TH}>Current members</th>
                <th className={TH}>Last match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {mentors.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                    No matches yet.
                  </td>
                </tr>
              )}
              {mentors.map((m) => (
                <tr key={m.mentorMemberId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className={`${TD} font-medium`}>
                    <Link
                      href={`/admin/members/${m.mentorMemberId}`}
                      className="text-plum-600 dark:text-plum-400 hover:underline"
                    >
                      {m.mentorName}
                    </Link>
                  </td>
                  <td className={TD}>{m.total}</td>
                  <td className={TD}>{m.converted}</td>
                  <td className={TD}>{m.notConverted}</td>
                  <td className={TD}>{m.inTrial}</td>
                  <td className={TD}>{m.noTrial}</td>
                  <td className={TD}>{percent(m.conversionRate)}</td>
                  <td className={TD}>{m.currentMembers}</td>
                  <td className={TD}>{parseDateOnly(m.lastStartedOn).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
