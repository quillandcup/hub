// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MemberDetails from '@/app/(admin)/admin/members/[id]/MemberDetails'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/components/MemberAttendanceView', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/members/[id]/MemberTimelinePanel', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/members/[id]/MemberSlackActivityPanel', () => ({
  default: () => null,
  computeSlackSummary: () => ({}),
}))
vi.mock('@/app/(admin)/admin/activity/ActivityFeedTable', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/activity/ActivityFilters', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/members/[id]/MemberBadgesPanel', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/members/[id]/MemberIdentityPanel', () => ({ default: () => null }))

function renderDetails(status: string) {
  render(
    <MemberDetails
      initialTab="overview"
      member={{
        id: 'mbr_1',
        name: 'Test Member',
        status,
        member_metrics: { engagement_score: 100 },
        member_engagement: { risk_level: 'medium' },
      }}
      attendanceRecords={[]}
      hiatusHistory={[]}
      slackActivities={[]}
      activityFeed={{ rows: [] } as never}
      activityFilters={{} as never}
      membershipHistory={[]}
      earnedBadges={[]}
      awardableBadgeTypes={[]}
      awards={[]}
      nameAliases={[]}
      emailAliases={[]}
    />,
  )
}

describe('MemberDetails engagement and churn risk', () => {
  it('labels the score out of 100 and shows churn risk separately for an active member', () => {
    renderDetails('active')
    expect(screen.getByText('Engagement (30 days)')).toBeTruthy()
    expect(screen.getByText('/ 100')).toBeTruthy()
    expect(screen.getByText('Churn risk (days since last prickle)')).toBeTruthy()
    expect(screen.getByText('medium')).toBeTruthy()
  })

  it('shows no churn risk for a cancelled member', () => {
    renderDetails('cancelled')
    expect(screen.queryByText('Churn risk (days since last prickle)')).toBeNull()
    expect(screen.queryByText('medium')).toBeNull()
  })
})
