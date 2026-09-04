import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'
import { seedReferenceData } from '../helpers/seed-data'

/**
 * The /admin/members search box only matched members.name and members.email
 * via ilike, so searching for a Zoom/Slack display name stored as an alias
 * (member_name_aliases.alias) would find nothing. This mirrors the fix in
 * page.tsx: query member_name_aliases for an ilike match on `alias`, then OR
 * those member ids into the members search filter.
 */
describe('Admin members page — alias-aware search', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testMemberIds: string[] = []
  const aliasIds: string[] = []

  let aliasedMemberId: string
  let plainMemberId: string

  beforeAll(async () => {
    await seedReferenceData()

    const { data: aliasedMember, error: aliasedError } = await supabase
      .from('members')
      .insert({
        name: 'Robert Smith',
        email: `robert-smith-${ts}@example.com`,
        joined_at: '2020-01-01',
        status: 'active',
      })
      .select('id')
      .single()
    expect(aliasedError).toBeNull()
    aliasedMemberId = aliasedMember!.id
    testMemberIds.push(aliasedMemberId)

    const { data: plainMember, error: plainError } = await supabase
      .from('members')
      .insert({
        name: 'Unrelated Member',
        email: `unrelated-${ts}@example.com`,
        joined_at: '2020-01-01',
        status: 'active',
      })
      .select('id')
      .single()
    expect(plainError).toBeNull()
    plainMemberId = plainMember!.id
    testMemberIds.push(plainMemberId)

    const { data: alias, error: aliasError } = await supabase
      .from('member_name_aliases')
      .insert({ member_id: aliasedMemberId, alias: `Bobby-${ts}`, source: 'zoom' })
      .select('id')
      .single()
    expect(aliasError).toBeNull()
    aliasIds.push(alias!.id)

    // A slack-source alias stores an opaque Slack user_id, not a name — it
    // should NOT be text-searchable the way a zoom display-name alias is.
    const { data: slackAlias, error: slackAliasError } = await supabase
      .from('member_name_aliases')
      .insert({ member_id: plainMemberId, alias: `U0SLACKID${ts}`, source: 'slack' })
      .select('id')
      .single()
    expect(slackAliasError).toBeNull()
    aliasIds.push(slackAlias!.id)
  })

  afterAll(async () => {
    await supabase.from('member_name_aliases').delete().in('id', aliasIds)
    await supabase.from('members').delete().in('id', testMemberIds)
  })

  // Mirrors the search-building logic in app/(admin)/admin/members/page.tsx.
  async function searchMembers(search: string) {
    const { data: matchingAliases } = await supabase
      .from('member_name_aliases')
      .select('member_id')
      .eq('source', 'zoom')
      .ilike('alias', `%${search}%`)
    const aliasMemberIds = Array.from(
      new Set((matchingAliases ?? []).map((a) => a.member_id))
    )

    const orFilters = [`name.ilike.%${search}%`, `email.ilike.%${search}%`]
    if (aliasMemberIds.length > 0) {
      orFilters.push(`id.in.(${aliasMemberIds.join(',')})`)
    }

    const { data, error } = await supabase
      .from('members')
      .select('*')
      .or(orFilters.join(','))
      .order('name')

    expect(error).toBeNull()
    return data ?? []
  }

  it('finds a member by their canonical name', async () => {
    const results = await searchMembers('Robert Smith')
    expect(results.map((m) => m.id)).toContain(aliasedMemberId)
  })

  it('finds a member by an alias that does not match their canonical name', async () => {
    const results = await searchMembers(`Bobby-${ts}`)
    expect(results.map((m) => m.id)).toEqual([aliasedMemberId])
  })

  it('does not return unrelated members for an alias search', async () => {
    const results = await searchMembers(`Bobby-${ts}`)
    expect(results.map((m) => m.id)).not.toContain(plainMemberId)
  })

  it('returns no results for a search matching neither a member nor an alias', async () => {
    const results = await searchMembers(`nonexistent-search-term-${ts}`)
    expect(results.filter((m) => testMemberIds.includes(m.id))).toEqual([])
  })

  it('does not match a slack-source alias (opaque user_id, not a name)', async () => {
    const results = await searchMembers(`U0SLACKID${ts}`)
    expect(results.filter((m) => testMemberIds.includes(m.id))).toEqual([])
  })
})
