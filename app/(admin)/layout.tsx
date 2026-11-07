import { requireStaffPage } from "@/lib/admin-auth";
import RolePreviewBanner from "@/components/RolePreviewBanner";
import AnnouncementStack, { ANNOUNCEMENT_PRIORITY } from "@/components/announcements/AnnouncementStack";
import AppUpdatedBar from "@/components/announcements/AppUpdatedBar";
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
  // Secure staff check (redirects signed-out → /login, anyone but an admin or community manager
  // → /no-access). proxy.ts pre-filters /admin optimistically, and each admin page repeats its own
  // check (requireAdminPage, or requireStaffPage on the pages a community manager may open)
  // because layouts don't re-run on client navigation -- see lib/admin-auth.ts.
  const user = await requireStaffPage();
  const isAdmin = user.role === "admin";
  // A real admin looking at the area as a lower role (lib/staff-preview.ts).
  const previewing = user.role !== user.realRole;

  // A failed read leaves the page default.
  const profile = await createRepos(await createClient()).profiles.byId(user.id).catch(() => null);

  const enabledFeatures: FeatureKey[] = await getUserFeaturePreviews(user.id);

  // The admin's own member record, if they have one, for the bell; none is fine.
  const identity = await getEffectiveIdentity(user);
  const timeZone = await getViewerTimeZone();

  return (
    <div className="relative flex h-dvh overflow-hidden bg-canvas dark:bg-slate-950">
      <AdminNavigation role={user.role} enabledFeatures={enabledFeatures} navMode={isNavMode(profile?.nav_mode) ? profile.nav_mode : null} />
      <div className="flex flex-col flex-1 min-w-0">
        <AnnouncementStack
          items={[
            { id: "app-updated", priority: ANNOUNCEMENT_PRIORITY.appUpdated, element: <AppUpdatedBar /> },
            // Not an AnnouncementBar yet; it keeps its own look, just placed with the rest.
            { id: "role-preview", priority: ANNOUNCEMENT_PRIORITY.sudo, element: previewing && <RolePreviewBanner roleLabel="Community Manager" /> },
          ]}
        />
        <WithInAppNotifications identity={identity}>
          <AppHeader resultsPath={isAdmin ? "/admin/search" : "/search"} isAdmin={isAdmin}>
            <UserMenu userEmail={user.email || "User"} isAdmin={isAdmin} canPreviewRole={isAdmin} />
          </AppHeader>
          <TimezoneProvider zone={timeZone}>
            <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              {children}
            </main>
          </TimezoneProvider>
        </WithInAppNotifications>
      </div>
      <PageViewTracker />
    </div>
  );
}
