import { describe, it, expect } from 'vitest';
import { toKajabiPhotoUrl, extractSlackImageUrl } from '@/lib/member-avatar';

describe('toKajabiPhotoUrl', () => {
  it('uses the Kajabi CDN path when a relative avatar path is set', () => {
    const url = toKajabiPhotoUrl('avatars/abc123.jpg', 'alice@example.com', null);
    expect(url).toBe('https://kajabi-storefronts-production.kajabi-cdn.com/kajabi-storefronts-production/avatars/abc123.jpg');
  });

  it('passes through an absolute Kajabi avatar URL unchanged', () => {
    const url = toKajabiPhotoUrl('https://cdn.example.com/avatars/abc123.jpg', 'alice@example.com', null);
    expect(url).toBe('https://cdn.example.com/avatars/abc123.jpg');
  });

  it('falls back to the Slack photo when there is no Kajabi avatar', () => {
    const url = toKajabiPhotoUrl(null, 'alice@example.com', 'https://avatars.slack-edge.com/alice-192.png');
    expect(url).toBe('https://avatars.slack-edge.com/alice-192.png');
  });

  it('prefers the Kajabi avatar over a Slack photo when both are present', () => {
    const url = toKajabiPhotoUrl('avatars/abc123.jpg', 'alice@example.com', 'https://avatars.slack-edge.com/alice-192.png');
    expect(url).toBe('https://kajabi-storefronts-production.kajabi-cdn.com/kajabi-storefronts-production/avatars/abc123.jpg');
  });

  it('falls back to a Gravatar URL when there is no Kajabi avatar or Slack photo', () => {
    const url = toKajabiPhotoUrl(null, 'alice@example.com', null);
    expect(url).toMatch(/^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}\?d=404&s=200$/);
  });

  it('hashes the lowercased, trimmed email for Gravatar (case- and whitespace-insensitive)', () => {
    const lower = toKajabiPhotoUrl(null, 'alice@example.com', null);
    const upperWithSpace = toKajabiPhotoUrl(null, '  Alice@Example.com  ', null);
    expect(upperWithSpace).toBe(lower);
  });

  it('sets d=404 on the Gravatar URL so a missing account 404s (triggering the client-side initials fallback)', () => {
    const url = toKajabiPhotoUrl(null, 'alice@example.com', null);
    expect(url).toContain('d=404');
  });
});

describe('extractSlackImageUrl', () => {
  it('returns null when the profile has no avatar_hash (no photo data at all)', () => {
    expect(extractSlackImageUrl({})).toBeNull();
    expect(extractSlackImageUrl(null)).toBeNull();
    expect(extractSlackImageUrl(undefined)).toBeNull();
  });

  it('returns null for a "g"-prefixed avatar_hash (Slack-generated default/Gravatar-derived avatar)', () => {
    const url = extractSlackImageUrl({
      avatar_hash: 'g1234567890a',
      image_192: 'https://secure.gravatar.com/avatar/deadbeef-192.png',
      image_512: 'https://secure.gravatar.com/avatar/deadbeef-512.png',
    });
    expect(url).toBeNull();
  });

  it('returns image_192 for a real uploaded photo (non-"g" avatar_hash)', () => {
    const url = extractSlackImageUrl({
      avatar_hash: '8f4e6d2c1b0a',
      image_192: 'https://avatars.slack-edge.com/alice-192.png',
      image_512: 'https://avatars.slack-edge.com/alice-512.png',
    });
    expect(url).toBe('https://avatars.slack-edge.com/alice-192.png');
  });

  it('falls back to image_512 when image_192 is missing for a real uploaded photo', () => {
    const url = extractSlackImageUrl({
      avatar_hash: '8f4e6d2c1b0a',
      image_192: null,
      image_512: 'https://avatars.slack-edge.com/alice-512.png',
    });
    expect(url).toBe('https://avatars.slack-edge.com/alice-512.png');
  });

  it('returns null when a real photo is indicated but no image URLs are present', () => {
    const url = extractSlackImageUrl({ avatar_hash: '8f4e6d2c1b0a', image_192: null, image_512: null });
    expect(url).toBeNull();
  });
});
