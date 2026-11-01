import { describe, expect, it } from 'vitest'
import { findCourseHero, imageFieldNames } from '@/lib/kajabi/course-hero'

describe('finding the hero in the admin product JSON', () => {
  const product = (attributes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ data: { id: '1', attributes }, ...extra })

  it('takes the URL under a hero, banner, cover or background key, and says where it was', () => {
    expect(findCourseHero(product({ heroImageUrl: 'https://cdn.test/h.jpg' }))).toEqual({ url: 'https://cdn.test/h.jpg', key: 'data.attributes.heroImageUrl' })
    expect(findCourseHero(product({ banner_image: 'https://cdn.test/b.jpg' }))?.url).toBe('https://cdn.test/b.jpg')
    expect(findCourseHero(product({ settings: { backgroundImageUrl: 'https://cdn.test/g.jpg' } }))?.key).toBe('data.attributes.settings.backgroundImageUrl')
  })

  it('never takes the thumbnail or a poster, whatever else the key says', () => {
    expect(findCourseHero(product({ thumbnailUrl: 'https://cdn.test/t.jpg', coverThumbnailUrl: 'https://cdn.test/t2.jpg', posterImageUrl: 'https://cdn.test/p.jpg' }))).toBeNull()
  })

  it('ignores values that are not http(s) URLs, and finds nothing in an empty or odd payload', () => {
    expect(findCourseHero(product({ heroImageUrl: 'javascript:alert(1)', bannerImage: null, coverText: 'Not a URL' }))).toBeNull()
    expect(findCourseHero({})).toBeNull()
    expect(findCourseHero(null)).toBeNull()
    expect(findCourseHero('text')).toBeNull()
  })

  it('looks through arrays, and stops at a sane depth', () => {
    expect(findCourseHero(product({ images: [{ heroUrl: 'https://cdn.test/h.jpg' }] }))?.key).toBe('data.attributes.images[0].heroUrl')
    let deep: Record<string, unknown> = { heroUrl: 'https://cdn.test/deep.jpg' }
    for (let i = 0; i < 12; i++) deep = { next: deep }
    expect(findCourseHero(product(deep))).toBeNull()
  })

  it('lists the names of the URL fields, never their values, for a miss', () => {
    const names = imageFieldNames(product({ thumbnailUrl: 'https://cdn.test/secret-t.jpg', images: [{ url: 'https://cdn.test/a.jpg' }, { url: 'https://cdn.test/b.jpg' }] }))
    expect(names).toEqual(['data.attributes.images[].url', 'data.attributes.thumbnailUrl'])
    expect(JSON.stringify(names)).not.toContain('cdn.test')
  })
})
