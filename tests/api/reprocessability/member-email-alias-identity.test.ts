import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * member_email_aliases point at a member (member_id), not at an email.
 *
 * Production failure that prompted this: a member had two Kajabi contacts, her
 * real one and a second one merged in with an alias (second email -> her email).
 * She changed her real contact's email in Kajabi. The alias still named her
 * old address, so the second contact alone resolved to it, and the kajabi_id
 * UPDATE of the leftover member row for that contact tried to take the old
 * address while she still held it: members_email_key, and the whole members
 * step failed on every sync until someone fixed the alias by hand.
 *
 * These run the real /api/process/members route against the local stack.
 */
describe('Member email aliases follow the member, not an email', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const prefix = `alias-identity-${ts}`
  const email = (label: string) => `${prefix}-${label}@example.com`
  const kajabiId = (label: string) => `${prefix}-${label}`

  async function processMembers() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/members`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(`process/members failed: ${response.status} - ${JSON.stringify(body)}`)
    return body
  }

  async function addContact(label: string, contactEmail: string, name = `Alias Identity ${label}`) {
    const { error } = await supabase.schema('bronze').from('kajabi_contacts').insert({
      kajabi_contact_id: kajabiId(label),
      email: contactEmail,
      name,
      created_at_kajabi: '2023-01-01T00:00:00Z',
      data: {},
    })
    if (error) throw error
  }

  async function setContactEmail(label: string, contactEmail: string) {
    const { error } = await supabase.schema('bronze').from('kajabi_contacts')
      .update({ email: contactEmail })
      .eq('kajabi_contact_id', kajabiId(label))
    if (error) throw error
  }

  async function memberByKajabiId(label: string) {
    const { data, error } = await supabase.from('members').select('*').eq('kajabi_id', kajabiId(label))
    if (error) throw error
    return data ?? []
  }

  async function memberByEmail(memberEmail: string) {
    const { data, error } = await supabase.from('members').select('*').eq('email', memberEmail)
    if (error) throw error
    return data ?? []
  }

  async function addAlias(aliasEmail: string, memberId: string) {
    const { error } = await supabase.from('member_email_aliases').insert({
      alias_email: aliasEmail,
      member_id: memberId,
      source: 'manual',
    })
    if (error) throw error
  }

  async function alias(aliasEmail: string) {
    const { data, error } = await supabase
      .from('member_email_aliases')
      .select('member_id, canonical_email, source, active')
      .eq('alias_email', aliasEmail)
      .maybeSingle()
    if (error) throw error
    return data
  }

  async function cleanUp() {
    // Scoped to this file's prefix only (the local DB is shared by every test file).
    await supabase.schema('bronze').from('kajabi_purchases').delete().ilike('kajabi_purchase_id', `${prefix}-%`)
    await supabase.schema('bronze').from('kajabi_customers').delete().ilike('kajabi_customer_id', `${prefix}-%`)
    await supabase.schema('bronze').from('kajabi_offers').delete().ilike('kajabi_offer_id', `${prefix}-%`)
    await supabase.schema('bronze').from('kajabi_contacts').delete().ilike('kajabi_contact_id', `${prefix}-%`)
    await supabase.from('member_email_aliases').delete().ilike('alias_email', `${prefix}-%`)
    await supabase.from('members').delete().ilike('email', `${prefix}-%`)
  }

  beforeAll(cleanUp)
  afterAll(cleanUp)

  describe('primary contact changes email while an alias contact points at the member (production regression)', () => {
    let memberId: string
    let leftoverId: string

    beforeAll(async () => {
      // Two Kajabi contacts, each synced into its own member row, then merged
      // by an admin with an alias: exactly the production shape.
      await addContact('amy', email('amy-aol'))
      await addContact('amy-books', email('amy-books'))
      await processMembers()
      memberId = (await memberByKajabiId('amy'))[0].id
      leftoverId = (await memberByKajabiId('amy-books'))[0].id
      await addAlias(email('amy-books'), memberId)
      await processMembers()
    })

    it('syncs successfully after the primary contact\'s email changes', async () => {
      await setContactEmail('amy', email('amy-gmail'))
      const result = await processMembers()
      expect(result.success).toBe(true)
      expect(result.emailConflicts).toEqual([])
    }, 60000)

    it('updates the same member row to the new email', async () => {
      const rows = await memberByKajabiId('amy')
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(memberId)
      expect(rows[0].email).toBe(email('amy-gmail'))
      expect(await memberByEmail(email('amy-aol'))).toHaveLength(0)
    })

    it('leaves the alias contact\'s leftover row alone instead of giving it the old email', async () => {
      const { data } = await supabase.from('members').select('id, email').eq('id', leftoverId).single()
      expect(data!.email).toBe(email('amy-books'))
    })

    it('keeps the alias on the member, with canonical_email now the new address', async () => {
      expect(await alias(email('amy-books'))).toMatchObject({
        member_id: memberId,
        canonical_email: email('amy-gmail'),
        active: true,
      })
    })

    it('adds the old address as an auto-detected alias of the member', async () => {
      expect(await alias(email('amy-aol'))).toMatchObject({
        member_id: memberId,
        canonical_email: email('amy-gmail'),
        source: 'auto_detected',
      })
    })

    it('is stable on the next run', async () => {
      const result = await processMembers()
      expect(result.emailConflicts).toEqual([])
      const rows = await memberByKajabiId('amy')
      expect(rows.map((r) => [r.id, r.email])).toEqual([[memberId, email('amy-gmail')]])
      expect((await alias(email('amy-books')))!.member_id).toBe(memberId)
    }, 60000)

    it('follows a second email change too', async () => {
      await setContactEmail('amy', email('amy-third'))
      await processMembers()
      const rows = await memberByKajabiId('amy')
      expect(rows.map((r) => [r.id, r.email])).toEqual([[memberId, email('amy-third')]])
      for (const old of ['amy-books', 'amy-aol', 'amy-gmail']) {
        expect(await alias(email(old))).toMatchObject({ member_id: memberId, canonical_email: email('amy-third') })
      }
    }, 60000)

    it('handles the member changing back to an address that had become her alias', async () => {
      await setContactEmail('amy', email('amy-aol'))
      const result = await processMembers()
      expect(result.emailConflicts).toEqual([])
      const rows = await memberByKajabiId('amy')
      expect(rows.map((r) => [r.id, r.email])).toEqual([[memberId, email('amy-aol')]])
      expect((await alias(email('amy-third')))!.member_id).toBe(memberId)
    }, 60000)
  })

  describe('alias contact with no member row of its own', () => {
    let memberId: string

    beforeAll(async () => {
      await addContact('bea', email('bea-old'))
      await processMembers()
      memberId = (await memberByKajabiId('bea'))[0].id
      await addAlias(email('bea-alt'), memberId)
      await addContact('bea-alt', email('bea-alt'))
      await processMembers()
    })

    it('never creates a member for the aliased contact', async () => {
      expect(await memberByEmail(email('bea-alt'))).toHaveLength(0)
      expect(await memberByKajabiId('bea-alt')).toHaveLength(0)
    })

    it('still resolves after the primary contact changes email', async () => {
      await setContactEmail('bea', email('bea-new'))
      const result = await processMembers()
      expect(result.emailConflicts).toEqual([])
      expect((await memberByKajabiId('bea')).map((r) => [r.id, r.email])).toEqual([[memberId, email('bea-new')]])
      expect(await memberByEmail(email('bea-alt'))).toHaveLength(0)
      expect(await memberByEmail(email('bea-old'))).toHaveLength(0)
    }, 60000)
  })

  describe('same-run data filed under the previous email', () => {
    const offerId = kajabiId('offer')

    beforeAll(async () => {
      await supabase.schema('bronze').from('kajabi_offers').upsert([
        { kajabi_offer_id: offerId, name: 'Quill & Cup Membership', trial_period_days: 0, data: { attributes: { subscription: true } } },
      ], { onConflict: 'kajabi_offer_id' })
      await addContact('cal', email('cal-old'))
      // Kajabi's customer record (and so the purchase) still carries the old email.
      await supabase.schema('bronze').from('kajabi_customers').insert({
        kajabi_customer_id: kajabiId('cal-cust'), email: email('cal-old'), data: {},
      })
      await supabase.schema('bronze').from('kajabi_purchases').insert({
        kajabi_purchase_id: kajabiId('cal-purchase'),
        kajabi_customer_id: kajabiId('cal-cust'),
        kajabi_offer_id: offerId,
        status: 'active',
        created_at_kajabi: '2023-02-01T00:00:00Z',
        effective_start_at: '2023-02-01T00:00:00Z',
        deactivated_at: null,
        data: {},
      })
      await processMembers()
    })

    afterAll(async () => {
      const [member] = await memberByKajabiId('cal')
      if (member) await supabase.from('member_join_date_overrides').delete().eq('member_id', member.id)
    })

    it('starts active with the purchase', async () => {
      expect((await memberByKajabiId('cal'))[0].status).toBe('active')
    })

    it('stays active, with its join-date override, in the run where the contact email changes', async () => {
      const [member] = await memberByKajabiId('cal')
      const { error } = await supabase.from('member_join_date_overrides').insert({
        member_id: member.id,
        first_joined_at: '2020-05-01',
        reason: 'test: pre-Kajabi join',
      })
      if (error) throw error

      await setContactEmail('cal', email('cal-new'))
      await processMembers()

      const [after] = await memberByKajabiId('cal')
      expect(after.id).toBe(member.id)
      expect(after.email).toBe(email('cal-new'))
      expect(after.status).toBe('active')
      expect(after.first_joined_at).toBe('2020-05-01')
    }, 60000)
  })

  describe('new Kajabi email already belongs to an unrelated member', () => {
    // Kajabi emails are unique per contact, so the holder is a member with no
    // Kajabi contact under that email (a leftover row, or added by hand).
    let danId: string
    let eveId: string

    beforeAll(async () => {
      await addContact('dan', email('dan'))
      await processMembers()
      danId = (await memberByKajabiId('dan'))[0].id
      const { data, error } = await supabase.from('members').insert({
        email: email('eve'), name: 'Eve', joined_at: '2023-01-01', status: 'lead', source: 'kajabi',
      }).select('id').single()
      if (error) throw error
      eveId = data!.id
    })

    it('reports the conflict and still processes everyone else', async () => {
      await setContactEmail('dan', email('eve'))
      await addContact('fay', email('fay'))

      const result = await processMembers()
      expect(result.success).toBe(true)
      expect(result.emailConflicts).toEqual([
        { kajabi_id: kajabiId('dan'), email: email('eve'), member_ids: [danId], conflicting_member_id: eveId },
      ])
      expect(await memberByKajabiId('fay')).toHaveLength(1)
    }, 60000)

    it('leaves both members as they were', async () => {
      const { data } = await supabase.from('members').select('id, email').in('id', [danId, eveId]).order('email')
      expect(data).toEqual([
        { id: danId, email: email('dan') },
        { id: eveId, email: email('eve') },
      ])
    })

    it('goes through once the other member is out of the way', async () => {
      // Stand-in for the admin merging the two.
      await supabase.from('members').update({ email: email('eve-moved') }).eq('id', eveId)
      const result = await processMembers()
      expect(result.emailConflicts.filter((c: any) => c.kajabi_id === kajabiId('dan'))).toEqual([])
      const { data } = await supabase.from('members').select('email').eq('id', danId).single()
      expect(data!.email).toBe(email('eve'))
    }, 60000)
  })

  describe('admin edits outside the pipeline', () => {
    it('keeps aliases attached when a member\'s email is changed directly', async () => {
      const { data: member, error } = await supabase.from('members').insert({
        email: email('gil'), name: 'Gil', joined_at: '2023-01-01', status: 'lead', source: 'kajabi',
      }).select('id').single()
      if (error) throw error
      await addAlias(email('gil-alt'), member!.id)

      await supabase.from('members').update({ email: email('gil-new') }).eq('id', member!.id)

      expect(await alias(email('gil-alt'))).toMatchObject({ member_id: member!.id, canonical_email: email('gil-new') })
    })

    it('rejects an alias for a member that does not exist', async () => {
      const { error } = await supabase.from('member_email_aliases').insert({
        alias_email: email('nobody-alias'),
        canonical_email: email('nobody'),
        source: 'manual',
      })
      expect(error?.code).toBe('23503')
    })
  })
})
