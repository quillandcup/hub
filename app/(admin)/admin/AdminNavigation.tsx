"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FeatureKey } from "@/lib/features";
import { navGroups } from "@/lib/site-pages";
import { useOpenMobileNav } from "@/components/MobileMenuButton";
import type { NavMode } from "@/lib/nav-mode";
import { NavModeButton, useSidebarMode } from "@/components/useSidebarMode";

interface NavLinksProps {
  enabledFeatures: FeatureKey[];
  pathname: string | null;
  collapsed: boolean;
  /** Keep headings and labels mounted (hidden while collapsed) so items never move as the rail opens. */
  keepLayout?: boolean;
  onNavigate?: () => void;
}

function NavLinks({ enabledFeatures, pathname, collapsed, keepLayout, onNavigate }: NavLinksProps) {
  const showLabels = keepLayout || !collapsed;
  const labelFade = keepLayout ? `whitespace-nowrap transition-opacity duration-200 ${collapsed ? "opacity-0" : "opacity-100"}` : "";

  return (
    <>
      {/* Back to member view */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          title={collapsed ? "My View" : undefined}
        >
          <span>←</span>
          {showLabels && <span className={`whitespace-nowrap ${labelFade}`}>My View</span>}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] overflow-y-auto overflow-x-hidden flex-1">
        {navGroups("admin", enabledFeatures).map((section) => {
          const visibleItems = section.items;

          const containsActiveItem = visibleItems.some(
            (item) =>
              pathname === item.href ||
              (item.href !== "/admin" && pathname?.startsWith(item.href))
          );

          const list = (
            <ul className="space-y-1">
              {visibleItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin" && pathname?.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={`flex items-center gap-2 ${item.nav?.icon ? "pl-0" : "pl-3"} pr-3 py-2 rounded-lg transition-colors ${
                        isActive
                          ? "bg-plum-50 dark:bg-plum-900/20 text-plum-600 dark:text-plum-400 font-medium"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                      title={collapsed ? item.title : undefined}
                    >
                      {item.nav?.icon && <span className="w-8 flex-shrink-0 text-center text-lg">{item.nav.icon}</span>}
                      {showLabels && <span className={`whitespace-nowrap ${labelFade}`}>{item.title}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          );

          // Collapsible sections (Analytics, System, Developer) fold when the sidebar is open. A pinned-closed
          // icon rail shows every item at a glance; an auto-hide rail keeps the folded rows too (the heading
          // invisible), so the list is the same height at rest and open and nothing shifts as it opens.
          if (section.collapsible && (keepLayout || !collapsed)) {
            return (
              <details key={section.name} className="mb-6 group" open={containsActiveItem}>
                <summary
                  className={`text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2 px-3 cursor-pointer select-none list-none flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200 ${labelFade} ${keepLayout && collapsed ? "pointer-events-none" : ""}`}
                  aria-hidden={(keepLayout && collapsed) || undefined}
                >
                  <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                  {section.name}
                </summary>
                {list}
              </details>
            );
          }

          return (
            <div key={section.name} className="mb-6">
              {showLabels && (
                <h2 className={`text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-2 px-3 ${labelFade}`} aria-hidden={collapsed || undefined}>
                  {section.name}
                </h2>
              )}
              {list}
            </div>
          );
        })}
      </nav>
    </>
  );
}

interface AdminNavigationProps {
  enabledFeatures: FeatureKey[];
  /** The member's saved sidebar mode (one setting for member and admin); null until they choose: pinned open. */
  navMode?: NavMode | null;
}

export default function AdminNavigation({ enabledFeatures, navMode = null }: AdminNavigationProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { mode, autoHide, collapsed, railOpen, peekHandlers, cycleMode } = useSidebarMode(navMode);

  useOpenMobileNav(() => setMobileOpen(true));

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile slide-in drawer */}
      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-64 h-dvh bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transform transition-transform duration-300 flex flex-col ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <h1 className="text-lg font-bold text-slate-600 dark:text-slate-400">
            ⚙️ Admin
          </h1>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Close navigation menu"
          >
            ✕
          </button>
        </div>

        <NavLinks
          enabledFeatures={enabledFeatures}
          pathname={pathname}
          collapsed={false}
          onNavigate={() => setMobileOpen(false)}
        />
      </aside>

      {/* Desktop sidebar. In auto-hide the wrapper holds the rail's width and the aside floats over the page,
          above the app header (z-30), whose search box would otherwise cover the title. */}
      <div
        className={`hidden lg:block flex-shrink-0 h-screen relative transition-all duration-300 ${railOpen ? "z-40" : "z-30"} ${
          autoHide || collapsed ? "w-16" : "w-64"
        }`}
        {...peekHandlers}
      >
        <aside
          aria-label="Sidebar navigation"
          data-auto-hide={autoHide || undefined}
          className={`flex h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex-col ${
            autoHide ? `absolute inset-y-0 left-0 overflow-hidden ${railOpen ? "w-64 shadow-xl" : "w-16"}` : collapsed ? "w-16" : "w-64"
          }`}
        >
          {/* Header */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
            {(autoHide || !collapsed) && (
              <h1
                className={`text-lg font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap ${
                  autoHide ? `transition-opacity duration-200 ${railOpen ? "opacity-100" : "opacity-0"}` : ""
                }`}
              >
                ⚙️ Admin
              </h1>
            )}
            <NavModeButton mode={mode} railOpen={railOpen} onCycle={cycleMode} />
          </div>

          <NavLinks
            enabledFeatures={enabledFeatures}
            pathname={pathname}
            collapsed={autoHide ? !railOpen : collapsed}
            keepLayout={autoHide}
          />
        </aside>
      </div>
    </>
  );
}
