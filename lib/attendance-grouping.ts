// Attendance allows multiple records per (member_id, prickle_id) to track
// leave/rejoin patterns (see supabase/migrations/20260406181048_allow_multiple_attendance_per_prickle.sql
// and CLAUDE.md) — use COUNT(DISTINCT prickle_id) to count unique prickles attended.
export function countDistinctPrickles(records: any[]): number {
  const prickleIds = new Set<string>();
  for (const record of records) {
    const prickle = Array.isArray(record.prickles) ? record.prickles[0] : record.prickles;
    const key = prickle?.id ?? record.prickle_id;
    if (key) prickleIds.add(key);
  }
  return prickleIds.size;
}
