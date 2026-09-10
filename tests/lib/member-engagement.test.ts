import { describe, it, expect } from 'vitest'
import { computeMemberEngagementMetrics, type EngagementActivityRow } from '@/lib/member-engagement'

const NOW = new Date('2026-08-23T12:00:00Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

// Builds both inputs computeMemberEngagementMetrics needs from a member's
// prickle-attended rows — matching what the real callers do: an unbounded
// fetch of activity_type='prickle_attended' (for totalPrickles/lastAttendedAt)
// plus a last-30-days fetch across all activity types (for the score). Each
// row here is already one-per-(member_id, prickle_id), same as what the
// reprocess_prickle_attendance_atomic mirror produces — this function no
// longer dedupes leave/rejoin rows itself, that aggregation now happens in
// the SQL mirror.
function prickleInputs(records: { member_id: string; occurred_at: string }[]) {
  const thirtyDaysAgoMs = NOW.getTime() - 30 * 24 * 60 * 60 * 1000
  const allPrickleAttended = records
  const recentPrickleActivities: EngagementActivityRow[] = records
    .filter((r) => new Date(r.occurred_at).getTime() >= thirtyDaysAgoMs)
    .map((r) => ({ member_id: r.member_id, activity_type: 'prickle_attended', engagement_value: 10, occurred_at: r.occurred_at }))
  return { allPrickleAttended, recentPrickleActivities }
}

describe('computeMemberEngagementMetrics', () => {
  it('returns high risk with zero counts for a member with no attendance', () => {
    const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW)

    expect(metrics.get('member-1')).toEqual({
      lastAttendedAt: null,
      pricklesLast30Days: 0,
      totalPrickles: 0,
      activityPointsLast30Days: 0,
      engagementScore: 0,
      riskLevel: 'high',
      engagementTier: 'at_risk',
    })
  })

  it('counts each prickle-attended row as one prickle (dedup across leave/rejoin already happened in the SQL mirror, not here)', () => {
    const { allPrickleAttended, recentPrickleActivities } = prickleInputs([
      { member_id: 'member-1', occurred_at: daysAgo(5) },
      { member_id: 'member-1', occurred_at: daysAgo(4) },
    ])

    const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW, recentPrickleActivities)

    expect(metrics.get('member-1')?.totalPrickles).toBe(2)
    expect(metrics.get('member-1')?.pricklesLast30Days).toBe(2)
  })

  it('uses the most recent occurred_at as lastAttendedAt regardless of row order', () => {
    const { allPrickleAttended } = prickleInputs([
      { member_id: 'member-1', occurred_at: daysAgo(20) },
      { member_id: 'member-1', occurred_at: daysAgo(2) },
      { member_id: 'member-1', occurred_at: daysAgo(10) },
    ])

    const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW)

    expect(metrics.get('member-1')?.lastAttendedAt).toBe(new Date(daysAgo(2)).toISOString())
  })

  it('only counts prickles within the last 30 days toward pricklesLast30Days, but all-time toward totalPrickles', () => {
    const { allPrickleAttended, recentPrickleActivities } = prickleInputs([
      { member_id: 'member-1', occurred_at: daysAgo(10) },
      { member_id: 'member-1', occurred_at: daysAgo(45) },
    ])

    const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW, recentPrickleActivities)

    expect(metrics.get('member-1')?.pricklesLast30Days).toBe(1)
    expect(metrics.get('member-1')?.totalPrickles).toBe(2)
  })

  it('caps engagementScore at 100 even with more than 10 prickles in 30 days', () => {
    const { allPrickleAttended, recentPrickleActivities } = prickleInputs(
      Array.from({ length: 15 }, (_, i) => ({ member_id: 'member-1', occurred_at: daysAgo(1) }))
    )

    const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW, recentPrickleActivities)

    expect(metrics.get('member-1')?.pricklesLast30Days).toBe(15)
    expect(metrics.get('member-1')?.engagementScore).toBe(100)
  })

  describe('riskLevel thresholds', () => {
    it('is "low" just under 15 days since last attended', () => {
      const { allPrickleAttended } = prickleInputs([{ member_id: 'member-1', occurred_at: daysAgo(14) }])
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('low')
    })

    it('is "medium" at exactly 15 days since last attended', () => {
      const { allPrickleAttended } = prickleInputs([{ member_id: 'member-1', occurred_at: daysAgo(15) }])
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('medium')
    })

    it('is "medium" just under 30 days since last attended', () => {
      const { allPrickleAttended } = prickleInputs([{ member_id: 'member-1', occurred_at: daysAgo(29) }])
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('medium')
    })

    it('is "high" past 30 days since last attended', () => {
      const { allPrickleAttended } = prickleInputs([{ member_id: 'member-1', occurred_at: daysAgo(31) }])
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('high')
    })

    it('is "high" for a member with no attendance at all', () => {
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('high')
    })
  })

  describe('engagementTier thresholds', () => {
    it('is "at_risk" with zero prickles in the last 30 days', () => {
      const { allPrickleAttended, recentPrickleActivities } = prickleInputs([
        { member_id: 'member-1', occurred_at: daysAgo(45) },
      ])
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW, recentPrickleActivities)
      expect(metrics.get('member-1')?.engagementTier).toBe('at_risk')
    })

    it('is "active" with a nonzero score below 50', () => {
      const { allPrickleAttended, recentPrickleActivities } = prickleInputs([
        { member_id: 'member-1', occurred_at: daysAgo(1) },
        { member_id: 'member-1', occurred_at: daysAgo(2) },
      ])
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW, recentPrickleActivities)
      expect(metrics.get('member-1')?.engagementScore).toBe(20)
      expect(metrics.get('member-1')?.engagementTier).toBe('active')
    })

    it('is "highly_engaged" at a score of exactly 50', () => {
      const { allPrickleAttended, recentPrickleActivities } = prickleInputs(
        Array.from({ length: 5 }, () => ({ member_id: 'member-1', occurred_at: daysAgo(1) }))
      )
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW, recentPrickleActivities)
      expect(metrics.get('member-1')?.engagementScore).toBe(50)
      expect(metrics.get('member-1')?.engagementTier).toBe('highly_engaged')
    })
  })

  it('keeps metrics isolated per member and only returns entries for requested memberIds', () => {
    const { allPrickleAttended } = prickleInputs([
      { member_id: 'member-1', occurred_at: daysAgo(1) },
      { member_id: 'member-2', occurred_at: daysAgo(1) },
      { member_id: 'member-2', occurred_at: daysAgo(2) },
      // member-3 has attendance but is not in the requested memberIds list
      { member_id: 'member-3', occurred_at: daysAgo(1) },
    ])

    const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1', 'member-2'], NOW)

    expect(metrics.size).toBe(2)
    expect(metrics.get('member-1')?.totalPrickles).toBe(1)
    expect(metrics.get('member-2')?.totalPrickles).toBe(2)
    expect(metrics.has('member-3')).toBe(false)
  })

  describe('activity points (Slack engagement, combined with Prickle-derived scoring)', () => {
    it('gives a member with zero Prickles but recent Slack activity a nonzero score', () => {
      // e.g. Amanda: rejoined and posted in Slack this week, hasn't attended a
      // Prickle yet — engagementScore should reflect the Slack signal, not be 0.
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 3, occurred_at: daysAgo(5) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(3)
      expect(metrics.get('member-1')?.engagementScore).toBe(3)
    })

    it('is not enough on its own for a single light-touch Slack message to leave at_risk', () => {
      // One message (worth 1-3 pts per calculateMessageValue) is a much weaker
      // signal than one Prickle (10 pts) — it shouldn't alone flip the tier.
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 3, occurred_at: daysAgo(5) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.engagementTier).toBe('at_risk')
    })

    it('moves a member to "active" once sustained Slack activity reaches a Prickle-equivalent (10 pts)', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 5, occurred_at: daysAgo(10) },
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 6, occurred_at: daysAgo(2) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.engagementScore).toBe(11)
      expect(metrics.get('member-1')?.engagementTier).toBe('active')
    })

    it('ignores activity older than 30 days', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 5, occurred_at: daysAgo(45) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(0)
      expect(metrics.get('member-1')?.engagementScore).toBe(0)
    })

    it('sums engagement_value across multiple activities for the same member', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 3, occurred_at: daysAgo(10) },
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 1, occurred_at: daysAgo(2) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(4)
      expect(metrics.get('member-1')?.engagementScore).toBe(4)
    })

    it('adds activity points on top of the Prickle-based score', () => {
      const { allPrickleAttended, recentPrickleActivities } = prickleInputs([
        { member_id: 'member-1', occurred_at: daysAgo(1) },
      ])
      const activities: EngagementActivityRow[] = [
        ...recentPrickleActivities,
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 3, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.engagementScore).toBe(13) // 10 (1 prickle) + 3 (Slack)
    })

    it('still caps the combined score at 100', () => {
      const { allPrickleAttended, recentPrickleActivities } = prickleInputs(
        Array.from({ length: 10 }, () => ({ member_id: 'member-1', occurred_at: daysAgo(1) }))
      )
      const activities: EngagementActivityRow[] = [
        ...recentPrickleActivities,
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 50, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics(allPrickleAttended, ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.engagementScore).toBe(100)
    })

    it('does not let Slack-only activity change riskLevel (Prickle-recency based; lead scoring is a separate, later phase)', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 10, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.riskLevel).toBe('high')
    })

    it('keeps activity points isolated per member', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', activity_type: 'slack_message', engagement_value: 5, occurred_at: daysAgo(1) },
        { member_id: 'member-2', activity_type: 'slack_message', engagement_value: 2, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1', 'member-2'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(5)
      expect(metrics.get('member-2')?.activityPointsLast30Days).toBe(2)
    })

    it('excludes outreach-touch activity from a lead\'s engagement signal (our action, not theirs)', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', activity_type: 'outreach_touch_logged', engagement_value: 0, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(0)
      expect(metrics.get('member-1')?.engagementScore).toBe(0)
    })
  })
})
