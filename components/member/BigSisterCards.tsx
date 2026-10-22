import Link from "next/link";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import MemberHoverCard from "@/components/member/MemberHoverCard";
import type { MentorshipPartner, MyMentorships } from "@/lib/my-mentorship";
import ReasonForm from "@/app/(member)/big-sisters/ReasonForm";
import { parseDateOnly } from "@/lib/member-tenure";

function day(dateOnly: string): string {
  return parseDateOnly(dateOnly).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// TODO(docs/TODO.md "Big Sisters: message in the Hub"): replace this Slack link with a Hub DM once
// Hub chat can start one.
function Person({
  partner,
  slackLink,
  caption,
}: {
  partner: MentorshipPartner;
  slackLink: string | undefined;
  caption: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <MemberAvatar name={partner.name} photoUrl={partner.photoUrl} size={48} />
      <div className="min-w-0 flex-1">
        <MemberHoverCard memberId={partner.memberId} surface="big_sisters">
          <Link data-track="big-sister-open-partner"
            href={`/members/${partner.memberId}`}
            className="text-base font-semibold text-slate-900 dark:text-slate-100 hover:text-plum-600 dark:hover:text-plum-400"
          >
            {partner.name}
          </Link>
        </MemberHoverCard>
        <p className="text-xs text-slate-500 dark:text-slate-400">{caption}</p>
      </div>
      {slackLink && (
        <a data-track="big-sister-say-hi-on-slack"
          href={slackLink}
          className="shrink-0 px-3 py-1.5 text-sm font-medium bg-plum-600 hover:bg-plum-700 text-white rounded-lg transition-colors"
        >
          Say hi on Slack
        </a>
      )}
    </div>
  );
}

const CARD = "bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 mb-6";
const HEADING = "text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4";

/**
 * The member's own Big Sister matches: their big sister if they're new, and the new members they
 * are looking after if they're one. Renders nothing when there's neither. On the dashboard it's a
 * compact card that links to /big-sisters, which shows the same cards in full.
 */
export default function BigSisterCards({
  mentorships,
  slackLinks,
  linkToPage = false,
}: {
  mentorships: MyMentorships;
  /** Slack DM link per member id. */
  slackLinks: Record<string, string>;
  linkToPage?: boolean;
}) {
  const { bigSister, mentees } = mentorships;
  if (!bigSister && mentees.length === 0) return null;

  return (
    <>
      {bigSister && (
        <div className={CARD} data-tour="big-sister-card">
          <h2 className={HEADING}>Your Big Sister</h2>
          <Person
            partner={bigSister}
            slackLink={slackLinks[bigSister.memberId]}
            caption={`Here to show you around since ${day(bigSister.startedOn)}. Ask away.`}
          />
          {linkToPage && (
            <Link data-track="big-sister-about-big-sisters"
              href="/big-sisters"
              className="inline-block mt-4 text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400"
            >
              About Big Sisters →
            </Link>
          )}
        </div>
      )}
      {mentees.length > 0 && (
        <div className={CARD}>
          <h2 className={HEADING}>{mentees.length === 1 ? "Your new member" : "Your new members"}</h2>
          <div className="space-y-4">
            {mentees.map((m) => (
              <div key={m.mentorshipId}>
                <Person
                  partner={m}
                  slackLink={slackLinks[m.memberId]}
                  caption={`Joined ${day(m.startedOn)}. Say hello and invite them to a prickle.`}
                />
                {m.canRecordReason && <ReasonForm mentorshipId={m.mentorshipId} name={m.name} initialNote={m.note ?? ""} />}
              </div>
            ))}
          </div>
          {linkToPage && (
            <Link data-track="big-sister-about-big-sisters-2"
              href="/big-sisters"
              className="inline-block mt-4 text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400"
            >
              About Big Sisters →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
