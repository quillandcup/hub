"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";

interface StatsTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * The tabs inside the stats modal. They are state of the overlay, not pages, so they live in
 * component state rather than the path (the tabbed-pages rule is for pages).
 */
export default function StatsTabs({ tabs, label }: { tabs: StatsTab[]; label: string }) {
  const [active, setActive] = useState(tabs[0].id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    setActive(next.id);
    document.getElementById(`stats-tab-${next.id}`)?.focus();
  }

  return (
    <div className="mt-5">
      <div role="tablist" aria-label={label} className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t, i) => {
          const selected = t.id === current.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`stats-tab-${t.id}`}
              aria-selected={selected}
              aria-controls="stats-tabpanel"
              tabIndex={selected ? 0 : -1}
              data-track={`admin-watch-stats-tab-${t.id}`}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                selected
                  ? "border-plum-600 text-plum-700 dark:border-plum-300 dark:text-plum-300"
                  : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="stats-tabpanel" aria-labelledby={`stats-tab-${current.id}`} className="pt-4">
        {current.content}
      </div>
    </div>
  );
}
