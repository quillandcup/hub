import type { EarnedBadge } from "@/lib/badges";

const CATEGORY_STYLES: Record<string, string> = {
  milestone: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
  community: "bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800",
  course: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
  retreat: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
  special: "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800",
};

export default function BadgeChip({ badge }: { badge: EarnedBadge }) {
  const title = [badge.badgeType.description, badge.occurrences > 1 ? `Awarded ${badge.occurrences} times` : null]
    .filter(Boolean)
    .join(" — ");

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
        CATEGORY_STYLES[badge.badgeType.category] ?? CATEGORY_STYLES.community
      }`}
      title={title || undefined}
    >
      <span className="text-xl leading-none">{badge.badgeType.icon}</span>
      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{badge.levelName}</span>
    </div>
  );
}
