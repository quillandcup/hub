import { describe, it, expect, beforeEach } from 'vitest'
import { signSudoCookie, parseSudoCookie } from '@/lib/sudo'

const ADMIN_ID = '550e8400-e29b-41d4-a716-446655440000'
const MEMBER_ID = '550e8400-e29b-41d4-a716-446655440001'

describe('sudo HMAC helpers', () => {
  beforeEach(() => {
    process.env.SUDO_SECRET = 'test-secret-that-is-32-chars-xxxx'
  })

  it('signSudoCookie produces a value parseSudoCookie can verify', () => {
    const value = signSudoCookie(ADMIN_ID, MEMBER_ID)
    expect(parseSudoCookie(value)).toEqual({ adminId: ADMIN_ID, memberId: MEMBER_ID })
  })

  it('parseSudoCookie returns null when memberId is tampered', () => {
    const value = signSudoCookie(ADMIN_ID, MEMBER_ID)
    const tampered = value.replace(MEMBER_ID, '550e8400-e29b-41d4-a716-000000000000')
    expect(parseSudoCookie(tampered)).toBeNull()
  })

  it('parseSudoCookie returns null when signature is tampered', () => {
    const value = signSudoCookie(ADMIN_ID, MEMBER_ID)
    const tampered = value.slice(0, -4) + '0000'
    expect(parseSudoCookie(tampered)).toBeNull()
  })

  it('parseSudoCookie returns null for malformed values', () => {
    expect(parseSudoCookie('not-valid')).toBeNull()
    expect(parseSudoCookie('')).toBeNull()
    expect(parseSudoCookie('only:two')).toBeNull()
  })

  it('parseSudoCookie returns null when SUDO_SECRET differs', () => {
    const value = signSudoCookie(ADMIN_ID, MEMBER_ID)
    process.env.SUDO_SECRET = 'different-secret-32-chars-xxxxxxx'
    expect(parseSudoCookie(value)).toBeNull()
  })
})
