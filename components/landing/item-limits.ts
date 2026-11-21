/**
 * The most items each block that holds a list of them (a slot of item blocks, `SLOT_ALLOW` in config.tsx) is laid out for.
 * Items past it are hidden on the public page, and the publish check says so. One place, so the layout and the check agree.
 */
export const ITEM_LIMITS = { Steps: 5, Stats: 4, FinisherCards: 6, Timeline: 12, WeekStrip: 7, FinishLineCards: 3, PlanPhases: 4 } as const;
