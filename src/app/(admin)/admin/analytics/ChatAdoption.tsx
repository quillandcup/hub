import { getMemberDisplayName } from "@/lib/member-display-name";

export interface ChatWeekRow {
  week_start: string;
  hub_messages: number;
  slack_messages: number;
  hub_authors: number;
  slack_authors: number;
}

export interface ChatPersonRow {
  member_id: string;
  name: string;
  display_name: string | null;
  hub_messages: number;
  slack_messages: number;
}

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

const weekLabel = (weekStart: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${weekStart}T00:00:00Z`));

const PEOPLE_SHOWN = 10;

/**
 * How much of what members write is written in the Hub and how much in Slack: in total, by week and per person.
 * Counts only (the database function leaves out content, deleted and system messages and restricted
 * conversations). The share of messages is the adoption number; the people split shows whether the Hub is
 * used by a few or by most of those who write.
 */
export function ChatAdoption({ weekly, people, days }: { weekly: ChatWeekRow[]; people: ChatPersonRow[]; days: number }) {
  const hub = weekly.reduce((sum, w) => sum + w.hub_messages, 0);
  const slack = weekly.reduce((sum, w) => sum + w.slack_messages, 0);
  const onlyHub = people.filter((p) => p.hub_messages > 0 && p.slack_messages === 0).length;
  const both = people.filter((p) => p.hub_messages > 0 && p.slack_messages > 0).length;
  const onlySlack = people.filter((p) => p.hub_messages === 0 && p.slack_messages > 0).length;
  const writers = people.length;
  const top = people.slice(0, PEOPLE_SHOWN);

  return (
    <section aria-label="Chat adoption" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Chat: Hub or Slack</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Messages written in the Hub against messages written in Slack, in the last {days} days. Counts only; direct messages and restricted channels are left out.
        </p>
      </div>

      {hub + slack === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No messages in this window.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <dt className="text-xs text-slate-500 dark:text-slate-400">Written in the Hub</dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{percent(hub, hub + slack)}</dd>
              <dd className="text-xs text-slate-500 dark:text-slate-400">
                {hub} of {hub + slack} messages
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <dt className="text-xs text-slate-500 dark:text-slate-400">People who wrote in the Hub</dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{percent(onlyHub + both, writers)}</dd>
              <dd className="text-xs text-slate-500 dark:text-slate-400">
                {onlyHub + both} of {writers} people who wrote ({onlyHub} only in the Hub, {both} in both, {onlySlack} only in Slack)
              </dd>
            </div>
          </dl>

          <table className="w-full text-sm">
            <caption className="mb-1 text-left text-sm font-medium text-slate-700 dark:text-slate-300">By week (starting Sunday)</caption>
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-1 pr-3 font-medium">Week of</th>
                <th className="py-1 pr-3 font-medium">Hub</th>
                <th className="py-1 pr-3 font-medium">Slack</th>
                <th className="py-1 font-medium">Hub share</th>
              </tr>
            </thead>
            <tbody>
              {weekly.map((w) => (
                <tr key={w.week_start} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3">{weekLabel(w.week_start)}</td>
                  <td className="py-1 pr-3">
                    {w.hub_messages} <span className="text-xs text-slate-500 dark:text-slate-400">({w.hub_authors} people)</span>
                  </td>
                  <td className="py-1 pr-3">
                    {w.slack_messages} <span className="text-xs text-slate-500 dark:text-slate-400">({w.slack_authors} people)</span>
                  </td>
                  <td className="py-1">{percent(w.hub_messages, w.hub_messages + w.slack_messages)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="w-full text-sm">
            <caption className="mb-1 text-left text-sm font-medium text-slate-700 dark:text-slate-300">
              By person (the {Math.min(PEOPLE_SHOWN, writers)} who wrote most)
            </caption>
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-1 pr-3 font-medium">Member</th>
                <th className="py-1 pr-3 font-medium">Messages</th>
                <th className="py-1 font-medium">In the Hub</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.member_id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3">{getMemberDisplayName({ name: p.name, display_name: p.display_name })}</td>
                  <td className="py-1 pr-3">{p.hub_messages + p.slack_messages}</td>
                  <td className="py-1">
                    {percent(p.hub_messages, p.hub_messages + p.slack_messages)} <span className="text-xs text-slate-500 dark:text-slate-400">({p.hub_messages})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
