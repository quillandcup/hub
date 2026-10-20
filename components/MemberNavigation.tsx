"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FeatureKey } from "@/lib/features";
import Wordmark from "@/components/Wordmark";
import { useOpenMobileNav } from "@/components/MobileMenuButton";
import { navGroups, type SitePage } from "@/lib/site-pages";
import { navTrackName } from "@/lib/analytics/names";

interface MemberNavigationProps {
  isAdmin: boolean;
  enabledFeatures: FeatureKey[];
}

interface NavLinksProps {
  isAdmin: boolean;
  enabledFeatures: FeatureKey[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}

function NavLinks({ isAdmin, enabledFeatures, pathname, collapsed, onNavigate }: NavLinksProps) {
  // The links come from lib/site-pages.ts, which universal search reads too.
  const isActive = (page: SitePage) =>
    pathname === page.href || [page.href, ...(page.nav?.activeFor ?? [])].some((prefix) => pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
      active
        ? "bg-plum-50 dark:bg-plum-900/20 text-plum-600 dark:text-plum-400 font-medium"
        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
    }`;

  return (
    <>
      <nav className="p-4 overflow-y-auto flex-1">
        {navGroups("member", enabledFeatures).map((group) => (
          <div key={group.name} className="mb-6">
            {!collapsed && (
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
                {group.name}
              </h2>
            )}
            <div className="space-y-1">
              {group.items.map((page) => (
                <Link
                  key={page.href}
                  href={page.href}
                  data-track={navTrackName(page.href)}
                  onClick={onNavigate}
                  className={linkClass(isActive(page))}
                  title={collapsed ? page.title : undefined}
                >
                  <span className="text-lg">{page.nav?.icon}</span>
                  {!collapsed && <span>{page.title}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Admin Portal — fixed at bottom, admin-only */}
      {isAdmin && (
        <div className="px-2 py-3 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <Link
            href="/admin"
            data-track="nav-admin-portal"
            onClick={onNavigate}
            className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            title="Admin Portal"
          >
            <span className="text-base flex-shrink-0">⚙️</span>
            {!collapsed && <span className="text-sm whitespace-nowrap">Admin Portal →</span>}
          </Link>
        </div>
      )}
    </>
  );
}

export default function MemberNavigation({ isAdmin, enabledFeatures }: MemberNavigationProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useOpenMobileNav(() => setMobileOpen(true));

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    setCollapsed(isMobile);
    const handleResize = () => setCollapsed(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile slide-in drawer. Height comes from `fixed inset-y-0` (the visible viewport), not `h-screen`:
          on mobile browsers 100vh is taller than the visible area, which pushed the bottom-pinned Admin Portal
          link under the browser toolbar where it couldn't be reached. */}
      <aside
        aria-label="Mobile navigation"
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transform transition-transform duration-300 flex flex-col ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!mobileOpen}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <Wordmark className="text-lg" />
          <button
            onClick={() => setMobileOpen(false)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Close navigation menu"
          >
            ✕
          </button>
        </div>

        <NavLinks
          isAdmin={isAdmin}
          enabledFeatures={enabledFeatures}
          pathname={pathname}
          collapsed={false}
          onNavigate={() => setMobileOpen(false)}
        />
      </aside>

      {/* Desktop sidebar — unchanged collapsible behavior at md and above */}
      <aside
        aria-label="Sidebar navigation"
        className={`hidden md:flex flex-shrink-0 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-10 flex-col ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          {!collapsed && (
            <Wordmark className="text-lg" />
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            data-track="nav-collapse-sidebar"
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors relative z-20"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "→" : "←"}
          </button>
        </div>

        <NavLinks
          isAdmin={isAdmin}
          enabledFeatures={enabledFeatures}
          pathname={pathname}
          collapsed={collapsed}
        />
      </aside>
    </>
  );
}
