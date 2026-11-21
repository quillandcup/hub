import { ORG_TIMEZONE } from "@/lib/config";

/** "March 1, 2027", in the organisation's timezone (access ends at a moment, not a member's local midnight). */
export function formatCourseDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: ORG_TIMEZONE });
}

/** "October 6, 2026 at 10:10 PM", in the organisation's timezone. */
export function formatCourseDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: ORG_TIMEZONE });
}
