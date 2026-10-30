import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLayeredEnv, readLayeredEnv } from '../../scripts/load-layered-env'

describe('layered env files', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'layered-env-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const write = (name: string, text: string) => writeFileSync(join(dir, name), text)

  it('gives the file what only .env.shared has, and lets the file win where both have a value', () => {
    write('.env.shared', 'KAJABI_SITE_ID=111\nSHARED_ONLY=s\nBOTH=from-shared\n')
    write('.env.prod', 'SUPABASE_URL=https://db.example\nBOTH=from-prod\n')
    const { values, files } = readLayeredEnv(join(dir, '.env.prod'))
    expect(values).toEqual({ KAJABI_SITE_ID: '111', SHARED_ONLY: 's', BOTH: 'from-prod', SUPABASE_URL: 'https://db.example' })
    expect(files.map((f) => f.split('/').pop())).toEqual(['.env.shared', '.env.prod'])
  })

  it('treats an empty value as unset, so an empty override does not hide the shared one', () => {
    write('.env.shared', 'KAJABI_SITE_ID=111\n')
    write('.env.prod', 'KAJABI_SITE_ID=\nOTHER=\n')
    expect(readLayeredEnv(join(dir, '.env.prod')).values).toEqual({ KAJABI_SITE_ID: '111' })
  })

  it('works with no .env.shared beside the file, and when the file is .env.shared itself', () => {
    write('.env.local', 'A=1\n')
    expect(readLayeredEnv(join(dir, '.env.local')).values).toEqual({ A: '1' })
    write('.env.shared', 'B=2\n')
    const shared = readLayeredEnv(join(dir, '.env.shared'))
    expect(shared.values).toEqual({ B: '2' })
    expect(shared.files).toHaveLength(1)
  })

  it('throws, naming the file, when the file is missing', () => {
    expect(() => readLayeredEnv(join(dir, '.env.nope'))).toThrow('.env.nope not found')
  })

  it('puts the values in the environment without replacing what is already set', () => {
    write('.env.shared', 'KEEP=shared\nNEW=shared\n')
    write('.env.prod', 'KEEP=prod\n')
    const env: Record<string, string | undefined> = { KEEP: 'already' }
    loadLayeredEnv(join(dir, '.env.prod'), env)
    expect(env).toEqual({ KEEP: 'already', NEW: 'shared' })
  })
})
