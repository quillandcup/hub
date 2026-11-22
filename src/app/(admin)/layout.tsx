import { requirePermission } from "@/lib/admin-auth";
import { can } from "@/lib/permissions";
import { PREVIEW_ROLE_LABELS, type PreviewableRole } from "@/lib/staff-preview";
import RolePreviewBanner from "@/components/RolePreviewBanner";
import AnnouncementStack, { ANNOUNCEMENT_PRIORITY } from "@/components/announcements/AnnouncementStack";
import AnnouncementBar from "@/components/announcements/AnnouncementBar";
import { getStaffMfaState } from "@/lib/staff-mfa.server";
import AppUpdatedBar from "@/components/announcements/AppUpdatedBar";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserFeaturePreviews } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";
import AdminNavigation from "./admin/AdminNavigation";
import UserMenu from "@/components/UserMenu";
import AppHeader from "@/components/AppHeader";
import ShortcutsProvider from "@/components/shortcuts/ShortcutsProvider";
import ShortcutsLayout from "@/components/shortcuts/ShortcutsPanel";
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
  // Secure staff check (redirects signed-out → /login, anyone who isn't staff → /no-access). src/proxy.ts
  // pre-filters /admin optimistically, and each admin page repeats its own check with the permission it needs
  // (requirePermission) because layouts don't re-run on client navigation -- see src/lib/admin-auth.ts.
  const user = await requirePermission("staff.access");
  // What the viewer's role may do in the header: the admin search, and sudo as a member.
  const canSearch = can(user, "system.search.use");
  const canSudo = can(user, "member.sudo");
  // A real admin looking at the area as a lower role (src/lib/staff-preview.ts).
  const previewing = user.roles.join() !== user.realRoles.join();

  // A failed read leaves the page default.
  const profile = await createRepos(await createClient()).profiles.byId(user.id).catch(() => null);

  const enabledFeatures: FeatureKey[] = await getUserFeaturePreviews(user.id);

  // The admin's own member record, if they have one, for the bell; none is fine.
  const identity = await getEffectiveIdentity(user);
  const timeZone = await getViewerTimeZone();
  // Staff without a second sign-in step are only reminded until the requirement starts (src/lib/staff-mfa.ts); the guard above has
  // already sent anyone it blocks to /mfa, so this read is the one it cached.
  const mfaSuggested = (await getStaffMfaState()) === "suggest";

  return (
    <div className="relative flex h-dvh overflow-hidden bg-canvas dark:bg-slate-950">
      <AdminNavigation roles={user.roles} enabledFeatures={enabledFeatures} navMode={isNavMode(profile?.nav_mode) ? profile.nav_mode : null} />
      <div className="flex flex-col flex-1 min-w-0">
        <AnnouncementStack
          items={[
            { id: "app-updated", priority: ANNOUNCEMENT_PRIORITY.appUpdated, element: <AppUpdatedBar /> },
            // Not an AnnouncementBar yet; it keeps its own look, just placed with the rest.
            {
              id: "staff-mfa",
              priority: ANNOUNCEMENT_PRIORITY.staffMfa,
              element: mfaSuggested && (
                <AnnouncementBar tone="notice" aria-label="Two-step sign-in" action={{ label: "Set it up", track: "staff-mfa-banner", href: "/settings#two-step-sign-in" }}>
                  <span className="font-medium">Staff accounts will need two-step sign-in. Set it up now so you are not locked out of the admin pages.</span>
                </AnnouncementBar>
              ),
            },
            { id: "role-preview", priority: ANNOUNCEMENT_PRIORITY.sudo, element: previewing && <RolePreviewBanner roleLabel={PREVIEW_ROLE_LABELS[user.role as PreviewableRole] ?? user.role} /> },
          ]}
        />
        <WithInAppNotifications identity={identity}>
          <ShortcutsProvider>
          <AppHeader resultsPath={canSearch ? "/admin/search" : "/search"} isAdmin={canSearch}>
            <UserMenu userEmail={user.email || "User"} isAdmin={canSudo} canPreviewRole={user.realRole === "admin" && !previewing} />
          </AppHeader>
          <TimezoneProvider zone={timeZone}>
            <ShortcutsLayout>
              <main className="min-w-0 flex-1 overflow-auto">
                {children}
              </main>
            </ShortcutsLayout>
          </TimezoneProvider>
          </ShortcutsProvider>
        </WithInAppNotifications>
      </div>
      <PageViewTracker />
    </div>
  );
}
