import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import BadgeTypeForm from "../BadgeTypeForm";

export const metadata: Metadata = {
  title: "New Badge",
};

export default async function NewBadgePage() {
  const supabase = await createClient();
  const [{ data: allEvents }, { data: linkedBadges }] = await Promise.all([
    supabase.from("events").select("id, title, starts_at").order("starts_at", { ascending: false }),
    supabase.from("badge_types").select("event_id").not("event_id", "is", null),
  ]);
  const linkedEventIds = new Set((linkedBadges ?? []).map((b) => b.event_id));
  const events = (allEvents ?? []).filter((e) => !linkedEventIds.has(e.id));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin/badges"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Badges
          </Link>
          <h1 className="text-2xl font-bold">New Badge</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl">
          <BadgeTypeForm mode="create" events={events} />
        </div>
      </main>
    </div>
  );
}
