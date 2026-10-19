"use client";

export const OPEN_MOBILE_NAV_EVENT = "open-mobile-nav";

// Lives in the page header so it lines up with the search and avatar even when
// banners push the header down; MemberNavigation owns the drawer and listens.
export default function MobileMenuButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_MOBILE_NAV_EVENT))}
      className="md:hidden mr-2 h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-slate-700 dark:text-slate-300"
      aria-label="Open navigation menu"
    >
      <span className="text-lg leading-none">☰</span>
    </button>
  );
}
