import MobileMenuButton from "@/components/MobileMenuButton";
import SearchPalette from "@/components/search/SearchPalette";
import LiveRoomIndicator from "@/components/LiveRoomIndicator";
import HelpLink from "@/components/HelpLink";
import { InAppNotificationBanner, InAppNotificationBell } from "@/components/InAppNotifications";

// The top bar shared by the member and admin layouts, so everything in it lines up the same way
// in both: hamburger, search, On air light, help, notification bell, then `children` (the user menu).
// Help shows when `helpHref` is given (the member area; the help articles live there).
// The bell and the banner under the bar show only inside InAppNotifications.
export default function AppHeader({
  resultsPath,
  isAdmin,
  helpHref,
  children,
}: {
  resultsPath: string;
  isAdmin: boolean;
  helpHref?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end gap-2 px-6 flex-shrink-0 relative z-30">
        <MobileMenuButton />
        <SearchPalette resultsPath={resultsPath} isAdmin={isAdmin} />
        <LiveRoomIndicator />
        {helpHref && <HelpLink href={helpHref} />}
        <InAppNotificationBell />
        {children}
      </header>
      <InAppNotificationBanner />
    </>
  );
}
