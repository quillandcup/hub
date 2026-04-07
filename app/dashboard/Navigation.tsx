"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  name: string;
  href: string;
  icon?: string;
}

interface NavSection {
  name: string;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    name: "Overview",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: "📊" },
    ],
  },
  {
    name: "Members",
    items: [
      { name: "All Members", href: "/dashboard/members", icon: "👥" },
      { name: "At-Risk Members", href: "/dashboard/at-risk", icon: "⚠️" },
    ],
  },
  {
    name: "Prickles",
    items: [
      { name: "Calendar View", href: "/calendar", icon: "📅" },
      { name: "All Prickles", href: "/dashboard/prickles", icon: "✍️" },
    ],
  },
  {
    name: "Data Hygiene",
    items: [
      { name: "Health Check", href: "/hygiene", icon: "🏥" },
      { name: "Unmatched Events", href: "/hygiene/unmatched-events", icon: "📋" },
      { name: "Unmatched Zoom", href: "/hygiene/unmatched-zoom", icon: "🔍" },
      { name: "Name Matching", href: "/hygiene/name-matching", icon: "🧩" },
    ],
  },
  {
    name: "Data Management",
    items: [
      { name: "Import Data", href: "/data/import", icon: "📥" },
      { name: "Prickle Types", href: "/data/prickle-types", icon: "🏷️" },
      { name: "Name Aliases", href: "/data/aliases", icon: "👤" },
    ],
  },
];

export default function Navigation() {
  // Mobile-first: default to collapsed, check on mount to expand on desktop
  // This prevents flicker by starting in the correct state for mobile
  const [collapsed, setCollapsed] = useState(() => {
    // Only check window size on client-side
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    // Default to collapsed for SSR (mobile-first)
    return true;
  });
  const pathname = usePathname();

  // Handle window resize to auto-adjust on screen size changes
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      setCollapsed(isMobile);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <aside
      className={`flex-shrink-0 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-10 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800">
        {!collapsed && (
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Quill & Cup
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

      {/* Navigation */}
      <nav className="p-4 overflow-y-auto h-[calc(100vh-4rem)]">
        {navigation.map((section) => (
          <div key={section.name} className="mb-6">
            {!collapsed && (
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
                {section.name}
              </h2>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href ||
                  (item.href !== "/dashboard" && pathname?.startsWith(item.href));

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
        ))}
      </nav>
    </aside>
  );
}
