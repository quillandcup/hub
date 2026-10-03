import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../helpers/supabase'

/**
 * "Sign in from Slack" (lib/slack-sign-in.ts) against the local stack: Slack-id bindings,
 * single-use button tokens and codes, the button's GET route, the Continue and code actions
 * (real GoTrue generateLink + verifyOtp), the /hub command, the Home tab event and its refresh
 * button. The Slack Web API is mocked.
 */

const slackUsersInfo = vi.fn()
const slackViewsPublish = vi.fn()
const slackPostMessage = vi.fn()
vi.mock('@slack/web-api', () => ({
  WebClient: class {
    users = { info: slackUsersInfo }
    views = { publish: slackViewsPublish }
    chat = { postMessage: slackPostMessage }
  },
}))

// Sessions are verified on the "SSR" client; a plain anon client stands in (no cookies).
const ssrClient = getTestSupabaseClient()
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ssrClient }))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

const { afterTasks, nextPath, clientIp } = vi.hoisted(() => ({
  afterTasks: [] as Promise<unknown>[],
  nextPath: { value: '/' },
  clientIp: { value: '198.51.100.1' },
}))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (fn: () => unknown) => {
    afterTasks.push(Promise.resolve().then(fn))
  },
}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ origin: 'http://localhost:3000', 'x-forwarded-for': `${clientIp.value}, 10.0.0.1` }),
}))
vi.mock('@/lib/next-path-cookie', () => ({ takeNextPath: async () => nextPath.value }))

import {
  resolveHubUserForSlackUser,
  issueSlackSignIn,
  consumeSlackSignIn,
  formatSlackSignInCode,
  SLACK_REFRESH_ACTION_ID,
  SLACK_SEND_LINK_ACTION_ID,
  SLACK_ADMIN_SIGN_IN_TTL_MINUTES,
} from '@/lib/slack-sign-in'
import { extractSlackSignInCredential } from '@/lib/slack-sign-in-code'
import { completeSlackSignIn, signInWithSlackCode } from '@/app/auth/slack/actions'
import { GET as buttonGET } from '@/app/auth/slack/route'
import { POST as commandsPOST } from '@/app/api/webhooks/slack/commands/route'
import { POST as eventsPOST } from '@/app/api/webhooks/slack/route'
import { POST as interactionsPOST } from '@/app/api/webhooks/slack/interactions/route'

const SECRET = 'test-slack-secret'
const ORIGIN = 'http://localhost:3000'

function signedRequest(url: string, body: string, contentType: string, secret = SECRET) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-signature': signature,
      'x-slack-request-timestamp': timestamp,
    },
    body,
  })
}

function slackProfile(email: string | null) {
  return { ok: true, user: { id: 'U', deleted: false, is_bot: false, profile: { email } } }
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((e as Error).message)
    if (m) return m[1]
    throw e
  }
  throw new Error('expected a redirect')
}

function tokenOf(url: string) {
  return new URL(url).searchParams.get('token')!
}

function buttonRequest(token: string, navigation: boolean) {
  const headers: Record<string, string> = navigation ? { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } : {}
  return new NextRequest(`${ORIGIN}/auth/slack?token=${encodeURIComponent(token)}`, { headers })
}

function codeForm(code: string) {
  const fd = new FormData()
  fd.set('code', code)
  return fd
}

