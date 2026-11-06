import type { Prickle } from "@/lib/data/prickles";

/**
 * A prickle that exists, for tests of what hangs off one (check-ins, dismissals). The database
 * refuses a check-in or a dismissal for a prickle that isn't there (foreign key), and so do the
 * Slack handlers, which answer "that prickle isn't there any more" (`PRICKLE_GONE`).
 */
export const aPrickle = (id: string, overrides: Partial<Prickle> = {}): Prickle => ({
  id,
  typeId: null,
  hostId: null,
  title: null,
  startTime: "2026-10-05T10:00:00.000Z",
  endTime: "2026-10-05T11:00:00.000Z",
  source: "calendar",
  calendarEventId: null,
  ...overrides,
});
