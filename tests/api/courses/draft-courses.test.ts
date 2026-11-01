import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { ensureDraftCourses } from '@/lib/courses/process'
import { createRepos } from "@/lib/data/repos";

/**
 * Every imported Kajabi course gets a Hub row (a draft until it is published), so its admin
 * address uses a Hub id. Against the real local database, under run-unique keys.
 */

const ts = Date.now()
const NEW = `test-draft-new-${ts}`
const TAKEN = `test-draft-taken-${ts}`
const BLANK = `test-draft-blank-${ts}`
const TITLE = `Draft Course ${ts}`
const TAKEN_TITLE = `Draft Taken ${ts}`

describe('ensureDraftCourses', () => {
  const supabase = getTestSupabaseAdminClient()
  const bronze = supabase.schema('bronze')

  async function cleanup() {
    await supabase.from('courses').delete().like('slug', `%${ts}%`)
    await bronze.from('kajabi_courses').delete().in('kajabi_id', [NEW, TAKEN, BLANK])
  }

  beforeAll(async () => {
    await cleanup()
    // A Hub course already owns the slug the second Kajabi course would get; the third has no usable slug.
    await supabase.from('courses').insert({ slug: `draft-taken-${ts}`, title: 'Owner', source: 'hub' })
    await bronze.from('kajabi_courses').insert([
      { kajabi_id: NEW, title: TITLE, raw_payload: { attributes: { description: 'About it.' } } },
      { kajabi_id: TAKEN, title: TAKEN_TITLE, raw_payload: {} },
      { kajabi_id: BLANK, title: '!!!', raw_payload: {} },
    ])
  })
  afterAll(cleanup)

  it('makes a draft row with its own Hub id and the slug publishing would use', async () => {
    await ensureDraftCourses(createRepos(supabase))
    const { data } = await supabase.from('courses').select('id, slug, title, description, source, is_draft').eq('source_key', NEW)
    expect(data).toEqual([{ id: expect.stringMatching(/^crs_/), slug: `draft-course-${ts}`, title: TITLE, description: 'About it.', source: 'kajabi', is_draft: true }])
  })

  it('skips a course whose slug is taken or empty, and does not touch a row it already made', async () => {
    const before = (await supabase.from('courses').select('id').eq('source_key', NEW).single()).data!
    const made = await ensureDraftCourses(createRepos(supabase))
    expect(made).toBe(0)
    expect((await supabase.from('courses').select('id').eq('source_key', NEW).single()).data).toEqual(before)
    expect((await supabase.from('courses').select('id').in('source_key', [TAKEN, BLANK])).data).toEqual([])
  })
})
