const TZ = "America/New_York"

export function etHour(iso: string): number {
  const h = parseInt(
    new Date(iso).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: TZ })
  )
  return h === 24 ? 0 : h
}

export function etDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })
}

export function etDow(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", timeZone: TZ })
}

export function etIsWeekday(iso: string): boolean {
  const d = new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })
  return d !== "Sat" && d !== "Sun"
}

export type PrickleRow = {
  id: string
  start_time: string
  members: { name: string } | null
  prickle_types: { name: string; normalized_name: string } | null
}

export type AttRow = {
  member_id: string
  prickle_id: string
  join_time: string
  leave_time: string
  members: { name: string } | null
}

export type TopEntry = { name: string; count: number }
export type TypeEntry = {
  name: string
  sessions: number
  totalAttendance: number
  avgAttendance: number
}
export type HourEntry = { hour: number; pct: number }
export type DowEntry = { day: string; count: number }

export function computeTopHosts(prickles: PrickleRow[], limit = 10): TopEntry[] {
  const counts = new Map<string, number>()
  for (const p of prickles) {
    const name = p.members?.name
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}

export function computeTopAttendees(attendance: AttRow[], limit = 10): TopEntry[] {
  const pricklesByMember = new Map<string, Set<string>>()
  const nameByMember = new Map<string, string>()
  for (const a of attendance) {
    const name = a.members?.name
    if (!name) continue
    nameByMember.set(a.member_id, name)
    const s = pricklesByMember.get(a.member_id) ?? new Set<string>()
    s.add(a.prickle_id)
    pricklesByMember.set(a.member_id, s)
  }
  return Array.from(pricklesByMember.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, limit)
    .map(([id, s]) => ({ name: nameByMember.get(id)!, count: s.size }))
}

export function computePrickleTypes(
  prickles: PrickleRow[],
  attendanceByPrickle: Map<string, number>,
  minSessions = 5,
  limit = 12
): TypeEntry[] {
  const sessions = new Map<string, number>()
  const totalAtt = new Map<string, number>()
  for (const p of prickles) {
    const name = p.prickle_types?.name
    const normalized = p.prickle_types?.normalized_name
    if (!name || normalized === "progress") continue
    sessions.set(name, (sessions.get(name) ?? 0) + 1)
    totalAtt.set(name, (totalAtt.get(name) ?? 0) + (attendanceByPrickle.get(p.id) ?? 0))
  }
  return Array.from(sessions.entries())
    .filter(([, s]) => s >= minSessions)
    .map(([name, s]) => ({
      name,
      sessions: s,
      totalAttendance: totalAtt.get(name) ?? 0,
      avgAttendance: Math.round(((totalAtt.get(name) ?? 0) / s) * 10) / 10,
    }))
    .sort((a, b) => b.avgAttendance - a.avgAttendance)
    .slice(0, limit)
}

export function computeHourCoverage(attendedPrickles: PrickleRow[]): HourEntry[] {
  const hourDays = new Map<number, Set<string>>()
  const allDates = new Set<string>()
  for (const p of attendedPrickles) {
    const date = etDate(p.start_time)
    const hour = etHour(p.start_time)
    allDates.add(date)
    const s = hourDays.get(hour) ?? new Set<string>()
    s.add(date)
    hourDays.set(hour, s)
  }
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    pct:
      allDates.size > 0
        ? Math.round(((hourDays.get(h)?.size ?? 0) / allDates.size) * 100)
        : 0,
  }))
}

const DOW_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function computeDayOfWeek(attendedPrickles: PrickleRow[]): DowEntry[] {
  const counts = new Map<string, number>()
  for (const p of attendedPrickles) {
    const d = etDow(p.start_time)
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return DOW_ORDER.map((day) => ({
    day: day.slice(0, 3),
    count: counts.get(day) ?? 0,
  }))
}

export interface HeroStats {
  totalHours: number
  uniqueAttendees: number
  weekdayCoverage: number
}

export function computeHeroStats(
  attendedPrickles: PrickleRow[],
  attendance: AttRow[]
): HeroStats {
  let totalHoursRaw = 0
  for (const a of attendance) {
    totalHoursRaw +=
      (new Date(a.leave_time).getTime() - new Date(a.join_time).getTime()) / (1000 * 60 * 60)
  }

  const uniqueAttendees = new Set(attendance.map((a) => a.member_id)).size

  const weekdayDates = new Set<string>()
  const sevenAmDates = new Set<string>()
  for (const p of attendedPrickles) {
    if (!etIsWeekday(p.start_time)) continue
    const date = etDate(p.start_time)
    weekdayDates.add(date)
    if (etHour(p.start_time) === 7) sevenAmDates.add(date)
  }
  const weekdayCoverage =
    weekdayDates.size > 0
      ? Math.round((sevenAmDates.size / weekdayDates.size) * 100)
      : 0

  return { totalHours: Math.round(totalHoursRaw), uniqueAttendees, weekdayCoverage }
}
