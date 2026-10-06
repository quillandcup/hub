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
 * reads it back), and any filter change starts again on page 1. The Actor and
 * Member pickers are the shared EntitySearch fed with staff and members.
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
          <span className="block mb-1">Actor (who did it)</span>
          <StaffSearch
            staff={staff}
            selectedUserId={filters.actorUserId}
            selectedName={actorName}
            onSelect={(user) => go({ actorUserId: user?.id ?? null })}
            placeholder="Search staff..."
          />
        </label>
        <label className="block text-sm text-slate-600 dark:text-slate-400">
          <span className="block mb-1">Member (who it was about)</span>
          <MemberSearch
            members={members}
            selectedMemberId={filters.memberId}
            selectedMemberName={memberName}
            onSelect={(member) => go({ memberId: member?.id ?? null })}
            placeholder="Search members..."
          />
        </label>
      </div>
    </div>
  );
}
