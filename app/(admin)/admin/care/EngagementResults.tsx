import type { CareResults, CareWindowName, CareWindowResult } from "@/lib/care";
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

/** An engagement's three windows, side by side: what they did before, while she was in touch, and a month or two after. */
export default function EngagementResults({ results }: { results: CareResults }) {
  return (
    <div className="mt-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <caption className="sr-only">What the member did before, during and after this engagement</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400">
              <th scope="col" className="py-1 pr-3 font-medium">Window</th>
              <th scope="col" className="py-1 pr-3 font-medium">Prickles</th>
              <th scope="col" className="py-1 pr-3 font-medium">Slack messages</th>
              <th scope="col" className="py-1 pr-3 font-medium">Firsts</th>
              <th scope="col" className="py-1 font-medium">People connected</th>
            </tr>
          </thead>
          <tbody>
            {(["before", "during", "after"] as const).map((name) => {
              const result = results[name];
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
                      <td className="py-1.5">{result.counts.peopleConnected}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="py-1.5 text-slate-600 dark:text-slate-400">
                      Not yet
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        Some members come back without being asked, and the numbers are small, so read each one as a story, not a score. People connected counts
        the members they talked with or reacted to (not staff), as far back as the Hub&apos;s chat history goes.
      </p>
    </div>
  );
}
