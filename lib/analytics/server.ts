import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { SUDO_COOKIE_NAME, actingAsHeaderValue } from "@/lib/sudo-cookie";
import type { OutcomeAction } from "@/lib/analytics/actions";
import { validateProperties } from "@/lib/analytics/events";
import { SESSION_COOKIE } from "@/lib/analytics/session-cookie";
import { isAnalyticsOptedOut } from "@/lib/analytics/opt-out";

/**
 * Server side of usage tracking: what a server action did, not just that someone clicked.
 *
 * A server action is wired up with `withAction` at the bottom of its file:
 *
 *   async function createProjectImpl(...) { ... }
 *   export async function createProject(...args: Parameters<typeof createProjectImpl>) {
 *     return withAction("project_created", () => createProjectImpl(...args));
 *   }
 *
 * It records `action_completed` with the action and whether it worked, in the visit that made the
 * request. It records nothing without the visit's session cookie, which the browser only sets while
 * usage tracking is allowed (lib/analytics/session-cookie.ts), so a visitor who declined, or who
 * isn't signed in, is never recorded. Recording can't fail the action: every problem is logged and
 * swallowed, and the action's own result (or error) always comes back unchanged.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ActionOutcome {
  ok: boolean;
  /** A short word qualifying "ok", e.g. "nobody" for a wheel spin that found no one. */
  detail?: string;
}

/**
 * Whether an action's result means it worked. The app's actions report failure as `{ error }`
 * (most), or `{ success: false }` / `{ ok: false }`; anything else, including nothing, is success.
 */
export function actionOutcome(result: unknown): ActionOutcome {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.error || r.success === false || r.ok === false) return { ok: false };
  }
  return { ok: true };
}

/** A redirect thrown by an action is how it finishes, not a failure. */
function isRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Records one outcome for the current visit, if there is one. Never throws. */
export async function recordAction(action: OutcomeAction, outcome: ActionOutcome): Promise<void> {
  try {
    const store = await cookies();
    const session = store.get(SESSION_COOKIE)?.value;
    if (!session || !UUID.test(session)) return;

    const user = await getCurrentUser();
    if (!user) return;
    // A visit cookie can outlive the switch on /privacy by up to 30 minutes.
    if (await isAnalyticsOptedOut(user.id)) return;

    const properties = validateProperties("action_completed", { action, ok: outcome.ok, detail: outcome.detail });
    if (!properties.ok) return;

    await createRepos(await createClient()).analyticsEvents.record([
      {
        message_id: crypto.randomUUID(),
        user_id: user.id,
        session_id: session,
        source: "server",
        event: "action_completed",
        properties: properties.properties,
        context: {},
        sudo: actingAsHeaderValue(store.get(SUDO_COOKIE_NAME)?.value, user.id) !== null,
        occurred_at: new Date().toISOString(),
      },
    ]);
  } catch (error) {
    // No request scope (a test, a script), no session store, a database hiccup: none of it may reach the action.
    console.error("[analytics] Recording an action outcome failed:", error instanceof Error ? error.message : error);
  }
}

/**
 * Runs a server action and records how it went. The result, or the error it threw, is returned
 * unchanged; a thrown redirect counts as success. `classify` overrides what "worked" means.
 */
export async function withAction<T>(
  action: OutcomeAction,
  run: () => Promise<T>,
  classify: (result: T) => ActionOutcome = actionOutcome
): Promise<T> {
  let result: T;
  try {
    result = await run();
  } catch (error) {
    await recordAction(action, { ok: isRedirect(error) });
    throw error;
  }
  await recordAction(action, classify(result));
  return result;
}
