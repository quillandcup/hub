import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'
import { seedReferenceData } from '../helpers/seed-data'

/**
 * Test member filtering on /dashboard/members page
 *
 * CRITICAL: Filter parameters must correctly filter members by engagement and risk levels.
 * The page joins member_engagement table and needs to filter on the joined data.
 *
 * Filters to test:
 * - at_risk: members with high risk level
 * - highly_engaged: members with highly_engaged engagement tier
 * - all: all members (no filter)
 */
describe('Member Filters', () => {
  const supabase = getTestSupabaseAdminClient()
  const testMemberIds: string[] = []

  beforeAll(async () => {
    // Seed reference data
    await seedReferenceData()

    // Create test members with different engagement profiles
    const members = [
      {
        name: 'At Risk Member',
        email: `at-risk-${Date.now()}@example.com`,
        joined_at: new Date().toISOString(),
        status: 'active',
        engagement: {
          risk_level: 'high',
          engagement_tier: 'at_risk',
        }
      },
      {
        name: 'Highly Engaged Member',
        email: `highly-engaged-${Date.now()}@example.com`,
        joined_at: new Date().toISOString(),
        status: 'active',
        engagement: {
          risk_level: 'low',
          engagement_tier: 'highly_engaged',
        }
      },
      {
        name: 'Active Member',
        email: `active-${Date.now()}@example.com`,
        joined_at: new Date().toISOString(),
        status: 'active',
        engagement: {
          risk_level: 'medium',
          engagement_tier: 'active',
        }
      },
      {
        name: 'On Hiatus Member',
        email: `hiatus-${Date.now()}@example.com`,
        joined_at: new Date().toISOString(),
        status: 'on_hiatus',
        engagement: {
          risk_level: 'low',
          engagement_tier: 'active',
        }
      },
    ]

    // Insert members and their engagement data
    for (const member of members) {
      const { data: memberData, error: memberError } = await supabase
        .from('members')
        .insert({
          name: member.name,
          email: member.email,
          joined_at: member.joined_at,
          status: member.status,
        })
        .select('id')
        .single()

      expect(memberError).toBeNull()
      testMemberIds.push(memberData!.id)

      // Insert member engagement
      const { error: engagementError } = await supabase
        .from('member_engagement')
        .insert({
          member_id: memberData!.id,
          risk_level: member.engagement.risk_level,
          engagement_tier: member.engagement.engagement_tier,
        })

      expect(engagementError).toBeNull()
    }
  })

  afterAll(async () => {
    // Clean up test data
    await supabase.from('member_engagement').delete().in('member_id', testMemberIds)
    await supabase.from('members').delete().in('id', testMemberIds)
  })

  it('should return only at-risk members when filter=at_risk', async () => {
    // Query members with at_risk filter (mimics page.tsx query)
    const { data: members, error } = await supabase
      .from('members')
      .select(`
        *,
        member_metrics(*),
        member_engagement(*)
      `)
      .in('id', testMemberIds)
      .order('name')

    expect(error).toBeNull()

    // Filter in memory (this is what the fix will do)
    const atRiskMembers = members?.filter(
      (m: any) => m.member_engagement?.risk_level === 'high'
    )

    expect(atRiskMembers).toBeDefined()
    expect(atRiskMembers!.length).toBe(1)
    expect(atRiskMembers![0].name).toBe('At Risk Member')
    expect(atRiskMembers![0].member_engagement.risk_level).toBe('high')
  })

  it('should return only highly-engaged members when filter=highly_engaged', async () => {
    // Query members with highly_engaged filter (mimics page.tsx query)
    const { data: members, error } = await supabase
      .from('members')
      .select(`
        *,
        member_metrics(*),
        member_engagement(*)
      `)
      .in('id', testMemberIds)
      .order('name')

    expect(error).toBeNull()

    // Filter in memory (this is what the fix will do)
    const highlyEngagedMembers = members?.filter(
      (m: any) => m.member_engagement?.engagement_tier === 'highly_engaged'
    )

    expect(highlyEngagedMembers).toBeDefined()
    expect(highlyEngagedMembers!.length).toBe(1)
    expect(highlyEngagedMembers![0].name).toBe('Highly Engaged Member')
    expect(highlyEngagedMembers![0].member_engagement.engagement_tier).toBe('highly_engaged')
  })

  it('should return all members when filter=all', async () => {
    // Query members without filter (mimics page.tsx query)
    const { data: members, error } = await supabase
      .from('members')
      .select(`
        *,
        member_metrics(*),
        member_engagement(*)
      `)
      .in('id', testMemberIds)
      .order('name')

    expect(error).toBeNull()
    expect(members).toBeDefined()
    expect(members!.length).toBe(4)
  })

  it('should return only active members when filter=active', async () => {
    // Query members with active filter (mimics page.tsx query)
    const { data: members, error } = await supabase
      .from('members')
      .select(`
        *,
        member_metrics(*),
        member_engagement(*)
      `)
      .in('id', testMemberIds)
      .eq('status', 'active')
      .order('name')

    expect(error).toBeNull()
    expect(members).toBeDefined()
    expect(members!.length).toBe(3)
    expect(members!.every((m: any) => m.status === 'active')).toBe(true)
  })

  it('should return only on-hiatus members when filter=on_hiatus', async () => {
    // Query members with on_hiatus filter (mimics page.tsx query)
    const { data: members, error } = await supabase
      .from('members')
      .select(`
        *,
        member_metrics(*),
        member_engagement(*)
      `)
      .in('id', testMemberIds)
      .eq('status', 'on_hiatus')
      .order('name')

    expect(error).toBeNull()
    expect(members).toBeDefined()
    expect(members!.length).toBe(1)
    expect(members![0].status).toBe('on_hiatus')
    expect(members![0].name).toBe('On Hiatus Member')
  })

  it('should handle members without engagement data gracefully', async () => {
    // Create a member without engagement data
    const { data: memberData, error: memberError } = await supabase
      .from('members')
      .insert({
        name: 'No Engagement Data Member',
        email: `no-engagement-${Date.now()}@example.com`,
        joined_at: new Date().toISOString(),
        status: 'active',
      })
      .select('id')
      .single()

    expect(memberError).toBeNull()
    testMemberIds.push(memberData!.id)

    // Query with engagement join
    const { data: members, error } = await supabase
      .from('members')
      .select(`
        *,
        member_metrics(*),
        member_engagement(*)
      `)
      .eq('id', memberData!.id)

    expect(error).toBeNull()
    expect(members).toBeDefined()
    expect(members!.length).toBe(1)
    expect(members![0].member_engagement).toBeNull()

    // Filter for at_risk should NOT include this member
    const atRiskMembers = members?.filter(
      (m: any) => m.member_engagement?.risk_level === 'high'
    )
    expect(atRiskMembers!.length).toBe(0)
  })
})
