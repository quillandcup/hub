import MobileMenuButton from "@/components/MobileMenuButton";
import SearchPalette from "@/components/search/SearchPalette";

// The top bar shared by the member and admin layouts, so the hamburger, search and
// the controls on the right line up the same way in both.
export default function AppHeader({
  resultsPath,
  isAdmin,
  children,
}: {
  resultsPath: string;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  return (
    <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end gap-2 px-6 flex-shrink-0 relative z-30">
      <MobileMenuButton />
      <SearchPalette resultsPath={resultsPath} isAdmin={isAdmin} />
      {children}
    </header>
  );
}
