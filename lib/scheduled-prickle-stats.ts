export interface PrickleType {
  id: string;
  name: string;
}

export interface Prickle {
  id: string;
  type_id: string | null;
  start_time: string;
}

export interface AttendanceRow {
  prickle_id: string;
  member_id: string;
}

export interface TypeStats {
  typeId: string;
  typeName: string;
  sessions: number;
  min: number;
  mean: number;
  max: number;
  mode: number;
  sparkline: number[]; // last <=12 sessions, oldest to newest
  lastSession: string; // ISO date string
}

export function computeScheduledPrickleStats(
  types: PrickleType[],
  prickles: Prickle[],
  attendance: AttendanceRow[]
): TypeStats[] {
  // Build per-prickle distinct member count
  const attendanceByPrickle = new Map<string, Set<string>>();
  for (const row of attendance) {
    if (!attendanceByPrickle.has(row.prickle_id)) {
      attendanceByPrickle.set(row.prickle_id, new Set());
    }
    attendanceByPrickle.get(row.prickle_id)!.add(row.member_id);
  }

  // Group prickles by type_id (skip those with no type)
  const pricklesByType = new Map<string, Prickle[]>();
  for (const p of prickles) {
    if (!p.type_id) continue;
    if (!pricklesByType.has(p.type_id)) {
      pricklesByType.set(p.type_id, []);
    }
    pricklesByType.get(p.type_id)!.push(p);
  }

  const results: TypeStats[] = [];

  for (const type of types) {
    const typePrickles = pricklesByType.get(type.id) ?? [];
    if (typePrickles.length === 0) continue; // hide types with no sessions

    // Sorted oldest to newest
    const sorted = [...typePrickles].sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    // Per-prickle attendance counts (distinct members)
    const counts = sorted.map(
      (p) => attendanceByPrickle.get(p.id)?.size ?? 0
    );

    const sessions = counts.length;
    const minVal = Math.min(...counts);
    const maxVal = Math.max(...counts);
    const meanVal = counts.reduce((s, c) => s + c, 0) / sessions;

    // Mode: most common attendance count
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modeVal = counts[0];
    let modeFreq = 0;
    for (const [val, f] of freq) {
      if (f > modeFreq) {
        modeFreq = f;
        modeVal = val;
      }
    }

    // Sparkline: last <=12 sessions
    const sparkline = counts.slice(-12);

    const lastSession = sorted[sorted.length - 1].start_time;

    results.push({
      typeId: type.id,
      typeName: type.name,
      sessions,
      min: minVal,
      mean: meanVal,
      max: maxVal,
      mode: modeVal,
      sparkline,
      lastSession,
    });
  }

  // Sort by session count descending
  results.sort((a, b) => b.sessions - a.sessions);

  return results;
}
