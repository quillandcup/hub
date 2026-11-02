import type { EventName } from "@/lib/analytics/events";

/** The windows the usage page offers, in days. */
export const WINDOW_DAYS = [7, 30, 90] as const;

export function parseWindowDays(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (WINDOW_DAYS as readonly number[]).includes(n) ? n : 30;
}

export interface FunnelDefinition {
  title: string;
  description: string;
  /** `where` limits a step to events with these property values. */
  steps: { event: EventName; label: string; where?: Record<string, boolean | number | string> }[];
}

/**
 * Funnels shown on the usage page (/admin/analytics): an ordered list of events, counted per
 * visit. Add one when a feature ships, next to the events it logs.
 */
export const FUNNELS: FunnelDefinition[] = [
  {
    title: "Course lessons: opened, played, completed",
    description:
      "Visits that opened a lesson with a video, started the video, then finished the lesson (by the button or by watching to the end). A drop between the first two is members who open the page and don't press play; a drop after is members who stop partway.",
    steps: [
      { event: "course_lesson_viewed", label: "Opened a video lesson", where: { has_video: true } },
      { event: "course_video_played", label: "Started the video" },
      { event: "lesson_completion_changed", label: "Completed the lesson", where: { completed: true } },
    ],
  },
  {
    title: "Course lessons: downloads",
    description: "Visits that opened a lesson, then clicked one of its downloads.",
    steps: [
      { event: "course_lesson_viewed", label: "Opened a lesson" },
      { event: "element_clicked", label: "Clicked a download", where: { name: "lesson-download-file" } },
    ],
  },
  {
    title: "On air light: someone is at the table",
    description: "Visits that opened the popover while the room was live, then clicked Join on Zoom.",
    steps: [
      { event: "onair_popover_opened", label: "Opened the popover", where: { live: true } },
      { event: "onair_join_clicked", label: "Clicked Join on Zoom", where: { live: true } },
    ],
  },
  {
    title: "On air light: off air",
    description:
      "Visits that opened the popover while the room was empty, then clicked Start a PUP on Zoom. A big drop here is the case for showing the next scheduled prickle instead.",
    steps: [
      { event: "onair_popover_opened", label: "Opened the popover", where: { live: false } },
      { event: "onair_join_clicked", label: "Clicked Start a PUP on Zoom", where: { live: false } },
    ],
  },
  {
    title: "Rollout: checking in",
    description: "Visits that opened the dashboard, a prickle, and saved a check-in. A drop after the prickle page is members who looked and didn't check in.",
    steps: [
      { event: "page_viewed", label: "Opened the dashboard", where: { route: "/dashboard" } },
      { event: "page_viewed", label: "Opened a prickle", where: { route: "/prickles/[id]" } },
      { event: "action_completed", label: "Saved a check-in", where: { action: "checkin_saved", ok: true } },
    ],
  },
  {
    title: "Rollout: weekly commitments",
    description: "Visits that opened My Prickles' commitments tab and set up a commitment.",
    steps: [
      { event: "page_viewed", label: "Opened commitments", where: { route: "/my-prickles/commitments" } },
      { event: "action_completed", label: "Created a commitment", where: { action: "commitment_created", ok: true } },
    ],
  },
  {
    title: "Rollout: profile",
    description: "Visits that opened the profile settings and saved them.",
    steps: [
      { event: "page_viewed", label: "Opened profile settings", where: { route: "/settings/profile" } },
      { event: "action_completed", label: "Saved the profile", where: { action: "profile_saved", ok: true } },
    ],
  },
  {
    title: "Rollout: the getting-started tour",
    description: "Visits where a member started the tour, marked a step, and finished it. Dismissals are in the all-events table below.",
    steps: [
      { event: "action_completed", label: "Started the tour", where: { action: "onboarding_started", ok: true } },
      { event: "action_completed", label: "Marked a step done", where: { action: "onboarding_step_marked", ok: true } },
      { event: "action_completed", label: "Finished the tour", where: { action: "onboarding_completed", ok: true } },
    ],
  },
];
