import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import RecordHistoryButton from "@/components/RecordHistoryButton";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import BadgeTypeForm, { type Category } from "../../BadgeTypeForm";
import { requireAdminPage } from "@/lib/admin-auth";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const badgeType = await createRepos(supabase).badges.typeById(id);
  return { title: badgeType?.name ?? "Edit Badge" };
}

export default async function EditBadgePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const supabase = await createClient();

  const badges = createRepos(supabase).badges;
  const [badgeType, levels, awardCounts, allEvents, linkedEventIds, programs] = await Promise.all([
    badges.typeById(id),
    badges.levelsOf(id),
    badges.awardCounts(),
    createRepos(supabase).events.choices(),
    badges.linkedEventIds({ exceptTypeId: id }),
    createRepos(supabase).programs.names(),
  ]);
  const awardCount = awardCounts.get(id) ?? 0;

  if (!badgeType) notFound();

  const events = allEvents.filter((e) => !linkedEventIds.has(e.id));

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 relative">
          <Link
            href="/admin/badges"
            className="text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block"
          >
            ← Back to Badges
          </Link>
          <h1 className="text-2xl font-bold">Edit Badge</h1>
          <div className="absolute top-4 right-6">
            <RecordHistoryButton
              entityType={["badge_type", "badge_level", "member_badge"]}
              entityId={id}
              parentColumn="badge_type_id"
              label={badgeType.name}
            />
          </div>
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
            programs={programs ?? []}
            initial={{
              name: badgeType.name,
              description: badgeType.description ?? "",
              icon: badgeType.icon,
              category: badgeType.category as Category, // a check constraint limits the column to these
              hasLevels: badgeType.has_levels,
              levels: (levels ?? []).map((l) => ({
                level: l.level,
                name: l.name,
                threshold: l.threshold != null ? String(l.threshold) : "",
              })),
              eventId: badgeType.event_id ?? null,
              programId: badgeType.program_id,
            }}
          />
        </div>
      </main>
    </div>
  );
}
