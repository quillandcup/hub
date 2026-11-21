import { createRepos } from "@/lib/data/repos";
import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import BadgeTypeForm from "../BadgeTypeForm";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "New Badge",
};

export default async function NewBadgePage() {
  await requireAdminPage();
  const supabase = await createClient();
  const repos = createRepos(supabase);
  const [allEvents, linkedEventIds, programs] = await Promise.all([
    repos.events.choices(),
    repos.badges.linkedEventIds(),
    repos.programs.names(),
  ]);
  const events = allEvents.filter((e) => !linkedEventIds.has(e.id));

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin/badges"
            className="text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block"
          >
            ← Back to Badges
          </Link>
          <h1 className="text-2xl font-bold">New Badge</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl">
          <BadgeTypeForm mode="create" events={events} programs={programs ?? []} />
        </div>
      </main>
    </div>
  );
}
