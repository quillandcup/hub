import { describe, it, expect } from "vitest"
import {
  PRIORITY,
  computeCalendarAdded,
  rankUpcomingPrickles,
  type CalendarItemRow,
  type UpcomingPrickle,
} from "@/lib/upcoming-prickles"

const TZ = "America/New_York"
const NOW = new Date("2026-09-26T12:00:00Z") // Sat Sep 26, 8am EDT

function upcoming(id: string, startTime: string, opts: Partial<UpcomingPrickle> = {}): UpcomingPrickle {
  return {
    id,
    typeId: "t1",
    typeName: "Writing",
    startTime,
    hostId: `host-${id}`,
    hostName: `Host ${id}`,
    dayOfWeek: "Tuesday",
    startHour: 19,
    seriesKey: `series-${id}`,
    ...opts,
  }
}

const onceItem = (prickleId: string): CalendarItemRow => ({
  kind: "prickle",
  prickle_id: prickleId,
  type_id: null,
  day_of_week: null,
  start_time_local: null,
  timezone: null,
})

// Tuesdays 7:00 PM ET.
const weeklyItem: CalendarItemRow = {
  kind: "slot",
  prickle_id: null,
  type_id: "t1",
  day_of_week: 2,
  start_time_local: "19:00:00",
  timezone: TZ,
}

describe("computeCalendarAdded", () => {
  const tueEvening = upcoming("tue", "2026-09-29T23:00:00Z") // Tue Sep 29, 7:00 PM EDT
  const nextTue = upcoming("nextTue", "2026-10-06T23:00:00Z")
  const otherType = upcoming("otherType", "2026-09-29T23:00:00Z", { typeId: "t2" })
  const tueLater = upcoming("tueLater", "2026-09-30T00:00:00Z") // Tue 8:00 PM EDT
  const single = upcoming("single", "2026-10-01T14:00:00Z", { typeId: "t9" })

  it("matches one-off items by prickle id and weekly items by type, weekday and local time", () => {
    const added = computeCalendarAdded([onceItem("single"), weeklyItem], [tueEvening, nextTue, otherType, tueLater, single])
    expect(Object.fromEntries(added)).toEqual({ tue: "weekly", nextTue: "weekly", single: "once" })
  })

  it("reports 'once' when a prickle is covered both ways", () => {
    const added = computeCalendarAdded([weeklyItem, onceItem("tue")], [tueEvening])
    expect(added.get("tue")).toBe("once")
  })
})

describe("rankUpcomingPrickles with calendar-added prickles", () => {
  const added = upcoming("added", "2026-10-02T13:00:00Z", { seriesKey: "ADDED" })
  const committed = upcoming("committed", "2026-10-05T13:00:00Z", { seriesKey: "COMMIT" })
  const streak = upcoming("streak", "2026-09-27T13:00:00Z", { seriesKey: "STREAK" })
  const plain = upcoming("plain", "2026-09-26T16:00:00Z", { seriesKey: "PLAIN" })

  it("ranks a prickle added to the calendar below a commitment and above a streak, with a badge", () => {
    const ranked = rankUpcomingPrickles({
      upcoming: [plain, streak, added, committed],
      memberId: "me",
      now: NOW,
      timeZone: TZ,
      commitmentByPrickleId: new Map([["committed", { commitmentId: "c1", week: 1, weeks: 4, sessionsPerWeek: 1, kept: 0 }]]),
      calendarAddedByPrickleId: new Map([["added", "weekly"]]),
      activeStreakBySeries: new Map([["STREAK", 3]]),
    })
    expect(ranked.map((r) => r.prickle.id)).toEqual(["committed", "added", "streak", "plain"])
    expect(ranked[1].priority).toBe(PRIORITY.calendar)
    expect(ranked[1].reasons[0]).toEqual({ kind: "calendar", tooltip: ["You added this one every week"] })
  })
})
