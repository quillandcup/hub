import BadgeChip from "@/components/BadgeChip";
import { badgeHref, type EarnedBadge } from "@/lib/badges";

/** A member's earned badges as chips; a retreat badge links to its event, Big Sister to /big-sisters. (Profile and chat panel.) */
export default function MemberBadgeChips({
  badges,
  bigSistersEnabled = false,
}: {
  badges: EarnedBadge[];
  /** The viewer has the big_sisters preview, so the Big Sister badge can link to its page. */
  bigSistersEnabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <BadgeChip
          key={badge.badgeType.id}
          badge={badge}
          href={badgeHref(badge.badgeType, { bigSistersEnabled })}
        />
      ))}
    </div>
  );
}
