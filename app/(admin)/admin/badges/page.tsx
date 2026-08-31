import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Badges",
};

const CATEGORY_LABELS: Record<string, string> = {
  milestone: "Milestone",
  community: "Community",
  course: "Course",
  retreat: "Retreat",
  special: "Special",
};

const CATEGORY_ORDER = ["milestone", "special", "community", "course", "retreat"];

export default async function BadgesPage() {
  const supabase = await createClient();

  const [{ data: badgeTypes }, { data: levels }, { data: awards }] = await Promise.all([
    supabase.from("badge_types").select("*").order("category").order("name"),
    supabase.from("badge_levels").select("*").order("level"),
    supabase.from("member_badges").select("badge_type_id"),
  ]);

  const levelsByType = new Map<string, typeof levels>();
  for (const level of levels ?? []) {
    const list = levelsByType.get(level.badge_type_id) ?? [];
    list.push(level);
    levelsByType.set(level.badge_type_id, list as any);
  }

  const awardCountByType = new Map<string, number>();
  for (const award of awards ?? []) {
    awardCountByType.set(award.badge_type_id, (awardCountByType.get(award.badge_type_id) ?? 0) + 1);
  }

  const grouped = new Map<string, typeof badgeTypes>();
  for (const type of badgeTypes ?? []) {
    const list = grouped.get(type.category) ?? [];
    list.push(type);
    grouped.set(type.category, list as any);
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Badges</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Badge definitions shown on member profiles. Award or revoke a badge from a member&apos;s
            admin page.
          </p>
        </div>
        <Link
          href="/admin/badges/new"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          + New Badge
        </Link>
      </div>

      <div className="space-y-6">
        {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
          <div key={cat} className="bg-white dark:bg-slate-900 rounded-lg shadow">
            <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {CATEGORY_LABELS[cat] ?? cat}
              </h2>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {(grouped.get(cat) ?? []).map((type: any) => {
                const typeLevels = (levelsByType.get(type.id) ?? []) as any[];
                return (
                  <div key={type.id} className="px-6 py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-2xl flex-shrink-0">{type.icon}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                            {type.name}
                          </span>
                          {type.is_automatic && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                              Automatic
                            </span>
                          )}
                          {type.has_levels && typeLevels.length > 0 && (
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              {typeLevels.map((l) => l.name).join(" → ")}
                            </span>
                          )}
                        </div>
                        {type.description && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {type.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {type.is_automatic
                          ? "computed automatically"
                          : `${awardCountByType.get(type.id) ?? 0} awarded`}
                      </span>
                      <Link
                        href={`/admin/badges/${type.id}/edit`}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Edit
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
