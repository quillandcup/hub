import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as XLSX from 'xlsx'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Test to verify /api/import/kajabi-product-progress is idempotent.
 *
 * Kajabi's Product Progress export has no stable per-row ID, so this route
 * uses the append-snapshot pattern (like subscription_history / kajabi_members):
 * every import is stamped with a shared imported_at and appended, rather than
 * upserted by natural key. Re-importing the same export should create a NEW
 * snapshot per row, not silently collide or duplicate within a single run.
 */
describe('Kajabi Product Progress Import Idempotency', () => {
  const supabase = getTestSupabaseAdminClient()
  const authHeaders = getTestAuthHeaders()
  const baseUrl = getTestApiBaseUrl()

  const testEmail = `idempotency-test-progress-${Date.now()}@example.com`
  const testProduct = `Test Course ${Date.now()}`

  function createTestXlsx(rows: Record<string, any>[]): File {
    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Product Progress')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    return new File([buffer], 'product-progress.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  }

  function rowFor(overrides: Record<string, any> = {}) {
    return {
      Email: testEmail,
      Product: testProduct,
      'Completion %': 40,
      'Lessons Completed': 4,
      'Total Lessons': 10,
      'Last Activity': '2026-08-01',
      ...overrides,
    }
  }

  beforeAll(async () => {
    await supabase.schema('bronze').from('kajabi_product_progress').delete().eq('member_email', testEmail)
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('kajabi_product_progress').delete().eq('member_email', testEmail)
  })

  it('should create a kajabi_product_progress record on first import', async () => {
    const file = createTestXlsx([rowFor()])
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${baseUrl}/api/import/kajabi-product-progress`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })

    expect(response.ok).toBe(true)
    const result = await response.json()
    expect(result.success).toBe(true)
    expect(result.imported).toBe(1)

    const { data: rows } = await supabase
      .schema('bronze')
      .from('kajabi_product_progress')
      .select('*')
      .eq('member_email', testEmail)

    expect(rows).toHaveLength(1)
    expect(rows?.[0].product_name).toBe(testProduct)
    expect(rows?.[0].completion_percentage).toBe(40)
    expect(rows?.[0].lessons_completed).toBe(4)
    expect(rows?.[0].total_lessons).toBe(10)
  })

  it('should create a NEW snapshot on re-import with changed data (append-only)', async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))

    const file = createTestXlsx([rowFor({ 'Completion %': 70, 'Lessons Completed': 7 })])
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${baseUrl}/api/import/kajabi-product-progress`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })

    expect(response.ok).toBe(true)
    const result = await response.json()
    expect(result.success).toBe(true)
    expect(result.imported).toBe(1)

    const { data: allRows } = await supabase
      .schema('bronze')
      .from('kajabi_product_progress')
      .select('*')
      .eq('member_email', testEmail)
      .order('imported_at', { ascending: true })

    // Two snapshots now exist: the original and the updated one
    expect(allRows).toHaveLength(2)
    expect(allRows?.[0].completion_percentage).toBe(40)
    expect(allRows?.[1].completion_percentage).toBe(70)
    expect(allRows?.[0].imported_at).not.toBe(allRows?.[1].imported_at)
  })

  it('should not collide when re-posting the exact same import twice in a row', async () => {
    // Re-running the identical request (e.g. a retried GitHub Actions step)
    // should still land as its own snapshot, not error or silently no-op.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const file = createTestXlsx([rowFor({ 'Completion %': 70, 'Lessons Completed': 7 })])
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${baseUrl}/api/import/kajabi-product-progress`, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    })

    expect(response.ok).toBe(true)

    const { data: allRows } = await supabase
      .schema('bronze')
      .from('kajabi_product_progress')
      .select('*')
      .eq('member_email', testEmail)

    expect(allRows).toHaveLength(3)
  })

  it('should resolve to the latest snapshot for display purposes', async () => {
    const { data: latest } = await supabase
      .schema('bronze')
      .from('kajabi_product_progress')
      .select('*')
      .eq('member_email', testEmail)
      .order('imported_at', { ascending: false })
      .limit(1)
      .single()

    expect(latest?.completion_percentage).toBe(70)
  })
})
