import Link from "next/link";

/**
 * Settings, Profile: where the member's milestones used to be listed. They are with each project in My Writing now
 * (docs/product/FINISHERS.md), so this is only a pointer, not a section (the search finds them at My Writing).
 */
export function MilestonesPointer() {
  return (
    <p className="mt-6 border-t border-slate-200 dark:border-slate-700 pt-6 text-sm text-slate-600 dark:text-slate-400" data-testid="milestones-pointer">
      Your milestones are with your projects in{" "}
      <Link href="/projects" data-track="settings-milestones-pointer" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 underline underline-offset-2">
        My Writing
      </Link>
      .
    </p>
  );
}
