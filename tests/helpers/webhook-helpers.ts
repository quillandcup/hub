import fs from 'fs'
import path from 'path'

/**
 * Load webhook fixture data
 */
export function loadWebhookFixture(service: 'calendar' | 'zoom' | 'slack', filename: string) {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'webhooks', service, filename)
  const content = fs.readFileSync(fixturePath, 'utf-8')
  return JSON.parse(content)
}

/**
 * Create headers from fixture
 */
export function createHeadersFromFixture(fixture: any): Headers {
  const headers = new Headers()
  Object.entries(fixture.headers || {}).forEach(([key, value]) => {
    headers.set(key, value as string)
  })
  return headers
}

/**
 * Create webhook request payload
 */
export function createWebhookRequest(
  url: string,
  fixture: any,
  options: Partial<RequestInit> = {}
): Request {
  return new Request(url, {
    method: 'POST',
    headers: createHeadersFromFixture(fixture),
    body: JSON.stringify(fixture.body),
    ...options,
  })
}
