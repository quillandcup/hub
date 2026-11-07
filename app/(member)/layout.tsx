import { COMMUNITY_MANAGER_ROLE } from '@/lib/staff-access'
import { BrowserPushAccountGuard } from "@/components/BrowserPushAccountGuard";
import { createClient } from '@/lib/supabase/server'
import { createRepos } from '@/lib/data/repos'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getEffectiveIdentity, type EffectiveIdentity } from '@/lib/sudo'
import { effectiveMemberHasFeature, getUserFeaturePreviews } from '@/lib/features.server'
import type { FeatureKey } from '@/lib/features'
import MemberNavigation from '@/components/MemberNavigation'
import { isNavMode } from '@/lib/nav-mode'
import MemberFooter from '@/components/MemberFooter'
import SlackConnectPrompt from '@/components/SlackConnectPrompt'
import { getSlackConnectionStatus, isSlackConnectConfigured } from '@/lib/slack-connect'
import { createServiceRoleClient } from '@/lib/supabase/service'
import UserMenu from '@/components/UserMenu'
import AppHeader from '@/components/AppHeader'
import WithInAppNotifications from '@/components/WithInAppNotifications'
import SudoBanner from '@/components/SudoBanner'
import AnnouncementStack, { ANNOUNCEMENT_PRIORITY } from '@/components/announcements/AnnouncementStack'
import AppUpdatedBar from '@/components/announcements/AppUpdatedBar'
import { InstallAppPrompt } from '@/components/InstallAppPrompt'
import { TimezoneInitializer } from '@/components/TimezoneInitializer'
import { SecondaryTimezoneProvider } from '@/components/SecondaryTimezone'
import { TimezoneProvider } from '@/components/Timezone'
import { resolveTimeZone } from '@/lib/timezone'
import { isValidTimeZone } from '@/lib/time-zone'
import PageViewTracker from '@/components/PageViewTracker'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import { getOnboardingState } from '@/lib/onboarding.server'
import { Suspense, use } from 'react'

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // The three lookups need only the user, so they run together; the rest start from the identity.
  // A failed profile read leaves the defaults (a member, the browser's time zone), as it always has.
  // Features are resolved for every member, not just admins previewing — a flag can also
  // be on for someone via a global rollout or a segment (see lib/features.server.ts), and nav
  // visibility needs to match that.
  const [profile, enabledFeatures, effectiveIdentity] = await Promise.all([
    createRepos(supabase).profiles.byId(user.id).catch(() => null),
    getUserFeaturePreviews(user.id) as Promise<FeatureKey[]>,
    getEffectiveIdentity(user),
  ])

  // Admin with no member record and no sudo active → send to admin area
  if (!effectiveIdentity) redirect('/admin')

  const isAdmin = profile?.role === 'admin'
  const storedTimezone = profile?.timezone_preference ?? 'browser'
  const secondaryTimezone = isValidTimeZone(profile?.secondary_timezone) ? profile.secondary_timezone : null

  // The tour is the member's own: hidden during sudo, so an admin browsing as them doesn't see or
  // change it (app/actions/onboarding.ts refuses then too).
  const showOnboarding = !effectiveIdentity.isSudo

  // Not awaited: the page renders alongside these (an await here would hold it back), and the pieces
  // that need them suspend on their own, with nothing showing until they arrive.
  const extras = loadExtras(effectiveIdentity, enabledFeatures)

  const main = (
    // The Getting started card floats over the bottom right corner (fixed, up to about 20rem tall open):
    // while it is on the page there is room under the content, so the last control scrolls clear of it.
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain group-has-[[data-onboarding-card]]/shell:pb-80">
      {children}
    </main>
  )

  return (
    <div className="group/shell relative flex h-dvh overflow-hidden bg-canvas dark:bg-slate-950">
      <Suspense fallback={null}>
        <PushGuard extras={extras} identity={effectiveIdentity} />
      </Suspense>
      <MemberNavigation isAdmin={isAdmin || profile?.role === COMMUNITY_MANAGER_ROLE} isSudo={effectiveIdentity.isSudo} enabledFeatures={enabledFeatures} navMode={isNavMode(profile?.nav_mode) ? profile.nav_mode : null} />
      <div className="flex flex-col flex-1 min-w-0">
        {/* Bars above the header, stacked by priority (components/announcements/AnnouncementStack.tsx). */}
        <Suspense fallback={null}>
          <Bars extras={extras} identity={effectiveIdentity} />
        </Suspense>

        <TimezoneProvider zone={resolveTimeZone(storedTimezone)}>
        <SecondaryTimezoneProvider zone={secondaryTimezone}>
        <WithInAppNotifications identity={effectiveIdentity}>
          <AppHeader resultsPath="/search" isAdmin={isAdmin}>
            <UserMenu
              userEmail={effectiveIdentity.memberDisplayName ?? effectiveIdentity.memberName}
              memberId={effectiveIdentity.memberId}
              isAdmin={isAdmin}
              canPreviewRole={isAdmin}
              isSudo={effectiveIdentity.isSudo}
              canStartOnboarding={showOnboarding}
            />
          </AppHeader>
          {main}
          <MemberFooter />
        </WithInAppNotifications>
        </SecondaryTimezoneProvider>
        </TimezoneProvider>
        <TimezoneInitializer storedTimezone={storedTimezone} isSudo={effectiveIdentity.isSudo} />
      </div>
      <PageViewTracker />
      {showOnboarding && (
        <Suspense fallback={null}>
          <Tour extras={extras} />
        </Suspense>
      )}
    </div>
  )
}

