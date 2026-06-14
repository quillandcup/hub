import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { detectDuplicates } from "@/lib/member-duplicates";
import MergeFixClient from "./MergeFixClient";

export const dynamic = "force-dynamic";

export default async function MergeFixPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Paginate in case member count grows
  const allMembers: { id: string; name: string; email: string; status: string }[] = [];
  const BATCH = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("members")
      .select("id, name, email, status")
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
        <MergeFixClient duplicateGroups={duplicateGroups} />
      </main>
    </div>
  );
}
