import { describe, it, expect } from "vitest"
import {
  computeHostExperience,
  computeRegularMemberIds,
  computeSlotVibrancy,
  orderWithDiversity,
  recommendationReasons,
  scoreRecommendation,
  type HostExperience,
  type PastAttendance,
  type PastPrickle,
  type SlotVibrancy,
} from "@/lib/prickle-recommendations"
import { rankUpcomingPrickles, type UpcomingPrickle } from "@/lib/upcoming-prickles"

const TZ = "America/New_York"
const NOW = new Date("2026-09-26T12:00:00Z") // Sat 8am ET

function upcoming(
  id: string,
  startTime: string,
  opts: { seriesKey?: string; hostId?: string | null; hostName?: string | null } = {},
): UpcomingPrickle {
  return {
    id,
    typeId: "t1",
    typeName: "Writing",
    startTime,
    hostId: opts.hostId === undefined ? `host-${id}` : opts.hostId,
    hostName: opts.hostName === undefined ? `Host ${id.toUpperCase()}` : opts.hostName,
    dayOfWeek: "Saturday",
    startHour: 10,
    seriesKey: opts.seriesKey ?? `series-${id}`,
  }
}

const veteranHost: HostExperience = { hostedCount: 40, recentHosted: 8, recentShowedUp: 8, recentOnTime: 8 }
const newHost: HostExperience = { hostedCount: 1, recentHosted: 1, recentShowedUp: 1, recentOnTime: 1 }
const busySlot: SlotVibrancy = { occurrences: 8, avgAttendance: 9, avgRegulars: 5 }
const sparseSlot: SlotVibrancy = { occurrences: 1, avgAttendance: 1, avgRegulars: 0 }

describe("computeRegularMemberIds", () => {
  it("counts distinct prickles, not attendance rows (leave/rejoin creates multiple rows)", () => {
    const rows: PastAttendance[] = [
      { prickleId: "p1", memberId: "a", joinTime: "t" },
      { prickleId: "p1", memberId: "a", joinTime: "t" },
      { prickleId: "p2", memberId: "a", joinTime: "t" },
      { prickleId: "p1", memberId: "b", joinTime: "t" },
    ]
    expect([...computeRegularMemberIds(rows, 2)]).toEqual(["a"])
  })
})

describe("computeSlotVibrancy", () => {
  it("averages distinct attendees and regulars per past occurrence, excluding the viewer", () => {
    const past: PastPrickle[] = [
      { id: "p1", seriesKey: "S", hostId: null, startTime: "2026-09-01T14:00:00Z" },
      { id: "p2", seriesKey: "S", hostId: null, startTime: "2026-09-08T14:00:00Z" },
    ]
    const attendance: PastAttendance[] = []
    // "reg" attends 6 distinct prickles overall (a regular), including both of S's occurrences.
    for (const pid of ["p1", "p2", "x1", "x2", "x3", "x4"])
      attendance.push({ prickleId: pid, memberId: "reg", joinTime: "t" })
    attendance.push({ prickleId: "p1", memberId: "casual", joinTime: "t" })
    attendance.push({ prickleId: "p1", memberId: "casual", joinTime: "t" }) // rejoin, same prickle
    attendance.push({ prickleId: "p1", memberId: "viewer", joinTime: "t" })

    const slot = computeSlotVibrancy(past, attendance, "viewer").get("S")!
    expect(slot.occurrences).toBe(2)
    expect(slot.avgAttendance).toBe(1.5) // p1: reg+casual, p2: reg
    expect(slot.avgRegulars).toBe(1)
  })
})

describe("computeHostExperience", () => {
  it("combines all-time counts with recent show-up and on-time record using the host's earliest join", () => {
    const past: PastPrickle[] = [
      { id: "p1", seriesKey: "S", hostId: "h", startTime: "2026-09-01T14:00:00Z" },
      { id: "p2", seriesKey: "S", hostId: "h", startTime: "2026-09-08T14:00:00Z" },
      { id: "p3", seriesKey: "S", hostId: "h", startTime: "2026-09-15T14:00:00Z" },
    ]
    const attendance: PastAttendance[] = [
      { prickleId: "p1", memberId: "h", joinTime: "2026-09-01T14:20:00Z" },
      { prickleId: "p1", memberId: "h", joinTime: "2026-09-01T13:58:00Z" }, // earliest -> on time
      { prickleId: "p2", memberId: "h", joinTime: "2026-09-08T14:30:00Z" }, // late
      // p3: no-show
    ]
    const exp = computeHostExperience(new Map([["h", 25]]), past, attendance).get("h")!
    expect(exp).toEqual({ hostedCount: 25, recentHosted: 3, recentShowedUp: 2, recentOnTime: 1 })
  })
})

