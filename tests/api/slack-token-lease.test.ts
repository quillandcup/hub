import { describe, it, expect, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'

/**
 * slack_token_refresh_claim hands out the lease that keeps two requests from refreshing one Slack token at
 * once (Slack refresh tokens are single-use). The point of it is what happens when many requests ask at the
 * same instant, which only real, separate connections to the database can show.
 */
describe('slack_token_refresh_claim', () => {
  const supabase = getTestSupabaseAdminClient()
  const key = `lease-test-${Math.random().toString(36).slice(2)}`
  const keys: string[] = [key]

  afterAll(async () => {
    await supabase.from('slack_token_refresh_leases').delete().in('lease_key', keys)
  })

  const claim = async (k: string) => {
    const { data, error } = await supabase.rpc('slack_token_refresh_claim', { p_key: k, p_seconds: 60 })
    expect(error).toBeNull()
    return data
  }

  it('gives the lease to exactly one of many simultaneous requests', async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => claim(key)))
    expect(results.filter((won) => won === true)).toHaveLength(1)
    expect(results.filter((won) => won === false)).toHaveLength(15)
  })

  it('keeps refusing while it is held, gives it again once released, and tells keys apart', async () => {
    const other = `${key}-other`
    keys.push(other)
    expect(await claim(key)).toBe(false) // still held from the test above
    expect(await claim(other)).toBe(true) // a different token has its own lease

    await supabase.rpc('slack_token_refresh_release', { p_key: key })
    expect(await claim(key)).toBe(true)
    expect(await claim(key)).toBe(false)
  })

  it('hands it to the next request once the holder has run out of time (a holder that died)', async () => {
    const dead = `${key}-dead`
    keys.push(dead)
    expect(await claim(dead)).toBe(true)
    await supabase.from('slack_token_refresh_leases').update({ held_until: new Date(Date.now() - 1000).toISOString() }).eq('lease_key', dead)
    expect(await claim(dead)).toBe(true)
  })

  it('can be called only with the service role', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { error } = await anon.rpc('slack_token_refresh_claim', { p_key: key, p_seconds: 60 })
    expect(error).not.toBeNull()
  })
})
