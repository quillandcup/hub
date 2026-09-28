"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

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
                ? "border-plum-600 text-plum-600 dark:border-plum-400 dark:text-plum-400"
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

/** Record the selected tab in the URL without navigating (replaces the history entry), so
 * browser Back, a reload, or a remembered link lands on it. For controlled `TabBar` users;
 * `Tabs` does this itself with `syncToUrl`. Next's router picks the change up (useSearchParams). */
export function replaceTabInUrl(param: string, tabId: string, clear: readonly string[] = []) {
  const url = new URL(window.location.href);
  url.searchParams.set(param, tabId);
  for (const other of clear) url.searchParams.delete(other);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Switch tabs when a link changes the `?tab=` param on the page we're already on, e.g. a link
 * from one tab to `?tab=all` while the page was first loaded as `?tab=all`: the server renders
 * the same `initialTab`, so `key={initialTab}` alone doesn't remount and the old tab would stay.
 * Our own tab clicks also change the param (replaceTabInUrl), to the tab already showing, so
 * following it is a no-op. Its own component so only `syncToUrl` users need the Suspense
 * boundary useSearchParams asks for.
 */
function FollowTabParam({
  param,
  tabIds,
  onChange,
}: {
  param: string;
  tabIds: readonly string[];
  onChange: (id: string) => void;
}) {
  // Null outside the App Router (e.g. component tests): nothing to follow.
  const value = useSearchParams()?.get(param) ?? null;
  const onChangeRef = useRef(onChange);
  const tabIdsRef = useRef(tabIds);
  useEffect(() => {
    onChangeRef.current = onChange;
    tabIdsRef.current = tabIds;
  });
  useEffect(() => {
    if (value && tabIdsRef.current.includes(value)) onChangeRef.current(value);
  }, [value]);
  return null;
}

export interface TabPanel<T extends string> extends TabItem<T> {
  content: ReactNode;
}

/** Tab strip plus panels, with the active tab held internally. Only the active panel is
 * mounted. To honor a `?tab=` param, pass it as `initialTab` along with `key={initialTab}`
 * so client-side navigation to a different tab remounts with the new selection.
 *
 * `syncToUrl` writes the selected tab back to the URL (replacing the history entry, no
 * navigation), so returning to the page -- browser Back, a reload, a remembered link -- lands
 * on the same tab. `clear` lists other params that only apply to the initial tab. */
export function Tabs<T extends string>({
  tabs,
  initialTab,
  className,
  syncToUrl,
}: {
  tabs: readonly TabPanel<T>[];
  initialTab?: T;
  className?: string;
  syncToUrl?: { param: string; clear?: readonly string[] };
}) {
  const [activeTab, setActiveTab] = useState<T>(initialTab ?? tabs[0].id);
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  function handleTabChange(id: T) {
    setActiveTab(id);
    if (syncToUrl && id !== active.id) replaceTabInUrl(syncToUrl.param, id, syncToUrl.clear);
  }

  return (
    <div className={className}>
      {syncToUrl && (
        <Suspense fallback={null}>
          <FollowTabParam
            param={syncToUrl.param}
            tabIds={tabs.map((t) => t.id)}
            onChange={(id) => setActiveTab(id as T)}
          />
        </Suspense>
      )}
      <TabBar tabs={tabs} activeTab={active.id} onTabChange={handleTabChange} className="mb-6" />
      <div role="tabpanel">{active.content}</div>
    </div>
  );
}
