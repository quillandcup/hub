"use client";

import Link from "next/link";

/**
 * Shown once, right after a member switches their writer profile on (docs/product/WRITER_PROFILES.md): where the page is, a reminder
 * that what is marked with the globe is on it, where each part is changed, and the way to see it as a visitor would. It lists nothing
 * and controls nothing: every item already has its own lock, house or globe where it lives. Dismissed with "Got it", or when the profile
 * goes off.
 */
export default function WriterProfileOnNote({ address, previewPath, onDone }: { address: string | null; previewPath: string; onDone: () => void }) {
  return (
    <section aria-labelledby="writer-profile-on" className="max-w-md rounded-md border border-plum-300 bg-plum-50 p-4 dark:border-plum-700 dark:bg-plum-900/20" data-testid="writer-profile-on-note">
      {/* A heading by role, not a heading tag: this note is shown once and is not a section of the settings page that the search lists. */}
      <p id="writer-profile-on" role="heading" aria-level={3} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Your writer profile is on.
      </p>
      {address && (
        <p className="mt-1 break-all text-sm text-slate-800 dark:text-slate-200" data-testid="writer-profile-on-address">
          {address}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
        Anything marked with the globe icon is on your page: your name, photo, bio, links, milestones and books. To change them, go to Settings, then Profile. For milestones and books, use My Writing.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link href={previewPath} target="_blank" data-track="settings-writer-profile-on-preview" className="rounded-md bg-plum-600 px-3 py-1.5 text-sm text-white hover:bg-plum-700">
          View as a visitor
        </Link>
        <button type="button" onClick={onDone} className="text-sm underline text-plum-700 dark:text-plum-300" data-track="settings-writer-profile-on-done">
          Got it
        </button>
      </div>
    </section>
  );
}