describe("scoreRecommendation", () => {
  it("scores an established, reliable host on a busy slot above a new host on a sparse slot", () => {
    expect(scoreRecommendation(veteranHost, busySlot)).toBeGreaterThan(scoreRecommendation(newHost, sparseSlot))
    expect(scoreRecommendation(veteranHost, busySlot)).toBeCloseTo(1)
  })

  it("penalizes hosts who often don't show up", () => {
    const flaky: HostExperience = { hostedCount: 40, recentHosted: 8, recentShowedUp: 3, recentOnTime: 3 }
    expect(scoreRecommendation(flaky, busySlot)).toBeLessThan(scoreRecommendation(veteranHost, busySlot))
  })

  it("scores zero with no host and no history", () => {
    expect(scoreRecommendation(undefined, undefined)).toBe(0)
  })
})

describe("recommendationReasons", () => {
  it("explains a strong pick with friendly badges", () => {
    const kinds = recommendationReasons({
      hostName: "Jane Q Smith",
      host: veteranHost,
      slot: busySlot,
      viewerIsHost: false,
    })
    expect(kinds.map((r) => r.kind)).toEqual(["experiencedHost", "popular", "regulars"])
    expect(kinds[0].tooltip).toEqual(["Jane S has hosted 40 sessions", "Reliably there on time"])
    expect(kinds[1].tooltip).toEqual(["Usually about 9 writers"])
  })

  it("stays quiet for new hosts, sparse slots, and the viewer's own hosting", () => {
    expect(recommendationReasons({ hostName: "N", host: newHost, slot: sparseSlot, viewerIsHost: false })).toEqual([])
    expect(recommendationReasons({ hostName: "V", host: veteranHost, slot: undefined, viewerIsHost: true })).toEqual([])
  })

  it("withholds the experienced-host badge from a host with a poor show-up record", () => {
    const flaky: HostExperience = { hostedCount: 40, recentHosted: 8, recentShowedUp: 3, recentOnTime: 3 }
    expect(recommendationReasons({ hostName: "F", host: flaky, slot: undefined, viewerIsHost: false })).toEqual([])
  })
})

describe("orderWithDiversity", () => {
  it("breaks exact ties by start time", () => {
    const order = orderWithDiversity(
      [
        { id: "late", startTime: "2026-09-26T20:00:00Z", dayKey: "d1", seriesKey: "a", score: 0.5 },
        { id: "early", startTime: "2026-09-26T14:00:00Z", dayKey: "d1", seriesKey: "b", score: 0.5 },
      ],
      NOW,
    )
    // Same day, but "early" also loses less to the per-day-away decay -- either way it comes first.
    expect(order.map((c) => c.id)).toEqual(["early", "late"])
  })

  it("spreads picks across days instead of stacking one day", () => {
    const sameDay = ["a", "b", "c"].map((id, i) => ({
      id,
      startTime: `2026-09-27T1${i}:00:00Z`,
      dayKey: "2026-09-27",
      seriesKey: id,
      score: 0.8,
    }))
    const otherDay = { id: "d", startTime: "2026-09-29T14:00:00Z", dayKey: "2026-09-29", seriesKey: "d", score: 0.7 }
    const order = orderWithDiversity([...sameDay, otherDay], NOW).map((c) => c.id)
    expect(order.slice(0, 2)).toEqual(["a", "d"])
  })

  it("doesn't let one weekly slot take two top spots", () => {
    const order = orderWithDiversity(
      [
        { id: "wk1", startTime: "2026-09-27T14:00:00Z", dayKey: "d1", seriesKey: "S", score: 0.9 },
        { id: "wk2", startTime: "2026-10-04T14:00:00Z", dayKey: "d8", seriesKey: "S", score: 0.9 },
        { id: "other", startTime: "2026-10-01T14:00:00Z", dayKey: "d5", seriesKey: "T", score: 0.7 },
      ],
      NOW,
    ).map((c) => c.id)
    expect(order).toEqual(["wk1", "other", "wk2"])
  })

  it("doesn't bury a soon prickle under a marginally better one days later", () => {
    const order = orderWithDiversity(
      [
        { id: "later", startTime: "2026-10-08T14:00:00Z", dayKey: "d12", seriesKey: "a", score: 0.61 },
        { id: "soon", startTime: "2026-09-26T16:00:00Z", dayKey: "d0", seriesKey: "b", score: 0.6 },
      ],
      NOW,
    ).map((c) => c.id)
    expect(order[0]).toBe("soon")
  })
})

