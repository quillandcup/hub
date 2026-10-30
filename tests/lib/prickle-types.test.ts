import { describe, it, expect } from 'vitest'
import { normalizePrickleType, parsePrickleFromSummary, prickleTitleFromSummary, plainTextDescription, assignHostAndSpeaker, typeIdByAlias } from '@/lib/prickle-types'

// ---------------------------------------------------------------------------
// normalizePrickleType
// ---------------------------------------------------------------------------

describe('normalizePrickleType', () => {
  it('lowercases and hyphenates a plain type name', () => {
    expect(normalizePrickleType('HEADS DOWN')).toBe('heads-down')
  })

  it('strips a trailing "Prickle" suffix', () => {
    expect(normalizePrickleType('Heads Down Prickle')).toBe('heads-down')
  })

  it('strips a trailing "prickle" regardless of case', () => {
    expect(normalizePrickleType('Sprint PRICKLE')).toBe('sprint')
  })

  it('strips a leading "Prickle" prefix', () => {
    expect(normalizePrickleType('Prickle Sprint')).toBe('sprint')
  })

  it('collapses a bare "Prickle" to an empty string', () => {
    expect(normalizePrickleType('  Prickle  ')).toBe('')
  })

  it('removes special characters other than hyphens', () => {
    expect(normalizePrickleType("Open Table Prickle!")).toBe('open-table')
  })

  it('collapses multiple internal spaces into a single hyphen', () => {
    expect(normalizePrickleType('Open   Table')).toBe('open-table')
  })

  // Regression test for GitHub CodeQL alert #3 (js/polynomial-redos):
  // the old `/\s*prickle\s*/gi` pattern could take quadratic time on long
  // runs of whitespace with no "prickle" present, since the engine retried
  // the same `\s*` backtrack at every offset within the run. A long
  // space-only (or otherwise "prickle"-free) string is exactly the
  // adversarial input that pattern was flagged for.
  it('handles a very long run of spaces without hanging (ReDoS regression)', () => {
    const pathological = ' '.repeat(50000)
    const start = Date.now()
    const result = normalizePrickleType(pathological)
    const elapsed = Date.now() - start

    expect(result).toBe('')
    expect(elapsed).toBeLessThan(1000)
  })

  it('handles a long whitespace run that does contain "prickle" (ReDoS regression)', () => {
    const pathological = ' '.repeat(50000) + 'prickle' + ' '.repeat(50000)
    const start = Date.now()
    const result = normalizePrickleType(pathological)
    const elapsed = Date.now() - start

    expect(result).toBe('')
    expect(elapsed).toBeLessThan(1000)
  })
})

// ---------------------------------------------------------------------------
// parsePrickleFromSummary
// ---------------------------------------------------------------------------

describe('parsePrickleFromSummary', () => {
  it('parses a plain "Prickle w/Host" summary as a Progress Prickle', () => {
    expect(parsePrickleFromSummary('Prickle w/Lili')).toEqual({
      type: 'Prickle',
      host: 'Lili',
    })
  })

  it('parses a typed prickle with a host', () => {
    expect(parsePrickleFromSummary('HEADS DOWN w/Cody')).toEqual({
      type: 'HEADS DOWN',
      host: 'Cody',
    })
  })

  it('parses a standalone prickle type with no host', () => {
    expect(parsePrickleFromSummary('Open Table Prickle')).toEqual({
      type: 'Open Table Prickle',
      host: null,
    })
  })

  it('strips surrounding quotes from a custom type name', () => {
    expect(parsePrickleFromSummary("'Midnight Crew' w/member13-display")).toEqual({
      type: 'Midnight Crew',
      host: 'member13-display',
    })
  })
})

describe('prickleTitleFromSummary', () => {
  it('keeps a host-chosen name and drops the w/Host tail', () => {
    expect(prickleTitleFromSummary('Educational Webinar: Query Letters w/Sam', 'Educational Prickle')).toBe('Educational Webinar: Query Letters')
    expect(prickleTitleFromSummary("'Midnight Crew' w/Alex", 'Open Table')).toBe('Midnight Crew')
  })

  it('is null when the summary is just the type', () => {
    expect(prickleTitleFromSummary('Heads Down w/Cody', 'Heads Down')).toBeNull()
    expect(prickleTitleFromSummary('Heads Down Prickle', 'Heads Down')).toBeNull()
    expect(prickleTitleFromSummary('Prickle w/Lili', 'Progress Prickle')).toBeNull()
  })
})

