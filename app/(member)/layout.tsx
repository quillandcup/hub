import { BrowserPushAccountGuard } from "@/components/BrowserPushAccountGuard";
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getEffectiveIdentity } from '@/lib/sudo'
import { effectiveMemberHasFeature, getUserFeaturePreviews } from '@/lib/features.server'
import type { FeatureKey } from '@/lib/features'
import MemberNavigation from '@/components/MemberNavigation'
import UserMenu from '@/components/UserMenu'
import AppChrome from '@/components/AppChrome'
import SudoBanner from '@/components/SudoBanner'
import { InstallAppPrompt } from '@/components/InstallAppPrompt'
import { TimezoneInitializer } from '@/components/TimezoneInitializer'
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
  const showOnboarding = !effectiveIdentity.isSudo
  const showInstallPrompt = await effectiveMemberHasFeature('browser_notifications', effectiveIdentity, enabledFeatures)
  const onboardingState = showOnboarding ? await getOnboardingState(effectiveIdentity.memberId) : null

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
        {effectiveIdentity.isSudo && (
          <SudoBanner
            memberName={effectiveIdentity.memberName}
            memberEmail={effectiveIdentity.memberEmail}
          />
        )}
        {showInstallPrompt && <InstallAppPrompt />}
        <AppChrome
          resultsPath="/search"
          isAdmin={isAdmin}
          identity={effectiveIdentity}
          enabledFeatures={enabledFeatures}
          headerEnd={
            <UserMenu
              userEmail={effectiveIdentity.memberName}
              memberId={effectiveIdentity.memberId}
              isAdmin={isAdmin}
              isSudo={effectiveIdentity.isSudo}
              canStartOnboarding={showOnboarding}
            />
          }
        >
          {main}
        </AppChrome>
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
