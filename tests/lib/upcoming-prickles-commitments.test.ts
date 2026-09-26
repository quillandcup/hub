import { describe, it, expect } from "vitest"
import type { Commitment, SlotPrickle } from "@/lib/commitments"
import {
  PRIORITY,
  computeCommitmentSignals,
  rankUpcomingPrickles,
  type CommitmentSignal,
  type UpcomingPrickle,
} from "@/lib/upcoming-prickles"
import type { HostExperience, SlotVibrancy } from "@/lib/prickle-recommendations"

const TZ = "America/New_York"
const NOW = new Date("2026-09-26T12:00:00Z") // Sat Sep 26, 8am EDT

// Mondays 9:00 AM ET for 4 weeks from Sep 14: Sep 14, 21, 28, Oct 5 (13:00Z while EDT).
const commitment: Commitment = {
  id: "c1",
  typeId: "t1",
  dayOfWeek: 1,
  startTimeLocal: "09:00:00",
  timezone: TZ,
  startDate: "2026-09-14",
  weeks: 4,
  status: "active",
  cancelledAt: null,
}

const slot = (id: string, startTime: string, typeId = "t1"): SlotPrickle => ({
  id,
  typeId,
  startTime,
  endTime: startTime,
})

const prickles: SlotPrickle[] = [
  slot("wk1", "2026-09-14T13:00:00Z"), // attended
  slot("wk2", "2026-09-21T13:00:00Z"), // missed
  slot("wk3", "2026-09-28T13:00:00Z"),
  slot("wk4", "2026-10-05T13:00:00Z"),
  slot("sameTypeTwoHoursLater", "2026-09-28T15:00:00Z"),
  slot("otherType", "2026-10-05T13:00:00Z", "t2"),
]

describe("computeCommitmentSignals", () => {
  it("maps each upcoming week of an active commitment to its prickle, with week number and kept count", () => {
    const signals = computeCommitmentSignals([commitment], prickles, new Set(["wk1"]), NOW)
    expect([...signals.entries()]).toEqual([
      ["wk3", { commitmentId: "c1", week: 3, weeks: 4, kept: 1 }],
      ["wk4", { commitmentId: "c1", week: 4, weeks: 4, kept: 1 }],
    ])
  })

  it("uses lib/commitments tolerance matching: a drifted prickle within the tolerance still counts", () => {
    const drifted = [slot("drift", "2026-09-28T13:40:00Z"), slot("farOff", "2026-10-05T15:30:00Z")]
    const signals = computeCommitmentSignals([commitment], drifted, new Set(), NOW)
    expect([...signals.keys()]).toEqual(["drift"])
  })

  it("matches in the commitment's own timezone (Monday 2pm London = 13:00Z in BST)", () => {
    const london: Commitment = { ...commitment, id: "c2", startTimeLocal: "14:00", timezone: "Europe/London" }
    const signals = computeCommitmentSignals([london], prickles, new Set(), NOW)
    expect([...signals.keys()]).toEqual(["wk3", "wk4"])
  })

  it("ignores cancelled commitments and active ones whose window has already ended", () => {
    const cancelled: Commitment = { ...commitment, status: "cancelled", cancelledAt: "2026-09-20T00:00:00Z" }
    const ended: Commitment = { ...commitment, startDate: "2026-08-03", weeks: 2 }
    expect(computeCommitmentSignals([cancelled, ended], prickles, new Set(), NOW).size).toBe(0)
  })
})

function upcoming(id: string, startTime: string, opts: Partial<UpcomingPrickle> = {}): UpcomingPrickle {
  return {
    id,
    typeId: "t1",
    typeName: "Writing",
    startTime,
    hostId: `host-${id}`,
    hostName: `Host ${id}`,
    dayOfWeek: "Monday",
    startHour: 9,
    seriesKey: `series-${id}`,
    ...opts,
  }
}

const veteranHost: HostExperience = { hostedCount: 40, recentHosted: 8, recentShowedUp: 8, recentOnTime: 8 }
const busySlot: SlotVibrancy = { occurrences: 8, avgAttendance: 9, avgRegulars: 5 }

describe("rankUpcomingPrickles with commitments", () => {
  const committed = upcoming("committed", "2026-10-05T13:00:00Z", { seriesKey: "COMMIT" })
  const streak = upcoming("streak", "2026-09-27T13:00:00Z", { seriesKey: "STREAK" })
  const strongRec = upcoming("strongRec", "2026-09-26T16:00:00Z", { hostId: "vet", seriesKey: "STRONG" })
  const hosting = upcoming("hosting", "2026-10-06T13:00:00Z", { hostId: "me", seriesKey: "HOST" })
  const signal: CommitmentSignal = { commitmentId: "c1", week: 3, weeks: 4, kept: 1 }

  const base = {
    memberId: "me",
    now: NOW,
    timeZone: TZ,
    activeStreakBySeries: new Map([["STREAK", 6]]),
    hostExperience: new Map([["vet", veteranHost]]),
    slotVibrancy: new Map([["STRONG", busySlot]]),
  }

  it("ranks a committed prickle just below hosting and above a long streak and a strong recommendation", () => {
    const ranked = rankUpcomingPrickles({
      ...base,
      upcoming: [strongRec, streak, committed, hosting],
      commitmentByPrickleId: new Map([["committed", signal]]),
    })
    expect(ranked.map((r) => r.prickle.id)).toEqual(["hosting", "committed", "streak", "strongRec"])
    expect(ranked.map((r) => r.priority)).toEqual([
      PRIORITY.hosting,
      PRIORITY.commitment,
      PRIORITY.streak,
      PRIORITY.none,
    ])
    expect(ranked[1].reasons[0]).toEqual({ kind: "commitment", tooltip: ["Week 3 of 4 · 1 kept so far"] })
  })

  it("omits the kept count before any week is kept", () => {
    const ranked = rankUpcomingPrickles({
      ...base,
      upcoming: [committed],
      commitmentByPrickleId: new Map([["committed", { ...signal, week: 1, kept: 0 }]]),
    })
    expect(ranked[0].reasons[0].tooltip).toEqual(["Week 1 of 4"])
  })

  it("keeps hosting on top but still shows the commitment badge when both apply", () => {
    const ranked = rankUpcomingPrickles({
      ...base,
      upcoming: [hosting],
      commitmentByPrickleId: new Map([["hosting", signal]]),
    })
    expect(ranked[0].priority).toBe(PRIORITY.hosting)
    expect(ranked[0].reasons.map((r) => r.kind).slice(0, 2)).toEqual(["hosting", "commitment"])
  })

  it("orders several committed prickles soonest first, and shows the streak badge alongside", () => {
    const later = upcoming("later", "2026-10-12T13:00:00Z", { seriesKey: "STREAK" })
    const sooner = upcoming("sooner", "2026-09-28T13:00:00Z", { seriesKey: "STREAK" })
    const ranked = rankUpcomingPrickles({
      ...base,
      upcoming: [later, sooner],
      commitmentByPrickleId: new Map([
        ["later", { ...signal, week: 4 }],
        ["sooner", signal],
      ]),
    })
    expect(ranked.map((r) => r.prickle.id)).toEqual(["sooner", "later"])
    expect(ranked[0].reasons.map((r) => r.kind)).toEqual(["commitment", "streak"])
  })
})
