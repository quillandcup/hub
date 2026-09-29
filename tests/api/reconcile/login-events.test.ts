import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../../helpers/supabase'
import { mirrorLoginEvents } from '@/lib/processing/login-events'

/**
 * mirrorLoginEvents against real auth sessions: signing in creates an
 * auth.sessions row, which the mirror turns into a hedgie_hub_login activity.
 */
describe('mirrorLoginEvents', () => {
  const admin = getTestSupabaseAdminClient()
  const suffix = Date.now()
  const password = 'login-events-test-password'
  const linkedEmail = `login-events-linked-${suffix}@example.com`
  const emailOnlyEmail = `login-events-emailonly-${suffix}@example.com`
  const nonMemberEmail = `login-events-nonmember-${suffix}@example.com`

  const authUserIds: string[] = []
  let linkedMemberId: string
  let emailOnlyMemberId: string
  const sessionIds: Record<string, string> = {}
  let windowStart: Date

  async function signUpAndSignIn(email: string) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw new Error(`Failed to create test user ${email}: ${error?.message}`)
    authUserIds.push(data.user.id)

    const client = getTestSupabaseClient()
    const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password })
    if (signInError || !signIn.session) throw new Error(`Failed to sign in as ${email}: ${signInError?.message}`)
    const claims = JSON.parse(Buffer.from(signIn.session.access_token.split('.')[1], 'base64url').toString())
    sessionIds[email] = claims.session_id
    return data.user.id
  }

  const window = () => ({ from: windowStart, to: new Date(Date.now() + 60_000) })

  const loginActivities = async () => {
    const { data, error } = await admin
      .from('member_activities')
      .select('member_id, related_id, activity_type')
      .eq('source', 'access_events')
      .in('related_id', Object.values(sessionIds))
    if (error) throw error
    return data ?? []
  }

  beforeAll(async () => {
    windowStart = new Date(Date.now() - 60_000)

    const { data: members, error } = await admin
      .from('members')
      .insert([
        { name: 'Login Events Linked', email: linkedEmail, joined_at: '2023-01-01', status: 'active' },
        { name: 'Login Events Email Only', email: emailOnlyEmail, joined_at: '2023-01-01', status: 'active' },
      ])
      .select('id, email')
    if (error || !members) throw new Error(`Failed to create members: ${error?.message}`)
    linkedMemberId = members.find((m) => m.email === linkedEmail)!.id
    emailOnlyMemberId = members.find((m) => m.email === emailOnlyEmail)!.id

    const linkedUserId = await signUpAndSignIn(linkedEmail)
    await admin.from('members').update({ user_id: linkedUserId }).eq('id', linkedMemberId)
    await signUpAndSignIn(emailOnlyEmail)
    await signUpAndSignIn(nonMemberEmail)
  })

  afterAll(async () => {
    if (Object.keys(sessionIds).length > 0) {
      await admin.from('member_activities').delete().eq('source', 'access_events').in('related_id', Object.values(sessionIds))
    }
    await admin.from('members').delete().in('id', [linkedMemberId, emailOnlyMemberId].filter(Boolean))
    for (const id of authUserIds) await admin.auth.admin.deleteUser(id).catch(() => {})
  })

  it('mirrors each member login once, matching by user_id or email', async () => {
    await mirrorLoginEvents(admin, window())

    const activities = await loginActivities()
    expect(activities).toHaveLength(2)
    expect(activities).toEqual(
      expect.arrayContaining([
        { member_id: linkedMemberId, related_id: sessionIds[linkedEmail], activity_type: 'hedgie_hub_login' },
        { member_id: emailOnlyMemberId, related_id: sessionIds[emailOnlyEmail], activity_type: 'hedgie_hub_login' },
      ])
    )
  })

  it('does not duplicate activities when the window is mirrored again', async () => {
    await mirrorLoginEvents(admin, window())
    await mirrorLoginEvents(admin, window())

    expect(await loginActivities()).toHaveLength(2)
  })

  it('ignores sessions outside the window', async () => {
    await admin.from('member_activities').delete().eq('source', 'access_events').in('related_id', Object.values(sessionIds))

    const before = new Date(windowStart.getTime() - 60_000)
    await mirrorLoginEvents(admin, { from: before, to: windowStart })

    expect(await loginActivities()).toHaveLength(0)
  })
})