describe("rankUpcomingPrickles", () => {
  // Chronologically: sparse (soonest), then veteran.
  const sparseSoon = upcoming("sparse", "2026-09-26T14:00:00Z", { hostId: "newbie", seriesKey: "SPARSE" })
  const strongLater = upcoming("strong", "2026-09-27T14:00:00Z", { hostId: "vet", seriesKey: "STRONG" })
  const community = {
    hostExperience: new Map([
      ["vet", veteranHost],
      ["newbie", newHost],
    ]),
    slotVibrancy: new Map([
      ["STRONG", busySlot],
      ["SPARSE", sparseSlot],
    ]),
  }

  it("ranks experienced-host / popular slots above sparse new-host slots for a member with no history", () => {
    const ranked = rankUpcomingPrickles({
      upcoming: [sparseSoon, strongLater],
      memberId: "new-member",
      now: NOW,
      timeZone: TZ,
      ...community,
    })
    expect(ranked.map((r) => r.prickle.id)).toEqual(["strong", "sparse"])
    expect(ranked[0].reasons.map((r) => r.kind)).toEqual(["experiencedHost", "popular", "regulars"])
    expect(ranked[1].reasons).toEqual([])
    expect(ranked[0].recommendationScore).toBeGreaterThan(ranked[1].recommendationScore)
  })

  it("keeps personal signals dominant: a streak on the sparse slot still outranks the strong slot", () => {
    const ranked = rankUpcomingPrickles({
      upcoming: [strongLater, sparseSoon],
      memberId: "m",
      now: NOW,
      timeZone: TZ,
      activeStreakBySeries: new Map([["SPARSE", 3]]),
      ...community,
    })
    expect(ranked.map((r) => r.prickle.id)).toEqual(["sparse", "strong"])
    expect(ranked[0].priority).toBe(1)
    expect(ranked[0].reasons[0].kind).toBe("streak")
  })

  it("puts the member's own hosting first and doesn't badge them as an experienced host", () => {
    const mine = upcoming("mine", "2026-10-02T14:00:00Z", { hostId: "vet", seriesKey: "STRONG" })
    const ranked = rankUpcomingPrickles({
      upcoming: [sparseSoon, mine],
      memberId: "vet",
      now: NOW,
      timeZone: TZ,
      ...community,
    })
    expect(ranked[0].prickle.id).toBe("mine")
    expect(ranked[0].reasons.map((r) => r.kind)).toEqual(["hosting", "popular", "regulars"])
  })

  it("uses community score as a tie-breaker within a personal tier", () => {
    const ranked = rankUpcomingPrickles({
      upcoming: [sparseSoon, strongLater],
      memberId: "m",
      now: NOW,
      timeZone: TZ,
      lostStreakBySeries: new Map([
        ["SPARSE", 4],
        ["STRONG", 4],
      ]),
      ...community,
    })
    expect(ranked.map((r) => r.prickle.id)).toEqual(["strong", "sparse"])
  })

  it("falls back to soonest-first when there are no signals at all", () => {
    const a = upcoming("a", "2026-09-28T14:00:00Z", { hostId: null, hostName: null })
    const b = upcoming("b", "2026-09-27T14:00:00Z", { hostId: null, hostName: null })
    const c = upcoming("c", "2026-09-29T14:00:00Z", { hostId: null, hostName: null })
    const ranked = rankUpcomingPrickles({ upcoming: [a, b, c], memberId: "m", now: NOW, timeZone: TZ })
    expect(ranked.map((r) => r.prickle.id)).toEqual(["b", "a", "c"])
  })

  it("spreads recommendations across days, seeding from personal picks", () => {
    // Personal streak pick on Sunday; two equally strong recommendations: one Sunday, one Tuesday.
    const streakSun = upcoming("streakSun", "2026-09-27T13:00:00Z", { seriesKey: "MINE" })
    const recSun = upcoming("recSun", "2026-09-27T16:00:00Z", { hostId: "vet", seriesKey: "STRONG" })
    const recTue = upcoming("recTue", "2026-09-29T16:00:00Z", { hostId: "vet", seriesKey: "STRONG2" })
    const ranked = rankUpcomingPrickles({
      upcoming: [streakSun, recSun, recTue],
      memberId: "m",
      now: NOW,
      timeZone: TZ,
      activeStreakBySeries: new Map([["MINE", 2]]),
      hostExperience: new Map([["vet", veteranHost]]),
      slotVibrancy: new Map([
        ["STRONG", busySlot],
        ["STRONG2", busySlot],
      ]),
    })
    expect(ranked.map((r) => r.prickle.id)).toEqual(["streakSun", "recTue", "recSun"])
  })
})
