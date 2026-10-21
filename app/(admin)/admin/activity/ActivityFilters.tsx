"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import MemberSearch from "@/components/MemberSearch";
import StaffSearch, { type StaffUser } from "@/components/StaffSearch";
import {
  CENTRAL_DEFAULTS,
  MEMBER_DEFAULTS,
  FEED_DAY_OPTIONS,
  FEED_KINDS,
  FEED_KIND_LABELS,
  feedSearch,
  type FeedFilters,
} from "@/lib/activity-feed";

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

type ActivityFiltersProps =
  | {
      /** The central log: every view, with the member and staff pickers. */
      variant?: "central";
      filters: FeedFilters;
      staff: StaffUser[];
      members: PickerMember[];
      /** Names for the selected ids when they aren't in the picker lists (e.g. a member as actor). */
      actorName: string | null;
      memberName: string | null;
    }
  | {
      /** One member's Activity Log tab: no pickers (the page is the member), no Privacy view. */
      variant: "member";
      filters: FeedFilters;
      /** The tab's own path, e.g. /admin/members/<id>/activity. */
      basePath: string;
    };

/**
 * Filter bar for the activity log, shared by /admin/activity and a member's Activity Log
 * tab. Everything lives in the URL (the server page reads it back), and any filter change
 * starts again on page 1. In the central log, Member is the main filter (members are mostly
 * their own actors) and the staff picker only narrows to one admin's actions; both are the
 * shared EntitySearch. The member variant keeps everything else.
 */
export default function ActivityFilters(props: ActivityFiltersProps) {
  const { filters } = props;
  const member = props.variant === "member";
  const router = useRouter();
  const defaults = member ? MEMBER_DEFAULTS : CENTRAL_DEFAULTS;
  const base = props.variant === "member" ? props.basePath : "/admin/activity";
  const href = (patch: Partial<FeedFilters>) =>
    // On a member's tab the member is the path, not a param.
    `${base}${feedSearch({ ...filters, ...patch, ...(member ? { memberId: null } : {}) }, defaults)}`;
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
        {!member && (
          <Link
            href={href({ view: "privacy", kinds: null })}
            className={pill(filters.view === "privacy")}
            title="Changes to which Slack channels staff can read"
          >
            Privacy
          </Link>
        )}
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
        <Link
          href={href({ hideSystem: !filters.hideSystem })}
          aria-pressed={filters.hideSystem}
          className={pill(filters.hideSystem)}
          title="Hide changes made by the system (imports, scheduled jobs, triggers)"
        >
          Hide system
        </Link>
        <Link
          href={href({ hideSlack: !filters.hideSlack })}
          aria-pressed={filters.hideSlack}
          className={pill(filters.hideSlack)}
          title="Hide member activity that came from Slack"
        >
          Hide Slack
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

      {props.variant !== "member" && (
      <div className="@container">
        <div className="grid gap-3 @xl:grid-cols-2 max-w-2xl">
        <label className="block text-sm text-slate-600 dark:text-slate-400">
          <span className="block mb-1">Member</span>
          <MemberSearch
            members={props.members}
            selectedMemberId={filters.memberId}
            selectedMemberName={props.memberName}
            // A member's own actions only appear outside the Audit view, so picking one shows Everything.
            onSelect={(member) => go({ memberId: member?.id ?? null, ...(member ? { view: "all" as const } : {}) })}
            placeholder="Search members..."
          />
          <span className="block mt-1 text-xs text-slate-500">What they did, and what staff did for them or as them</span>
        </label>
        <label className="block text-sm text-slate-600 dark:text-slate-400">
          <span className="block mb-1">Staff member</span>
          <StaffSearch
            staff={props.staff}
            selectedUserId={filters.actorUserId}
            selectedName={props.actorName}
            onSelect={(user) => go({ actorUserId: user?.id ?? null })}
            placeholder="Search staff..."
          />
          <span className="block mt-1 text-xs text-slate-500">Only what this admin or assistant did</span>
        </label>
      </div>
      </div>
      )}
    </div>
  );
}
