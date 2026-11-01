import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'

/**
 * slack_bot_token_save / slack_bot_token_get, called the way the app calls them: through PostgREST. That matters:
 * Supabase refuses an UPDATE or DELETE without a WHERE clause on that path ("UPDATE requires a WHERE clause"), and
 * the first version of the function had two, so the first refresh of the rotating bot token worked at Slack and
 * then could not be stored, taking the bot down. pgTAP runs as a superuser the guard doesn't apply to, so it
 * couldn't show it.
 */
describe('slack_bot_token_save through the API', () => {
  const supabase = getTestSupabaseAdminClient()

  async function clear() {
    await supabase.from('slack_bot_token').delete().eq('singleton', true)
    await supabase.from('slack_token_refresh_leases').delete().eq('lease_key', 'bot')
  }

  beforeAll(clear)
  afterAll(clear)

  const get = async () => {
    const { data, error } = await supabase.rpc('slack_bot_token_get')
    expect(error).toBeNull()
    return (data ?? [])[0] as { access_token: string; refresh_token: string; expires_at: string } | undefined
  }

  it('stores a credential, then updates it in place, and gives back the lease', async () => {
    expect(await get()).toBeUndefined()

    const first = await supabase.rpc('slack_bot_token_save', { p_access_token: 'xoxe.xoxb-test-1', p_refresh_token: 'xoxe-test-refresh-1', p_expires_at: '2098-01-01T00:00:00Z' })
    expect(first.error).toBeNull()
    expect(await get()).toMatchObject({ access_token: 'xoxe.xoxb-test-1', refresh_token: 'xoxe-test-refresh-1' })

    // The refresh path: the second save is the one that used to fail.
    await supabase.rpc('slack_token_refresh_claim', { p_key: 'bot', p_seconds: 60 })
    const second = await supabase.rpc('slack_bot_token_save', { p_access_token: 'xoxe.xoxb-test-2', p_refresh_token: 'xoxe-test-refresh-2', p_expires_at: '2098-01-02T00:00:00Z' })
    expect(second.error).toBeNull()
    const stored = await get()
    expect(stored).toMatchObject({ access_token: 'xoxe.xoxb-test-2', refresh_token: 'xoxe-test-refresh-2' })
    expect(new Date(stored!.expires_at).toISOString()).toBe('2098-01-02T00:00:00.000Z')

    const { count } = await supabase.from('slack_bot_token').select('*', { count: 'exact', head: true })
    expect(count).toBe(1)
    const lease = await supabase.rpc('slack_token_refresh_claim', { p_key: 'bot', p_seconds: 60 })
    expect(lease.data).toBe(true) // saving released it
  })

  it('refuses to store nothing', async () => {
    const { error } = await supabase.rpc('slack_bot_token_save', { p_access_token: '', p_refresh_token: 'x', p_expires_at: '2098-01-01T00:00:00Z' })
    expect(error?.message).toContain('no access token')
  })
})
