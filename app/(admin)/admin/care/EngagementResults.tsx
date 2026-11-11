import { CARE_MEMBERSHIP_LABELS, type CareResults, type CareWindowName, type CareWindowResult } from "@/lib/care";
import { ORG_TIMEZONE } from "@/lib/config";

const NAMES: Record<CareWindowName, string> = { before: "Before", during: "During", after: "After" };

const day = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, month: "short", day: "numeric" });
const fullDay = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, month: "short", day: "numeric", year: "numeric" });

/** The window as dates: its first day to its last (the window ends where the next day starts, so the last day is a moment earlier). */
function range({ window }: CareWindowResult): string {
  const last = new Date(Date.parse(window.to) - 1);
  return `${day.format(new Date(window.from))} to ${fullDay.format(last)}`;
}

function firsts({ counts }: CareWindowResult): string {
  if (!counts) return "";
  const found = [counts.firstPrickle && "first prickle", counts.firstSlackPost && "first Slack post"].filter(Boolean);
  return found.length ? found.join(", ") : "None";
}

const TH = "py-1 pr-3 font-medium";

/**
 * An engagement's results: three windows side by side (what they did before, while she was in touch, and a month or two
 * after), then how they stayed: active, on hiatus or cancelled at each checkpoint after the period, the first time they went on
 * hiatus or left, and the programs they held. The three states are shown as they are, never as one weighted number.
 */
export default function EngagementResults({ results }: { results: CareResults }) {
  const { windows, retention } = results;
  return (
    <div className="mt-3 space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">What the member did before, during and after this engagement</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <th scope="col" className={TH}>Window</th>
              <th scope="col" className={TH}>Prickles</th>
              <th scope="col" className={TH}>Slack messages</th>
              <th scope="col" className={TH}>Firsts</th>
              <th scope="col" className={TH}>People connected</th>
              <th scope="col" className="py-1 font-medium">Programs started</th>
            </tr>
          </thead>
          <tbody>
            {(["before", "during", "after"] as const).map((name) => {
              const result = windows[name];
              return (
                <tr key={name} className="border-b border-slate-100 align-top dark:border-slate-800">
                  <th scope="row" className="py-1.5 pr-3 font-medium">
                    {NAMES[name]}
                    <span className="block text-xs font-normal text-slate-600 dark:text-slate-400">
                      {range(result)}
                      {result.window.state === "so_far" && " (so far)"}
                    </span>
                  </th>
                  {result.counts ? (
                    <>
                      <td className="py-1.5 pr-3">{result.counts.pricklesAttended}</td>
                      <td className="py-1.5 pr-3">{result.counts.slackMessages}</td>
                      <td className="py-1.5 pr-3">{firsts(result)}</td>
                      <td className="py-1.5 pr-3">{result.counts.peopleConnected}</td>
                      <td className="py-1.5">{result.counts.programsStarted.length ? result.counts.programsStarted.join("; ") : "None"}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="py-1.5 text-slate-600 dark:text-slate-400">
                      Not yet
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <caption className="sr-only">Whether the member stayed, at each checkpoint after the period</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <th scope="col" className={TH}>Staying</th>
              <th scope="col" className={TH}>Membership</th>
              <th scope="col" className="py-1 font-medium">Program held</th>
            </tr>
          </thead>
          <tbody>
            {retention.checkpoints.map((c) => (
              <tr key={c.days} className="border-b border-slate-100 align-top dark:border-slate-800">
                <th scope="row" className="py-1.5 pr-3 font-medium">
                  {c.days} days after the period
                  <span className="block text-xs font-normal text-slate-600 dark:text-slate-400">{fullDay.format(new Date(c.at))}</span>
                </th>
                {c.membership ? (
                  <>
                    <td className="py-1.5 pr-3">{CARE_MEMBERSHIP_LABELS[c.membership]}</td>
                    <td className="py-1.5">{c.programs && c.programs.length ? c.programs.join("; ") : "None"}</td>
                  </>
                ) : (
                  <td colSpan={2} className="py-1.5 text-slate-600 dark:text-slate-400">
                    Not yet
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm">
          {retention.firstLapse
            ? `First ${retention.firstLapse.status === "on_hiatus" ? "went on hiatus" : "cancelled"}: ${retention.firstLapse.daysAfterStart} ${retention.firstLapse.daysAfterStart === 1 ? "day" : "days"} after it started (${fullDay.format(new Date(retention.firstLapse.at))}), even if they came back.`
            : "Has not gone on hiatus or cancelled since it started."}
        </p>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400">
        These describe what happened; they do not show the outreach caused it. Some members come back without being asked, and the numbers are
        small, so read each one as a story, not a score. Active, on hiatus and cancelled come from their membership history (a member on
        hiatus has not left, and has not stayed either), and people connected counts the members they talked with or reacted to (not
        staff), all as far back as the Hub&apos;s records go.
      </p>
    </div>
  );
}
