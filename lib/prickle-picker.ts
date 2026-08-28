import { buildAttendanceMap, getScheduleSlot } from "@/lib/scheduled-prickle-stats";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PrickleTypePurpose = "writing" | "work" | "social" | "mixed";
export type Vibe = "focused" | "balanced" | "chatty";
export type TimeOfDay = "any" | "morning" | "afternoon" | "evening" | "late_night";
export type VibePreference = "any" | Vibe;
export type PurposePreference = "any" | Exclude<PrickleTypePurpose, "mixed">;

export interface PickerPrickleType {
  id: string;
  name: string;
  purpose: PrickleTypePurpose;
  /**
   * Can a hedgie bring an unrelated task (esp. non-writing work) here and just
   * use it as protected time? Orthogonal to `purpose` -- e.g. Progress
   * Prickle (writing) is friendly, Sprint Prickle (writing) is not, Monthly
   * Goal Review (work) is not.
   */
  soloTaskFriendly: boolean;
}

export interface PickerHost {
  id: string;
  name: string;
}

export interface CandidatePrickle {
  id: string;
  type_id: string | null;
  host_id: string | null;
  start_time: string;
}

export interface HistoricalAttendanceRow {
  prickle_id: string;
  member_id: string;
}

export interface HostVibeRow {
  type_id: string;
  host_id: string;
  vibe: Vibe;
  notes: string | null;
}

export interface PickerAnswers {
  /** ISO datetime, inclusive lower bound on start_time */
  windowStart: string;
  /** ISO datetime, inclusive upper bound on start_time */
  windowEnd: string;
  timeOfDay: TimeOfDay;
  vibe: VibePreference;
  purpose: PurposePreference;
  /** Member IDs the hedgie wants to see there; empty = no preference */
  withMemberIds: string[];
  /** IANA timezone used only for time-of-day bucketing */
  timezone: string;
}

export interface PickerRecommendation {
  seriesKey: string;
  typeId: string | null;
  typeName: string;
  hostId: string | null;
  hostName: string | null;
  purpose: PrickleTypePurpose;
  scheduleLabel: string;
  vibe: Vibe | "unknown";
  vibeSource: "tagged" | "inferred" | "unknown";
  vibeNotes: string | null;
  avgAttendance: number | null;
  sessionCount: number;
  coAttendanceRate: number | null;
  score: number;
  occurrences: { id: string; startTime: string }[];
}

const DEFAULT_TIMEZONE = "America/New_York";

// Heuristic thresholds used only when a series has no explicit host vibe tag.
// Never a hard filter — always a low-confidence nudge.
export const INFERRED_VIBE_THRESHOLDS = { focusedMax: 3, chattyMin: 8 };

const WEIGHT_CO_ATTENDANCE = 3;
const WEIGHT_VIBE = 1.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function seriesKeyFor(typeId: string | null, hostId: string | null): string {
  return `${typeId ?? "notype"}:${hostId ?? "nohost"}`;
}

function getHourBucket(iso: string, timezone: string): Exclude<TimeOfDay, "any"> {
  const tz = timezone && timezone !== "browser" ? timezone : DEFAULT_TIMEZONE;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  }).format(new Date(iso));
  const hour = Number(formatted) % 24;

  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "late_night";
}

function passesTimeOfDayFilter(startTime: string, timeOfDay: TimeOfDay, timezone: string): boolean {
  if (timeOfDay === "any") return true;
  return getHourBucket(startTime, timezone) === timeOfDay;
}

function withinWindow(startTime: string, windowStart: string, windowEnd: string): boolean {
  const t = new Date(startTime).getTime();
  return t >= new Date(windowStart).getTime() && t <= new Date(windowEnd).getTime();
}

function passesPurposeFilter(
  preference: PurposePreference,
  purpose: PrickleTypePurpose,
  soloTaskFriendly: boolean
): boolean {
  if (preference === "any") return true;
  if (preference === "work") {
    // "Non-writing work" means protected solo time for an unrelated task —
    // not attending an on-topic structured session. Monthly Goal Review is
    // thematically "work" but is a workshop following the host's agenda, so
    // it's excluded here even though its purpose label matches; Progress
    // Prickle (purpose=writing) is included because it's genuinely open time.
    return soloTaskFriendly;
  }
  if (purpose === "mixed") return true;
  return purpose === preference;
}

function inferVibe(avgAttendance: number): Vibe {
  if (avgAttendance <= INFERRED_VIBE_THRESHOLDS.focusedMax) return "focused";
  if (avgAttendance >= INFERRED_VIBE_THRESHOLDS.chattyMin) return "chatty";
  return "balanced";
}

function scoreVibeMatch(
  preference: VibePreference,
  vibe: Vibe | "unknown",
  source: "tagged" | "inferred" | "unknown"
): number {
  if (preference === "any") return 0.5;
  if (vibe === "unknown") return 0.25;
  if (vibe === preference) return source === "tagged" ? 1 : 0.5;
  return source === "tagged" ? 0 : 0.15;
}

function scorePurposeMatch(preference: PurposePreference, purpose: PrickleTypePurpose): number {
  if (preference === "any") return 0;
  if (preference === "work") {
    // Filter already guarantees solo_task_friendly here; just prefer an
    // on-topic work session (if one is ever also marked solo-friendly) over
    // generic open writing time.
    return purpose === "work" ? 0.5 : 0.3;
  }
  if (purpose === preference) return 0.5; // on-topic thematic match
  if (purpose === "mixed") return 0.2;
  return 0;
}

function scoreCoAttendance(withMemberIds: string[], coAttendanceRate: number | null, sessionCount: number): number {
  if (withMemberIds.length === 0) return 0;
  if (sessionCount === 0) return 0.3; // neutral floor — new series aren't excluded, just unproven
  return coAttendanceRate ?? 0;
}

