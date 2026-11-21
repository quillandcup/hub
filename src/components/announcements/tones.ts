/** The three looks of an announcement bar. Shared with the in-app notification banners, which keep their own behavior but not their own colors. */
export type AnnouncementTone = "info" | "notice" | "critical";

/** Every tone passes 4.5:1 for its text in light and dark mode (the page-accessibility check). */
export const ANNOUNCEMENT_TONE_CLASSES: Record<AnnouncementTone, string> = {
  // A quiet tint: something worth doing, nothing wrong.
  info: "border-b border-plum-200 bg-plum-50 text-plum-900 dark:border-plum-900 dark:bg-plum-950 dark:text-plum-100",
  // The strong plum strip: a state of the page, or a notification that is time-sensitive.
  notice: "border-b border-plum-700 bg-plum-600 text-white",
  // Red: you are somewhere you could do damage (sudo).
  critical: "border-b border-red-700 bg-red-600 text-white",
};

/** Layout shared by every bar: wraps on small screens. */
export const ANNOUNCEMENT_BAR_LAYOUT = "flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-2 text-sm";
