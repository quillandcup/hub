import type { SupabaseClient } from "@supabase/supabase-js";
import { PICKER_HISTORY_MONTHS } from "@/lib/prickle-picker";
import { getMonthStart } from "@/lib/prickle-schedules";

/** Types a member can configure: recent/upcoming prickles and active current/future host signups. */
export async function getHostVibeTypes(supabase: SupabaseClient, memberId: string): Promise<Map<string, string>> {
  const now = new Date();
  const historyStart = new Date(now);
  historyStart.setMonth(historyStart.getMonth() - PICKER_HISTORY_MONTHS);
  const batchSize = 1000;

  const load = async (source: "prickles" | "prickle_schedules") => {
    const types = new Map<string, string>();
    for (let offset = 0; ; offset += batchSize) {
      const query = supabase.from(source).select("type_id, prickle_types!inner(id, name)");
      const scoped = source === "prickles"
        ? query.eq("host", memberId).gte("start_time", historyStart.toISOString())
        : query.eq("host_id", memberId).gte("month", getMonthStart(now).toISOString().slice(0, 10))
          .in("status", ["proposed", "confirmed"]).is("deleted_at", null);
      const { data } = await scoped.order("id").range(offset, offset + batchSize - 1);
      for (const row of data ?? []) {
        const type = Array.isArray(row.prickle_types) ? row.prickle_types[0] : row.prickle_types;
        if (row.type_id && type) types.set(row.type_id, type.name);
      }
      if (!data || data.length < batchSize) break;
    }
    return types;
  };

  const [prickles, schedules] = await Promise.all([load("prickles"), load("prickle_schedules")]);
  return new Map([...prickles, ...schedules]);
}
