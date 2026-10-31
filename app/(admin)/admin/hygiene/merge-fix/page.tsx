import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { detectDuplicates } from "@/lib/member-duplicates";
import MergeFixClient from "./MergeFixClient";
import { sortGroupMembers } from "@/lib/merge-fix";
import type { EnrichedGroup } from "@/lib/merge-fix";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Merge & Fix",
};

export const dynamic = "force-dynamic";

export default async function MergeFixPage() {
  await requireAdminPage();
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const dismissedKeys = await createRepos(supabase).adminWork.dismissedGroupKeys();

  const allMembers = (await createRepos(supabase).members.list({ orderBy: "name" })).map((m) => ({
    id: m.id,
    name: m.name,
    displayName: m.displayName,
    email: m.email,
    status: m.status,
    stripe_customer_id: m.stripeCustomerId,
  }));

  const duplicateGroups = detectDuplicates(allMembers);

  // Enrich groups with Stripe status and sort so the best primary candidate is first
  const memberById = new Map(allMembers.map(m => [m.id, m]));
  const stripeIdsInGroups = Array.from(new Set(
    duplicateGroups
      .flatMap(g => g.members)
      .map(m => memberById.get(m.id)?.stripe_customer_id)
      .filter((id): id is string => !!id)
  ));

  const activeSubs = stripeIdsInGroups.length > 0
    ? await createRepos(supabase).billing.stripeSubscriptionStatuses(["active", "trialing", "past_due"], stripeIdsInGroups)
    : [];

  const activeStripeCustomers = new Set(activeSubs.map(s => s.stripe_customer_id));

  const enrichedGroups: EnrichedGroup[] = duplicateGroups.map(group => ({
    reason: group.reason,
    confidence: group.confidence,
    members: sortGroupMembers(
      group.members.map(m => {
        const raw = memberById.get(m.id);
        return {
          ...m,
          displayName: raw?.displayName ?? null,
          stripe_customer_id: raw?.stripe_customer_id ?? null,
          stripe_active: raw?.stripe_customer_id ? activeStripeCustomers.has(raw.stripe_customer_id) : false,
        };
      })
    ),
  }));

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin/hygiene"
            className="text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block"
          >
            ← Back to Data Hygiene
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Merge & Fix</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
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
