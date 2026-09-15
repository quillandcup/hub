import { safeUrl } from "@/lib/url";
import type { AwardInput } from "@/app/(member)/awards/actions";

/** Shared field validation for a member_awards row -- used by app/(member)/awards/actions.ts. */
export function validateAwardInput(input: AwardInput): string | null {
  if (!input.awardName?.trim()) return "Award name is required";
  if (!input.workTitle?.trim()) return "The title of what won is required";
  if (!input.awardDate) return "Date is required";
  if (input.url?.trim() && !safeUrl(input.url)) return "Enter a valid link (starting with https://), or leave it blank";
  return null;
}
