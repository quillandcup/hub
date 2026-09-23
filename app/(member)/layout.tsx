import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getEffectiveIdentity } from '@/lib/sudo'
import { getUserFeaturePreviews } from '@/lib/features.server'
import type { FeatureKey } from '@/lib/features'
import MemberNavigation from '@/components/MemberNavigation'
import UserMenu from '@/components/UserMenu'
import SudoBanner from '@/components/SudoBanner'
import { TimezoneInitializer } from '@/components/TimezoneInitializer'
import FeedbackWidget from '@/components/FeedbackWidget'

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, timezone_preference')
    .eq('id', user.id)
    .single()

  const isAdmin = profile?.role === 'admin'
  const storedTimezone = profile?.timezone_preference ?? 'browser'

  const enabledFeatures: FeatureKey[] = isAdmin
    ? await getUserFeaturePreviews(user.id)
    : []

  const effectiveIdentity = await getEffectiveIdentity(user)

  // Admin with no member record and no sudo active → send to admin area
  if (!effectiveIdentity) redirect('/admin')

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <MemberNavigation isAdmin={isAdmin} memberId={effectiveIdentity.memberId} enabledFeatures={enabledFeatures} />
      <div className="flex flex-col flex-1 min-w-0">
        {effectiveIdentity.isSudo && (
          <SudoBanner
            memberName={effectiveIdentity.memberName}
            memberEmail={effectiveIdentity.memberEmail}
          />
        )}
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end px-6 flex-shrink-0 relative z-30">
          <UserMenu
            userEmail={effectiveIdentity.memberName}
            isAdmin={isAdmin}
            isSudo={effectiveIdentity.isSudo}
            enabledFeatures={enabledFeatures}
          />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
        <TimezoneInitializer storedTimezone={storedTimezone} isSudo={effectiveIdentity.isSudo} />
      </div>
      <FeedbackWidget />
    </div>
  )
}
