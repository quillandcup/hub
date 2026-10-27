import { BrowserPushAccountGuard } from "@/components/BrowserPushAccountGuard";
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getEffectiveIdentity } from '@/lib/sudo'
import { effectiveMemberHasFeature, getUserFeaturePreviews } from '@/lib/features.server'
import type { FeatureKey } from '@/lib/features'
import MemberNavigation from '@/components/MemberNavigation'
import MemberFooter from '@/components/MemberFooter'
import SlackConnectPrompt from '@/components/SlackConnectPrompt'
import { getSlackConnectionStatus, isSlackConnectConfigured } from '@/lib/slack-connect'
import { createServiceRoleClient } from '@/lib/supabase/service'
import UserMenu from '@/components/UserMenu'
import AppHeader from '@/components/AppHeader'
import WithInAppNotifications from '@/components/WithInAppNotifications'
import SudoBanner from '@/components/SudoBanner'
import AnnouncementStack, { ANNOUNCEMENT_PRIORITY } from '@/components/announcements/AnnouncementStack'
import { InstallAppPrompt } from '@/components/InstallAppPrompt'
import { TimezoneInitializer } from '@/components/TimezoneInitializer'
import { SecondaryTimezoneProvider } from '@/components/SecondaryTimezone'
import { TimezoneProvider } from '@/components/Timezone'
import { resolveTimeZone } from '@/lib/timezone'
import { isValidTimeZone } from '@/lib/time-zone'
import FeedbackWidget from '@/components/FeedbackWidget'
import PageViewTracker from '@/components/PageViewTracker'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import { getOnboardingState } from '@/lib/onboarding.server'
import { Suspense } from 'react'

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, timezone_preference, secondary_timezone')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  const storedTimezone = profile?.timezone_preference ?? 'browser'
  const secondaryTimezone = isValidTimeZone(profile?.secondary_timezone) ? profile.secondary_timezone : null

  // Resolved for every member, not just admins previewing — a flag can also
  // be on for someone via a global rollout or a segment (see
  // lib/features.server.ts), and nav visibility needs to match that.
  const enabledFeatures: FeatureKey[] = await getUserFeaturePreviews(user.id)

  const effectiveIdentity = await getEffectiveIdentity(user)

  // Admin with no member record and no sudo active → send to admin area
  if (!effectiveIdentity) redirect('/admin')

  // The tour is the member's own: hidden during sudo, so an admin browsing as them doesn't see or
  // change it (app/actions/onboarding.ts refuses then too).
  const showOnboarding = !effectiveIdentity.isSudo
  const showInstallPrompt = await effectiveMemberHasFeature('browser_notifications', effectiveIdentity, enabledFeatures)
  const onboardingState = showOnboarding ? await getOnboardingState(effectiveIdentity.memberId) : null

  // Chat needs a working Slack connection (lib/chat/access.ts sends them to Settings); tell a member who has chat
  // but not that, wherever they are, instead of leaving them to find out at the chat door.
  let slackNeed: 'connect' | 'reconnect' | 'update' | null = null
  if (!effectiveIdentity.isSudo && isSlackConnectConfigured() && (await effectiveMemberHasFeature('chat', effectiveIdentity, enabledFeatures))) {
    const slack = await getSlackConnectionStatus(createServiceRoleClient(), effectiveIdentity.memberId)
    slackNeed = !slack.connected ? (slack.revoked ? 'reconnect' : 'connect') : !slack.sharesReadState ? 'update' : null
  }

  // While the tour shows, room to scroll the page's last controls clear of its bar.
  const main = (
    <main className={`flex-1 overflow-auto ${onboardingState?.active ? 'pb-36' : ''}`}>
      {children}
    </main>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas dark:bg-slate-950">
      <BrowserPushAccountGuard memberId={effectiveIdentity.memberId} isSudo={effectiveIdentity.isSudo} publicKey={showInstallPrompt ? (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null) : null} />
      <MemberNavigation isAdmin={isAdmin} enabledFeatures={enabledFeatures} />
      <div className="flex flex-col flex-1 min-w-0">
        {/* Bars above the header, stacked by priority (components/announcements/AnnouncementStack.tsx). */}
        <AnnouncementStack
          items={[
            {
              id: 'sudo',
              priority: ANNOUNCEMENT_PRIORITY.sudo,
              element: effectiveIdentity.isSudo && (
                <SudoBanner
                  memberName={effectiveIdentity.memberDisplayName ?? effectiveIdentity.memberName}
                  memberEmail={effectiveIdentity.memberEmail}
                />
              ),
            },
            { id: 'install-app', priority: ANNOUNCEMENT_PRIORITY.installApp, element: showInstallPrompt && <InstallAppPrompt /> },
            {
              id: 'slack-connect',
              priority: ANNOUNCEMENT_PRIORITY.slackConnect,
              // While the Getting started tour runs it has the Slack step (required for chat), so the bar would say it twice.
              element: slackNeed && !onboardingState?.active && <SlackConnectPrompt need={slackNeed} />,
            },
          ]}
        />

        <TimezoneProvider zone={resolveTimeZone(storedTimezone)}>
        <SecondaryTimezoneProvider zone={secondaryTimezone}>
        <WithInAppNotifications identity={effectiveIdentity}>
          <AppHeader resultsPath="/search" isAdmin={isAdmin} helpHref="/help">
            <UserMenu
              userEmail={effectiveIdentity.memberDisplayName ?? effectiveIdentity.memberName}
              memberId={effectiveIdentity.memberId}
              isAdmin={isAdmin}
              isSudo={effectiveIdentity.isSudo}
              canStartOnboarding={showOnboarding}
            />
          </AppHeader>
          {main}
          <MemberFooter showPrivacy={enabledFeatures.includes('message_privacy')} />
        </WithInAppNotifications>
        </SecondaryTimezoneProvider>
        </TimezoneProvider>
        <TimezoneInitializer storedTimezone={storedTimezone} isSudo={effectiveIdentity.isSudo} />
      </div>
      <FeedbackWidget />
      <PageViewTracker />
      {onboardingState && (
        // useSearchParams needs a Suspense boundary.
        <Suspense fallback={null}>
          <OnboardingGuide initialState={onboardingState} />
        </Suspense>
      )}
    </div>
  )
}
