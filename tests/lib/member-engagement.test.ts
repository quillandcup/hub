import { describe, it, expect } from 'vitest'
import {
  computeMemberEngagementMetrics,
  type EngagementAttendanceRow,
  type EngagementActivityRow,
} from '@/lib/member-engagement'

const NOW = new Date('2026-08-23T12:00:00Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
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

  it('counts DISTINCT prickle_id per member, not attendance rows (leave/rejoin per CLAUDE.md)', () => {
    // Same prickle, two attendance records (bathroom break / stepped away and rejoined)
    const attendance: EngagementAttendanceRow[] = [
      { member_id: 'member-1', prickle_id: 'prickle-a', join_time: daysAgo(5) },
      { member_id: 'member-1', prickle_id: 'prickle-a', join_time: daysAgo(4) },
    ]

    const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)

    expect(metrics.get('member-1')?.totalPrickles).toBe(1)
    expect(metrics.get('member-1')?.pricklesLast30Days).toBe(1)
  })

  it('uses the most recent join_time as lastAttendedAt regardless of row order', () => {
    const attendance: EngagementAttendanceRow[] = [
      { member_id: 'member-1', prickle_id: 'prickle-a', join_time: daysAgo(20) },
      { member_id: 'member-1', prickle_id: 'prickle-b', join_time: daysAgo(2) },
      { member_id: 'member-1', prickle_id: 'prickle-c', join_time: daysAgo(10) },
    ]

    const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)

    expect(metrics.get('member-1')?.lastAttendedAt).toBe(new Date(daysAgo(2)).toISOString())
  })

  it('only counts prickles within the last 30 days toward pricklesLast30Days', () => {
    const attendance: EngagementAttendanceRow[] = [
      { member_id: 'member-1', prickle_id: 'recent', join_time: daysAgo(10) },
      { member_id: 'member-1', prickle_id: 'old', join_time: daysAgo(45) },
    ]

    const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)

    expect(metrics.get('member-1')?.pricklesLast30Days).toBe(1)
    expect(metrics.get('member-1')?.totalPrickles).toBe(2)
  })

  it('caps engagementScore at 100 even with more than 10 prickles in 30 days', () => {
    const attendance: EngagementAttendanceRow[] = Array.from({ length: 15 }, (_, i) => ({
      member_id: 'member-1',
      prickle_id: `prickle-${i}`,
      join_time: daysAgo(1),
    }))

    const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)

    expect(metrics.get('member-1')?.pricklesLast30Days).toBe(15)
    expect(metrics.get('member-1')?.engagementScore).toBe(100)
  })

  describe('riskLevel thresholds', () => {
    it('is "low" just under 15 days since last attended', () => {
      const attendance: EngagementAttendanceRow[] = [
        { member_id: 'member-1', prickle_id: 'p', join_time: daysAgo(14) },
      ]
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('low')
    })

    it('is "medium" at exactly 15 days since last attended', () => {
      const attendance: EngagementAttendanceRow[] = [
        { member_id: 'member-1', prickle_id: 'p', join_time: daysAgo(15) },
      ]
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('medium')
    })

    it('is "medium" just under 30 days since last attended', () => {
      const attendance: EngagementAttendanceRow[] = [
        { member_id: 'member-1', prickle_id: 'p', join_time: daysAgo(29) },
      ]
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('medium')
    })

    it('is "high" past 30 days since last attended', () => {
      const attendance: EngagementAttendanceRow[] = [
        { member_id: 'member-1', prickle_id: 'p', join_time: daysAgo(31) },
      ]
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('high')
    })

    it('is "high" for a member with no attendance at all', () => {
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW)
      expect(metrics.get('member-1')?.riskLevel).toBe('high')
    })
  })

  describe('engagementTier thresholds', () => {
    it('is "at_risk" with zero prickles in the last 30 days', () => {
      const attendance: EngagementAttendanceRow[] = [
        { member_id: 'member-1', prickle_id: 'p', join_time: daysAgo(45) },
      ]
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)
      expect(metrics.get('member-1')?.engagementTier).toBe('at_risk')
    })

    it('is "active" with a nonzero score below 50', () => {
      const attendance: EngagementAttendanceRow[] = [
        { member_id: 'member-1', prickle_id: 'p1', join_time: daysAgo(1) },
        { member_id: 'member-1', prickle_id: 'p2', join_time: daysAgo(2) },
      ]
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)
      expect(metrics.get('member-1')?.engagementScore).toBe(20)
      expect(metrics.get('member-1')?.engagementTier).toBe('active')
    })

    it('is "highly_engaged" at a score of exactly 50', () => {
      const attendance: EngagementAttendanceRow[] = Array.from({ length: 5 }, (_, i) => ({
        member_id: 'member-1',
        prickle_id: `prickle-${i}`,
        join_time: daysAgo(1),
      }))
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW)
      expect(metrics.get('member-1')?.engagementScore).toBe(50)
      expect(metrics.get('member-1')?.engagementTier).toBe('highly_engaged')
    })
  })

  it('keeps metrics isolated per member and only returns entries for requested memberIds', () => {
    const attendance: EngagementAttendanceRow[] = [
      { member_id: 'member-1', prickle_id: 'p1', join_time: daysAgo(1) },
      { member_id: 'member-2', prickle_id: 'p1', join_time: daysAgo(1) },
      { member_id: 'member-2', prickle_id: 'p2', join_time: daysAgo(2) },
      // member-3 has attendance but is not in the requested memberIds list
      { member_id: 'member-3', prickle_id: 'p1', join_time: daysAgo(1) },
    ]

    const metrics = computeMemberEngagementMetrics(attendance, ['member-1', 'member-2'], NOW)

    expect(metrics.size).toBe(2)
    expect(metrics.get('member-1')?.totalPrickles).toBe(1)
    expect(metrics.get('member-2')?.totalPrickles).toBe(2)
    expect(metrics.has('member-3')).toBe(false)
  })

  describe('activity points (Slack engagement, Phase 3 combined scoring)', () => {
    it('gives a member with zero Prickles but recent Slack activity a nonzero score', () => {
      // e.g. Amanda: rejoined and posted in Slack this week, hasn't attended a
      // Prickle yet — engagementScore should reflect the Slack signal, not be 0.
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 3, occurred_at: daysAgo(5) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(3)
      expect(metrics.get('member-1')?.engagementScore).toBe(3)
    })

    it('is not enough on its own for a single light-touch Slack message to leave at_risk', () => {
      // One message (worth 1-3 pts per calculateMessageValue) is a much weaker
      // signal than one Prickle (10 pts) — it shouldn't alone flip the tier.
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 3, occurred_at: daysAgo(5) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.engagementTier).toBe('at_risk')
    })

    it('moves a member to "active" once sustained Slack activity reaches a Prickle-equivalent (10 pts)', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 5, occurred_at: daysAgo(10) },
        { member_id: 'member-1', engagement_value: 6, occurred_at: daysAgo(2) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.engagementScore).toBe(11)
      expect(metrics.get('member-1')?.engagementTier).toBe('active')
    })

    it('ignores activity older than 30 days', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 5, occurred_at: daysAgo(45) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(0)
      expect(metrics.get('member-1')?.engagementScore).toBe(0)
    })

    it('sums engagement_value across multiple activities for the same member', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 3, occurred_at: daysAgo(10) },
        { member_id: 'member-1', engagement_value: 1, occurred_at: daysAgo(2) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(4)
      expect(metrics.get('member-1')?.engagementScore).toBe(4)
    })

    it('adds activity points on top of the Prickle-based score', () => {
      const attendance: EngagementAttendanceRow[] = [
        { member_id: 'member-1', prickle_id: 'p1', join_time: daysAgo(1) },
      ]
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 3, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.engagementScore).toBe(13) // 10 (1 prickle) + 3 (Slack)
    })

    it('still caps the combined score at 100', () => {
      const attendance: EngagementAttendanceRow[] = Array.from({ length: 10 }, (_, i) => ({
        member_id: 'member-1',
        prickle_id: `prickle-${i}`,
        join_time: daysAgo(1),
      }))
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 50, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics(attendance, ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.engagementScore).toBe(100)
    })

    it('does not let Slack-only activity change riskLevel (Prickle-recency based; Phase 4, not this scope)', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 10, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1'], NOW, activities)

      expect(metrics.get('member-1')?.riskLevel).toBe('high')
    })

    it('keeps activity points isolated per member', () => {
      const activities: EngagementActivityRow[] = [
        { member_id: 'member-1', engagement_value: 5, occurred_at: daysAgo(1) },
        { member_id: 'member-2', engagement_value: 2, occurred_at: daysAgo(1) },
      ]
      const metrics = computeMemberEngagementMetrics([], ['member-1', 'member-2'], NOW, activities)

      expect(metrics.get('member-1')?.activityPointsLast30Days).toBe(5)
      expect(metrics.get('member-2')?.activityPointsLast30Days).toBe(2)
    })
  })
})
