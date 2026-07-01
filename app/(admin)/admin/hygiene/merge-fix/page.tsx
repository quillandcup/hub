import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { detectDuplicates } from "@/lib/member-duplicates";
import MergeFixClient from "./MergeFixClient";
import { sortGroupMembers } from "@/lib/merge-fix";
import type { EnrichedGroup } from "@/lib/merge-fix";

export const dynamic = "force-dynamic";

export default async function MergeFixPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: dismissedRows } = await supabase
    .from("dismissed_duplicate_groups")
    .select("group_key")
    .eq("user_id", user.id);
  const dismissedKeys = new Set((dismissedRows ?? []).map((r) => r.group_key));

  // Paginate in case member count grows
  const allMembers: { id: string; name: string; email: string; status: string; stripe_customer_id: string | null }[] = [];
  const BATCH = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("members")
      .select("id, name, email, status, stripe_customer_id")
      .order("name")
      .range(offset, offset + BATCH - 1);
    if (batch && batch.length > 0) {
      allMembers.push(...batch);
      offset += batch.length;
      hasMore = batch.length === BATCH;
    } else {
      hasMore = false;
    }
  }

  const duplicateGroups = detectDuplicates(allMembers);

  // Enrich groups with Stripe status and sort so the best primary candidate is first
  const memberById = new Map(allMembers.map(m => [m.id, m]));
  const stripeIdsInGroups = Array.from(new Set(
    duplicateGroups
      .flatMap(g => g.members)
      .map(m => memberById.get(m.id)?.stripe_customer_id)
      .filter((id): id is string => !!id)
  ));

  const { data: activeSubs } = stripeIdsInGroups.length > 0
    ? await supabase.schema("bronze").from("stripe_subscriptions")
        .select("stripe_customer_id")
        .in("stripe_customer_id", stripeIdsInGroups)
        .in("status", ["active", "trialing", "past_due"])
    : { data: [] as { stripe_customer_id: string }[] };

  const activeStripeCustomers = new Set((activeSubs ?? []).map(s => s.stripe_customer_id));

  const enrichedGroups: EnrichedGroup[] = duplicateGroups.map(group => ({
    reason: group.reason,
    members: sortGroupMembers(
      group.members.map(m => {
        const raw = memberById.get(m.id);
        return {
          ...m,
          stripe_customer_id: raw?.stripe_customer_id ?? null,
          stripe_active: raw?.stripe_customer_id ? activeStripeCustomers.has(raw.stripe_customer_id) : false,
        };
      })
    ),
  }));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin/hygiene"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Data Hygiene
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Merge & Fix</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Potential duplicate members detected by matching name or email
              </p>
            </div>
            {duplicateGroups.length > 0 && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                {duplicateGroups.length}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <MergeFixClient duplicateGroups={enrichedGroups} dismissedKeys={dismissedKeys} />
      </main>
    </div>
  );
}
