import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Metadata } from "next";
import PrickleTypesTable from "./PrickleTypesTable";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Prickle Types",
};

export default async function PrickleTypesPage() {
  await requireAdminPage();
  const supabase = await createClient();

  // Fetch all prickle types
  const { data: prickleTypes } = await supabase
    .from("prickle_types")
    .select("id, name, normalized_name, description, purpose, solo_task_friendly")
    .order("name");

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Prickle Types</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Manage prickle type categories used for event classification
        </p>
      </div>

      {/* Prickle Types List */}
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-xl font-bold">All Types ({prickleTypes?.length || 0})</h2>
          <Link
            href="/admin/data/prickle-types/new"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            + Add Type
          </Link>
        </div>
        <PrickleTypesTable rows={prickleTypes ?? []} />
      </div>
    </div>
  );
}
