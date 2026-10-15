/**
 * Whether `value` is an IANA time zone name Intl understands. "browser" (what's stored until a
 * member's first page load saves their detected zone) and anything else that isn't a zone are not.
 */
export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value || value === "browser") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
