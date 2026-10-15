/// <reference types="vite/client" />
import { AsyncLocalStorage } from 'node:async_hooks'
import { vi } from 'vitest'
import { NextRequest } from 'next/server'

// Routes read cookies()/headers() from next/headers, which only work inside Next's request
// scope. Serve them from the request apiFetch is currently running instead.
const currentRequest = new AsyncLocalStorage<{ request: NextRequest; afterTasks: Array<() => unknown> }>()

vi.mock('next/headers', () => ({
  cookies: async () => currentRequest.getStore()!.request.cookies,
  headers: async () => currentRequest.getStore()!.request.headers,
}))

// after() also needs a request scope. Queue its callbacks and run them, awaited, once the
// handler has returned, so a test never leaves background work running past its own end.
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: (() => unknown) | PromiseLike<unknown>) => {
    currentRequest.getStore()!.afterTasks.push(typeof task === 'function' ? task : () => task)
  },
}))

type RouteModule = Record<string, unknown>
type RouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) => Promise<Response> | Response

// Every API route module, loaded lazily so a test only imports the routes it calls.
const routeLoaders = import.meta.glob('/app/api/**/route.ts') as Record<string, () => Promise<RouteModule>>

type RouteEntry = { segments: string[]; load: () => Promise<RouteModule> }

const routes: RouteEntry[] = Object.entries(routeLoaders).map(([file, load]) => ({
  segments: file.replace(/^\/app\/api\//, '').replace(/\/?route\.ts$/, '').split('/').filter(Boolean),
  load,
}))

/** Specificity: static segments beat [param], which beat [...catchAll]. */
function matchRoute(pathSegments: string[]): { entry: RouteEntry; params: Record<string, string | string[]> } | null {
  let best: { entry: RouteEntry; params: Record<string, string | string[]>; score: number } | null = null
  for (const entry of routes) {
    const params: Record<string, string | string[]> = {}
    let score = 0
    let ok = true
    let consumed = 0
    for (const seg of entry.segments) {
      const catchAll = /^\[\[?\.\.\.(\w+)\]\]?$/.exec(seg)
      const dynamic = /^\[(\w+)\]$/.exec(seg)
      if (catchAll) {
        const rest = pathSegments.slice(consumed)
        if (rest.length === 0 && !seg.startsWith('[[')) ok = false
        params[catchAll[1]] = rest.map(decodeURIComponent)
        consumed = pathSegments.length
        score += 1
        break
      }
      if (consumed >= pathSegments.length) { ok = false; break }
      if (dynamic) {
        params[dynamic[1]] = decodeURIComponent(pathSegments[consumed])
        score += 2
      } else if (seg === pathSegments[consumed]) {
        score += 3
      } else {
        ok = false
        break
      }
      consumed++
    }
    if (ok && consumed === pathSegments.length && (!best || score > best.score)) best = { entry, params, score }
  }
  return best
}

/**
 * Drop-in for `fetch(`${getTestApiBaseUrl()}/api/...`, init)` that calls the route handler in
 * this process instead of over HTTP, so Vitest counts the route's coverage. The proxy is skipped:
 * it leaves /api/* public and routes authenticate themselves (see lib/supabase/middleware.ts).
 */
export async function apiFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input.toString(), 'http://localhost:3000')
  const pathSegments = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean)
  const match = matchRoute(pathSegments)
  if (!match) return new Response('Not Found', { status: 404 })

  const method = (init.method ?? 'GET').toUpperCase()
  const mod = await match.entry.load()
  const handler = mod[method] as RouteHandler | undefined
  if (!handler) return new Response(null, { status: 405 })

  const request = new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1])
  const afterTasks: Array<() => unknown> = []
  return currentRequest.run({ request, afterTasks }, async () => {
    const response = await handler(request, { params: Promise.resolve(match.params) })
    for (const task of afterTasks) {
      try {
        await task()
      } catch (err) {
        console.error('after() task failed', err)
      }
    }
    return response
  })
}
