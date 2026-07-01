import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const memberRouteSrc = fs.readFileSync(
  path.join(process.cwd(), 'app/api/process/members/route.ts'),
  'utf-8'
)

/**
 * Verifies that member processing automatically reprocesses attendance after completing.
 *
 * Why: When a new member is added (or an inactive member is reactivated), their historical
 * Zoom names become matchable. Without re-running attendance, they end up with a
 * "matched → no attendance record" gap — a state that should be impossible.
 *
 * The fix: use Next.js after() to schedule attendance reprocessing in the background
 * immediately after member processing completes, without blocking the response.
 */
describe('Member processing attendance cascade', () => {
  it('imports after() from next/server for background processing', () => {
    expect(memberRouteSrc).toContain("after } from \"next/server\"")
  })

  it('imports triggerAttendanceReprocessing from the trigger module', () => {
    expect(memberRouteSrc).toContain('triggerAttendanceReprocessing')
    expect(memberRouteSrc).toContain('@/lib/processing/trigger')
  })

  it('calls after() to schedule background attendance reprocessing', () => {
    expect(memberRouteSrc).toContain('after(async () =>')
    expect(memberRouteSrc).toContain('triggerAttendanceReprocessing')
  })

  it('has maxDuration set high enough to cover attendance reprocessing', () => {
    // Attendance reprocessing can take up to 300s; member processing is ~10s.
    // maxDuration must accommodate both since after() runs within the same function lifetime.
    expect(memberRouteSrc).toMatch(/maxDuration\s*=\s*300/)
    expect(memberRouteSrc).not.toMatch(/maxDuration\s*=\s*60/)
  })

  it('reprocesses last 90 days of attendance (same window as alias changes)', () => {
    expect(memberRouteSrc).toContain('reprocessFrom')
    expect(memberRouteSrc).toContain('reprocessTo')
    expect(memberRouteSrc).toContain('90')
  })
})
