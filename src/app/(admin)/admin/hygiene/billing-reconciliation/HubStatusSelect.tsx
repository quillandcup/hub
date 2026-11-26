"use client";

import { useRouter } from "next/navigation";

export interface HubStatusOption {
  id: string;
  /** With its count of rows, e.g. "On hiatus (4)". */
  label: string;
  /** The page with this Hub status chosen and every other filter kept. */
  href: string;
}

/** The Hub status filter: a select, so its four options take one control's room beside the group chips. */
export default function HubStatusSelect({ options, value }: { options: HubStatusOption[]; value: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
      Hub status
      <select
        value={value}
        onChange={(e) => {
          const next = options.find((o) => o.id === e.target.value);
          if (next) router.push(next.href);
        }}
        className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
