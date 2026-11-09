import { safeNextPath } from "@/lib/safe-next";

/**
 * Gates: system-mandated detours that stand between a visitor and the page they asked for (connect Slack before
 * chat opens, and the like; sign-in is the proxy's gate, see lib/supabase/middleware.ts). The standard, in
 * `.claude/rules/gates-and-return-to.md`: a gate carries the visitor's destination through every step (`?next=`,
 * validated by `safeNextPath`), sends them back to it when the requirement is met, and always offers "Not now" (`GateExit`),
 * which gives up the destination and goes to `declineTo`. A gate is declared here, so new ones are reviewed against the
 * standard and `tests/lib/gates.test.ts` can check them all.
 *
 * Pure (usable in client components); redirecting from a server page is `redirectToGate` in lib/gates.server.ts.
 */
export interface Gate {
  /** Stable name, for analytics and tests. */
  id: string;
  /** The page that handles the requirement. */
  path: string;
  /** Query that tells that page which gate it is (a page can serve several). */
  params: Readonly<Record<string, string>>;
  /** Why the visitor was stopped, in the words the page shows. */
  reason: string;
  /** Where "Not now" goes: the visitor gave up on their destination. Never itself gated. */
  declineTo: string;
  /** What `declineTo` is called on the "Not now" link. */
  declineLabel: string;
}

export const GATES = {
  connectSlack: {
    id: "connect-slack",
    path: "/settings",
    params: { slack: "required" },
    reason: "Chat needs your Slack account connected. Connect it once and you are in.",
    declineTo: "/dashboard",
    declineLabel: "your dashboard",
  },
} as const satisfies Record<string, Gate>;

/** The request header the proxy sets to the address being asked for (path and query), so a server page can tell a gate where to come back to (lib/gates.server.ts). */
export const CURRENT_PATH_HEADER = "x-hub-path";

/** The query parameter that carries the destination to the gate page and through its steps. */
export const RETURN_PARAM = "next";

/**
 * The gate's address with the visitor's destination attached. A destination that isn't a safe same-origin path, or is the
 * gate's own page (which would loop), is left off: the gate then ends at its fallback.
 */
export function gateHref(gate: Gate, destination?: string | null): string {
  const query = new URLSearchParams(gate.params);
  const next = safeNextPath(destination);
  if (next && next.split(/[?#]/, 1)[0] !== gate.path) query.set(RETURN_PARAM, next);
  return `${gate.path}?${query.toString()}`;
}

/** The destination a gate page was given (`?next=`), or null. Always a safe same-origin path. */
export function returnToParam(value: string | null | undefined): string | null {
  return safeNextPath(value);
}

/**
 * Where a gate sends the visitor once its requirement is met: their destination, else `fallback`. Never the gate's own page
 * again, so a destination that is itself the gate can't loop.
 */
export function afterGate(gate: Gate, destination: string | null | undefined, fallback: string): string {
  const next = safeNextPath(destination);
  return next && next.split(/[?#]/, 1)[0] !== gate.path ? next : fallback;
}