describe('plainTextDescription', () => {
  it('turns calendar HTML into text with paragraphs and line breaks', () => {
    expect(plainTextDescription('<p>Bring a project.</p><p>We chat first &amp; write after.<br>Cameras optional</p>'))
      .toBe('Bring a project.\n\nWe chat first & write after.\nCameras optional')
  })

  it('keeps bold, italic and links as markdown', () => {
    expect(plainTextDescription('<b>Members Only Pitch Prickle</b><br>Say <i>hi </i>at <a href="https://example.com/x">our site</a>'))
      .toBe('**Members Only Pitch Prickle**\nSay *hi* at [our site](https://example.com/x)')
  })

  it('drops links that are not http(s) or mailto', () => {
    expect(plainTextDescription('<a href="javascript:alert(1)">Join</a>')).toBe('Join')
  })

  it('keeps list items on their own lines', () => {
    expect(plainTextDescription('<ul><li>One</li><li>Two</li></ul>')).toBe('- One\n- Two')
  })

  it('does not leave markup or relative links behind', () => {
    expect(plainTextDescription('<a href="x">Join</a><script>alert(1)</script>')).toBe('Join')
  })

  it('is null for empty input', () => {
    expect(plainTextDescription(null)).toBeNull()
    expect(plainTextDescription('<p> </p>')).toBeNull()
  })
})

describe('typeIdByAlias', () => {
  const types = [{ id: 'prty_AAAAAAAAAAA1', summary_aliases: ['edu'] }, { id: 'prty_AAAAAAAAAAA2', summary_aliases: [] }, { id: 'prty_AAAAAAAAAAA3' }]

  it('matches a calendar type that starts with an alias word', () => {
    expect(typeIdByAlias(normalizePrickleType('EDU-PRICKLE: Make It Funny'), types)).toBe('prty_AAAAAAAAAAA1')
    expect(typeIdByAlias(normalizePrickleType('EDU-PRICKLE Tiny Things That Make a Life'), types)).toBe('prty_AAAAAAAAAAA1')
    expect(typeIdByAlias('edu', types)).toBe('prty_AAAAAAAAAAA1')
  })

  it('matches the Daydream Prickle calendar title through the alias the migration stores', () => {
    const daydream = [{ id: 'prty_AAAAAAAAAAA9', summary_aliases: ['qc-daydream'] }]
    const type = parsePrickleFromSummary('Q&C DAYDREAM PRICKLE w/Ania').type!
    expect(normalizePrickleType(type)).toBe('qc-daydream')
    expect(typeIdByAlias(normalizePrickleType(type), daydream)).toBe('prty_AAAAAAAAAAA9')
  })

  it('needs the whole first word, and is null with no alias match', () => {
    expect(typeIdByAlias('education-night', types)).toBeNull()
    expect(typeIdByAlias('heads-down', types)).toBeNull()
  })
})

describe('prickleTitleFromSummary with type aliases', () => {
  it('drops the type label the calendar title starts with', () => {
    expect(prickleTitleFromSummary('EDU-PRICKLE: Make It Funny w/Ellen Example', 'Educational Prickle', ['edu'])).toBe('Make It Funny')
    expect(prickleTitleFromSummary('EDU-PRICKLE Tiny Things That Make a Life w/Diana', 'Educational Prickle', ['edu'])).toBe('Tiny Things That Make a Life')
  })

  it('is null when only the label is left, and leaves other titles alone', () => {
    expect(prickleTitleFromSummary('EDU-PRICKLE w/Ania', 'Educational Prickle', ['edu'])).toBeNull()
    expect(prickleTitleFromSummary('Educational Webinar: Query Letters w/Sam', 'Educational Prickle', ['edu'])).toBe('Educational Webinar: Query Letters')
  })
})

