import { requireAdminPage } from "@/lib/admin-auth";
import { getUserFeaturePreviews } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";
import AdminNavigation from "./admin/AdminNavigation";
import UserMenu from "@/components/UserMenu";
import FeedbackWidget from "@/components/FeedbackWidget";

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

  const enabledFeatures: FeatureKey[] = await getUserFeaturePreviews(user.id);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas dark:bg-slate-950">
      <AdminNavigation enabledFeatures={enabledFeatures} />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end px-6 flex-shrink-0 relative z-30">
          <UserMenu
            userEmail={user.email || "User"}
            isAdmin={true}
            enabledFeatures={enabledFeatures}
          />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
      <FeedbackWidget />
    </div>
  );
}
