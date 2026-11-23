import type { SupabaseClient } from "@supabase/supabase-js";

const STAFF_ROLES = ["admin", "assistant", "community_manager", "conversion_specialist"];

/**
 * Gives a user exactly these staff roles (`"member"` or an empty list: none), writing `user_roles` with a service-role client. A
 * test's way to set up who someone is; the product's way is `set_user_roles` (which also checks who may change what).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function giveRoles(db: SupabaseClient<any, any, any>, userId: string, roles: string | readonly string[]) {
  const wanted = (typeof roles === "string" ? [roles] : [...roles]).filter((r) => STAFF_ROLES.includes(r));
  const removed = await db.from("user_roles").delete().eq("user_id", userId);
  if (removed.error) throw new Error(`clearing roles failed: ${removed.error.message}`);
  if (wanted.length === 0) return;
  const added = await db.from("user_roles").insert(wanted.map((role) => ({ user_id: userId, role })));
  if (added.error) throw new Error(`giving roles failed: ${added.error.message}`);
}
