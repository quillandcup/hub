"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FeatureKey } from "@/lib/features";

interface NavItem {
  name: string;
  href: string;
  icon?: string;
  feature?: FeatureKey;
}

interface NavSection {
  name: string;
  items: NavItem[];
  /** Rarely-used maintenance/data-hygiene tooling — rendered collapsed by default to keep daily-use pages front and center. */
  collapsible?: boolean;
}

const navigation: NavSection[] = [
  {
    name: "Overview",
    items: [
      { name: "Dashboard", href: "/admin", icon: "📊" },
    ],
  },
  {
    name: "Members",
    items: [
      { name: "All Members", href: "/admin/members", icon: "👥" },
      { name: "At-Risk Members", href: "/admin/at-risk", icon: "⚠️" },
      { name: "Hiatus Tracking", href: "/admin/hiatus", icon: "⏸️", feature: "hiatus_tracking" },
      { name: "Hedgieversaries", href: "/admin/hedgieversaries", icon: "🎂", feature: "hedgieversaries" },
      { name: "Programs", href: "/admin/programs", icon: "🎓", feature: "program_cohorts" },
      { name: "Network", href: "/admin/members/network", icon: "🕸️" },
      { name: "Wheel of Wonder", href: "/admin/wheel-of-wonder", icon: "🎡", feature: "wheel_of_wonder" },
      { name: "Badges", href: "/admin/badges", icon: "🏅" },
    ],
  },
  {
    name: "Prickles",
    items: [
      { name: "Calendar View", href: "/admin/calendar", icon: "📅" },
      { name: "Prickle Insights", href: "/admin/insights/prickles", icon: "✍️" },
      { name: "Resubscriptions", href: "/admin/insights/resubscriptions", icon: "🔄" },
      { name: "Community Stats", href: "/admin/stats", icon: "✨" },
      { name: "Slack Engagement", href: "/admin/insights/slack-engagement", icon: "💬" },
      { name: "Hosts", href: "/admin/hosts", icon: "🎙️" },
    ],
  },
  {
    name: "Advanced",
    collapsible: true,
    items: [
      { name: "Health Check", href: "/admin/hygiene", icon: "🏥" },
      { name: "Import Data", href: "/admin/data/import", icon: "📥" },
      { name: "Prickle Types", href: "/admin/data/prickle-types", icon: "🏷️" },
      { name: "Name Aliases", href: "/admin/data/aliases", icon: "👤" },
      { name: "Member Overrides", href: "/admin/member-overrides", icon: "🎁", feature: "member_overrides" },
      { name: "Reconciliation", href: "/admin/reconciliation", icon: "🔄" },
      { name: "Users", href: "/admin/users", icon: "🔑" },
      { name: "Feedback", href: "/admin/feedback", icon: "💬" },
    ],
  },
];

interface NavLinksProps {
  enabledFeatures: FeatureKey[];
  pathname: string | null;
  collapsed: boolean;
  onNavigate?: () => void;
}

function NavLinks({ enabledFeatures, pathname, collapsed, onNavigate }: NavLinksProps) {
  return (
    <>
      {/* Back to member view */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          title={collapsed ? "My View" : undefined}
        >
          <span>←</span>
          {!collapsed && <span>My View</span>}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="p-4 overflow-y-auto flex-1">
        {navigation.map((section) => {
          const visibleItems = section.items.filter(
            (item) => !item.feature || enabledFeatures.includes(item.feature)
          );
          if (visibleItems.length === 0) return null;

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
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                      title={collapsed ? item.name : undefined}
                    >
                      {item.icon && <span className="text-lg">{item.icon}</span>}
                      {!collapsed && <span>{item.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          );

          // Collapsible ("Advanced") sections only fold when the sidebar is
          // expanded — in icon-only mode every item stays reachable at a glance.
          if (section.collapsible && !collapsed) {
            return (
              <details key={section.name} className="mb-6 group" open={containsActiveItem}>
                <summary className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3 cursor-pointer select-none list-none flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
                  <span className="inline-block transition-transform group-open:rotate-90">▸</span>
                  {section.name}
                </summary>
                {list}
              </details>
            );
          }

          return (
            <div key={section.name} className="mb-6">
              {!collapsed && (
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
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
}

export default function AdminNavigation({ enabledFeatures }: AdminNavigationProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

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
      {/* Mobile hamburger button — no permanent space, just a fixed trigger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-40 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-slate-700 dark:text-slate-300"
        aria-label="Open navigation menu"
      >
        <span className="text-lg leading-none">☰</span>
      </button>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile slide-in drawer */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transform transition-transform duration-300 flex flex-col ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!mobileOpen}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <h1 className="text-lg font-bold text-slate-500 dark:text-slate-400">
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

      {/* Desktop sidebar — unchanged collapsible behavior at md and above */}
      <aside
        className={`hidden md:flex flex-shrink-0 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-10 flex-col ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          {!collapsed && (
            <h1 className="text-lg font-bold text-slate-500 dark:text-slate-400">
              ⚙️ Admin
            </h1>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors relative z-20"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "→" : "←"}
          </button>
        </div>

        <NavLinks
          enabledFeatures={enabledFeatures}
          pathname={pathname}
          collapsed={collapsed}
        />
      </aside>
    </>
  );
}
