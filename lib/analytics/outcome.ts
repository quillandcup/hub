import type { ActionOutcome } from "@/lib/analytics/server";

/**
 * Whether an API route's response means it worked, for `withAction`: anything under 400 did; a refusal or a failure is
 * recorded as not worked, with its status as the detail (`403`, `500`), so a spike of one kind shows up.
 */
export function responseOutcome(response: Response): ActionOutcome {
  return response.status < 400 ? { ok: true } : { ok: false, detail: String(response.status) };
}
