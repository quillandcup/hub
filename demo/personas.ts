/**
 * The demo cast: invented people, example.com addresses. Each persona is a state a real member can be in,
 * and a scene signs in as the one its article is about. The password is a throwaway for the local demo stack.
 */
import { COMMUNITY } from "@/lib/data/profiles/community";

export const DEMO_PASSWORD = "demo-only-local-password";

export interface Persona {
  key: string;
  name: string;
  email: string;
  role: "admin" | "member";
  /** Days since they joined, or null when the persona has no member record. */
  joinedDaysAgo: number | null;
}

// The cast is the community profile (lib/data/profiles/community.ts); this file keeps the demo's names for it.
export const PERSONAS: Persona[] = COMMUNITY.people
  .filter((p) => p.signsIn)
  .map(({ key, name, email, role, joinedDaysAgo }) => ({ key, name, email, role, joinedDaysAgo }));

/** How often someone comes to a prickle they could attend (0 to 1): what makes streaks, "~4 Hedgies" and show-up rates look lived in. */
export const ATTENDANCE_RATE: Record<string, number> = Object.fromEntries(
  COMMUNITY.people.filter((p) => p.signsIn && p.joinedDaysAgo !== null).map((p) => [p.email, p.rate]),
);

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

export const FILLER_MEMBERS: FillerMember[] = COMMUNITY.people
  .filter((p) => !p.signsIn)
  .map((p) => ({ name: p.name, email: p.email, joinedDaysAgo: p.joinedDaysAgo as number, rate: p.rate }));

/** Each member's short bio, by name, so the member directory and profiles read like a community. */
export const BIOS: Record<string, string> = Object.fromEntries(COMMUNITY.people.flatMap((p) => (p.bio ? [[p.name, p.bio]] : [])));

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

const WEEKLY_PATTERN = COMMUNITY.weeklyPattern;

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
