export interface PrickleType {
  id: string;
  name: string;
  normalized_name?: string;
}

export interface Prickle {
  id: string;
  type_id: string | null;
  start_time: string;
}

export interface PrickleWithHost extends Prickle {
  host: { id: string; name: string } | { id: string; name: string }[] | null;
}

export interface AttendanceRow {
  prickle_id: string;
  member_id: string;
}

export interface PrickleSession {
  id: string;
  startTime: string;
  hostName: string | null;
  attendeeNames: string[];
  attendeeCount: number;
}

export interface TypeStats {
  typeId: string;
  typeName: string;
  normalizedName: string;
  sessions: number;
  min: number;
  median: number;
  mean: number;
  max: number;
  sparkline: number[]; // all sessions in the time window, sampled to <=20 points, oldest to newest
  lastSession: string; // ISO date string
}

export interface GroupStats {
  groupKey: string;
  groupLabel: string;
  sessions: number;
  min: number;
  median: number;
  mean: number;
  max: number;
  sparkline: number[];
  lastSession: string;
  prickleSessions: PrickleSession[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildAttendanceMap(attendance: AttendanceRow[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const row of attendance) {
    if (!map.has(row.prickle_id)) map.set(row.prickle_id, new Set());
    map.get(row.prickle_id)!.add(row.member_id);
  }
  return map;
}

type CoreStats = {
  sessions: number;
  min: number;
  median: number;
  mean: number;
  max: number;
  sparkline: number[];
  lastSession: string;
};

function sampleSparkline(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const bucketSize = values.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
    const bucket = values.slice(start, end);
    return bucket.reduce((s, v) => s + v, 0) / bucket.length;
  });
}

function computeCoreStats(
  prickles: Prickle[],
  attendanceMap: Map<string, Set<string>>
): CoreStats | null {
  if (prickles.length === 0) return null;

  const sorted = [...prickles].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  const counts = sorted.map((p) => attendanceMap.get(p.id)?.size ?? 0);
  const sessions = counts.length;
  const minVal = Math.min(...counts);
  const maxVal = Math.max(...counts);
  const meanVal = counts.reduce((s, c) => s + c, 0) / sessions;

  const sorted2 = [...counts].sort((a, b) => a - b);
  const mid = Math.floor(sorted2.length / 2);
  const medianVal =
    sorted2.length % 2 === 1
      ? sorted2[mid]
      : (sorted2[mid - 1] + sorted2[mid]) / 2;

  return {
    sessions,
    min: minVal,
    median: medianVal,
    mean: meanVal,
    max: maxVal,
    sparkline: sampleSparkline(counts, 20),
    lastSession: sorted[sorted.length - 1].start_time,
  };
}

// ---------------------------------------------------------------------------
// Per-type stats (main insights page)
// ---------------------------------------------------------------------------

export function computeScheduledPrickleStats(
  types: PrickleType[],
  prickles: Prickle[],
  attendance: AttendanceRow[]
): TypeStats[] {
  const attendanceMap = buildAttendanceMap(attendance);

  const pricklesByType = new Map<string, Prickle[]>();
  for (const p of prickles) {
    if (!p.type_id) continue;
    if (!pricklesByType.has(p.type_id)) pricklesByType.set(p.type_id, []);
    pricklesByType.get(p.type_id)!.push(p);
  }

  const results: TypeStats[] = [];

  for (const type of types) {
    const typePrickles = pricklesByType.get(type.id) ?? [];
    if (typePrickles.length === 0) continue;

    const stats = computeCoreStats(typePrickles, attendanceMap);
    if (!stats) continue;

    results.push({
      typeId: type.id,
      typeName: type.name,
      normalizedName: type.normalized_name ?? "",
      ...stats,
    });
  }

  results.sort((a, b) => b.sessions - a.sessions);
  return results;
}

// ---------------------------------------------------------------------------
// Schedule slot helpers (ET timezone)
// ---------------------------------------------------------------------------

const DAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function getScheduleSlot(startTime: string): { sortKey: string; label: string } {
  const dt = new Date(startTime);

  const weekdayLong = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(dt);

  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(dt);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);

  const dayAbbr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const dayNum = DAY_ORDER.indexOf(dayAbbr as (typeof DAY_ORDER)[number]);

  return {
    sortKey: `${String(dayNum)}-${hour}:${minute}`,
    label: `${weekdayLong}s at ${timeLabel} ET`,
  };
}

// ---------------------------------------------------------------------------
// Grouped stats (detail page: by schedule or by host)
// ---------------------------------------------------------------------------

export function computeGroupedPrickleStats(
  prickles: PrickleWithHost[],
  attendance: AttendanceRow[],
  groupBy: "schedule" | "host",
  memberNameMap: Map<string, string> = new Map()
): GroupStats[] {
  const attendanceMap = buildAttendanceMap(attendance);

  const groups = new Map<string, { label: string; prickles: PrickleWithHost[] }>();

  for (const p of prickles) {
    let sortKey: string;
    let label: string;

    if (groupBy === "schedule") {
      const slot = getScheduleSlot(p.start_time);
      sortKey = slot.sortKey;
      label = slot.label;
    } else {
      const host = Array.isArray(p.host) ? p.host[0] : p.host;
      if (!host) {
        sortKey = "zzz-no-host";
        label = "No Host Assigned";
      } else {
        sortKey = host.name.toLowerCase();
        label = host.name;
      }
    }

    if (!groups.has(sortKey)) groups.set(sortKey, { label, prickles: [] });
    groups.get(sortKey)!.prickles.push(p);
  }

  const results: GroupStats[] = [];

  for (const [sortKey, group] of groups) {
    const stats = computeCoreStats(group.prickles, attendanceMap);
    if (!stats) continue;

    const sortedPrickles = [...group.prickles].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    const prickleSessions: PrickleSession[] = sortedPrickles.map((p) => {
      const host = Array.isArray(p.host) ? p.host[0] : p.host;
      const attendeeIds = attendanceMap.get(p.id) ?? new Set<string>();
      const attendeeNames = [...attendeeIds]
        .map((id) => memberNameMap.get(id) ?? id)
        .sort((a, b) => a.localeCompare(b));
      return {
        id: p.id,
        startTime: p.start_time,
        hostName: host?.name ?? null,
        attendeeNames,
        attendeeCount: attendeeIds.size,
      };
    });

    results.push({ groupKey: sortKey, groupLabel: group.label, ...stats, prickleSessions });
  }

  results.sort((a, b) => a.groupKey.localeCompare(b.groupKey));
  return results;
}
