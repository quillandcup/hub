import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { TimezoneSwitcher } from "./TimezoneSwitcher";
import { SessionsPanel } from "./SessionsPanel";
import { IdentityPanel } from "./IdentityPanel";
import { ProfilePanel } from "./ProfilePanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { getNotificationSettings } from "./notificationActions";
import { getHostedVibes } from "@/app/(member)/prickle-picker/actions";
import HostVibePanel from "@/components/HostVibePanel";
import { Tabs } from "@/components/Tabs";

/** Settings tabs, at /settings (Account) and /settings/<id> (lib/tab-routes.ts). */
export const SETTINGS_TAB_IDS = ["account", "profile", "identity", "preferences", "notifications", "hosting"] as const;
export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];
export const SETTINGS_TITLE = "Settings";
export const SETTINGS_TAB_LABELS: Record<SettingsTabId, string> = {
  account: "Account",
  profile: "Profile",
  identity: "Identity",
  preferences: "Preferences",
  notifications: "Notifications",
  hosting: "Hosting",
};

/**
 * The settings page, rendered by /settings and each /settings/<tab> route with that tab open.
 * Every tab's data loads here, so switching tabs is instant.
 */
export default async function SettingsPage({ tab }: { tab: SettingsTabId }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const [{ data: profile }, effectiveIdentity, hostedVibes, notificationSettings] = await Promise.all([
    supabase.from("user_profiles").select("timezone_preference").eq("id", user.id).single(),
    getEffectiveIdentity(user),
    getHostedVibes(),
    getNotificationSettings(),
  ]);

  // Hosting is for hosts and Notifications for members; an old link to either otherwise opens Account.
  if ((tab === "hosting" && hostedVibes.length === 0) || (tab === "notifications" && !notificationSettings)) {
    redirect("/settings");
  }

  // The effective identity's email, so sudo shows the member's email rather than the admin's.
  const displayEmail = effectiveIdentity?.memberEmail ?? user.email;
  const timezonePreference = profile?.timezone_preference || "browser";

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Manage your account preferences and settings
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 shadow rounded-lg p-6">
          <Tabs
            key={tab}
            initialTab={tab}
            basePath="/settings"
            pageTitle={{ section: SETTINGS_TITLE }}
            tabs={[
              {
                id: "account",
                label: SETTINGS_TAB_LABELS.account,
                content: (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-4">
                        Account Information
                      </h2>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Email
                          </label>
                          <p className="text-sm text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-md">
                            {displayEmail}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                      <SessionsPanel />
                    </div>
                  </div>
                ),
              },
              {
                id: "profile",
                label: SETTINGS_TAB_LABELS.profile,
                content: <ProfilePanel />,
              },
              {
                id: "identity",
                label: SETTINGS_TAB_LABELS.identity,
                content: (
                  <div className="space-y-6">
                    <IdentityPanel />
                  </div>
                ),
              },
              {
                id: "preferences",
                label: SETTINGS_TAB_LABELS.preferences,
                content: (
                  <div className="space-y-6">
                    <ThemeSwitcher />
                    <TimezoneSwitcher initialTimezone={timezonePreference} />
                  </div>
                ),
              },
              ...(notificationSettings
                ? [
                    {
                      id: "notifications" as const,
                      label: SETTINGS_TAB_LABELS.notifications,
                      content: <NotificationsPanel initial={notificationSettings} />,
                    },
                  ]
                : []),
              ...(hostedVibes.length > 0
                ? [
                    {
                      id: "hosting" as const,
                      label: SETTINGS_TAB_LABELS.hosting,
                      content: (
                        <div data-tour="host-vibe">
                          <HostVibePanel hostedVibes={hostedVibes} />
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </main>
    </div>
  );
}
