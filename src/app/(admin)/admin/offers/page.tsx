import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { coverageState, loadOfferCoverage } from "@/lib/offer-coverage";
import OffersTable from "./OffersTable";

export const metadata: Metadata = { title: "Kajabi Offers" };

export default async function AdminOffersPage() {
  await requireAdminPage();
  const supabase = await createClient();
  const rows = await loadOfferCoverage(createRepos(supabase));
  const counts = { mapped: 0, unmapped: 0, multiple: 0 };
  for (const row of rows) counts[coverageState(row)]++;

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold">Kajabi Offers</h1>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        Before we leave Kajabi, each offer should be matched to exactly one resource in the Hub. An offer that matches none is something
        the Hub doesn&apos;t represent yet. Link offers from an{" "}
        <Link href="/admin/events" className="underline">
          event
        </Link>
        , a{" "}
        <Link href="/admin/programs" className="underline">
          program
        </Link>
        , or a{" "}
        <Link href="/admin/courses" className="underline">
          course
        </Link>{" "}
        (courses take theirs from Kajabi).
      </p>
      <p className="mb-6 text-sm">
        {rows.length} offers: {counts.mapped} mapped, {counts.unmapped} not in the Hub yet, {counts.multiple} with more than one resource.
      </p>

      <OffersTable rows={rows} />
    </div>
  );
}
