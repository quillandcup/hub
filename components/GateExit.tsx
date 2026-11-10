import Link from "next/link";
import type { Gate } from "@/lib/gates";

/**
 * The way out of a gate (lib/gates.ts, `.claude/rules/gates-and-return-to.md`): "Not now", which gives up the page the visitor was
 * headed to and goes to the gate's `declineTo`. Every page that serves a gate shows one, since the gate stands between the visitor
 * and what they asked for. A server component, so a gate page can use it from either side.
 */
export default function GateExit({ gate, className = "" }: { gate: Gate; className?: string }) {
  return (
    <Link
      href={gate.declineTo}
      data-track={`gate-exit-${gate.id}`}
      className={`text-sm font-medium text-slate-700 underline hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100 ${className}`}
    >
      Not now, go to {gate.declineLabel}
    </Link>
  );
}
