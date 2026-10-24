import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * The typed Supabase client every repository takes. Column names, nullability and enum values in
 * `.from("x").select(...)` are checked against `database.types.ts` (regenerate with `pnpm types:gen`).
 * Callers still holding an untyped client can pass it in: repositories are where the types start.
 */
export type Db = SupabaseClient<Database>;

/** Row type of a `public` table, e.g. `Row<"prickle_attendance">`. */
export type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
