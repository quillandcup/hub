import { ORG_TIMEZONE } from "@/lib/config";

/** "March 1, 2027", in the organisation's timezone (access ends at a moment, not a member's local midnight). */
export function formatCourseDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: ORG_TIMEZONE });
}