type Extras = Promise<{
  showInstallPrompt: boolean
  onboardingState: Awaited<ReturnType<typeof getOnboardingState>> | null
  slackNeed: 'connect' | 'reconnect' | 'update' | 'permissions' | null
}>

function loadExtras(identity: EffectiveIdentity, enabledFeatures: FeatureKey[]): Extras {
  // Chat needs a working Slack connection (lib/chat/access.ts sends them to Settings); tell a member who has chat
  // but not that, wherever they are, instead of leaving them to find out at the chat door.
  const slackNeedFor = async (): Promise<'connect' | 'reconnect' | 'update' | 'permissions' | null> => {
    if (identity.isSudo || !isSlackConnectConfigured() || !(await effectiveMemberHasFeature('chat', identity, enabledFeatures))) return null
    const slack = await getSlackConnectionStatus(createServiceRoleClient(), identity.memberId)
    return !slack.connected ? (slack.revoked ? 'reconnect' : 'connect') : !slack.sharesReadState ? 'update' : !slack.hasDmScopes ? 'permissions' : null
  }
  return Promise.all([
    effectiveMemberHasFeature('browser_notifications', identity, enabledFeatures),
    identity.isSudo ? Promise.resolve(null) : getOnboardingState(identity.memberId),
    slackNeedFor(),
  ]).then(([showInstallPrompt, onboardingState, slackNeed]) => ({ showInstallPrompt, onboardingState, slackNeed }))
}

function PushGuard({ extras, identity }: { extras: Extras; identity: EffectiveIdentity }) {
  const { showInstallPrompt } = use(extras)
  return <BrowserPushAccountGuard memberId={identity.memberId} isSudo={identity.isSudo} publicKey={showInstallPrompt ? (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null) : null} />
}

/** Bars above the header, stacked by priority (components/announcements/AnnouncementStack.tsx). */
function Bars({ extras, identity }: { extras: Extras; identity: EffectiveIdentity }) {
  const { showInstallPrompt, onboardingState, slackNeed } = use(extras)
  return (
    <AnnouncementStack
      items={[
        {
          id: 'sudo',
          priority: ANNOUNCEMENT_PRIORITY.sudo,
          element: identity.isSudo && (
            <SudoBanner memberName={identity.memberDisplayName ?? identity.memberName} memberEmail={identity.memberEmail} />
          ),
        },
        { id: 'app-updated', priority: ANNOUNCEMENT_PRIORITY.appUpdated, element: <AppUpdatedBar /> },
        { id: 'install-app', priority: ANNOUNCEMENT_PRIORITY.installApp, element: showInstallPrompt && <InstallAppPrompt /> },
        {
          id: 'slack-connect',
          priority: ANNOUNCEMENT_PRIORITY.slackConnect,
          // While the Getting started tour runs it has the Slack step (required for chat), so the bar would say it twice.
          element: slackNeed && !onboardingState?.active && <SlackConnectPrompt need={slackNeed} />,
        },
      ]}
    />
  )
}

function Tour({ extras }: { extras: Extras }) {
  const { onboardingState } = use(extras)
  // useSearchParams needs a Suspense boundary, which the layout provides around this.
  return onboardingState ? <OnboardingGuide initialState={onboardingState} /> : null
}
