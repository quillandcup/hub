import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bodies: { fromDate: string; toDate: string }[] = [];
vi.mock("@/app/api/process/calendar/route", () => ({
  POST: async (req: Request) => {
    bodies.push(await req.json());
    return Response.json({ success: true });
  },
}));

import { TYPE_CHANGE_DAYS_BACK, triggerPrickleTypeReprocessing } from "@/lib/processing/trigger";

beforeEach(() => {
  bodies.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("triggerPrickleTypeReprocessing", () => {
  it("rebuilds the calendar prickles from a year back to 90 days ahead, not just the usual 90 days back", async () => {
    const result = await triggerPrickleTypeReprocessing();

    expect(result.processed.map((p) => [p.table, p.success])).toEqual([["calendar", true]]);
    expect(TYPE_CHANGE_DAYS_BACK).toBe(365);
    expect(bodies).toEqual([{ fromDate: "2025-10-27T12:00:00.000Z", toDate: "2027-01-25T12:00:00.000Z" }]);
  });
});
