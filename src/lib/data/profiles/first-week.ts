import type { SeedProfile } from "../seed-profile";

/**
 * A brand-new member in their first week, matched with a big sister: joined four days ago, has come to
 * two prickles, has a check-in waiting. The room around them is small and settled. Use it for the
 * newcomer's dashboard, the Big Sister pages and the Getting started tour.
 */
export const FIRST_WEEK: SeedProfile = {
  name: "first-week",
  history: { daysBack: 14, daysAhead: 7 },
  people: [
    { key: "newcomer", name: "Nora Newcomer", email: "nora.newcomer@example.com", signsIn: true, joinedDaysAgo: 4, rate: 0.9, bigSister: "buddy", bio: "Just moved my novel draft out of the drawer 📖" },
    { key: "buddy", name: "Bea Buddy", email: "bea.buddy@example.com", signsIn: true, joinedDaysAgo: 600, rate: 0.7, bio: "Big sister to anyone who wants one 🌻" },
    { key: "host", name: "Hana Example", email: "hana.example@example.com", joinedDaysAgo: 450, rate: 0.8 },
    { key: "regular", name: "Ines Sample", email: "ines.sample@example.com", joinedDaysAgo: 120, rate: 0.5 },
    { key: "admin", name: "Ada Admin", email: "ada.admin@example.com", signsIn: true, role: "admin", joinedDaysAgo: null, rate: 0 },
  ],
  weeklyPattern: [
    { weekday: 1, startLocal: "09:00", minutes: 60, summary: "Progress Prickle w/Hana Example" },
    { weekday: 3, startLocal: "19:00", minutes: 60, summary: "Sprint Prickle w/Bea Buddy" },
    { weekday: 5, startLocal: "10:00", minutes: 60, summary: "Progress Prickle w/Hana Example" },
    { weekday: 6, startLocal: "10:00", minutes: 90, summary: "Heads Down Prickle" },
  ],
  notifications: [
    { person: "newcomer", kind: "prickle_checkin", text: "Ready for Progress Prickle in ~20 min? Check in: how are you feeling coming in?", url: null, minutesAgo: 20, read: false },
  ],
};