describe('Slack sign-in', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const slack = {
    member: `UMEM${ts}`,
    admin: `UADM${ts}`,
    stranger: `USTR${ts}`,
    other: `UOTH${ts}`,
    invited: `UINV${ts}`,
  }
  const memberEmail = `slack_signin.member-${ts}@example.com`
  const adminEmail = `slack-signin-admin-${ts}@example.com`
  const invitedEmail = `slack-signin-invited-${ts}@example.com`
  let memberUserId: string
  let adminUserId: string
  let invitedUserId: string

  async function createUser(email: string, role: 'member' | 'admin') {
    const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true })
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
    await supabase.from('user_profiles').upsert({ id: data.user.id, email, role })
    return data.user.id
  }

  /** Bind the member's Slack id via the real first-sight email match. */
  async function bindMember() {
    slackUsersInfo.mockResolvedValue(slackProfile(memberEmail))
    expect((await resolveHubUserForSlackUser(supabase, slack.member)).status).toBe('ok')
  }

  async function signedInUserId() {
    const { data } = await ssrClient.auth.getSession()
    const id = data.session?.user.id
    await ssrClient.auth.signOut()
    return id
  }

  beforeAll(async () => {
    memberUserId = await createUser(memberEmail, 'member')
    adminUserId = await createUser(adminEmail, 'admin')
    const { data: invited, error } = await supabase.auth.admin.inviteUserByEmail(invitedEmail)
    if (error || !invited.user) throw new Error(`invite failed: ${error?.message}`)
    invitedUserId = invited.user.id
  })

  afterAll(async () => {
    const ids = Object.values(slack)
    await supabase.from('slack_sign_in_tokens').delete().in('slack_user_id', ids)
    await supabase.from('slack_identities').delete().in('slack_user_id', ids)
    for (const id of [memberUserId, adminUserId, invitedUserId]) {
      await supabase.auth.admin.deleteUser(id).catch(() => {})
    }
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    afterTasks.length = 0
    nextPath.value = '/'
    process.env.SLACK_SIGNING_SECRET = SECRET
    process.env.SLACK_BOT_TOKEN = 'xoxb-test'
    clientIp.value = '198.51.100.1'
    await supabase.from('slack_identities').delete().in('slack_user_id', Object.values(slack))
    await supabase
      .from('rate_limit_counters')
      .delete()
      .in('bucket', ['slack_code:global', 'slack_code:ip:198.51.100.1', 'slack_code:ip:198.51.100.2'])
  })

  describe('binding a Slack user id to a Hub account', () => {
    it('binds on first sight when the Slack email matches, case-insensitively', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(memberEmail.toUpperCase()))
      const result = await resolveHubUserForSlackUser(supabase, slack.member)
      expect(result).toEqual({ status: 'ok', userId: memberUserId, email: memberEmail })

      const { data } = await supabase.from('slack_identities').select('user_id, linked_via').eq('slack_user_id', slack.member).single()
      expect(data).toEqual({ user_id: memberUserId, linked_via: 'email_match' })
    })

    it('keeps using the bound id after the Slack email changes', async () => {
      await bindMember()
      slackUsersInfo.mockResolvedValue(slackProfile(`changed-${ts}@example.com`))
      expect(await resolveHubUserForSlackUser(supabase, slack.member)).toEqual({
        status: 'ok',
        userId: memberUserId,
        email: memberEmail,
      })
    })

    it('never lets a second Slack user take over an account that is already bound', async () => {
      await bindMember()
      slackUsersInfo.mockResolvedValue(slackProfile(memberEmail))
      expect(await resolveHubUserForSlackUser(supabase, slack.other)).toEqual({ status: 'no_account' })
    })

    it('treats _ in an email literally, not as a LIKE wildcard', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(memberEmail.replace('_', 'x')))
      expect(await resolveHubUserForSlackUser(supabase, slack.stranger)).toEqual({ status: 'no_account' })
    })

    it('ignores member-managed Slack name aliases', async () => {
      const { data: member } = await supabase
        .from('members')
        .insert({ name: `Slack Alias ${ts}`, email: memberEmail, user_id: memberUserId, joined_at: new Date().toISOString(), status: 'active' })
        .select('id')
        .single()
      await supabase.from('member_name_aliases').insert({ member_id: member!.id, alias: slack.stranger, source: 'slack', active: true })
      try {
        slackUsersInfo.mockResolvedValue(slackProfile(`someone-else-${ts}@example.com`))
        expect(await resolveHubUserForSlackUser(supabase, slack.stranger)).toEqual({ status: 'no_account' })
      } finally {
        await supabase.from('member_name_aliases').delete().eq('member_id', member!.id)
        await supabase.from('members').delete().eq('id', member!.id)
      }
    })

    describe('members whose Slack email differs from their Hub sign-in email', () => {
      const signInEmail = `slack-signin-alias-auth-${ts}@example.com`
      const canonicalEmail = `slack-signin-alias-canonical-${ts}@example.com`
      const aliasEmail = `slack-signin-alias-extra-${ts}@example.com`
      let userId: string
      let memberId: string

      beforeAll(async () => {
        userId = await createUser(signInEmail, 'member')
        const { data, error } = await supabase
          .from('members')
          .insert({ name: `Slack Alias Member ${ts}`, email: canonicalEmail, user_id: userId, joined_at: new Date().toISOString(), status: 'active' })
          .select('id')
          .single()
        if (error) throw new Error(`member insert failed: ${error.message}`)
        memberId = data!.id
        await supabase.from('member_email_aliases').insert({ member_id: memberId, alias_email: aliasEmail, source: 'manual' })
      })

      afterAll(async () => {
        await supabase.from('slack_identities').delete().eq('user_id', userId)
        await supabase.from('member_email_aliases').delete().eq('member_id', memberId)
        await supabase.from('members').delete().eq('id', memberId)
        await supabase.auth.admin.deleteUser(userId).catch(() => {})
      })

      beforeEach(async () => {
        await supabase.from('slack_identities').delete().eq('user_id', userId)
        await supabase.from('member_email_aliases').update({ active: true }).eq('member_id', memberId)
      })

      async function linkedVia() {
        const { data } = await supabase.from('slack_identities').select('linked_via').eq('slack_user_id', slack.other).maybeSingle()
        return data?.linked_via
      }

      it("matches the member's canonical email", async () => {
        slackUsersInfo.mockResolvedValue(slackProfile(canonicalEmail))
        expect(await resolveHubUserForSlackUser(supabase, slack.other)).toEqual({ status: 'ok', userId, email: signInEmail })
        expect(await linkedVia()).toBe('email_match')
      })

      it('matches one of their active email aliases', async () => {
        slackUsersInfo.mockResolvedValue(slackProfile(aliasEmail.toUpperCase()))
        expect(await resolveHubUserForSlackUser(supabase, slack.other)).toEqual({ status: 'ok', userId, email: signInEmail })
        expect(await linkedVia()).toBe('email_alias')
      })

      it('ignores an alias the member turned off', async () => {
        await supabase.from('member_email_aliases').update({ active: false }).eq('member_id', memberId)
        slackUsersInfo.mockResolvedValue(slackProfile(aliasEmail))
        expect(await resolveHubUserForSlackUser(supabase, slack.other)).toEqual({ status: 'no_account' })
      })
    })

    it('refuses admins and does not bind them', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(adminEmail))
      expect(await resolveHubUserForSlackUser(supabase, slack.admin)).toEqual({ status: 'admin' })
      const { data } = await supabase.from('slack_identities').select('slack_user_id').eq('slack_user_id', slack.admin)
      expect(data).toHaveLength(0)
    })
  })

  describe('admins who opted in (slack_admin_sign_in preview)', () => {
    const optIn = () => supabase.from('user_feature_previews').upsert({ user_id: adminUserId, feature_key: 'slack_admin_sign_in' })
    const optOut = () => supabase.from('user_feature_previews').delete().eq('user_id', adminUserId).eq('feature_key', 'slack_admin_sign_in')

    beforeEach(optIn)
    afterEach(optOut)

    it('resolves and binds them, marked as admin', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(adminEmail))
      expect(await resolveHubUserForSlackUser(supabase, slack.admin)).toEqual({
        status: 'ok',
        userId: adminUserId,
        email: adminEmail,
        admin: true,
      })
      const { data } = await supabase.from('slack_identities').select('user_id').eq('slack_user_id', slack.admin).single()
      expect(data?.user_id).toBe(adminUserId)
    })

    it('ignores the global switch: only their own opt-in counts', async () => {
      await optOut()
      await supabase.from('feature_flags').upsert({ feature_key: 'slack_admin_sign_in', enabled_globally: true })
      try {
        slackUsersInfo.mockResolvedValue(slackProfile(adminEmail))
        expect(await resolveHubUserForSlackUser(supabase, slack.admin)).toEqual({ status: 'admin' })
      } finally {
        await supabase.from('feature_flags').delete().eq('feature_key', 'slack_admin_sign_in')
      }
    })

    it(`gives them ${SLACK_ADMIN_SIGN_IN_TTL_MINUTES}-minute links that sign them in`, async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(adminEmail))
      const body = new URLSearchParams({ command: '/hub', user_id: slack.admin }).toString()
      const json = await (
        await commandsPOST(signedRequest(`${ORIGIN}/api/webhooks/slack/commands`, body, 'application/x-www-form-urlencoded'))
      ).json()
      const open = json.blocks.find((b: { type: string }) => b.type === 'actions').elements[0]

      const { data: row } = await supabase
        .from('slack_sign_in_tokens')
        .select('expires_at')
        .eq('slack_user_id', slack.admin)
        .is('used_at', null)
        .single()
      const minutesLeft = (new Date(row!.expires_at).getTime() - Date.now()) / 60_000
      expect(minutesLeft).toBeGreaterThan(SLACK_ADMIN_SIGN_IN_TTL_MINUTES - 1)
      expect(minutesLeft).toBeLessThanOrEqual(SLACK_ADMIN_SIGN_IN_TTL_MINUTES)

      await buttonGET(buttonRequest(tokenOf(open.url), true))
      expect(await signedInUserId()).toBe(adminUserId)
    })

    it('revokes their outstanding links when they opt out', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(adminEmail))
      await resolveHubUserForSlackUser(supabase, slack.admin)
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.admin, origin: ORIGIN, ttlMinutes: SLACK_ADMIN_SIGN_IN_TTL_MINUTES })
      await optOut()

      const res = await buttonGET(buttonRequest(tokenOf(issued.url), true))
      expect(res.headers.get('location')).toBe(`${ORIGIN}/auth/slack/continue?error=unavailable`)
    })
  })

  describe('button tokens and codes', () => {
    it('share one row: using the button spends the code too', async () => {
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })
      expect(issued.url.startsWith(`${ORIGIN}/auth/slack?token=`)).toBe(true)
      expect(issued.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)

      expect(await consumeSlackSignIn(supabase, { token: tokenOf(issued.url) })).toBe(slack.member)
      expect(await consumeSlackSignIn(supabase, { token: tokenOf(issued.url) })).toBeNull()
      expect(await consumeSlackSignIn(supabase, { code: issued.code })).toBeNull()
    })

    it('accept codes typed loosely: lowercase, with or without the dash, O for 0', async () => {
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })
      const typed = formatSlackSignInCode(issued.code).toLowerCase().replace(/0/g, 'o')
      expect(await consumeSlackSignIn(supabase, { code: typed })).toBe(slack.member)
    })

    it('are rejected once expired', async () => {
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })
      await supabase
        .from('slack_sign_in_tokens')
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq('slack_user_id', slack.member)
        .is('used_at', null)
      expect(await consumeSlackSignIn(supabase, { code: issued.code })).toBeNull()
    })

    it('reject unknown, empty and wrong-length credentials', async () => {
      expect(await consumeSlackSignIn(supabase, { token: 'not-a-real-token' })).toBeNull()
      expect(await consumeSlackSignIn(supabase, { token: '' })).toBeNull()
      expect(await consumeSlackSignIn(supabase, { code: 'ABC' })).toBeNull()
    })

    it('are not readable by signed-out clients, and neither are bindings', async () => {
      const anon = getTestSupabaseClient()
      const { data: tokens } = await anon.from('slack_sign_in_tokens').select('token_hash')
      const { data: bindings } = await anon.from('slack_identities').select('slack_user_id')
      expect(tokens ?? []).toHaveLength(0)
      expect(bindings ?? []).toHaveLength(0)
    })
  })

  describe('button click (GET /auth/slack)', () => {
    it('signs in directly on a browser navigation and returns to the remembered page', async () => {
      await bindMember()
      nextPath.value = '/prickles/123'
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })

      const res = await buttonGET(buttonRequest(tokenOf(issued.url), true))
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`${ORIGIN}/prickles/123`)
      expect(await signedInUserId()).toBe(memberUserId)

      // A fresh button goes into their Home tab for next time.
      await Promise.all(afterTasks)
      expect(slackViewsPublish).toHaveBeenCalledWith(expect.objectContaining({ user_id: slack.member }))
    })

    it('does not spend the token for a non-navigation fetch, sending it to Continue instead', async () => {
      await bindMember()
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })

      const res = await buttonGET(buttonRequest(tokenOf(issued.url), false))
      expect(res.headers.get('location')).toBe(`${ORIGIN}/auth/slack/continue?token=${tokenOf(issued.url)}`)

      const fd = new FormData()
      fd.set('token', tokenOf(issued.url))
      expect(await redirectOf(completeSlackSignIn(fd))).toBe('/')
      expect(await signedInUserId()).toBe(memberUserId)
    })

    it('on a used link, refreshes their Home tab and says so', async () => {
      await bindMember()
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })
      await consumeSlackSignIn(supabase, { token: tokenOf(issued.url) })

      const res = await buttonGET(buttonRequest(tokenOf(issued.url), true))
      expect(res.headers.get('location')).toBe(`${ORIGIN}/auth/slack/continue?error=expired&refreshed=1`)
      await Promise.all(afterTasks)
      expect(slackViewsPublish).toHaveBeenCalledWith(expect.objectContaining({ user_id: slack.member }))
    })

    it('refuses once the binding is removed, even with an unspent token', async () => {
      await bindMember()
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })
      await supabase.from('slack_identities').delete().eq('slack_user_id', slack.member)

      const res = await buttonGET(buttonRequest(tokenOf(issued.url), true))
      expect(res.headers.get('location')).toBe(`${ORIGIN}/auth/slack/continue?error=unavailable`)
    })

    it('signs in an invited member who has never signed in before', async () => {
      await supabase.from('slack_identities').insert({ slack_user_id: slack.invited, user_id: invitedUserId, linked_via: 'email_match' })
      await supabase.from('user_profiles').upsert({ id: invitedUserId, email: invitedEmail, role: 'member' })
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.invited, origin: ORIGIN })

      await buttonGET(buttonRequest(tokenOf(issued.url), true))
      expect(await signedInUserId()).toBe(invitedUserId)
    })
  })

  describe('code on the sign-in page', () => {
    it('signs in with the code and returns to the remembered page', async () => {
      await bindMember()
      nextPath.value = '/writing'
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })

      expect(await redirectOf(signInWithSlackCode(null, codeForm(formatSlackSignInCode(issued.code))))).toBe('/writing')
      expect(await signedInUserId()).toBe(memberUserId)
    })

    it('explains a bad code', async () => {
      const result = await signInWithSlackCode(null, codeForm('ZZZZZ-ZZZZZ'))
      expect(result.error).toMatch(/didn't work/)
    })

    it('stops an IP after 10 attempts in the window, even with a valid code, but not other IPs', async () => {
      await bindMember()
      for (let i = 0; i < 10; i++) {
        expect((await signInWithSlackCode(null, codeForm('ZZZZZ-ZZZZZ'))).error).toMatch(/didn't work/)
      }
      const issued = await issueSlackSignIn(supabase, { slackUserId: slack.member, origin: ORIGIN })
      expect((await signInWithSlackCode(null, codeForm(issued.code))).error).toMatch(/Too many sign-in attempts/)

      // The blocked attempt didn't spend the code: another IP can still use it.
      clientIp.value = '198.51.100.2'
      expect(await redirectOf(signInWithSlackCode(null, codeForm(issued.code)))).toBe('/')
      expect(await signedInUserId()).toBe(memberUserId)
    })
  })

  describe('/hub command', () => {
    const url = `${ORIGIN}/api/webhooks/slack/commands`

    it('rejects an invalid signature', async () => {
      const body = new URLSearchParams({ command: '/hub', user_id: slack.member }).toString()
      const res = await commandsPOST(signedRequest(url, body, 'application/x-www-form-urlencoded', 'wrong'))
      expect(res.status).toBe(401)
    })

    it('replies ephemerally with a button, a copyable-link button and a code, without a refresh button', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(memberEmail))
      const body = new URLSearchParams({ command: '/hub', user_id: slack.member }).toString()
      const json = await (await commandsPOST(signedRequest(url, body, 'application/x-www-form-urlencoded'))).json()

      expect(json.response_type).toBe('ephemeral')
      const elements = json.blocks.find((b: { type: string }) => b.type === 'actions').elements
      expect(elements.map((e: { action_id: string }) => e.action_id)).toEqual(['hub_sign_in', SLACK_SEND_LINK_ACTION_ID])
      expect(elements[0].url).toMatch(new RegExp(`^${ORIGIN}/auth/slack\\?token=`))
      expect(JSON.stringify(json.blocks)).toMatch(/`[0-9A-Z]{5}-[0-9A-Z]{5}`/)
    })

    it('refuses to issue anything when the signing secret is not configured', async () => {
      delete process.env.SLACK_SIGNING_SECRET
      const body = new URLSearchParams({ command: '/hub', user_id: slack.member }).toString()
      const json = await (await commandsPOST(signedRequest(url, body, 'application/x-www-form-urlencoded'))).json()
      expect(json.blocks).toBeUndefined()
      expect(slackUsersInfo).not.toHaveBeenCalled()
    })
  })

  describe('Home tab', () => {
    const eventsUrl = `${ORIGIN}/api/webhooks/slack`

    function homeOpened(user: string, tab = 'home') {
      const body = JSON.stringify({ type: 'event_callback', event: { type: 'app_home_opened', user, tab } })
      return eventsPOST(signedRequest(eventsUrl, body, 'application/json'))
    }

    it('publishes a sign-in button, a refresh button and a code when the tab opens', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(memberEmail))
      await homeOpened(slack.member)

      const { user_id, view } = slackViewsPublish.mock.calls[0][0]
      expect(user_id).toBe(slack.member)
      const [open, send, refresh] = view.blocks.find((b: { type: string }) => b.type === 'actions').elements
      expect(open.url).toMatch(new RegExp(`^${ORIGIN}/auth/slack\\?token=`))
      expect(send.action_id).toBe(SLACK_SEND_LINK_ACTION_ID)
      expect(refresh.action_id).toBe(SLACK_REFRESH_ACTION_ID)
      expect(JSON.stringify(view.blocks)).toContain('<!date^')
    })

    it('ignores the Messages tab', async () => {
      await homeOpened(slack.member, 'messages')
      expect(slackViewsPublish).not.toHaveBeenCalled()
    })

    it('tells admins to use email sign-in instead', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(adminEmail))
      await homeOpened(slack.admin)
      const { view } = slackViewsPublish.mock.calls[0][0]
      expect(view.blocks.some((b: { type: string }) => b.type === 'actions')).toBe(false)
      expect(JSON.stringify(view.blocks)).toContain('/login')
    })

    function clickButton(actionId: string, user: string) {
      const payload = JSON.stringify({ type: 'block_actions', user: { id: user }, actions: [{ action_id: actionId }] })
      const body = new URLSearchParams({ payload }).toString()
      return interactionsPOST(signedRequest(`${ORIGIN}/api/webhooks/slack/interactions`, body, 'application/x-www-form-urlencoded'))
    }

    it('"Get a fresh link" republishes the tab', async () => {
      await bindMember()
      await clickButton(SLACK_REFRESH_ACTION_ID, slack.member)
      expect(slackViewsPublish).toHaveBeenCalledWith(expect.objectContaining({ user_id: slack.member }))
    })

    it('"Send me a link I can copy" DMs the member a working one-time link, without unfurling it', async () => {
      await bindMember()
      await clickButton(SLACK_SEND_LINK_ACTION_ID, slack.member)

      expect(slackPostMessage).toHaveBeenCalledTimes(1)
      const message = slackPostMessage.mock.calls[0][0]
      expect(message).toMatchObject({ channel: slack.member, unfurl_links: false, unfurl_media: false })
      expect(message.text).toContain(`${ORIGIN}/auth/slack?token=`)

      // Copying the whole message and pasting it on the sign-in page yields the link's token.
      const credential = extractSlackSignInCredential(message.text)
      expect(credential?.kind).toBe('token')
      const res = await buttonGET(buttonRequest((credential as { token: string }).token, true))
      expect(res.headers.get('location')).toBe(`${ORIGIN}/`)
      expect(await signedInUserId()).toBe(memberUserId)
    })

    it('"Send me a link I can copy" sends nothing to someone without a Hub account', async () => {
      slackUsersInfo.mockResolvedValue(slackProfile(`nobody-${ts}@example.com`))
      await clickButton(SLACK_SEND_LINK_ACTION_ID, slack.stranger)
      expect(slackPostMessage).not.toHaveBeenCalled()
    })
  })
})
