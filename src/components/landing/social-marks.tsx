import type { ReactNode } from "react";
import type { SocialNetwork } from "./social-networks";

/**
 * The marks of the Social icons block. Brand marks are not in lucide (`.claude/rules/icons.md`: a brand mark is a custom drawing), and
 * these are not the networks' official logos: each is a simple outline drawn for this project from plain shapes (rounded squares,
 * circles, lines), so there is no third-party artwork or licence to carry. They are recognisable by shape and by the link's name,
 * which is always the network's own ("Instagram"), never the picture alone. Stroked in `currentColor`, so they follow the section's text colour.
 */
const MARKS: Record<SocialNetwork, ReactNode> = {
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.7" fill="currentColor" />
    </>
  ),
  facebook: <path d="M14.5 3.5h-1.8A3.7 3.7 0 0 0 9 7.2V10H6.5v3.5H9V21h3.5v-7.5H15l.5-3.5h-3V7.7c0-.7.4-1.2 1.1-1.2h1.9z" />,
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
    </>
  ),
  tiktok: <path d="M14 3v10.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.3 2.5 2 4.2 4.5 4.5" />,
  x: <path d="M4.5 4.5l15 15M19.5 4.5l-15 15" />,
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 10.5V16M8 7.8v.01M11.5 16v-5.5M11.5 13c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5V16" />
    </>
  ),
  pinterest: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10.5 18.5l1.7-7M9.6 11.2a3 3 0 1 1 3.2 3.4" />
    </>
  ),
  substack: (
    <>
      <path d="M5 4.5h14M5 8.5h14" />
      <path d="M5 12.5h14v8l-7-4-7 4z" />
    </>
  ),
  threads: <path d="M16.5 9.5c-.6-2.2-2.2-3.3-4.5-3.3-3 0-5 2.3-5 5.8s2 5.8 5 5.8c2.7 0 4.5-1.4 4.5-3.4 0-2.2-2-3.3-4.5-3.1-2 .2-3 1-3 2.2 0 1.1 1 1.8 2.3 1.8 1.8 0 2.7-1.1 2.7-3.3" />,
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z" />
    </>
  ),
};

/** The mark of a network, hidden from screen readers (the link carries the name). Size comes from the class. */
export function SocialMark({ network, className = "h-5 w-5" }: { network: SocialNetwork; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      {MARKS[network]}
    </svg>
  );
}
