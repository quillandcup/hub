import { ORG_TIMEZONE } from "@/lib/config";
import { isId } from "@/lib/ids";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";
import { ACCESS_OPTIONS } from "@/lib/courses/access-options";
import { slugifyTitle } from "@/lib/courses/visibility";

/**
 * The details of a Hub-owned course as the course editor takes them, checked in one place for the
 * create and the edit action (and the form, which shows the same messages). Pure.
 */

export interface CourseDetailsInput {
  title: string;
  /** Left empty, the address comes from the title. */
  slug: string;
  description: string;
  /** The index into `ACCESS_OPTIONS`, as a string; "" means nothing was chosen (there is no default). */
  accessChoice: string;
  /** The opening day (YYYY-MM-DD in the organisation's timezone), or "" to open as soon as someone has access. */
  launchOn: string;
  /** A program's id, or "" for none. */
  programId: string;
}

/** What gets stored, in the columns' own shape. */
export interface CourseDetails {
  title: string;
  slug: string;
  description: string | null;
  access_duration: string | null;
  launch_at: string | null;
  program_id: string | null;
}

export type CourseDetailsErrors = Partial<Record<keyof CourseDetailsInput, string>>;

export const MAX_TITLE = 120;
export const MAX_SLUG = 60;
export const MAX_DESCRIPTION = 2000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseCourseDetails(input: CourseDetailsInput): { ok: true; value: CourseDetails } | { ok: false; errors: CourseDetailsErrors } {
  const errors: CourseDetailsErrors = {};

  const title = input.title.trim();
  if (!title) errors.title = "Give the course a name.";
  else if (title.length > MAX_TITLE) errors.title = `Keep the name under ${MAX_TITLE} characters.`;

  // Left empty, the address comes from the name, cut to fit rather than refused.
  const slug = input.slug.trim() || slugifyTitle(title).slice(0, MAX_SLUG).replace(/-+$/, "");
  if (title && !slug) errors.slug = "Add an address (letters and numbers).";
  else if (slug.length > MAX_SLUG) errors.slug = `Keep the address under ${MAX_SLUG} characters.`;
  else if (slug && !SLUG_PATTERN.test(slug)) errors.slug = "Use lowercase letters, numbers and single hyphens.";

  const description = input.description.trim();
  if (description.length > MAX_DESCRIPTION) errors.description = `Keep the description under ${MAX_DESCRIPTION} characters.`;

  const option = /^\d+$/.test(input.accessChoice) ? ACCESS_OPTIONS[Number(input.accessChoice)] : undefined;
  if (!option) errors.accessChoice = "Choose how long access lasts.";

  let launchAt: string | null = null;
  if (input.launchOn !== "") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input.launchOn) && !Number.isNaN(Date.parse(input.launchOn))) launchAt = zonedTimeToUtc(input.launchOn, "00:00", ORG_TIMEZONE).toISOString();
    else errors.launchOn = "Pick a day.";
  }

  if (input.programId !== "" && !isId(input.programId, "prg")) errors.programId = "Pick one of the programs, or none.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      slug,
      description: description || null,
      access_duration: option!.value,
      launch_at: launchAt,
      program_id: input.programId || null,
    },
  };
}

/** A module's or lesson's name: trimmed, and between 1 and `MAX_TITLE` characters. */
export function parseItemTitle(title: string): { ok: true; title: string } | { ok: false; error: string } {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, error: "Give it a name." };
  if (trimmed.length > MAX_TITLE) return { ok: false, error: `Keep the name under ${MAX_TITLE} characters.` };
  return { ok: true, title: trimmed };
}
