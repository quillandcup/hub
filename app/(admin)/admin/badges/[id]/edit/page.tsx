import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import BadgeTypeForm from "../../BadgeTypeForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: badgeType } = await supabase.from("badge_types").select("name").eq("id", id).single();
  return { title: badgeType?.name ?? "Edit Badge" };
}

export default async function EditBadgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: badgeType }, { data: levels }, { count: awardCount }, { data: allEvents }, { data: linkedBadges }] =
    await Promise.all([
      supabase.from("badge_types").select("*").eq("id", id).single(),
      supabase.from("badge_levels").select("*").eq("badge_type_id", id).order("level"),
      supabase.from("member_badges").select("id", { count: "exact", head: true }).eq("badge_type_id", id),
      supabase.from("events").select("id, title, starts_at").order("starts_at", { ascending: false }),
      supabase.from("badge_types").select("event_id").not("event_id", "is", null).neq("id", id),
    ]);

  if (!badgeType) notFound();

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
          <h1 className="text-2xl font-bold">Edit Badge</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl">
          <BadgeTypeForm
            mode="edit"
            badgeTypeId={badgeType.id}
            isAutomatic={badgeType.is_automatic}
            awardCount={awardCount ?? 0}
            events={events}
            initial={{
              name: badgeType.name,
              description: badgeType.description ?? "",
              icon: badgeType.icon,
              category: badgeType.category,
              hasLevels: badgeType.has_levels,
              levels: (levels ?? []).map((l) => ({
                level: l.level,
                name: l.name,
                threshold: l.threshold != null ? String(l.threshold) : "",
              })),
              eventId: badgeType.event_id,
            }}
          />
        </div>
      </main>
    </div>
  );
}
