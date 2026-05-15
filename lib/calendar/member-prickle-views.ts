import type { Prickle } from "@/components/CalendarWeekView";

interface RawPrickleRow {
  id: string;
  start_time: string;
  end_time: string;
  prickle_types: { name: string }[] | null;
}

export function buildMemberPrickleViews(
  prickles: RawPrickleRow[],
  attendedIds: Set<string>,
  countByPrickle: Map<string, number>
): Prickle[] {
  return prickles
    .filter((p) => attendedIds.has(p.id))
    .map((p) => ({
      id: p.id,
      start_time: p.start_time,
      end_time: p.end_time,
      prickle_type: p.prickle_types?.[0]?.name ?? "Unknown",
      attendance_count: countByPrickle.get(p.id) ?? 1,
      host: "",
      host_id: undefined,
      host_missing: false,
      host_late: false,
    }));
}
