import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { markRemovedSlackReactions } from '@/lib/slack-reactions'

/**
 * The Slack API import upserts reactions, so on its own it can't notice a
 * reaction someone took back (normally the reaction_removed webhook marks it).
 * markRemovedSlackReactions soft-deletes (removed_at) stored reactions on the
 * fetched messages that Slack no longer reports, and leaves everything else
 * alone, including reactions on messages the import didn't fetch (such as ones
 * that have aged out of Slack's history).
 */
describe('markRemovedSlackReactions', () => {
  const supabase = getTestSupabaseAdminClient()
  const channelId = `TEST_CHANNEL_REMOVED_${Date.now()}`
  const fetchedTs = '1790000000.000001'
  const replyTs = '1790000000.000002' // e.g. a thread reply the import doesn't fetch
  const removedAt = '2026-10-07T03:00:00+00:00'

  const reaction = (message_ts: string, name: string, user_id: string) => ({
    channel_id: channelId,
    message_ts,
    reaction: name,
    user_id,
    occurred_at: new Date(parseFloat(message_ts) * 1000).toISOString(),
    raw_payload: {},
  })

  const stored = async () => {
    const { data, error } = await supabase
      .schema('bronze')
      .from('slack_reactions')
      .select('message_ts, reaction, user_id, removed_at')
      .eq('channel_id', channelId)
    if (error) throw error
    return Object.fromEntries((data ?? []).map((r) => [`${r.message_ts}|${r.reaction}|${r.user_id}`, r.removed_at]))
  }

  const cleanup = () => supabase.schema('bronze').from('slack_reactions').delete().eq('channel_id', channelId)

  beforeEach(async () => {
    await cleanup()
    const { error } = await supabase
      .schema('bronze')
      .from('slack_reactions')
      .insert([
        reaction(fetchedTs, 'heart', 'U1'),
        reaction(fetchedTs, 'heart', 'U2'),
        reaction(fetchedTs, 'tada', 'U1'),
        reaction(replyTs, 'eyes', 'U3'),
      ])
    if (error) throw error
  })

  afterAll(cleanup)

  it('marks reactions on fetched messages that Slack no longer reports, keeping the rows', async () => {
    const removed = await markRemovedSlackReactions(
      supabase,
      [{ channel_id: channelId, message_ts: fetchedTs }],
      [reaction(fetchedTs, 'heart', 'U1')],
      removedAt
    )

    expect(removed).toBe(2)
    expect(await stored()).toEqual({
      [`${fetchedTs}|heart|U1`]: null,
      [`${fetchedTs}|heart|U2`]: removedAt,
      [`${fetchedTs}|tada|U1`]: removedAt,
      [`${replyTs}|eyes|U3`]: null,
    })
  })

  it('does not count or re-stamp a reaction that was already marked removed', async () => {
    const reported = [reaction(fetchedTs, 'heart', 'U1')]
    await markRemovedSlackReactions(supabase, [{ channel_id: channelId, message_ts: fetchedTs }], reported, removedAt)

    const again = await markRemovedSlackReactions(
      supabase,
      [{ channel_id: channelId, message_ts: fetchedTs }],
      reported,
      '2026-10-08T03:00:00+00:00'
    )

    expect(again).toBe(0)
    expect((await stored())[`${fetchedTs}|tada|U1`]).toBe(removedAt)
  })

  it('marks nothing when every stored reaction is still reported', async () => {
    const removed = await markRemovedSlackReactions(
      supabase,
      [{ channel_id: channelId, message_ts: fetchedTs }],
      [reaction(fetchedTs, 'heart', 'U1'), reaction(fetchedTs, 'heart', 'U2'), reaction(fetchedTs, 'tada', 'U1')],
      removedAt
    )

    expect(removed).toBe(0)
    expect(Object.values(await stored())).toEqual([null, null, null, null])
  })

  it('leaves reactions on messages the import did not fetch', async () => {
    const removed = await markRemovedSlackReactions(supabase, [], [], removedAt)

    expect(removed).toBe(0)
    expect(Object.values(await stored())).toEqual([null, null, null, null])
  })
})
