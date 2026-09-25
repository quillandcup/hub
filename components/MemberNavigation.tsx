"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FeatureKey } from "@/lib/features";

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
  const isDashboardActive = pathname === '/dashboard';
  const isProjectsActive = pathname === '/projects' || pathname.startsWith('/projects/');
  const isMyPricklesActive = pathname === '/my-prickles' || ['/calendar', '/prickle-picker', '/hosting'].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isStreaksActive = pathname === '/streaks';
  const isWheelActive = pathname === '/wheel-of-wonder';
  const isBookshelfActive = pathname === '/bookshelf';
  const isEventsActive = pathname === '/events' || pathname.startsWith('/events/');

  const showStreaks = enabledFeatures.includes('streaks');
  const showWheel = enabledFeatures.includes('wheel_of_wonder');
  const showEvents = enabledFeatures.includes('events');

  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
      active
        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
    }`;

  return (
    <>
      <nav className="p-4 overflow-y-auto flex-1">
        {/* Home */}
        <div className="mb-6">
          {!collapsed && (
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
              Home
            </h2>
          )}
          <div className="space-y-1">
            <Link
              href="/dashboard"
              onClick={onNavigate}
              className={linkClass(isDashboardActive)}
              title={collapsed ? "Dashboard" : undefined}
            >
              <span className="text-lg">🏠</span>
              {!collapsed && <span>Dashboard</span>}
            </Link>
          </div>
        </div>

        {/* My Burrow — the member's own writing and their relationship to Prickles */}
        <div className="mb-6">
          {!collapsed && (
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
              My Burrow
            </h2>
          )}
          <div className="space-y-1">
            <Link
              href="/projects"
              onClick={onNavigate}
              className={linkClass(isProjectsActive)}
              title={collapsed ? "My Writing" : undefined}
            >
              <span className="text-lg">📝</span>
              {!collapsed && <span>My Writing</span>}
            </Link>

            <Link
              href="/my-prickles"
              onClick={onNavigate}
              className={linkClass(isMyPricklesActive)}
              title={collapsed ? "My Prickles" : undefined}
            >
              <span className="text-lg">🦔</span>
              {!collapsed && <span>My Prickles</span>}
            </Link>

            {showStreaks && (
              <Link
                href="/streaks"
                onClick={onNavigate}
                className={linkClass(isStreaksActive)}
                title={collapsed ? "Streaks" : undefined}
              >
                <span className="text-lg">🔥</span>
                {!collapsed && <span>Streaks</span>}
              </Link>
            )}
          </div>
        </div>

        {/* Community — shared, broader-than-you surfaces */}
        <div className="mb-6">
          {!collapsed && (
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
              Community
            </h2>
          )}
          <div className="space-y-1">
            {showWheel && (
              <Link
                href="/wheel-of-wonder"
                onClick={onNavigate}
                className={linkClass(isWheelActive)}
                title={collapsed ? "Wheel of Wonder" : undefined}
              >
                <span className="text-lg">🎡</span>
                {!collapsed && <span>Wheel of Wonder</span>}
              </Link>
            )}

            <Link
              href="/bookshelf"
              onClick={onNavigate}
              className={linkClass(isBookshelfActive)}
              title={collapsed ? "Bookshelf" : undefined}
            >
              <span className="text-lg">🐚</span>
              {!collapsed && <span>Bookshelf</span>}
            </Link>

            {showEvents && (
              <Link
                href="/events"
                onClick={onNavigate}
                className={linkClass(isEventsActive)}
                title={collapsed ? "Events" : undefined}
              >
                <span className="text-lg">📸</span>
                {!collapsed && <span>Events</span>}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Admin Portal — fixed at bottom, admin-only */}
      {isAdmin && (
        <div className="px-2 py-3 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          <Link
            href="/admin"
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
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-slate-700 dark:text-slate-300"
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
          <h1 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Quill &amp; Cup
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
          isAdmin={isAdmin}
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
