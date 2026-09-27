import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// The `unit` vitest project runs in CI with no Supabase stack. A test under tests/lib or
// tests/components that talks to the database passes locally (where Supabase is usually
// running) but fails in CI's unit job -- so any such file must be listed in
// DB_EXCEPTIONS_UNDER_LIB in vitest.config.ts, which moves it to the `db` project.

const ROOT = join(__dirname, '..', '..')
const DB_HELPER_IMPORT = /from ['"][./]*(?:\.\.\/)*helpers\/supabase['"]|from ['"]@\/tests\/helpers\/supabase['"]/

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return testFiles(path)
    return /\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('vitest unit/db project split', () => {
  it('lists every tests/lib and tests/components file that uses the DB test helpers in DB_EXCEPTIONS_UNDER_LIB', () => {
    const config = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8')
    const unlisted = [...testFiles(join(ROOT, 'tests', 'lib')), ...testFiles(join(ROOT, 'tests', 'components'))]
      .filter((file) => DB_HELPER_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))
      .filter((file) => !config.includes(`'${file}'`))
    expect(unlisted).toEqual([])
  })
})
