import type { ReactNode } from "react";

/**
 * Priority of each bar above the member header, highest first. A new bar is one entry here and one
 * item in app/(member)/layout.tsx; nothing else decides where it goes.
 */
export const ANNOUNCEMENT_PRIORITY = {
  /** Sudo: you are acting as someone else. Critical, never dismissible. */
  sudo: 100,
  /** Install the app (iOS push needs it). */
  installApp: 50,
  /** Connect Slack for chat. */
  slackConnect: 40,
} as const;

export type AnnouncementItem = {
  id: string;
  priority: number;
  /** Null/false when the bar doesn't apply right now (the layout owns that condition). */
  element: ReactNode;
};

/**
 * The shell-level bars above the header, in one place. The rule is the simple one: they ALL stack,
 * highest priority first (ties keep the order given), so nothing, least of all a critical bar, is ever
 * hidden behind another. Each bar is dismissible on its own except the critical one, so the stack
 * shrinks as a member deals with them. Per-page state is a PageBanner under the header, and stored,
 * event-driven notices are in-app notifications; neither goes here.
 */
export default function AnnouncementStack({ items }: { items: AnnouncementItem[] }) {
  const shown = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Boolean(item.element))
    .sort((a, b) => b.item.priority - a.item.priority || a.index - b.index);
  if (shown.length === 0) return null;
  return (
    <div className="z-40 flex-shrink-0">
      {shown.map(({ item }) => (
        <div key={item.id}>{item.element}</div>
      ))}
    </div>
  );
}
