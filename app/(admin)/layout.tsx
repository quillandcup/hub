import { requireAdminPage } from "@/lib/admin-auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserFeaturePreviews } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";
import AdminNavigation from "./admin/AdminNavigation";
import UserMenu from "@/components/UserMenu";
import AppHeader from "@/components/AppHeader";
import WithInAppNotifications from "@/components/WithInAppNotifications";
import PageViewTracker from "@/components/PageViewTracker";
import { TimezoneProvider } from "@/components/Timezone";
import { getViewerTimeZone } from "@/lib/timezone";
import { isNavMode } from "@/lib/nav-mode";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Secure admin check (redirects signed-out → /login, non-admins → /dashboard).
  // proxy.ts pre-filters /admin optimistically, and each admin page repeats
  // this call because layouts don't re-run on client navigation -- see
  // lib/admin-auth.ts.
  const user = await requireAdminPage();

  // A failed read leaves the page default.
  const profile = await createRepos(await createClient()).profiles.byId(user.id).catch(() => null);

  const enabledFeatures: FeatureKey[] = await getUserFeaturePreviews(user.id);

  // The admin's own member record, if they have one, for the bell; none is fine.
  const identity = await getEffectiveIdentity(user);
  const timeZone = await getViewerTimeZone();

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas dark:bg-slate-950">
      <AdminNavigation enabledFeatures={enabledFeatures} navMode={isNavMode(profile?.nav_mode) ? profile.nav_mode : null} />
      <div className="flex flex-col flex-1 min-w-0">
        <WithInAppNotifications identity={identity}>
          <AppHeader resultsPath="/admin/search" isAdmin={true}>
            <UserMenu userEmail={user.email || "User"} isAdmin={true} />
          </AppHeader>
          <TimezoneProvider zone={timeZone}>
            <main className="flex-1 overflow-auto">
              {children}
            </main>
          </TimezoneProvider>
        </WithInAppNotifications>
      </div>
      <PageViewTracker />
    </div>
  );
}
