"use client";

import type { ReactNode } from "react";

/**
 * Text inside a card whose whole box is one link (the stretched link, see SharedMessageCard). The text sits above the link's
 * overlay so it can be selected and its own links work; a plain click on it still counts as a click on the card, so the
 * link is followed for it. Not when the click ends a text selection, or lands on a link or button of its own.
 */
export default function CardClickArea({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={className}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a, button")) return;
        if (window.getSelection()?.toString()) return;
        e.currentTarget.closest<HTMLElement>("[data-stretched-card]")?.querySelector<HTMLAnchorElement>("a[data-stretched-link]")?.click();
      }}
    >
      {children}
    </div>
  );
}
