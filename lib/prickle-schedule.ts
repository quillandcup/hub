import { createClient } from "@/lib/supabase/server"
import { buildAttendanceMap, getScheduleSlot } from "@/lib/scheduled-prickle-stats"
import { getMemberDisplayName } from "@/lib/member-display-name"

// The full recurring weekly schedule ("All Prickles" / "Prickle Times") --
// one row per (type, day-of-week, hour) slot that still has an upcoming
// occurrence, with the next instance's host and historical attendance for
// that slot. Distinct from lib/upcoming-prickles.ts, which ranks individual
// upcoming instances by personal relevance rather than describing the
// recurring pattern itself.

const BATCH_SIZE = 1000

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function fetchAllPaginated<T>(
  queryFn: (offset: number) => PromiseLike<{ data: unknown }>
): Promise<T[]> {
  let all: T[] = []
  let offset = 0
  let hasMore = true
  while (hasMore) {
    const { data } = await queryFn(offset)
    const batch = (data as T[] | null) ?? []
    if (batch.length > 0) {
      all = all.concat(batch)
      offset += batch.length
      hasMore = batch.length === BATCH_SIZE
    } else {
      hasMore = false
    }
  }
  return all
}

function unwrapOne<T>(ref: T | T[] | null | undefined): T | null {
  if (Array.isArray(ref)) return ref[0] ?? null
  return ref ?? null
}

type RawPrickleRow = {
  id: string
  type_id: string | null
  start_time: string
  prickle_types: { name: string } | { name: string }[] | null
  host: { id: string; name: string; display_name: string | null } | { id: string; name: string; display_name: string | null }[] | null
}

export interface PrickleScheduleRow {
  seriesKey: string
  sortKey: string
  dayOfWeek: string
  timeLabel: string
  typeId: string | null
  typeName: string
  scheduleLabel: string
  nextOccurrenceId: string
  nextOccurrenceStart: string
  hostId: string | null
  hostName: string | null
  sessionCount: number
  avgAttendance: number | null
}

function seriesKeyFor(typeId: string | null, scheduleSortKey: string): string {
  return `${typeId ?? "notype"}:${scheduleSortKey}`
}

/**
 * Every recurring weekly slot with at least one occurrence still ahead,
 * ordered by day-of-week then time (ET, matching how the org has always
 * scheduled and talked about Prickle Times).
 */
export async function getPrickleScheduleOverview(
  supabase: SupabaseClient,
  now: Date,
  lookbackDays: number,
  upcomingWindowDays: number
): Promise<PrickleScheduleRow[]> {
  const windowStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(now.getTime() + upcomingWindowDays * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  const raw = await fetchAllPaginated<RawPrickleRow>((offset) =>
    supabase
      .from("prickles")
      .select("id, type_id, start_time, prickle_types(name), host:members(id, name, display_name)")
      .gte("start_time", windowStart)
      .lte("start_time", windowEnd)
      .order("start_time")
      .range(offset, offset + BATCH_SIZE - 1)
  )

  // Group into upcoming vs. historical occurrences per (type, day, hour) slot.
  const upcomingBySlot = new Map<string, RawPrickleRow[]>()
  const historicalBySlot = new Map<string, RawPrickleRow[]>()

  for (const p of raw) {
    const slot = getScheduleSlot(p.start_time)
    const key = seriesKeyFor(p.type_id, slot.sortKey)
    const bucket = p.start_time >= nowIso ? upcomingBySlot : historicalBySlot
    const list = bucket.get(key) ?? []
    list.push(p)
    bucket.set(key, list)
  }

  // Historical attendance, batched by prickle ID (see CLAUDE.md pagination rule).
  const historicalIds = [...historicalBySlot.values()].flat().map((p) => p.id)
  let attendance: { prickle_id: string; member_id: string }[] = []
  const ID_BATCH = 500
  for (let i = 0; i < historicalIds.length; i += ID_BATCH) {
    const idsChunk = historicalIds.slice(i, i + ID_BATCH)
    const rows = await fetchAllPaginated<{ prickle_id: string; member_id: string }>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("prickle_id, member_id")
        .in("prickle_id", idsChunk)
        .range(offset, offset + BATCH_SIZE - 1)
    )
    attendance = attendance.concat(rows)
  }
  const attendanceMap = buildAttendanceMap(attendance)

  const rows: PrickleScheduleRow[] = []
  for (const [key, occurrences] of upcomingBySlot) {
    const next = occurrences.reduce((earliest, p) =>
      p.start_time < earliest.start_time ? p : earliest
    )
    const type = unwrapOne(next.prickle_types)
    const host = unwrapOne(next.host)
    const slot = getScheduleSlot(next.start_time)

    const historical = historicalBySlot.get(key) ?? []
    const counts = historical.map((p) => attendanceMap.get(p.id)?.size ?? 0)
    const avgAttendance = counts.length > 0 ? counts.reduce((s, c) => s + c, 0) / counts.length : null

    const nextDate = new Date(next.start_time)
    const dayOfWeek = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
    }).format(nextDate)
    const timeLabel = `${new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(nextDate)} ET`

    rows.push({
      seriesKey: key,
      sortKey: slot.sortKey,
      dayOfWeek,
      timeLabel,
      typeId: next.type_id,
      typeName: type?.name ?? "Prickle",
      scheduleLabel: slot.label,
      nextOccurrenceId: next.id,
      nextOccurrenceStart: next.start_time,
      hostId: host?.id ?? null,
      hostName: host ? getMemberDisplayName(host) : null,
      sessionCount: historical.length,
      avgAttendance,
    })
  }

  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  return rows
}
