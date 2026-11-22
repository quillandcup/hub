import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { AnimationsSwitcher } from "./AnimationsSwitcher";
import { TimezoneSwitcher } from "./TimezoneSwitcher";
import { SecondaryTimezoneSwitcher } from "./SecondaryTimezoneSwitcher";
import { SessionsPanel } from "./SessionsPanel";
import MfaPanel from "@/components/mfa/MfaPanel";
import { IdentityPanel } from "./IdentityPanel";
import { isStaffRole } from "@/lib/permissions";
import { ProfilePanel } from "./ProfilePanel";
import { MilestonesPanel } from "./MilestonesPanel";
import { getServiceRepos } from "@/lib/data/server";
import { memberHasWriterProfiles } from "@/lib/writer-profiles-access";
import { WhosComingSetting } from "./WhosComingSetting";
import { PreviewsPanel } from "./PreviewsPanel";
import BlockedPreviewsList from "@/components/chat/BlockedPreviewsList";
import { NotificationsPanel } from "./NotificationsPanel";
import { getNotificationSettings } from "./notificationActions";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getHostedVibes } from "@/app/(member)/prickle-picker/actions";
import HostVibePanel from "@/components/HostVibePanel";
import { Tabs } from "@/components/Tabs";
import SlackConnectPanel from "./SlackConnectPanel";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getSlackConnectionStatus, isSlackConnectConfigured } from "@/lib/slack-connect";

/** Settings tabs, at /settings (Account) and /settings/<id> (src/lib/tab-routes.ts). */
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
  const [profile, effectiveIdentity, hostedVibes, notificationSettings, enabledFeatures] = await Promise.all([
    createRepos(supabase).profiles.byId(user.id).catch(() => null),
    getEffectiveIdentity(user),
    getHostedVibes(),
    getNotificationSettings(),
    getUserFeaturePreviews(user.id),
  ]);
  const isAdmin = profile?.role === "admin";
  const isStaff = isStaffRole(profile?.role);
  // Hosting is behind the hosting preview, and only for hosts.
  const hostingOn = enabledFeatures.includes("hosting") && hostedVibes.length > 0;

  // Hosting is for hosts, Notifications for members and Previews for admins; an old link otherwise opens Account.
  if (
    (tab === "hosting" && !hostingOn) ||
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

  // The previews this member blocked in chat: only for their own account (not in sudo, where row-level security would show the admin's), and
  // only once chat link previews are on for them. A failed read just leaves the list empty.
  const blockedPreviews =
    enabledFeatures.includes("chat_link_previews") && effectiveIdentity && !effectiveIdentity.isSudo
      ? await createRepos(supabase).chatLinkPreviews.blocksOf(effectiveIdentity.memberId).catch(() => [])
      : null;

  // Milestones staff or a course proposed (docs/product/FINISHERS.md): the member's own, listed for them to confirm or decline. A failed
  // read just leaves the card out. In sudo the admin can look but not answer.
  // The card is always shown: it also needs their projects (to link a milestone they add) and live books (the third milestone is derived).
  const milestoneRepos = createRepos(supabase);
  // The globe on a milestone is offered only where writer profiles are open to the member, with a note when their profile is off.
  const [milestones, milestoneProjects, shelfBooks, milestoneWeb] = effectiveIdentity
    ? await Promise.all([
        milestoneRepos.milestones.ofMember(effectiveIdentity.memberId).catch(() => []),
        milestoneRepos.writing.activeProjects(effectiveIdentity.memberId).catch(() => []),
        milestoneRepos.books.mine(effectiveIdentity.memberId).catch(() => []),
        Promise.all([
          memberHasWriterProfiles(getServiceRepos(), effectiveIdentity.memberId),
          milestoneRepos.writerProfiles.ofMember(effectiveIdentity.memberId),
        ])
          .then(([available, page]) => ({ available, on: page?.isPublic ?? false }))
          .catch(() => ({ available: false, on: false })),
      ])
    : [[], [], [], { available: false, on: false }];

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
                        <SlackConnectPanel connected={slackConnected} sharesReadState={slackStatus?.sharesReadState ?? false} hasDmScopes={slackStatus?.hasDmScopes ?? false} hasDmReactionScope={slackStatus?.hasDmReactionScope ?? false} hasPrivateChannelScope={slackStatus?.hasPrivateChannelScope ?? false} />
                      </div>
                    )}

                    {/* The signed-in account's own second step, so not while viewing as another member. */}
                    {!effectiveIdentity?.isSudo && (
                      <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                        <MfaPanel staff={isStaff} />
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
                content: (
                  <>
                    <ProfilePanel milestones={milestones} projects={milestoneProjects} books={shelfBooks.map((b) => ({ id: b.id, title: b.title, projectId: b.project_id ?? null }))} readOnly={effectiveIdentity?.isSudo ?? false} />
                    <MilestonesPanel milestones={milestones} projects={milestoneProjects} books={shelfBooks.map((b) => ({ id: b.id, title: b.title, projectId: b.project_id ?? null }))} readOnly={effectiveIdentity?.isSudo ?? false} web={milestoneWeb} />
                  </>
                ),
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
                    <AnimationsSwitcher />
                    <TimezoneSwitcher initialTimezone={timezonePreference} />
                    <SecondaryTimezoneSwitcher initialTimezone={profile?.secondary_timezone ?? null} />
                    <WhosComingSetting />
                    {blockedPreviews && (
                      <div>
                        <h2 id="link-previews" className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                          Blocked link previews
                        </h2>
                        <BlockedPreviewsList initial={blockedPreviews} />
                      </div>
                    )}
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
              ...(hostingOn
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