function scoreConfidence(sessionCount: number): number {
  return Math.min(sessionCount, 10) * 0.02;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function getPrickleRecommendations(
  candidates: CandidatePrickle[],
  candidateTypes: Map<string, PickerPrickleType>,
  candidateHosts: Map<string, PickerHost>,
  historicalPrickles: CandidatePrickle[],
  historicalAttendance: HistoricalAttendanceRow[],
  hostVibes: HostVibeRow[],
  answers: PickerAnswers,
  limit = 8
): PickerRecommendation[] {
  const filteredCandidates = candidates.filter(
    (c) =>
      withinWindow(c.start_time, answers.windowStart, answers.windowEnd) &&
      passesTimeOfDayFilter(c.start_time, answers.timeOfDay, answers.timezone)
  );

  const candidatesBySeries = new Map<string, CandidatePrickle[]>();
  for (const c of filteredCandidates) {
    const key = seriesKeyFor(c.type_id, c.host_id);
    if (!candidatesBySeries.has(key)) candidatesBySeries.set(key, []);
    candidatesBySeries.get(key)!.push(c);
  }

  const historicalBySeries = new Map<string, CandidatePrickle[]>();
  for (const p of historicalPrickles) {
    const key = seriesKeyFor(p.type_id, p.host_id);
    if (!historicalBySeries.has(key)) historicalBySeries.set(key, []);
    historicalBySeries.get(key)!.push(p);
  }

  const attendanceMap = buildAttendanceMap(historicalAttendance);

  const hostVibeMap = new Map<string, HostVibeRow>();
  for (const v of hostVibes) {
    hostVibeMap.set(seriesKeyFor(v.type_id, v.host_id), v);
  }

  const withMemberIds = new Set(answers.withMemberIds);
  const recommendations: PickerRecommendation[] = [];

  for (const [seriesKey, seriesCandidates] of candidatesBySeries) {
    const first = seriesCandidates[0];
    const typeInfo = first.type_id ? candidateTypes.get(first.type_id) : undefined;
    const purpose = typeInfo?.purpose ?? "writing";
    const soloTaskFriendly = typeInfo?.soloTaskFriendly ?? true;

    if (!passesPurposeFilter(answers.purpose, purpose, soloTaskFriendly)) continue;

    const hostInfo = first.host_id ? candidateHosts.get(first.host_id) : undefined;
    const historical = historicalBySeries.get(seriesKey) ?? [];
    const sessionCount = historical.length;

    const attendeeCounts = historical.map((p) => attendanceMap.get(p.id)?.size ?? 0);
    const avgAttendance =
      sessionCount > 0 ? attendeeCounts.reduce((s, n) => s + n, 0) / sessionCount : null;

    const vibeRow = hostVibeMap.get(seriesKey);
    let vibe: Vibe | "unknown";
    let vibeSource: "tagged" | "inferred" | "unknown";
    let vibeNotes: string | null;
    if (vibeRow) {
      vibe = vibeRow.vibe;
      vibeSource = "tagged";
      vibeNotes = vibeRow.notes;
    } else if (avgAttendance !== null) {
      vibe = inferVibe(avgAttendance);
      vibeSource = "inferred";
      vibeNotes = null;
    } else {
      vibe = "unknown";
      vibeSource = "unknown";
      vibeNotes = null;
    }

    let coAttendanceRate: number | null = null;
    if (withMemberIds.size > 0 && sessionCount > 0) {
      const matches = historical.filter((p) => {
        const attendees = attendanceMap.get(p.id);
        if (!attendees) return false;
        for (const memberId of withMemberIds) {
          if (!attendees.has(memberId)) return false;
        }
        return true;
      }).length;
      coAttendanceRate = matches / sessionCount;
    }

    const score =
      WEIGHT_CO_ATTENDANCE * scoreCoAttendance(answers.withMemberIds, coAttendanceRate, sessionCount) +
      WEIGHT_VIBE * scoreVibeMatch(answers.vibe, vibe, vibeSource) +
      scorePurposeMatch(answers.purpose, purpose) +
      scoreConfidence(sessionCount);

    const sortedOccurrences = [...seriesCandidates].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    recommendations.push({
      seriesKey,
      typeId: first.type_id,
      typeName: typeInfo?.name ?? "Prickle",
      hostId: first.host_id,
      hostName: hostInfo?.name ?? null,
      purpose,
      scheduleLabel: getScheduleSlot(sortedOccurrences[0].start_time).label,
      vibe,
      vibeSource,
      vibeNotes,
      avgAttendance,
      sessionCount,
      coAttendanceRate,
      score,
      occurrences: sortedOccurrences.slice(0, 3).map((o) => ({ id: o.id, startTime: o.start_time })),
    });
  }

  // A proven zero -- the requested people have historically never all shown
  // up together at this series -- shouldn't be outranked into the results by
  // vibe/purpose scoring alone. Rank those series behind everything else
  // (unknown/no-history and nonzero co-attendance) rather than blending them
  // into one score-sorted list, but still show them if there isn't enough
  // else to fill the list.
  const isProvenMismatch = (r: PickerRecommendation) =>
    withMemberIds.size > 0 && r.sessionCount > 0 && r.coAttendanceRate === 0;

  recommendations.sort((a, b) => {
    const aMismatch = isProvenMismatch(a);
    const bMismatch = isProvenMismatch(b);
    if (aMismatch !== bMismatch) return aMismatch ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.occurrences[0].startTime).getTime() - new Date(b.occurrences[0].startTime).getTime();
  });

  return recommendations.slice(0, limit);
}
