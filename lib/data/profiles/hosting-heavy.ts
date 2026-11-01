import type { SeedProfile } from "../seed-profile";

/**
 * A hosting-heavy member: Hana hosts five of the seven weekly slots, a second host takes the rest, and
 * Hana holds the hosting badges. Use it for the host's schedule, the hosting stats and the host
 * check-in pages.
 */
export const HOSTING_HEAVY: SeedProfile = {
  name: "hosting-heavy",
  history: { daysBack: 28, daysAhead: 14 },
  people: [
    { key: "host", name: "Hana Hostess", email: "hana.hostess@example.com", signsIn: true, joinedDaysAgo: 500, rate: 0.9, bio: "Hosting is my favorite hour of the day 🎤" },
    { key: "cohost", name: "Cleo Cohost", email: "cleo.cohost@example.com", joinedDaysAgo: 260, rate: 0.7 },
    { key: "regular1", name: "Ines Sample", email: "ines.sample@example.com", joinedDaysAgo: 220, rate: 0.6 },
    { key: "regular2", name: "Jo Demo", email: "jo.demo@example.com", joinedDaysAgo: 90, rate: 0.5 },
    { key: "admin", name: "Ada Admin", email: "ada.admin@example.com", signsIn: true, role: "admin", joinedDaysAgo: 700, rate: 0 },
  ],
  weeklyPattern: [
    { weekday: 1, startLocal: "09:00", minutes: 60, summary: "Progress Prickle w/Hana Hostess" },
    { weekday: 2, startLocal: "14:00", minutes: 45, summary: "Sprint Prickle w/Hana Hostess" },
    { weekday: 3, startLocal: "09:00", minutes: 60, summary: "Progress Prickle w/Hana Hostess" },
    { weekday: 4, startLocal: "19:00", minutes: 60, summary: "Plot or Plan Prickle w/Cleo Cohost" },
    { weekday: 5, startLocal: "10:00", minutes: 60, summary: "Progress Prickle w/Hana Hostess" },
    { weekday: 6, startLocal: "10:00", minutes: 90, summary: "Heads Down Prickle" },
    { weekday: 0, startLocal: "19:00", minutes: 60, summary: "Sprint Prickle w/Hana Hostess" },
  ],
  badges: [
    { key: "host_hero", name: "Host Hero", icon: "🎤", category: "community", awardedTo: [{ person: "host", daysAgo: 30, note: "Hosted 100 prickles" }] },
  ],
};
