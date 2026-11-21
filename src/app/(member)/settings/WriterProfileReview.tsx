"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import VisibilityControl from "@/components/writing/VisibilityControl";
import { MILESTONE_LABELS, MILESTONE_SHOWN, MILESTONE_TITLES, PUBLISHED_SHOWN, PUBLISHED_TITLE, describeMilestoneLevel, milestoneLevels } from "@/lib/finishers";
import type { Work } from "@/lib/finishers-works";
import type { Visibility } from "@/lib/writing-visibility";
import { setMilestoneVisibility } from "./milestoneActions";

export type ReviewItem = { key: string; label: string; control: ReactNode };

/**
 * Shown once, right after a member switches their writer profile on: what anyone on the internet can now see, each with the same
 * lock, house or globe control as everywhere else, so the defaults are looked at in one place instead of item by item
 * (docs/product/WRITER_PROFILES.md, "Who sees what"). `items` are the profile items that have something in them, with their own
 * control (the caller saves them); the milestones are listed here, a confirmed one with its control and the Published steps (from the
 * Bookshelf) as read-only lines. A milestone or item at the house or the lock is not on the page, and says so through its control.
 */
export default function WriterProfileReview({
  name,
  items,
  works,
  webAvailable,
  previewPath,
  readOnly,
  onDone,
}: {
  /** The name the page is headed with, or null when it is not chosen. */
  name: string | null;
  items: ReviewItem[];
  works: Work[];
  webAvailable: boolean;
  previewPath: string;
  readOnly: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A click shows at once and goes back when the save fails; the server's level takes over when it arrives.
  const [levels, setLevels] = useState<Record<string, Visibility>>({});

  const confirmed = works.flatMap((w) =>
    (["the_end", "publish_ready"] as const).flatMap((kind) => {
      const m = w.milestones[kind];
      return m && m.status === "confirmed" ? [{ work: w, kind, milestone: m }] : [];
    }),
  );
  const published = works.filter((w) => w.published);

  const change = (id: string, next: Visibility) =>
    startTransition(async () => {
      setError(null);
      const before = levels[id];
      setLevels((l) => ({ ...l, [id]: next }));
      const result = await setMilestoneVisibility(id, next);
      if ("error" in result) {
        setLevels((l) => {
          const rest = { ...l };
          if (before === undefined) delete rest[id];
          else rest[id] = before;
          return rest;
        });
        setError(result.error);
      } else router.refresh();
    });

  return (
    <section aria-labelledby="writer-profile-review" className="max-w-md rounded-md border border-plum-300 bg-plum-50 p-4 dark:border-plum-700 dark:bg-plum-900/20" data-testid="writer-profile-review">
      {/* A heading by role, not a heading tag: this note is shown once and is not a section of the settings page that the search lists. */}
      <p id="writer-profile-review" role="heading" aria-level={3} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Your writer profile is on. Here is who sees what.
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        Anything marked Everyone (the globe) is on your page for anyone on the internet. Tap an icon to change it. Nothing else from the Hub is on your page.
      </p>
      <ul className="mt-3 space-y-2 text-sm text-slate-800 dark:text-slate-200">
        <li className="flex items-center justify-between gap-3">
          <span>Name: {name ?? "not chosen yet"}</span>
          <span className="text-xs text-slate-600 dark:text-slate-400">always on your page</span>
        </li>
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3" data-testid={`review-item-${item.key}`}>
            <span>{item.label}</span>
            {item.control}
          </li>
        ))}
        {confirmed.map(({ work, kind, milestone }) => (
          <li key={milestone.id} className="flex items-center justify-between gap-3" data-testid={`review-milestone-${milestone.id}`}>
            <span>
              {MILESTONE_TITLES[kind]}: {MILESTONE_SHOWN[kind]}
              {work.title ? ` (${work.title})` : ""} <span className="text-xs text-slate-500 dark:text-slate-400">{MILESTONE_LABELS[kind]}</span>
            </span>
            <VisibilityControl
              visibility={levels[milestone.id] ?? milestone.visibility}
              onChange={(next) => change(milestone.id, next)}
              disabled={pending || readOnly}
              noun="milestone"
              levels={milestoneLevels(webAvailable)}
              describe={describeMilestoneLevel}
              withText
              className="text-xs text-slate-600 dark:text-slate-400"
            />
          </li>
        ))}
        {published.map((w) => (
          <li key={`published-${w.key}`} className="flex items-center justify-between gap-3" data-testid="review-published">
            <span>
              {PUBLISHED_TITLE}: {PUBLISHED_SHOWN}
              {w.title ? ` (${w.title})` : ""}
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-400">from your Bookshelf</span>
          </li>
        ))}
      </ul>
      {items.length === 0 && confirmed.length === 0 && published.length === 0 && (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">Only your name is on the page so far. Set your bio, photo or a link to the globe in your profile, and it will appear here.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onDone} className="rounded-md bg-plum-600 px-3 py-1.5 text-sm text-white hover:bg-plum-700" data-track="settings-writer-profile-review-done">
          Looks good
        </button>
        <Link href={previewPath} target="_blank" data-track="settings-writer-profile-review-preview" className="text-sm underline text-plum-700 dark:text-plum-300">
          View as a visitor
        </Link>
      </div>
    </section>
  );
}
