import { formatPrickleTitle } from "@/lib/formatters";

// The prickle aggregate's pure behavior, beside its record. The record type comes from the data layer
// (lib/data/prickles.ts); this module has no database code, so server and client components can both import it.
export type { Prickle, PrickleDetail, PrickleType, PrickleHost } from "@/lib/data/prickles";

/** How a prickle is named, e.g. "Monday Progress Prickle with Jenn P": its own title if the host gave one, else its type and host. */
export function prickleTitle(prickle: {
  title: string | null;
  startTime: string;
  host: { name: string } | null;
  type: { name: string } | null;
}): string {
  return formatPrickleTitle({ title: prickle.title, start_time: prickle.startTime, host: prickle.host, prickle_types: prickle.type });
}
