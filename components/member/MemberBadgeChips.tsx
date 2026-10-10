import BadgeChip from "@/components/BadgeChip";
import type { EarnedBadge } from "@/lib/badges";

/** A member's earned badges as chips; a retreat badge links to its event. (Profile and chat panel.) */
export default function MemberBadgeChips({ badges }: { badges: EarnedBadge[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <BadgeChip
          key={badge.badgeType.id}
          badge={badge}
          href={badge.badgeType.event_slug ? `/events/${badge.badgeType.event_slug}` : null}
        />
      ))}
    </div>
  );
}
