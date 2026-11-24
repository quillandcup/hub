import Link from "next/link";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import MemberHoverCard from "@/components/member/MemberHoverCard";

type Surface = React.ComponentProps<typeof MemberHoverCard>["surface"];

interface Shared {
  /** The Hub member; absent for a person we can't link (a Slack user not matched), who is shown without a link or card. */
  memberId: string | null | undefined;
  name: string;
  surface: Surface;
  /** Where the link goes. */
  href: string;
  /** Pass false when the link keeps the page's scroll position (chat opens a side panel). */
  scroll?: boolean;
  trackName: string;
}

/**
 * A member's avatar (their photo, else their initials) inside the member hover card, linking to their
 * profile. The link is hidden from assistive technology and skipped by Tab, so the name next to it
 * (`MemberNameLink`) is the one stop; the card still opens from either. Without a member id it is the
 * plain avatar. Shared by chat and lesson comments.
 */
export function MemberAvatarLink({ memberId, name, photoUrl, size, surface, href, scroll, trackName }: Shared & { photoUrl: string | null; size: number }) {
  if (!memberId) {
    return (
      <span aria-hidden="true">
        <MemberAvatar name={name} photoUrl={photoUrl} size={size} />
      </span>
    );
  }
  return (
    <MemberHoverCard memberId={memberId} surface={surface}>
      <Link data-track={trackName} href={href} scroll={scroll} aria-hidden="true" tabIndex={-1}>
        <MemberAvatar name={name} photoUrl={photoUrl} size={size} />
      </Link>
    </MemberHoverCard>
  );
}

/** A member's name as a link to their profile inside the member hover card; plain bold text without a member id. */
export function MemberNameLink({ memberId, name, surface, href, scroll, trackName }: Shared) {
  if (!memberId) return <span className="font-semibold">{name}</span>;
  return (
    <MemberHoverCard memberId={memberId} surface={surface}>
      <Link href={href} scroll={scroll} data-track={trackName} className="font-semibold hover:underline">
        {name}
      </Link>
    </MemberHoverCard>
  );
}
