import type { SeedProfile } from "../seed-profile";

/**
 * The demo community: invented people, example.com addresses. Each person who signs in is a state a
 * real member can be in, and a demo scene signs in as the one its article is about; the others fill
 * the room so no screen is a community of five. The weekly rhythm is what the real calendar carries
 * ("Type w/Host"); `buildDataset` lays it over the last four weeks and the next two.
 */
export const COMMUNITY: SeedProfile = {
  name: "community",
  history: { daysBack: 28, daysAhead: 14 },
  people: [
    { key: "admin", name: "Amelia Admin", email: "amelia.admin@example.com", signsIn: true, role: "admin", joinedDaysAgo: null, rate: 0 },
    {
      key: "member",
      name: "Maya Example",
      email: "maya.example@example.com",
      signsIn: true,
      role: "member",
      joinedDaysAgo: 21,
      rate: 0.4,
      bio: "Drafting a cozy mystery set in a lighthouse bakery 🧁 Tea first, words second. WIP: 12k and counting!",
    },
    {
      key: "host",
      name: "Hazel Hosting",
      email: "hazel.hosting@example.com",
      signsIn: true,
      role: "member",
      joinedDaysAgo: 400,
      rate: 0.85,
      bio: "I host the early Progress Prickles ☀️ Revising a middle-grade fantasy, one chapter at a time. Coffee-powered.",
    },
    {
      key: "regular1",
      name: "Julia Sample",
      email: "julia.sample@example.com",
      signsIn: true,
      role: "member",
      joinedDaysAgo: 200,
      rate: 0.6,
      bio: "Short stories + the occasional sonnet ✨ Sprint Prickles keep me honest. Poet problems, always.",
    },
    {
      key: "regular2",
      name: "Rosa Demo",
      email: "rosa.demo@example.com",
      signsIn: true,
      role: "member",
      joinedDaysAgo: 90,
      rate: 0.5,
      bio: "Plotting my very first novel 📓 Plot or Plan Prickles are my favorite hour of the week. Index cards everywhere.",
    },
    { key: "willa", name: "Willa Placeholder", email: "willa.placeholder@example.com", signsIn: false, role: "member", joinedDaysAgo: 540, rate: 0.7, bio: "Cozy fantasy, strong tea, and a very large TBR pile 📚" },
    { key: "sadie", name: "Sadie Sample", email: "sadie.sample@example.com", signsIn: false, role: "member", joinedDaysAgo: 330, rate: 0.55, bio: "Writing a memoir in 20-minute bursts between school runs 🚌" },
    { key: "linnea", name: "Linnea Example", email: "linnea.example@example.com", signsIn: false, role: "member", joinedDaysAgo: 280, rate: 0.45, bio: "Poet by night, accountant by day. Here for the morning Prickles ✍️" },
    { key: "aria", name: "Aria Fictional", email: "aria.fictional@example.com", signsIn: false, role: "member", joinedDaysAgo: 210, rate: 0.65, bio: "Finishing my second draft before the leaves are gone 🍂" },
    { key: "briony", name: "Briony Demo", email: "briony.demo@example.com", signsIn: false, role: "member", joinedDaysAgo: 150, rate: 0.3, bio: "Sci-fi short stories and too many half-finished notebooks 🚀" },
    { key: "juniper", name: "Juniper Test", email: "juniper.test@example.com", signsIn: false, role: "member", joinedDaysAgo: 120, rate: 0.5, bio: "Romance writer. Sprint Prickles are my secret weapon 💌" },
    { key: "thea", name: "Thea Mockup", email: "thea.mockup@example.com", signsIn: false, role: "member", joinedDaysAgo: 75, rate: 0.6, bio: "Turning a screenplay into a novel, one scene at a time 🎬" },
    { key: "fern", name: "Fern Imaginary", email: "fern.imaginary@example.com", signsIn: false, role: "member", joinedDaysAgo: 60, rate: 0.35, bio: "Here to build a daily writing habit and make writer friends 🌱" },
    { key: "clover", name: "Clover Sketch", email: "clover.sketch@example.com", signsIn: false, role: "member", joinedDaysAgo: 45, rate: 0.5, bio: "Historical fiction with a lot of research rabbit holes 🕰️" },
    { key: "mabel", name: "Mabel Pretend", email: "mabel.pretend@example.com", signsIn: false, role: "member", joinedDaysAgo: 40, rate: 0.25, bio: "Writing picture books after the kids are in bed 🌙" },
  ],
  weeklyPattern: [
    { weekday: 1, startLocal: "09:00", minutes: 60, summary: "Progress Prickle w/Hazel Hosting" },
    { weekday: 2, startLocal: "14:00", minutes: 45, summary: "Sprint Prickle w/Julia Sample" },
    { weekday: 3, startLocal: "09:00", minutes: 60, summary: "Progress Prickle w/Hazel Hosting" },
    { weekday: 4, startLocal: "19:00", minutes: 60, summary: "Plot or Plan Prickle w/Rosa Demo" },
    { weekday: 5, startLocal: "10:00", minutes: 60, summary: "Progress Prickle w/Julia Sample" },
    { weekday: 6, startLocal: "10:00", minutes: 90, summary: "Heads Down Prickle" },
    { weekday: 0, startLocal: "19:00", minutes: 60, summary: "Sprint Prickle w/Hazel Hosting" },
  ],
  badges: [
    {
      key: "kind_words",
      name: "Kind Words",
      icon: "💛",
      category: "community",
      awardedTo: [
        { person: "host", daysAgo: 60, note: "For welcoming every newcomer" },
        { person: "member", daysAgo: 10 },
      ],
    },
    { key: "early_bird", name: "Early Bird", icon: "🌅", category: "milestone", awardedTo: [{ person: "host", daysAgo: 200 }] },
  ],
  notifications: [
    { person: "member", kind: "prickle_checkin", text: "Ready for Progress Prickle in ~20 min? Check in: how are you feeling coming in?", url: null, minutesAgo: 25, read: false },
    { person: "member", kind: "prickle_checkout", text: "How did Sprint Prickle go? Check out and log your words.", url: null, minutesAgo: 60 * 26, read: true },
  ],
};
