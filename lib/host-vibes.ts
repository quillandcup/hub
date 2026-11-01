import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { PICKER_HISTORY_MONTHS } from "@/lib/prickle-picker";
import { getMonthStart } from "@/lib/prickle-schedules";

/** Types a member can configure: recent/upcoming prickles and active current/future host signups. */
export async function getHostVibeTypes(supabase: Db, memberId: string): Promise<Map<string, string>> {
  const now = new Date();
  const historyStart = new Date(now);
  historyStart.setMonth(historyStart.getMonth() - PICKER_HISTORY_MONTHS);

  const repos = createRepos(supabase);
  const [prickles, schedules] = await Promise.all([
    repos.prickles.hostedTypesSince(memberId, historyStart.toISOString()),
    repos.prickleSchedules.scheduledTypesOf(memberId, getMonthStart(now).toISOString().slice(0, 10)),
  ]);
  return new Map([...prickles, ...schedules].map((t) => [t.typeId, t.typeName]));
}
