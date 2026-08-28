"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FeatureKey } from "@/lib/features";

interface MemberNavigationProps {
  isAdmin: boolean;
  memberId: string;
  enabledFeatures: FeatureKey[];
}

export default function MemberNavigation({ isAdmin, memberId, enabledFeatures }: MemberNavigationProps) {
  const [collapsed, setCollapsed] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    setCollapsed(isMobile);
    const handleResize = () => setCollapsed(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCalendarActive = pathname === '/calendar';
  const isStreaksActive = pathname === '/streaks';
  const isPrickerPickerActive = pathname === '/prickle-picker';
  const isProfileActive = pathname === `/members/${memberId}` || pathname.startsWith(`/members/${memberId}/`);

  const showStreaks = enabledFeatures.includes('streaks');
  const showPricklePicker = enabledFeatures.includes('prickle_picker');

  return (
    <aside
      className={`flex-shrink-0 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-10 flex flex-col ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        {!collapsed && (
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Quill &amp; Cup
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

      {/* Nav items */}
      <nav className="p-4 flex-1 space-y-1">
        <Link
          href="/calendar"
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            isCalendarActive
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
          title={collapsed ? "My Calendar" : undefined}
        >
          <span className="text-lg">📅</span>
          {!collapsed && <span>My Calendar</span>}
        </Link>

        {showStreaks && (
          <Link
            href="/streaks"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isStreaksActive
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
            title={collapsed ? "Streaks" : undefined}
          >
            <span className="text-lg">🔥</span>
            {!collapsed && <span>Streaks</span>}
          </Link>
        )}

        {showPricklePicker && (
          <Link
            href="/prickle-picker"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isPrickerPickerActive
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
            title={collapsed ? "Prickle Picker" : undefined}
          >
            <span className="text-lg">🧭</span>
            {!collapsed && <span>Prickle Picker</span>}
          </Link>
        )}

        <Link
          href={`/members/${memberId}`}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
            isProfileActive
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
          title={collapsed ? "My Profile" : undefined}
        >
          <span className="text-lg">👤</span>
          {!collapsed && <span>My Profile</span>}
        </Link>
      </nav>

      {/* Admin Portal — fixed at bottom, admin-only */}
      {isAdmin && (
        <div className="px-2 py-3 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <Link
            href="/admin"
            className="flex items-center justify-center gap-2 px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            title="Admin Portal"
          >
            <span className="text-base flex-shrink-0">⚙️</span>
            {!collapsed && <span className="text-sm whitespace-nowrap">Admin Portal →</span>}
          </Link>
        </div>
      )}
    </aside>
  )
}
