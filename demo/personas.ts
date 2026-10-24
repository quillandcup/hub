/**
 * The demo cast: invented people, example.com addresses. Each persona is a state a real member can be in,
 * and a scene signs in as the one its article is about. The password is a throwaway for the local demo stack.
 */
export const DEMO_PASSWORD = "demo-only-local-password";

export interface Persona {
  key: string;
  name: string;
  email: string;
  role: "admin" | "member";
  /** Days since they joined, or null when the persona has no member record. */
  joinedDaysAgo: number | null;
}

export const PERSONAS: Persona[] = [
  { key: "admin", name: "Avery Admin", email: "avery.admin@example.com", role: "admin", joinedDaysAgo: null },
  { key: "member", name: "Marlowe Example", email: "marlowe.example@example.com", role: "member", joinedDaysAgo: 21 },
  { key: "host", name: "Hazel Hosting", email: "hazel.hosting@example.com", role: "member", joinedDaysAgo: 400 },
  { key: "regular1", name: "Jules Sample", email: "jules.sample@example.com", role: "member", joinedDaysAgo: 200 },
  { key: "regular2", name: "Rowan Demo", email: "rowan.demo@example.com", role: "member", joinedDaysAgo: 90 },
];

/** How often someone comes to a prickle they could attend (0 to 1): what makes streaks, "~4 Hedgies" and show-up rates look lived in. */
export const ATTENDANCE_RATE: Record<string, number> = {
  "marlowe.example@example.com": 0.4,
  "hazel.hosting@example.com": 0.85,
  "jules.sample@example.com": 0.6,
  "rowan.demo@example.com": 0.5,
};

/**
 * Members who fill the room but never sign in, so no screen is a community of five. Invented names,
 * example.com addresses; `rate` is how often each comes to a prickle they could attend.
 */
export interface FillerMember {
  name: string;
  email: string;
  joinedDaysAgo: number;
  rate: number;
}

export const FILLER_MEMBERS: FillerMember[] = [
  { name: "Wren Placeholder", email: "wren.placeholder@example.com", joinedDaysAgo: 540, rate: 0.7 },
  { name: "Sage Sample", email: "sage.sample@example.com", joinedDaysAgo: 330, rate: 0.55 },
  { name: "Linden Example", email: "linden.example@example.com", joinedDaysAgo: 280, rate: 0.45 },
  { name: "Ash Fictional", email: "ash.fictional@example.com", joinedDaysAgo: 210, rate: 0.65 },
  { name: "Briar Demo", email: "briar.demo@example.com", joinedDaysAgo: 150, rate: 0.3 },
  { name: "Juniper Test", email: "juniper.test@example.com", joinedDaysAgo: 120, rate: 0.5 },
  { name: "Thistle Mockup", email: "thistle.mockup@example.com", joinedDaysAgo: 75, rate: 0.6 },
  { name: "Fern Imaginary", email: "fern.imaginary@example.com", joinedDaysAgo: 60, rate: 0.35 },
  { name: "Clover Sketch", email: "clover.sketch@example.com", joinedDaysAgo: 45, rate: 0.5 },
  { name: "Maple Pretend", email: "maple.pretend@example.com", joinedDaysAgo: 40, rate: 0.25 },
];

export function persona(key: string): Persona {
  const p = PERSONAS.find((x) => x.key === key);
  if (!p) throw new Error(`No demo persona "${key}"`);
  return p;
}

/** The prickles to seed, as calendar events relative to today in the org's timezone. Titles use the same "Type w/Host" shape the real calendar does. */
export interface DemoEvent {
  key: string;
  summary: string;
  dayOffset: number;
  startLocal: string;
  minutes: number;
}

/** The weekly rhythm: day of week (0 = Sunday), local start, minutes, and the calendar title the real calendar would carry. */
const WEEKLY_PATTERN: { weekday: number; startLocal: string; minutes: number; summary: string }[] = [
  { weekday: 1, startLocal: "09:00", minutes: 60, summary: "Progress Prickle w/Hazel Hosting" },
  { weekday: 2, startLocal: "14:00", minutes: 45, summary: "Sprint Prickle w/Jules Sample" },
  { weekday: 3, startLocal: "09:00", minutes: 60, summary: "Progress Prickle w/Hazel Hosting" },
  { weekday: 4, startLocal: "19:00", minutes: 60, summary: "Plot or Plan Prickle w/Rowan Demo" },
  { weekday: 5, startLocal: "10:00", minutes: 60, summary: "Progress Prickle w/Jules Sample" },
  { weekday: 6, startLocal: "10:00", minutes: 90, summary: "Heads Down Prickle" },
  { weekday: 0, startLocal: "19:00", minutes: 60, summary: "Sprint Prickle w/Hazel Hosting" },
];

/** Four weeks back and two ahead, so there is history, a recurring pattern and an upcoming week. The day offset is from today in the org's timezone; `weekdayOf` says which weekday today is. */
export function demoEvents(weekdayOfToday: number): DemoEvent[] {
  const events: DemoEvent[] = [];
  for (let dayOffset = -28; dayOffset <= 14; dayOffset++) {
    const weekday = (((weekdayOfToday + dayOffset) % 7) + 7) % 7;
    for (const slot of WEEKLY_PATTERN.filter((w) => w.weekday === weekday)) {
      events.push({ key: `d${dayOffset}-${slot.startLocal.replace(":", "")}`, summary: slot.summary, dayOffset, startLocal: slot.startLocal, minutes: slot.minutes });
    }
  }
  return events;
}

/** Fictional Zoom room shown in the "On air" popover; the .example host never resolves. */
export const DEMO_JOIN = {
  url: "https://zoom.example.com/j/0000000000",
  meetingId: "000 0000 0000",
  passcode: "demo",
};
