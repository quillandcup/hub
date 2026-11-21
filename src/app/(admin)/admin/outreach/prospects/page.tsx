import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import ProspectsView from "./ProspectsView";

export const metadata: Metadata = {
  title: "Prospects · Outreach",
};

export default async function ProspectsPage() {
  await requireAdminPage();
  const prospects = await createRepos(await createClient()).prospects.list();

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/outreach" className="text-plum-600 dark:text-plum-400 hover:underline mb-2 inline-block">
            ← Back to Outreach
          </Link>
          <h1 className="text-2xl font-bold">🔭 Prospects</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Writers on Instagram who might love Quill &amp; Cup, scored by the rules in the Hub. Review them, then reach out from your own account.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <ProspectsView prospects={prospects} />
      </main>
    </div>
  );
}
