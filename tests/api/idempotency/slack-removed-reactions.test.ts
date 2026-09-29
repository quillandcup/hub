import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { deleteRemovedSlackReactions } from '@/lib/slack-reactions'

/**
 * The Slack API import upserts reactions, so on its own it can't notice a
 * reaction someone took back (normally the reaction_removed webhook deletes it).
 * deleteRemovedSlackReactions prunes stored reactions on the fetched messages
 * that Slack no longer reports, and leaves everything else alone.
 */
describe('deleteRemovedSlackReactions', () => {
  const supabase = getTestSupabaseAdminClient()
  const channelId = `TEST_CHANNEL_REMOVED_${Date.now()}`
  const fetchedTs = '1790000000.000001'
  const replyTs = '1790000000.000002' // e.g. a thread reply the import doesn't fetch

  const reaction = (message_ts: string, name: string, user_id: string) => ({
    channel_id: channelId,
    message_ts,
    reaction: name,
    user_id,
    occurred_at: new Date(parseFloat(message_ts) * 1000).toISOString(),
    raw_payload: {},
  })

  const storedKeys = async () => {
    const { data, error } = await supabase
      .schema('bronze')
      .from('slack_reactions')
      .select('message_ts, reaction, user_id')
      .eq('channel_id', channelId)
    if (error) throw error
    return (data ?? []).map((r) => `${r.message_ts}|${r.reaction}|${r.user_id}`).sort()
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

  it('deletes reactions on fetched messages that Slack no longer reports', async () => {
    const removed = await deleteRemovedSlackReactions(
      supabase,
      [{ channel_id: channelId, message_ts: fetchedTs }],
      [reaction(fetchedTs, 'heart', 'U1')]
    )

    expect(removed).toBe(2)
    expect(await storedKeys()).toEqual([`${fetchedTs}|heart|U1`, `${replyTs}|eyes|U3`])
  })

  it('removes nothing when every stored reaction is still reported', async () => {
    const removed = await deleteRemovedSlackReactions(
      supabase,
      [{ channel_id: channelId, message_ts: fetchedTs }],
      [reaction(fetchedTs, 'heart', 'U1'), reaction(fetchedTs, 'heart', 'U2'), reaction(fetchedTs, 'tada', 'U1')]
    )

    expect(removed).toBe(0)
    expect(await storedKeys()).toHaveLength(4)
  })

  it('leaves reactions on messages the import did not fetch', async () => {
    const removed = await deleteRemovedSlackReactions(supabase, [], [])

    expect(removed).toBe(0)
    expect(await storedKeys()).toHaveLength(4)
  })
})
