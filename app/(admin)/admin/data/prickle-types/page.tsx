import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prickle Types",
};

const PURPOSE_STYLES: Record<string, string> = {
  writing: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  work: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  social: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  mixed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function PurposeBadge({ purpose }: { purpose: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        PURPOSE_STYLES[purpose] ?? PURPOSE_STYLES.mixed
      }`}
    >
      {purpose}
    </span>
  );
}

function SoloTaskFriendlyBadge({ soloTaskFriendly }: { soloTaskFriendly: boolean }) {
  return soloTaskFriendly ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      No
    </span>
  );
}

export default async function PrickleTypesPage() {
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
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Normalized
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Purpose
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  BYO-Task Friendly
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {prickleTypes?.map((type: any) => (
                <tr key={type.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {type.name}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-slate-600 dark:text-slate-400 font-mono">
                      {type.normalized_name}
                    </div>
                  </td>
                  <td className="px-6 py-4 max-w-xs">
                    <div className="text-sm text-slate-600 dark:text-slate-400 truncate" title={type.description ?? ""}>
                      {type.description ?? <span className="text-slate-400 dark:text-slate-600 italic">—</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <PurposeBadge purpose={type.purpose} />
                  </td>
                  <td className="px-6 py-4">
                    <SoloTaskFriendlyBadge soloTaskFriendly={type.solo_task_friendly} />
                  </td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/admin/data/prickle-types/${type.id}/edit`}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
