import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getTestSupabaseAdminClient } from './helpers/supabase'

// Tests for the shared dismissed_duplicate_groups table.
// Dismissals are global — one admin dismissing removes the group for all admins.

const supabase = getTestSupabaseAdminClient()
const TEST_KEY = `test-group-${Date.now()}`
const TEST_KEY_2 = `test-group-${Date.now()}-b`

async function cleanup() {
  await supabase
    .from('dismissed_duplicate_groups')
    .delete()
    .in('group_key', [TEST_KEY, TEST_KEY_2])
}

beforeEach(cleanup)
afterEach(cleanup)

describe('dismissed_duplicate_groups (shared)', () => {
  it('a dismissed group is visible without user filtering', async () => {
    const { error: insertError } = await supabase
      .from('dismissed_duplicate_groups')
      .insert({ group_key: TEST_KEY })
    expect(insertError).toBeNull()

    const { data, error } = await supabase
      .from('dismissed_duplicate_groups')
      .select('group_key')
    expect(error).toBeNull()
    expect(data?.map(r => r.group_key)).toContain(TEST_KEY)
  })

  it('inserting the same group_key twice is a no-op (unique constraint)', async () => {
    await supabase.from('dismissed_duplicate_groups').insert({ group_key: TEST_KEY })

    const { error } = await supabase
      .from('dismissed_duplicate_groups')
      .insert({ group_key: TEST_KEY })
    expect(error?.code).toBe('23505') // unique_violation

    const { data } = await supabase
      .from('dismissed_duplicate_groups')
      .select('group_key')
      .eq('group_key', TEST_KEY)
    expect(data).toHaveLength(1)
  })

  it('undismissing removes the record globally (no user_id filter)', async () => {
    await supabase.from('dismissed_duplicate_groups').insert({ group_key: TEST_KEY })

    const { error: deleteError } = await supabase
      .from('dismissed_duplicate_groups')
      .delete()
      .eq('group_key', TEST_KEY)
    expect(deleteError).toBeNull()

    const { data } = await supabase
      .from('dismissed_duplicate_groups')
      .select('group_key')
      .eq('group_key', TEST_KEY)
    expect(data).toHaveLength(0)
  })

  it('dismissed_at is set automatically on insert', async () => {
    const before = new Date()
    await supabase.from('dismissed_duplicate_groups').insert({ group_key: TEST_KEY })

    const { data } = await supabase
      .from('dismissed_duplicate_groups')
      .select('dismissed_at')
      .eq('group_key', TEST_KEY)
      .single()
    expect(data).not.toBeNull()
    expect(new Date(data!.dismissed_at).getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  it('multiple groups can be dismissed independently', async () => {
    await supabase.from('dismissed_duplicate_groups').insert([
      { group_key: TEST_KEY },
      { group_key: TEST_KEY_2 },
    ])

    const { data } = await supabase
      .from('dismissed_duplicate_groups')
      .select('group_key')
      .in('group_key', [TEST_KEY, TEST_KEY_2])
    expect(data?.map(r => r.group_key).sort()).toEqual([TEST_KEY, TEST_KEY_2].sort())

    // Undismiss one — the other stays
    await supabase.from('dismissed_duplicate_groups').delete().eq('group_key', TEST_KEY)

    const { data: remaining } = await supabase
      .from('dismissed_duplicate_groups')
      .select('group_key')
      .in('group_key', [TEST_KEY, TEST_KEY_2])
    expect(remaining?.map(r => r.group_key)).toEqual([TEST_KEY_2])
  })
})
