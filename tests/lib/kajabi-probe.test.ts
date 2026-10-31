import { describe, expect, it } from 'vitest'
import { describeJson, formatProbe, loginHint, normalizeRequestPath, queryNames } from '@/lib/kajabi/probe'

describe('the Kajabi probe output', () => {
  it('squeezes ids and the query string out of a request path', () => {
    expect(normalizeRequestPath('https://app.kajabi.com/api/admin/products/2149594995/progress?page=2&token=secret')).toBe('/api/admin/products/:id/progress')
    expect(normalizeRequestPath('https://app.kajabi.com/api/admin/customers/0b5f3c1e-2d4a-4b6c-8e7f-123456789abc/modules')).toBe('/api/admin/customers/:uuid/modules')
    expect(normalizeRequestPath('/api/admin/posts/12')).toBe('/api/admin/posts/12')
    expect(normalizeRequestPath('not a url?x=1')).toBe('not a url')
  })

  it('lists query parameter names, never their values', () => {
    expect(queryNames('https://k.test/a?page=2&token=secret&page=3')).toEqual(['page', 'token'])
    expect(JSON.stringify(queryNames('https://k.test/a?token=secret'))).not.toContain('secret')
    expect(queryNames('nope')).toEqual([])
  })

  it('describes the shape of a response by field path and type, with arrays collapsed, and no values', () => {
    const lines = describeJson({
      data: [
        { id: 'a1', attributes: { name: 'Ada Example', email: 'ada@example.com', completedAt: '2026-10-01T10:00:00Z', percent: 62, avatar: 'https://cdn.test/a.png', note: null } },
        { id: 'a2', attributes: { name: 'Bo Sample', percent: null, extra: true } },
      ],
      meta: { total: 2 },
    })
    expect(lines).toEqual(
      expect.arrayContaining([
        'data: array',
        'data[]: object',
        'data[].id: string',
        'data[].attributes.completedAt: string(date)',
        'data[].attributes.avatar: string(url)',
        'data[].attributes.percent: null|number',
        'data[].attributes.note: null',
        'data[].attributes.extra: boolean',
        'meta.total: number',
      ])
    )
    const text = lines.join('\n')
    expect(text).not.toContain('Ada Example')
    expect(text).not.toContain('ada@example.com')
    expect(text).not.toContain('cdn.test')
  })

  it('stops at a sane depth and field count', () => {
    let deep: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i < 20; i++) deep = { n: deep }
    expect(describeJson(deep).length).toBeLessThanOrEqual(7)
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`f${i}`, i]))
    expect(describeJson(wide).length).toBeLessThanOrEqual(120)
    expect(describeJson(null)).toEqual([])
  })

  it('prints one block per distinct request, merging repeats and their fields', () => {
    const out = formatProbe([
      { method: 'GET', status: 200, path: '/api/admin/x/:id', query: ['page'], fields: ['a: string'] },
      { method: 'GET', status: 200, path: '/api/admin/x/:id', query: ['week'], fields: ['b: number'] },
      { method: 'POST', status: 204, path: '/api/other', query: [], fields: [] },
    ])
    expect(out).toContain('GET 200 /api/admin/x/:id (x2) ?page&week')
    expect(out).toContain('    a: string')
    expect(out).toContain('    b: number')
    expect(out).toContain('POST 204 /api/other')
    expect(out.match(/GET 200/g)).toHaveLength(1)
    expect(formatProbe([])).toBe('No requests of interest were seen.')
  })

  it('says so when the recording shows the browser sent to a login, and stays quiet otherwise', () => {
    const request = (path: string) => ({ method: 'GET', status: 200, path, query: [], fields: [] })
    expect(loginHint([request('/products/demo/posts/:id'), request('/login')])).toContain('preview link from the Kajabi admin')
    expect(loginHint([request('/users/sign_in')])).not.toBeNull()
    expect(loginHint([request('/products/demo/posts/:id'), request('/api/x')])).toBeNull()
    expect(loginHint([request('/blogin'), request('/login/help')])).toBeNull()
    expect(loginHint([])).toBeNull()
  })
})
