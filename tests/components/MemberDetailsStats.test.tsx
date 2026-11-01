// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MemberDetails, { type MemberView } from '@/app/(admin)/admin/members/[id]/MemberDetails'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('@/components/MemberAttendanceView', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/members/[id]/MemberTimelinePanel', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/members/[id]/MemberSlackActivityPanel', () => ({
  default: () => null,
}))
vi.mock('@/app/(admin)/admin/activity/ActivityFeedTable', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/activity/ActivityFilters', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/members/[id]/MemberBadgesPanel', () => ({ default: () => null }))
vi.mock('@/app/(admin)/admin/members/[id]/MemberIdentityPanel', () => ({ default: () => null }))

function renderDetails(status: string, stats: Partial<MemberView> = { metrics: { lastAttendedAt: null, pricklesLast30Days: 0, totalPrickles: 0, engagementScore: 100 }, engagement: { riskLevel: 'medium' } }) {
  render(
    <MemberDetails
      initialTab="overview"
      member={{
        id: 'mbr_1',
        name: 'Test Member',
        displayName: null,
        email: 'member@example.test',
        status,
        kajabiId: null,
        stripeCustomerId: null,
        firstJoinedAt: null,
        mostRecentJoinedAt: null,
        totalActiveMonths: 0,
        metrics: null,
        engagement: null,
        ...stats,
      }}
      attendanceRecords={[]}
      hiatusHistory={[]}
      slackPage={{ rows: [], total: 0, page: 1, pageSize: 50, kind: 'all', channel: null, channels: [] }}
      slackSummary={{ total: 0, messages: 0, reactions: 0, channels: 0, last30Days: 0 }}
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
    expect(screen.getByText('Engagement')).toBeTruthy()
    expect(screen.getByText('/ 100')).toBeTruthy()
    expect(screen.getByText('Churn risk')).toBeTruthy()
    expect(screen.getByText('medium')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'About Engagement' })).toBeTruthy()
    expect(screen.getAllByRole('tooltip')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'About Churn risk' })).toBeTruthy()
  })

  it('shows no churn risk for a cancelled member', () => {
    renderDetails('cancelled')
    expect(screen.queryByText('Churn risk')).toBeNull()
    expect(screen.queryByText('medium')).toBeNull()
  })

  it('falls back to 0 and low risk when the member has no metrics yet', () => {
    renderDetails('active', {})
    expect(screen.getByText('/ 100')).toBeTruthy()
    expect(screen.getByText('low')).toBeTruthy()
  })
})

describe('MemberDetails tab titles', () => {
  it('puts the display name, not the legal name, in the document title when switching tabs', () => {
    renderDetails('active', { displayName: 'Ada E', metrics: null, engagement: null })
    fireEvent.click(screen.getByText("Slack Activity (0)"))
    expect(document.title.startsWith('Ada E')).toBe(true)
    expect(document.title).not.toContain('Test Member')
  })
})
