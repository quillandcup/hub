import type { SeedProfile } from "../seed-profile";

/**
 * An at-risk member: a long-time regular who stopped coming 24 days ago (and one who already left),
 * in a room that is otherwise busy. Use it for the at-risk and outreach lists, "we haven't seen you"
 * messages and the engagement columns.
 */
export const LAPSING: SeedProfile = {
  name: "lapsing",
  history: { daysBack: 56, daysAhead: 7 },
  people: [
    { key: "lapsing", name: "Lena Lapsing", email: "lena.lapsing@example.com", signsIn: true, joinedDaysAgo: 300, rate: 0.9, lastAttendedDaysAgo: 24, bio: "Used to be here every Tuesday ☕" },
    { key: "gone", name: "Greta Goneby", email: "greta.goneby@example.com", joinedDaysAgo: 500, rate: 0.8, lastAttendedDaysAgo: 70, status: "cancelled" },
    { key: "host", name: "Hana Example", email: "hana.example@example.com", joinedDaysAgo: 450, rate: 0.85 },
    { key: "regular1", name: "Ines Sample", email: "ines.sample@example.com", joinedDaysAgo: 220, rate: 0.6 },
    { key: "regular2", name: "Jo Demo", email: "jo.demo@example.com", joinedDaysAgo: 90, rate: 0.5 },
    { key: "admin", name: "Ada Admin", email: "ada.admin@example.com", signsIn: true, role: "admin", joinedDaysAgo: 700, rate: 0 },
  ],
  weeklyPattern: [
    { weekday: 2, startLocal: "14:00", minutes: 45, summary: "Sprint Prickle w/Hana Example" },
    { weekday: 4, startLocal: "19:00", minutes: 60, summary: "Plot or Plan Prickle w/Hana Example" },
    { weekday: 6, startLocal: "10:00", minutes: 90, summary: "Heads Down Prickle" },
  ],
};
