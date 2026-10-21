import { describe, expect, it } from 'vitest'
import { parseIp, requestLocation } from '@/lib/request-location'

const headers = (init: Record<string, string>) => new Headers(init)

describe('parseIp', () => {
  it('takes an IPv4 or IPv6 address, and drops a port', () => {
    expect(parseIp('203.0.113.7')).toBe('203.0.113.7')
    expect(parseIp(' 203.0.113.7 ')).toBe('203.0.113.7')
    expect(parseIp('203.0.113.7:51234')).toBe('203.0.113.7')
    expect(parseIp('2001:db8::1')).toBe('2001:db8::1')
    expect(parseIp('[2001:db8::1]:443')).toBe('2001:db8::1')
    expect(parseIp('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7')
  })

  it.each([['not-an-ip'], ['999.1.1.1'], ['203.0.113'], ['1.2.3.4.5'], ['<script>'], [''], [null], [undefined], ['a:b:c:d:e:f:g:h:i']])('rejects %s', (value) => {
    expect(parseIp(value as string | null | undefined)).toBeNull()
  })
})

describe('requestLocation', () => {
  it("gives the IP and the place from Vercel's geo headers, decoding the city", () => {
    expect(
      requestLocation(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'x-vercel-ip-country': 'us', 'x-vercel-ip-country-region': 'IN', 'x-vercel-ip-city': 'Muncie' })),
    ).toEqual({ ip_address: '203.0.113.7', country: 'US', region: 'IN', city: 'Muncie' })
    expect(requestLocation(headers({ 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' })).city).toBe('São Paulo')
  })

  it('takes the first forwarded hop, falling back to x-real-ip, and null with neither', () => {
    expect(requestLocation(headers({ 'x-forwarded-for': '198.51.100.9, 203.0.113.7' })).ip_address).toBe('198.51.100.9')
    expect(requestLocation(headers({ 'x-real-ip': '198.51.100.10' })).ip_address).toBe('198.51.100.10')
    expect(requestLocation(headers({ 'x-forwarded-for': 'garbage', 'x-real-ip': '198.51.100.10' })).ip_address).toBe('198.51.100.10')
    expect(requestLocation(headers({}))).toEqual({ ip_address: null, country: null, region: null, city: null })
  })

  it('turns anything the database would refuse into null, so the access event is never lost', () => {
    const location = requestLocation(headers({ 'x-forwarded-for': 'nope', 'x-vercel-ip-country': 'USA', 'x-vercel-ip-country-region': 'x'.repeat(30), 'x-vercel-ip-city': 'y'.repeat(300) }))
    expect(location.ip_address).toBeNull()
    expect(location.country).toBeNull()
    expect(location.region).toHaveLength(10)
    expect(location.city).toHaveLength(100)
  })

  it('copes with invalid percent-encoding and control characters, and drops an empty city', () => {
    expect(requestLocation(headers({ 'x-vercel-ip-city': '100%' })).city).toBe('100%')
    expect(requestLocation(headers({ 'x-vercel-ip-city': 'Mun%00cie\t  Town' })).city).toBe('Muncie Town')
    expect(requestLocation(headers({ 'x-vercel-ip-city': '   ' })).city).toBeNull()
  })
})
