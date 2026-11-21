/**
 * The most items each block that holds a list of them (a slot of item blocks, `SLOT_ALLOW` in config.tsx) is laid out for.
 * Items past it are hidden on the public page, and the publish check says so. One place, so the layout and the check agree.
 * A block with no entry (List, Testimonials, FAQ, Card grid, Link list) has no limit: its layout takes any number.
 * The numbers must be ones `CAP_CLASS` (blocks.tsx) has a class for, so Tailwind finds it.
 */
export const ITEM_LIMITS = { Steps: 5, Stats: 4, FinisherCards: 6, Timeline: 12, WeekStrip: 7, FinishLineCards: 3, PlanPhases: 4, ButtonRow: 3, SchedulePanel: 6, OutcomeNumbers: 4 } as const;
