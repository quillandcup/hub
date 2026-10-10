import Link from "next/link";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import AskMeAboutTopics from "@/components/member/AskMeAboutTopics";
import MemberBadgeChips from "@/components/member/MemberBadgeChips";
import MemberSocialLinks from "@/components/member/MemberSocialLinks";
import type { MemberCard } from "@/lib/chat/load";

/** "March 2025" from a YYYY-MM-DD date, read as the calendar date it names. */
function monthYear(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * A member's profile in the chat's right panel: photo, name, how long they have been a Hedgie, bio,
 * what to ask them about, the badges they have earned and their links. Only what the full profile
 * page shows every member (no private notes), built from the same shared pieces as that page
 * (components/member/), with a way to the full page.
 */
export default function ProfileCard({ member }: { member: MemberCard }) {
  return (
    <div className="space-y-5 py-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <MemberAvatar name={member.name} photoUrl={member.photoUrl} size={96} />
        <p className="text-lg font-semibold">{member.name}</p>
        {member.firstJoinedAt && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Hedgie since {monthYear(member.firstJoinedAt)}</p>
        )}
      </div>

      {member.bio && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">{member.bio}</p>}

      {member.askMeAbout.length > 0 && (
        <section aria-label="Ask me about">
          <h3 className="mb-2 text-sm font-medium text-slate-500 dark:text-slate-400">Ask me about…</h3>
          <AskMeAboutTopics topics={member.askMeAbout} />
        </section>
      )}

      {member.badges.length > 0 && (
        <section aria-label="Badges">
          <h3 className="mb-2 text-sm font-medium text-slate-500 dark:text-slate-400">Badges</h3>
          <MemberBadgeChips badges={member.badges} />
        </section>
      )}

      <MemberSocialLinks
        twitterUrl={member.twitterUrl}
        instagramUrl={member.instagramUrl}
        facebookUrl={member.facebookUrl}
        className="justify-center"
      />

      <p className="text-center">
        <Link href={`/members/${member.id}`} className="text-sm text-plum-600 hover:underline dark:text-plum-400">
          View full profile
        </Link>
      </p>
    </div>
  );
}
