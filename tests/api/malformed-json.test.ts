import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { apiFetch } from '../helpers/api-fetch'
import { getTestAuthHeaders } from '../helpers/supabase'

/**
 * Every handler that reads a JSON body answers a malformed one with 400 (not a 500 from the
 * unhandled SyntaxError). Handlers are found from the source: any exported method whose body
 * returns "Invalid JSON body", so a new route that follows the pattern is covered with no edit.
 */
const API_DIR = path.resolve(import.meta.dirname, '../../app/api')
const DUMMY_ID = '00000000-0000-0000-0000-000000000000'

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return name === 'route.ts' ? [full] : []
  })
}

function guardedHandlers(): Array<{ url: string; method: string }> {
  const found: Array<{ url: string; method: string }> = []
  for (const file of routeFiles(API_DIR)) {
    const source = readFileSync(file, 'utf8')
    const url = '/api/' + path.relative(API_DIR, path.dirname(file)).split(path.sep).map((s) => (s.startsWith('[') ? DUMMY_ID : s)).join('/')
    const parts = source.split(/^export (?:async )?function /m).slice(1)
    for (const part of parts) {
      const method = /^(GET|POST|PUT|PATCH|DELETE)\b/.exec(part)?.[1]
      if (method && part.includes('Invalid JSON body')) found.push({ url, method })
    }
  }
  return found
}

const handlers = guardedHandlers()

describe('malformed JSON request bodies', () => {
  // Some handlers check their config before reading the body; they return before any call out.
  beforeAll(() => vi.stubEnv('SLACK_BOT_TOKEN', 'test-token'))
  afterAll(() => vi.unstubAllEnvs())

  it('finds the guarded handlers', () => {
    expect(handlers.length).toBeGreaterThan(30)
  })

  it.each(handlers.map((h) => [`${h.method} ${h.url}`, h] as const))('%s answers 400', async (_name, { url, method }) => {
    const res = await apiFetch(url, {
      method,
      headers: { ...getTestAuthHeaders(), 'Content-Type': 'application/json' },
      body: '{ not json',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' })
  })
})
