import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { apiFetch } from '../../helpers/api-fetch'
import { createRepos } from '@/lib/data/repos'
import { memberProductProgress } from '@/lib/courses/product-progress'

/**
 * /api/import/kajabi-product-progress is idempotent (Bronze pattern: UPSERT on the natural key
 * (course, email), soft-delete what the new report no longer lists):
 * 1. First import creates rows and counts matched / unmatched / ambiguous members by email
 * 2. Re-importing the same file changes nothing (rows are not even rewritten)
 * 3. A changed percent updates in place; a row missing from the file is soft-deleted and comes back
 * 4. Other courses are untouched
 * 5. A file with an invalid row, or for an unknown course, writes and deletes nothing
 * 6. More than 1000 rows import and are all read back
 *
 * Everything is scoped to two fake course ids, so the shared local database is otherwise untouched.
 */

const ts = Date.now()
const COURSE = `test-kpp-${ts}`
const OTHER = `test-kpp-other-${ts}`
const email = (n: string) => `kpp-${n}-${ts}@example.com`

describe('Kajabi product progress import idempotency', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')
  const memberIds: string[] = []

  async function addMember(n: string, memberEmail: string) {
    const { data, error } = await supabase
      .from('members')
      .insert({ name: `Progress Member ${n}`, email: memberEmail, joined_at: new Date().toISOString(), status: 'active' })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    memberIds.push(data.id)
    return data.id as string
  }

  function upload(courseId: string, csv: string, fileName = 'product_progress.csv') {
    const form = new FormData()
    form.set('courseId', courseId)
    form.set('file', new File([csv], fileName, { type: 'text/csv' }))
    return apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi-product-progress`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
      body: form,
    })
  }

  const rows = async (course: string) =>
    ((await bronze.from('kajabi_product_progress').select('*').eq('course_kajabi_id', course).order('email')).data ?? []) as any[]

  async function cleanup() {
    await bronze.from('kajabi_product_progress').delete().in('course_kajabi_id', [COURSE, OTHER])
    await bronze.from('kajabi_courses').delete().in('kajabi_id', [COURSE, OTHER])
    if (memberIds.length) await supabase.from('members').delete().in('id', memberIds)
    await supabase.from('member_email_aliases').delete().eq('alias_email', email('alias'))
  }

  const HEADER = 'Name,Email,Product Progress,Logins,Start Date,Last Activity At'
  const csv = (...lines: string[]) => [HEADER, ...lines].join('\n')
  const FILE = csv(
    `Ada Example,${email('ada')},62%,14,2026-01-05,2026-02-10`,
    `Bo Example,${email('bo')},10,2,Not Started,`,
    `Cy Example,${email('cy')},100,40,2026-01-01,2026-03-01`,
    `Di Example,${email('ghost')},0,0,Not Started,Not Started`,
  )

  beforeAll(async () => {
    await cleanup()
    await bronze.from('kajabi_courses').insert([
      { kajabi_id: COURSE, title: `Test Course ${ts}` },
      { kajabi_id: OTHER, title: `Other Course ${ts}` },
    ])
    await addMember('ada', email('ada'))
    await addMember('bo', email('bo').toUpperCase().replace('@EXAMPLE.COM', '@example.com'))
    // Two members whose emails differ only by case: an upload for either is ambiguous.
    await addMember('cy1', email('cy'))
    await addMember('cy2', email('cy').replace('kpp-cy', 'KPP-CY'))
    // An alias: the report lists an old address of Ada.
  })
  afterAll(cleanup)

  it('imports a first report and counts matched, ambiguous and unmatched by email', async () => {
    const response = await upload(COURSE, FILE)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      rowsRead: 4,
      imported: 4,
      written: 4,
      unchanged: 0,
      removed: 0,
      matched: 2,
      ambiguous: 1,
      unmatched: 1,
      unmatchedEmails: [email('ghost')],
    })

    const stored = await rows(COURSE)
    expect(stored).toHaveLength(4)
    const ada = stored.find((r) => r.email === email('ada'))
    expect(ada).toMatchObject({
      percent: 62,
      logins: 14,
      started_on: '2026-01-05',
      last_activity_on: '2026-02-10',
      deleted_at: null,
      source_file: 'product_progress.csv',
    })
    expect(stored.find((r) => r.email === email('bo'))).toMatchObject({ percent: 10, started_on: null, last_activity_on: null })
    expect(stored.every((r) => r.import_batch === body.importBatch)).toBe(true)
  })

  it('changes nothing when the same file is imported again', async () => {
    const before = await rows(COURSE)
    for (let i = 0; i < 2; i++) {
      const body = await (await upload(COURSE, FILE)).json()
      expect(body).toMatchObject({ imported: 4, written: 0, unchanged: 4, removed: 0 })
    }
    expect(await rows(COURSE)).toEqual(before)
  })

  it('updates a changed percent in place and soft-deletes a row missing from the new report', async () => {
    const body = await (
      await upload(
        COURSE,
        csv(
          `Ada Example,${email('ada')},75,15,2026-01-05,2026-02-20`,
          `Bo Example,${email('bo')},10,2,Not Started,`,
          `Cy Example,${email('cy')},100,40,2026-01-01,2026-03-01`,
        ),
      )
    ).json()
    expect(body).toMatchObject({ imported: 3, written: 1, unchanged: 2, removed: 1 })

    const stored = await rows(COURSE)
    expect(stored).toHaveLength(4)
    expect(stored.find((r) => r.email === email('ada'))).toMatchObject({ percent: 75, logins: 15, last_activity_on: '2026-02-20' })
    expect(stored.find((r) => r.email === email('ghost'))?.deleted_at).not.toBeNull()
    expect(stored.filter((r) => r.deleted_at === null)).toHaveLength(3)
  })

  it('brings a removed row back when a later report lists it again', async () => {
    const body = await (await upload(COURSE, FILE)).json()
    expect(body).toMatchObject({ written: 2, unchanged: 2, removed: 0 })
    const ghost = (await rows(COURSE)).find((r) => r.email === email('ghost'))
    expect(ghost?.deleted_at).toBeNull()
  })

  it('leaves another course alone, even for the same people', async () => {
    await upload(OTHER, csv(`Ada Example,${email('ada')},5,1,2026-01-01,2026-01-02`))
    const otherBefore = await rows(OTHER)
    // A report for COURSE that lists nobody from OTHER must not touch OTHER's rows.
    await upload(COURSE, csv(`Bo Example,${email('bo')},10,2,Not Started,`))
    expect(await rows(OTHER)).toEqual(otherBefore)
    expect((await rows(COURSE)).filter((r) => r.deleted_at === null)).toHaveLength(1)
  })

  it('matches an uploaded old address through an active email alias', async () => {
    await supabase.from('member_email_aliases').insert({ canonical_email: email('ada'), alias_email: email('alias'), source: 'manual' })
    const body = await (await upload(COURSE, csv(`Ada Example,${email('alias')},5,1,,`))).json()
    expect(body).toMatchObject({ matched: 1, unmatched: 0, ambiguous: 0 })
  })

  it('rejects a file with an invalid row without writing or deleting anything', async () => {
    const before = await rows(COURSE)
    const response = await upload(COURSE, csv(`Ada Example,${email('ada')},99,1,,`, `Bad Row,not-an-email,5,1,,`, `Worse,${email('bo')},500,1,,`))
    const body = await response.json()
    expect(response.status).toBe(422)
    expect(body).toMatchObject({ rowsRead: 3, invalidCount: 2 })
    expect(body.invalid).toEqual([
      { line: 3, reason: 'Email is not a valid address' },
      { line: 4, reason: 'Product Progress is not a percentage from 0 to 100' },
    ])
    expect(JSON.stringify(body)).not.toContain('example.com')
    expect(await rows(COURSE)).toEqual(before)
  })

  it('answers 400 for a missing column, an unknown course, a non-CSV file and a bad body', async () => {
    const missing = await upload(COURSE, 'Name,Logins\nAda,1')
    expect(missing.status).toBe(400)
    expect((await missing.json()).error).toMatch(/Email and Product Progress/)

    expect((await upload(`nope-${ts}`, FILE)).status).toBe(400)
    expect((await upload(COURSE, FILE, 'progress.txt')).status).toBe(400)
    expect((await upload(COURSE, HEADER)).status).toBe(400)

    const noBody = await apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi-product-progress`, {
      method: 'POST',
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{"broken',
    })
    expect(noBody.status).toBe(400)

    const noCourse = new FormData()
    noCourse.set('file', new File([FILE], 'p.csv'))
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi-product-progress`, {
      method: 'POST',
      headers: getTestAuthHeaders(),
      body: noCourse,
    })
    expect(response.status).toBe(400)
    const noFile = new FormData()
    noFile.set('courseId', COURSE)
    expect(
      (await apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi-product-progress`, { method: 'POST', headers: getTestAuthHeaders(), body: noFile })).status,
    ).toBe(400)
  })

  it('rejects an anonymous caller', async () => {
    const form = new FormData()
    form.set('courseId', COURSE)
    form.set('file', new File([FILE], 'p.csv'))
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/import/kajabi-product-progress`, { method: 'POST', body: form })
    expect([401, 403]).toContain(response.status)
  })

  it('imports more than 1000 rows, writes them in chunks and reads them all back on re-import', async () => {
    const many = Array.from({ length: 1205 }, (_, i) => `Person ${i},kpp-many-${i}-${ts}@example.com,${i % 101},${i},2026-01-01,2026-01-02`)
    const first = await (await upload(OTHER, csv(...many))).json()
    expect(first).toMatchObject({ imported: 1205, written: 1205, removed: 1 })
    expect((await rows(OTHER)).filter((r) => r.deleted_at === null)).toHaveLength(1205)

    const again = await (await upload(OTHER, csv(...many))).json()
    expect(again).toMatchObject({ imported: 1205, written: 0, unchanged: 1205, removed: 0 })
    expect(await rows(OTHER)).toHaveLength(1206)
  })

  it('reads a member\'s imported percent, through their email and aliases', async () => {
    const repos = createRepos(supabase as any)
    await upload(COURSE, csv(`Ada Example,${email('ada')},75,15,2026-01-05,2026-02-20`, `Bo,${email('alias')},90,1,,`))
    const ada = memberIds[0]
    // The alias row (90) and Ada's own row (75) are both hers: the higher percentage wins.
    expect(await memberProductProgress(repos, ada, COURSE)).toMatchObject({
      percent: 90,
      logins: 1,
      startedOn: null,
    })
    expect(await memberProductProgress(repos, ada, OTHER)).toBeNull()
    expect(await memberProductProgress(repos, 'mbr_AAAAAAAAAAA1', COURSE)).toBeNull()

    await bronze.from('kajabi_product_progress').update({ deleted_at: new Date().toISOString() }).eq('course_kajabi_id', COURSE)
    expect(await memberProductProgress(repos, ada, COURSE)).toBeNull()
  })
})
