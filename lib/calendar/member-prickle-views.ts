export function buildMemberPrickleViews(
  prickles: any[],
  attendedIds: Set<string>,
  countByPrickle: Map<string, number>
) {
  return prickles
    .filter((p: any) => attendedIds.has(p.id))
    .map((p: any) => ({
      id: p.id,
      start_time: p.start_time,
      end_time: p.end_time,
      prickle_type: p.prickle_types?.name ?? "Unknown",
      attendance_count: countByPrickle.get(p.id) ?? 1,
      host: "",
      host_id: undefined,
      host_missing: false,
      host_late: false,
    }));
}
