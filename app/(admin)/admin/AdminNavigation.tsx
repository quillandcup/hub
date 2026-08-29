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
      { name: "Network", href: "/admin/members/network", icon: "🕸️" },
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
    name: "Data Management",
    items: [
      { name: "Health Check", href: "/admin/hygiene", icon: "🏥" },
      { name: "Import Data", href: "/admin/data/import", icon: "📥" },
      { name: "Prickle Types", href: "/admin/data/prickle-types", icon: "🏷️" },
      { name: "Name Aliases", href: "/admin/data/aliases", icon: "👤" },
      { name: "Member Overrides", href: "/admin/member-overrides", icon: "🎁", feature: "member_overrides" },
      { name: "Reconciliation", href: "/admin/reconciliation", icon: "🔄" },
    ],
  },
  {
    name: "System",
    items: [
      { name: "Users", href: "/admin/users", icon: "🔑" },
      { name: "Feedback", href: "/admin/feedback", icon: "💬" },
    ],
  },
];

interface AdminNavigationProps {
  enabledFeatures: FeatureKey[];
}

export default function AdminNavigation({ enabledFeatures }: AdminNavigationProps) {
  const [collapsed, setCollapsed] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    setCollapsed(isMobile);
    const handleResize = () => setCollapsed(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <aside
      className={`flex-shrink-0 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-10 flex flex-col ${
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

      {/* Back to member view */}
      <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <Link
          href="/dashboard"
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
          return (
            <div key={section.name} className="mb-6">
              {!collapsed && (
                <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
                  {section.name}
                </h2>
              )}
              <ul className="space-y-1">
                {visibleItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/admin" && pathname?.startsWith(item.href));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
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
            </div>
          );
        })}
      </nav>

    </aside>
  );
}
