"use client";

import { slugify } from "@/lib/landing/slug";

export const FIELD = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";

/**
 * The page's title and address, as the New page form asks for them: the address follows the title until it is edited by hand.
 * The parent owns the values so a dialog can prefill the title (a template's name, a file's title).
 */
export default function PageNameFields({
  title,
  slug,
  edited,
  onChange,
}: {
  title: string;
  slug: string;
  /** The address was typed by hand, so it no longer follows the title. */
  edited: boolean;
  onChange: (next: { title: string; slug: string; edited: boolean }) => void;
}) {
  return (
    <>
      <label className="block text-sm font-medium">
        Title
        <input value={title} onChange={(e) => onChange({ title: e.target.value, slug: edited ? slug : slugify(e.target.value), edited })} required maxLength={120} className={`${FIELD} mt-1`} />
      </label>
      <label className="block text-sm font-medium">
        Address
        <span className="mt-1 flex items-center gap-1">
          <span className="text-sm text-slate-600 dark:text-slate-400">/p/</span>
          <input value={slug} onChange={(e) => onChange({ title, slug: e.target.value, edited: true })} pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Lowercase letters, numbers and dashes" className={FIELD} />
        </span>
      </label>
    </>
  );
}
