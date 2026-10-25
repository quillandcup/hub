import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { TimezoneSwitcher } from "./TimezoneSwitcher";
import { SecondaryTimezoneSwitcher } from "./SecondaryTimezoneSwitcher";
import { SessionsPanel } from "./SessionsPanel";
import { IdentityPanel } from "./IdentityPanel";
import { ProfilePanel } from "./ProfilePanel";
import { PreviewsPanel } from "./PreviewsPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { getNotificationSettings } from "./notificationActions";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getHostedVibes } from "@/app/(member)/prickle-picker/actions";
import HostVibePanel from "@/components/HostVibePanel";
import { Tabs } from "@/components/Tabs";
import SlackConnectPanel from "./SlackConnectPanel";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSlackConnectionStatus, isSlackConnectConfigured } from "@/lib/slack-connect";

/** Settings tabs, at /settings (Account) and /settings/<id> (lib/tab-routes.ts). */
import { SETTINGS_TAB_IDS, SETTINGS_TITLE, SETTINGS_TAB_LABELS, type SettingsTabId } from "./tabs";
export { SETTINGS_TAB_IDS, SETTINGS_TITLE, SETTINGS_TAB_LABELS, type SettingsTabId };

/**
 * The settings page, rendered by /settings and each /settings/<tab> route with that tab open.
 * Every tab's data loads here, so switching tabs is instant.
 */
export default async function SettingsPage({ tab }: { tab: SettingsTabId }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const [{ data: profile }, effectiveIdentity, hostedVibes, notificationSettings, enabledFeatures] = await Promise.all([
    supabase.from("user_profiles").select("timezone_preference, secondary_timezone, role").eq("id", user.id).single(),
    getEffectiveIdentity(user),
    getHostedVibes(),
    getNotificationSettings(),
    getUserFeaturePreviews(user.id),
  ]);
  const isAdmin = profile?.role === "admin";

  // Hosting is for hosts, Notifications for members and Previews for admins; an old link otherwise opens Account.
  if (
    (tab === "hosting" && hostedVibes.length === 0) ||
    (tab === "notifications" && !notificationSettings) ||
    (tab === "previews" && !isAdmin)
  ) {
    redirect("/settings");
  }

  // Connecting Slack: only once the Slack app's client ID and secret are set, and only for your own
  // account (not while viewing as another member).
  const showSlackConnect = isSlackConnectConfigured() && effectiveIdentity !== null && !effectiveIdentity.isSudo;
  const slackStatus = showSlackConnect ? await getSlackConnectionStatus(createServiceRoleClient(), effectiveIdentity!.memberId) : null;
  const slackConnected = slackStatus?.connected ?? false;

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
                      <h2 id="account-information" className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-4">
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

                    {showSlackConnect && (
                      <div data-tour="slack-connect" className="border-t border-slate-200 dark:border-slate-700 pt-6">
                        <SlackConnectPanel connected={slackConnected} sharesReadState={slackStatus?.sharesReadState ?? false} showPrivacy={enabledFeatures.includes("message_privacy")} />
                      </div>
                    )}

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
                    <SecondaryTimezoneSwitcher initialTimezone={profile?.secondary_timezone ?? null} />
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
              ...(isAdmin
                ? [
                    {
                      id: "previews" as const,
                      label: SETTINGS_TAB_LABELS.previews,
                      content: <PreviewsPanel enabledFeatures={enabledFeatures} />,
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
