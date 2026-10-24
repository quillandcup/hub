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

export const DEMO_EVENTS: DemoEvent[] = [
  { key: "yesterday-progress", summary: "Progress Prickle w/Hazel Hosting", dayOffset: -1, startLocal: "10:00", minutes: 60 },
  { key: "today-progress", summary: "Progress Prickle w/Hazel Hosting", dayOffset: 0, startLocal: "10:00", minutes: 60 },
  { key: "tomorrow-progress", summary: "Progress Prickle w/Hazel Hosting", dayOffset: 1, startLocal: "10:00", minutes: 60 },
  { key: "tomorrow-sprint", summary: "Sprint Prickle w/Hazel Hosting", dayOffset: 1, startLocal: "14:00", minutes: 45 },
  { key: "dayafter-headsdown", summary: "Heads Down Prickle", dayOffset: 2, startLocal: "09:00", minutes: 90 },
];

/** Fictional Zoom room shown in the "On air" popover; the .example host never resolves. */
export const DEMO_JOIN = {
  url: "https://zoom.example.com/j/0000000000",
  meetingId: "000 0000 0000",
  passcode: "demo",
};
