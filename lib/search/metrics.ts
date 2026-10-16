import * as Sentry from "@sentry/nextjs";

/** Where a search ran from; the `surface` attribute on `search.duration`. */
export type SearchSurface = "palette" | "results_page";

/**
 * Records where a search's time went as `search.duration` (never the query text): `setup` (auth and
 * context), each kind's own time, any sub-stages a searcher reported (`stagesMs`), and the server `total`. The palette's client-side `roundtrip`
 * is recorded by the component. `chat` is `included` when the chat searcher ran (even with no
 * hits), otherwise `excluded`, so counts and latency can be compared by chat participation.
 */
export function recordSearchTimings(
  surface: SearchSurface,
  { setupMs, totalMs, kindsMs, stagesMs = {} }: { setupMs: number; totalMs: number; kindsMs: Record<string, number>; stagesMs?: Record<string, number> }
) {
  const record = (value: number, attributes: Record<string, string>) =>
    Sentry.metrics.distribution("search.duration", value, { unit: "millisecond", attributes: { surface, chat: kindsMs.chat !== undefined ? "included" : "excluded", ...attributes } });
  record(setupMs, { stage: "setup" });
  record(totalMs, { stage: "total" });
  for (const [kind, ms] of Object.entries(kindsMs)) record(ms, { stage: "kind", kind });
  for (const [stage, ms] of Object.entries(stagesMs)) record(ms, { stage });
}