describe('assignHostAndSpeaker', () => {
  const base = { typedName: 'Ellen Example', memberId: null, memberName: null, defaultHostId: 'mbr_AAAAAAAAAAA1', namesGuestSpeaker: true }

  it('makes the w/ name the host for a type with no guest speaker, falling back to the default host', () => {
    expect(assignHostAndSpeaker({ ...base, namesGuestSpeaker: false, memberId: 'mbr_AAAAAAAAAAA2' })).toEqual({ hostId: 'mbr_AAAAAAAAAAA2', guestSpeaker: null })
    expect(assignHostAndSpeaker({ ...base, namesGuestSpeaker: false, typedName: null })).toEqual({ hostId: 'mbr_AAAAAAAAAAA1', guestSpeaker: null })
  })

  it('keeps the default host and records an outside speaker by their typed name', () => {
    expect(assignHostAndSpeaker(base)).toEqual({ hostId: 'mbr_AAAAAAAAAAA1', guestSpeaker: 'Ellen Example' })
  })

  it('records a member speaker by their member name, with the default host still hosting', () => {
    expect(assignHostAndSpeaker({ ...base, typedName: 'Diana', memberId: 'mbr_AAAAAAAAAAA2', memberName: 'Diana Example' })).toEqual({
      hostId: 'mbr_AAAAAAAAAAA1',
      guestSpeaker: 'Diana Example',
    })
  })

  it('lets an admin-picked host replace the one the title and type give', () => {
    expect(assignHostAndSpeaker({ ...base, namesGuestSpeaker: false, hostOverrideId: 'mbr_AAAAAAAAAAA3' })).toEqual({ hostId: 'mbr_AAAAAAAAAAA3', guestSpeaker: null })
    expect(assignHostAndSpeaker({ ...base, hostOverrideId: 'mbr_AAAAAAAAAAA3' })).toEqual({ hostId: 'mbr_AAAAAAAAAAA3', guestSpeaker: 'Ellen Example' })
    expect(assignHostAndSpeaker({ ...base, memberId: 'mbr_AAAAAAAAAAA3', memberName: 'Ellen Example', hostOverrideId: 'mbr_AAAAAAAAAAA3' })).toEqual({ hostId: 'mbr_AAAAAAAAAAA3', guestSpeaker: null })
    expect(assignHostAndSpeaker({ ...base, hostOverrideId: null })).toEqual({ hostId: 'mbr_AAAAAAAAAAA1', guestSpeaker: 'Ellen Example' })
  })

  it('has no speaker when the w/ name is the default host, or there is no name', () => {
    expect(assignHostAndSpeaker({ ...base, typedName: 'Ania', memberId: 'mbr_AAAAAAAAAAA1', memberName: 'Ania Example' })).toEqual({ hostId: 'mbr_AAAAAAAAAAA1', guestSpeaker: null })
    expect(assignHostAndSpeaker({ ...base, typedName: null })).toEqual({ hostId: 'mbr_AAAAAAAAAAA1', guestSpeaker: null })
  })

  it('without a default host, a member speaker hosts and an outside speaker leaves the host empty', () => {
    expect(assignHostAndSpeaker({ ...base, defaultHostId: null, typedName: 'Diana', memberId: 'mbr_AAAAAAAAAAA2', memberName: 'Diana Example' })).toEqual({ hostId: 'mbr_AAAAAAAAAAA2', guestSpeaker: null })
    expect(assignHostAndSpeaker({ ...base, defaultHostId: null })).toEqual({ hostId: null, guestSpeaker: 'Ellen Example' })
  })
})

describe('"with" as the host separator', () => {
  it('reads the type and host from "with" like "w/"', () => {
    expect(parsePrickleFromSummary('Heads Down with Cody')).toEqual({ type: 'Heads Down', host: 'Cody' })
    expect(parsePrickleFromSummary('Prickle WITH Lili')).toEqual({ type: 'Prickle', host: 'Lili' })
    expect(parsePrickleFromSummary('EDU-PRICKLE: Make It Funny with Ellen Example')).toEqual({ type: 'EDU-PRICKLE: Make It Funny', host: 'Ellen Example' })
  })

  it('prefers w/ when both appear, and splits at the last "with" otherwise', () => {
    expect(parsePrickleFromSummary('Writing with Friends w/Ania')).toEqual({ type: 'Writing with Friends', host: 'Ania' })
    expect(parsePrickleFromSummary('Writing with Friends with Ania')).toEqual({ type: 'Writing with Friends', host: 'Ania' })
  })

  it('does not split inside a word or without a name after it', () => {
    expect(parsePrickleFromSummary('Without Ania')).toEqual({ type: 'Without Ania', host: null })
    expect(parsePrickleFromSummary('Open Table with')).toEqual({ type: 'Open Table with', host: null })
    expect(parsePrickleFromSummary('with Cody')).toEqual({ type: 'with Cody', host: null })
  })

  it('drops the "with Host" tail from the title', () => {
    expect(prickleTitleFromSummary('Query Letters with Sam', 'Educational Prickle')).toBe('Query Letters')
    expect(prickleTitleFromSummary('Heads Down with Cody', 'Heads Down')).toBeNull()
  })
})
