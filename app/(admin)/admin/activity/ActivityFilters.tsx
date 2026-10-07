"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import MemberSearch from "@/components/MemberSearch";
import StaffSearch, { type StaffUser } from "@/components/StaffSearch";
import {
  FEED_DAY_OPTIONS,
  FEED_KINDS,
  FEED_KIND_LABELS,
  feedSearch,
  type FeedFilters,
} from "@/lib/activity-feed";

const BASE = "/admin/activity";

const pill = (active: boolean) =>
  `px-3 py-1 rounded-full text-sm border transition-colors ${
    active
      ? "bg-plum-600 border-plum-600 text-white"
      : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
  }`;

interface PickerMember {
  id: string;
  name: string;
  email: string;
}

/**
 * Filter bar for the activity log. Everything lives in the URL (the server page
 * reads it back), and any filter change starts again on page 1. Member is the main
 * filter (members are mostly their own actors); the staff picker only narrows to one
 * admin's actions. Both are the shared EntitySearch.
 */
export default function ActivityFilters({
  filters,
  staff,
  members,
  actorName,
  memberName,
}: {
  filters: FeedFilters;
  staff: StaffUser[];
  members: PickerMember[];
  /** Names for the selected ids when they aren't in the picker lists (e.g. a member as actor). */
  actorName: string | null;
  memberName: string | null;
}) {
  const router = useRouter();
  const href = (patch: Partial<FeedFilters>) => `${BASE}${feedSearch({ ...filters, ...patch })}`;
  const go = (patch: Partial<FeedFilters>) => router.push(href(patch));

  return (
    <div className="space-y-3 mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ view: "audit", kinds: null })} className={pill(filters.view === "audit")}>
          Audit
        </Link>
        <Link href={href({ view: "all" })} className={pill(filters.view === "all")}>
          Everything
        </Link>
        <span className="mx-2 h-5 w-px bg-slate-300 dark:bg-slate-700" aria-hidden />
        {FEED_DAY_OPTIONS.map((d) => (
          <Link key={d} href={href({ days: d })} className={pill(filters.days === d)}>
            {d === 1 ? "24h" : `${d}d`}
          </Link>
        ))}
        <span className="mx-2 h-5 w-px bg-slate-300 dark:bg-slate-700" aria-hidden />
        <Link
          href={href({ sudoOnly: !filters.sudoOnly })}
          aria-pressed={filters.sudoOnly}
          className={pill(filters.sudoOnly)}
          title="Only what an admin did while viewing as a member"
        >
          Viewed as member
        </Link>
      </div>

      {filters.view === "all" && (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ kinds: null })} className={pill(filters.kinds === null)}>
            All types
          </Link>
          {FEED_KINDS.map((k) => (
            <Link
              key={k}
              href={href({ kinds: [k] })}
              className={pill(filters.kinds?.length === 1 && filters.kinds[0] === k)}
            >
              {FEED_KIND_LABELS[k]}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
        <label className="block text-sm text-slate-600 dark:text-slate-400">
          <span className="block mb-1">Member</span>
          <MemberSearch
            members={members}
            selectedMemberId={filters.memberId}
            selectedMemberName={memberName}
            // A member's own actions only appear outside the Audit view, so picking one shows Everything.
            onSelect={(member) => go({ memberId: member?.id ?? null, ...(member ? { view: "all" as const } : {}) })}
            placeholder="Search members..."
          />
          <span className="block mt-1 text-xs text-slate-500">What they did, and what staff did for them or as them</span>
        </label>
        <label className="block text-sm text-slate-600 dark:text-slate-400">
          <span className="block mb-1">Staff member</span>
          <StaffSearch
            staff={staff}
            selectedUserId={filters.actorUserId}
            selectedName={actorName}
            onSelect={(user) => go({ actorUserId: user?.id ?? null })}
            placeholder="Search staff..."
          />
          <span className="block mt-1 text-xs text-slate-500">Only what this admin or assistant did</span>
        </label>
      </div>
    </div>
  );
}
