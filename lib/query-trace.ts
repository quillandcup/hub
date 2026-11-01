import * as Sentry from "@sentry/nextjs";
import { DbQueryError, throwIfDbError } from "@/lib/db-error";
import { clock } from "@/lib/clock";
import { sendOperationsAlert } from "@/lib/operations-alerts";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";

/** A section slower than this is logged even when it succeeds, so a slow query shows up before it times out. */
export const SLOW_SECTION_MS = 2000;

/**
 * Runs one named part of a page or route and records how long it took. A slow one is logged
 * (Vercel logs and Sentry logs, with the duration); a failing one is tagged `section` on the
 * request's Sentry scope, so the error `onRequestError` reports already says which part failed,
 * and is rethrown as is after an alert to #hub-alerts (`section_failed`, docs/SLACK_OPERATIONS_ALERTS.md). Pass ids (member id), never names or emails, in `details`.
 */
export async function traced<T>(section: string, run: () => Promise<T>, details: Record<string, string> = {}): Promise<T> {
  const started = clock.now();
  try {
    return await run();
  } catch (error) {
    const scope = Sentry.getIsolationScope();
    scope.setTag("section", section);
    scope.setContext("section", { name: section, ms: clock.now() - started, ...details });
    const ms = clock.now() - started;
    console.error(`[section failed] ${section} after ${ms}ms`, details, error);
    // To #hub-alerts (rate-limited per section, never throws), so a failure is seen without watching Sentry.
    await sendOperationsAlert(createRepos(createServiceRoleClient()), { type: "section_failed", section, code: (error as { code?: string } | null)?.code, ms });
    throw error;
  } finally {
    const ms = clock.now() - started;
    if (ms >= SLOW_SECTION_MS) {
      console.warn(`[slow section] ${section} ${ms}ms`, details);
      Sentry.logger.warn(`Slow section ${section}`, { section, ms, ...details });
    }
  }
}

// Re-exported so existing imports keep working; client-reachable code imports lib/db-error directly (this file pulls in server-only modules).
export { DbQueryError, throwIfDbError };
