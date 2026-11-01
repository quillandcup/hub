import { describe, expect, it } from 'vitest'
import { describeJson, describeMarkup, formatProbe, loginHint, normalizeRequestPath, queryNames } from '@/lib/kajabi/probe'

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

describe('describeMarkup', () => {
  // A Rails-style response: JavaScript that appends an escaped HTML string. Made-up people and addresses.
  const SCRIPT = String.raw`$("#comments-list").append("<li class=\"comment comment-99001\" data-comment-id=\"99001\" data-member-id=\"4455667\"><a class=\"author\" href=\"\/members\/4455667?token=secret\">Ada Example<\/a><time datetime=\"2026-06-27\">on Jun 27<\/time><p class=\"comment-body\">Hello from ada@example.com, I write in Springfield.<\/p><a class=\"reply-link\" data-reply-url=\"\/posts\/12345678\/comments\/99001\/reply\" href=\"#\">Reply<\/a><img class=\"avatar\" src=\"https:\/\/cdn.example.test\/ada-example.png\"><\/li>");$("#more").attr("data-desc-from", "2026-06-20T10:00:00Z");<script>evil("Ada Example")<\/script>`

  it('lists the element, class and attribute names and the link paths, with ids squeezed and no query', () => {
    const text = describeMarkup(SCRIPT).join('\n')
    expect(text).toContain('li.comment.comment-:id x1 attrs: data-comment-id, data-member-id')
    expect(text).toContain('a.author x1 attrs: href | urls: /members/:id')
    expect(text).toContain('a.reply-link x1 attrs: data-reply-url, href | urls: /posts/:id/comments/:id/reply')
    expect(text).toContain('p.comment-body x1 attrs: none')
    expect(text).toContain('time x1 attrs: datetime')
    expect(text).toContain('img.avatar x1 attrs: src')
  })

  it('never prints a name, an email, what a comment says, an attribute value, a query string or an image address', () => {
    const text = describeMarkup(SCRIPT).join('\n')
    for (const secret of ['Ada Example', 'ada@example.com', 'Springfield', 'token=secret', 'ada-example.png', 'cdn.example', '4455667', 'Jun 27', '2026-06-27', 'evil']) {
      expect(text).not.toContain(secret)
    }
  })

  it('narrows a whole page to the elements that match a pattern, and skips script and style bodies', () => {
    const page = '<html><head><style>.comment{color:red}</style></head><body><nav class="menu"><a href="/home">Home</a></nav><section class="comments" data-comments-url="/posts/12345678/comments/show_more"><div class="comment-item"></div></section><script>var comment = 1</script></body></html>'
    expect(describeMarkup(page, { pattern: /comment/i })).toEqual([
      'section.comments x1 attrs: data-comments-url | urls: /posts/:id/comments/show_more',
      'div.comment-item x1 attrs: none',
    ])
    expect(describeMarkup(page).join('\n')).toContain('nav.menu')
  })

  it('is empty for text with no markup, and capped', () => {
    expect(describeMarkup('just words, no tags')).toEqual([])
    expect(describeMarkup(Array.from({ length: 100 }, (_, i) => `<div class="c${i}"></div>`).join(''), { maxLines: 7 })).toHaveLength(7)
  })
})
