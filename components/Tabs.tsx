"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { tabHref, tabTitle, type TabPageTitle } from "@/lib/tab-routes";
import { documentTitle } from "@/lib/page-title";

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

/** Point the URL at tab `tabId`'s path without navigating (replaces the history entry and drops
 * any query, which belongs to the tab being left), so Back, a reload or a remembered link lands
 * on it. For controlled `TabBar` users; `Tabs` does this itself with `basePath`. Next's router
 * picks the change up (usePathname). */
export function replaceTabPath(basePath: string, tabId: string, defaultTabId: string) {
  const href = tabHref(basePath, tabId, defaultTabId);
  if (window.location.pathname !== href || window.location.search) {
    window.history.replaceState(null, "", `${href}${window.location.hash}`);
  }
}

/**
 * Switch tabs when a link navigates to another tab's path on the page we're already on, e.g. a
 * "See all prickles" link to /my-prickles/all while the page was first loaded at
 * /my-prickles/all: the server renders the same `initialTab`, so `key={initialTab}` alone
 * doesn't remount and the old tab would stay. Our own tab clicks also change the path (to the tab
 * already showing), so following them is a no-op.
 */
export function useFollowTabPath<T extends string>(
  basePath: string,
  tabIds: readonly T[],
  onChange: (id: T) => void
) {
  // Null outside the App Router (e.g. component tests): nothing to follow.
  const pathname = usePathname();
  const onChangeRef = useRef(onChange);
  const tabIdsRef = useRef(tabIds);
  useEffect(() => {
    onChangeRef.current = onChange;
    tabIdsRef.current = tabIds;
  });
  useEffect(() => {
    if (!pathname) return;
    const ids = tabIdsRef.current;
    const id = ids.find((t) => tabHref(basePath, t, ids[0]) === pathname);
    if (id) onChangeRef.current(id);
  }, [pathname, basePath]);
}

/** Set the browser tab title for a client-side tab switch, matching the tab route's metadata
 * (tabTitle in lib/tab-routes.ts). For controlled `TabBar` users; `Tabs` does this with `pageTitle`. */
export function setTabDocumentTitle(page: TabPageTitle, tabLabel: string, isFirstTab: boolean) {
  document.title = documentTitle(tabTitle(page, tabLabel, isFirstTab));
}

export interface TabPanel<T extends string> extends TabItem<T> {
  content: ReactNode;
  /** For the browser tab title when `label` isn't plain text. */
  title?: string;
}

/** Tab strip plus panels, with the active tab held internally. Only the active panel is
 * mounted. Pass the tab the server rendered as `initialTab` along with `key={initialTab}`, so
 * client-side navigation to a different tab remounts with the new selection.
 *
 * `basePath` makes them path-based tabs (lib/tab-routes.ts): the first tab at `basePath`, the
 * rest at `basePath/<id>`. Clicking one switches instantly and rewrites the path (replacing the
 * history entry, no navigation), so Back, a reload or a remembered link lands on the same tab.
 * With `pageTitle` it also sets the browser tab title the tab's route would (lib/tab-routes.ts). */
export function Tabs<T extends string>({
  tabs,
  initialTab,
  className,
  basePath,
  pageTitle,
}: {
  tabs: readonly TabPanel<T>[];
  initialTab?: T;
  className?: string;
  basePath?: string;
  /** With `basePath`: what the page's title is made of, so a tab switch updates the browser tab title too. */
  pageTitle?: TabPageTitle;
}) {
  const [activeTab, setActiveTab] = useState<T>(initialTab ?? tabs[0].id);
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const tabIds = tabs.map((t) => t.id);
  useFollowTabPath(basePath ?? "", basePath ? tabIds : [], setActiveTab);

  function handleTabChange(id: T) {
    setActiveTab(id);
    if (!basePath || id === active.id) return;
    replaceTabPath(basePath, id, tabIds[0]);
    const tab = tabs.find((t) => t.id === id);
    if (pageTitle && tab) {
      setTabDocumentTitle(pageTitle, tab.title ?? (typeof tab.label === "string" ? tab.label : id), id === tabIds[0]);
    }
  }

  return (
    <div className={className}>
      <TabBar tabs={tabs} activeTab={active.id} onTabChange={handleTabChange} className="mb-6" />
      <div role="tabpanel">{active.content}</div>
    </div>
  );
}
