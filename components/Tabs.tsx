"use client";

import { useState, type ReactNode } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

/** Underlined tab strip. Controlled -- use directly when the active tab also drives
 * other state (e.g. a "View all" link that switches tabs); otherwise use `Tabs`. */
export function TabBar<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  className = "",
}: {
  tabs: readonly TabItem<T>[];
  activeTab: T;
  onTabChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`border-b border-slate-200 dark:border-slate-800 ${className}`}>
      <nav role="tablist" className="flex gap-1 -mb-px overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export interface TabPanel<T extends string> extends TabItem<T> {
  content: ReactNode;
}

/** Tab strip plus panels, with the active tab held internally. Only the active panel is
 * mounted. To honor a `?tab=` param, pass it as `initialTab` along with `key={initialTab}`
 * so client-side navigation to a different tab remounts with the new selection. */
export function Tabs<T extends string>({
  tabs,
  initialTab,
  className,
}: {
  tabs: readonly TabPanel<T>[];
  initialTab?: T;
  className?: string;
}) {
  const [activeTab, setActiveTab] = useState<T>(initialTab ?? tabs[0].id);
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <div className={className}>
      <TabBar tabs={tabs} activeTab={active.id} onTabChange={setActiveTab} className="mb-6" />
      <div role="tabpanel">{active.content}</div>
    </div>
  );
}
