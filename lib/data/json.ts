import type { Json } from "./database.types";

/**
 * A parsed API payload (a Kajabi contact, a Stripe customer, a Zoom event...) stored whole in a
 * `jsonb` column. The vendor SDKs' types have optional and `undefined` fields that `Json` rejects,
 * though they serialize fine, so this is the one place that says "it is JSON".
 */
export const asJson = (value: unknown): Json => value as Json;
