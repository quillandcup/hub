import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getEffectiveIdentity } from '@/lib/sudo'
import { getUserFeaturePreviews } from '@/lib/features.server'
import type { FeatureKey } from '@/lib/features'
import MemberNavigation from '@/components/MemberNavigation'
import UserMenu from '@/components/UserMenu'
import SudoBanner from '@/components/SudoBanner'
import { TimezoneInitializer } from '@/components/TimezoneInitializer'
import FeedbackWidget from '@/components/FeedbackWidget'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import { getOnboardingState } from '@/lib/onboarding.server'
import { Suspense } from 'react'
import {
  InAppNotificationBanner,
  InAppNotificationBell,
  InAppNotificationsProvider,
} from '@/components/InAppNotifications'
import { BELL_LIMIT, countInAppNotifications, loadInAppNotifications } from '@/lib/channels/in-app'

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
    .select('role, timezone_preference')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  const storedTimezone = profile?.timezone_preference ?? 'browser'

  // Resolved for every member, not just admins previewing — a flag can also
  // be on for someone via a global rollout or a segment (see
  // lib/features.server.ts), and nav visibility needs to match that.
  const enabledFeatures: FeatureKey[] = await getUserFeaturePreviews(user.id)

  const effectiveIdentity = await getEffectiveIdentity(user)

  // Admin with no member record and no sudo active → send to admin area
  if (!effectiveIdentity) redirect('/admin')

  // The tour is the member's own: hidden during sudo, so an admin browsing as them doesn't see or
  // change it (app/actions/onboarding.ts refuses then too).
  const showOnboarding = enabledFeatures.includes('onboarding') && !effectiveIdentity.isSudo
  // In-app notifications show in sudo like the rest of the member's experience
  // (app/actions/in-app-notifications.ts).
  const showInApp = enabledFeatures.includes('in_app_notifications')
  const [onboardingState, inAppNotifications] = await Promise.all([
    showOnboarding ? getOnboardingState(user.id, effectiveIdentity.memberId) : null,
    showInApp
      ? Promise.all([
          loadInAppNotifications(supabase, effectiveIdentity.memberId, new Date(), { limit: BELL_LIMIT }),
          countInAppNotifications(supabase, effectiveIdentity.memberId, { unreadOnly: true }),
        ]).then(([latest, unreadCount]) => ({ latest, unreadCount }))
      : null,
  ])

  const header = (bell: React.ReactNode) => (
    <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end gap-2 px-6 flex-shrink-0 relative z-30">
      {bell}
      <UserMenu
        userEmail={effectiveIdentity.memberName}
        memberId={effectiveIdentity.memberId}
        isAdmin={isAdmin}
        isSudo={effectiveIdentity.isSudo}
        enabledFeatures={enabledFeatures}
        canStartOnboarding={showOnboarding}
      />
    </header>
  )
  // While the tour shows, room to scroll the page's last controls clear of its bar.
  const main = (
    <main className={`flex-1 overflow-auto ${onboardingState?.active ? 'pb-36' : ''}`}>
      {children}
    </main>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas dark:bg-slate-950">
      <MemberNavigation isAdmin={isAdmin} enabledFeatures={enabledFeatures} />
      <div className="flex flex-col flex-1 min-w-0">
        {effectiveIdentity.isSudo && (
          <SudoBanner
            memberName={effectiveIdentity.memberName}
            memberEmail={effectiveIdentity.memberEmail}
          />
        )}
        {inAppNotifications ? (
          <InAppNotificationsProvider initial={inAppNotifications}>
            {header(<InAppNotificationBell />)}
            <InAppNotificationBanner />
            {main}
          </InAppNotificationsProvider>
        ) : (
          <>
            {header(null)}
            {main}
          </>
        )}
        <TimezoneInitializer storedTimezone={storedTimezone} isSudo={effectiveIdentity.isSudo} />
      </div>
      <FeedbackWidget />
      {onboardingState && (
        // useSearchParams needs a Suspense boundary.
        <Suspense fallback={null}>
          <OnboardingGuide initialState={onboardingState} />
        </Suspense>
      )}
    </div>
  )
}
