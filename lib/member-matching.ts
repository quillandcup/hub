/**
 * Centralized member matching logic for Zoom attendance processing
 *
 * This module provides a single source of truth for matching Zoom attendee
 * names to canonical member records.
 */

export interface Member {
  id: string;
  name: string;
  email: string;
}

export interface MemberAlias {
  member_id: string;
  alias: string;
}

export interface MatchResult {
  member_id: string;
  confidence: 'high' | 'medium' | 'low';
  method: 'email' | 'alias' | 'normalized_name';
}

/**
 * Normalizes a name for fuzzy matching
 * - Converts to lowercase
 * - Removes non-alphanumeric characters (except spaces)
 * - Collapses multiple spaces
 * - Trims whitespace
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matches a Zoom attendee (name + optional email) to a member record
 *
 * Matching rules (in priority order):
 * 1. Email exact match (if email provided) - HIGHEST confidence
 * 2. Alias exact match - HIGH confidence
 * 3. Normalized name match - HIGH confidence
 *
 * @param attendeeName - The name from Zoom
 * @param attendeeEmail - The email from Zoom (may be null)
 * @param members - Array of all members
 * @param aliases - Array of all name aliases
 * @returns MatchResult if found, null if no match
 */
export function matchAttendeeToMember(
  attendeeName: string,
  attendeeEmail: string | null,
  members: Member[],
  aliases: MemberAlias[]
): MatchResult | null {
  // Build lookup maps for O(1) matching
  const membersByEmail = new Map<string, Member>();
  const membersByNormalizedName = new Map<string, Member>();
  const aliasToMember = new Map<string, Member>();

  // Index members by email and normalized name
  for (const member of members) {
    membersByEmail.set(member.email.toLowerCase(), member);
    membersByNormalizedName.set(normalizeName(member.name), member);
  }

  // Index aliases
  for (const alias of aliases) {
    const member = members.find(m => m.id === alias.member_id);
    if (member) {
      aliasToMember.set(alias.alias, member);
    }
  }

  // Rule 1: Try email match first (highest confidence)
  if (attendeeEmail) {
    const member = membersByEmail.get(attendeeEmail.toLowerCase());
    if (member) {
      return {
        member_id: member.id,
        confidence: 'high',
        method: 'email'
      };
    }
  }

  // Rule 2: Try alias match (exact string match)
  if (aliasToMember.has(attendeeName)) {
    const member = aliasToMember.get(attendeeName)!;
    return {
      member_id: member.id,
      confidence: 'high',
      method: 'alias'
    };
  }

  // Rule 3: Try normalized name match
  const normalized = normalizeName(attendeeName);
  const member = membersByNormalizedName.get(normalized);
  if (member) {
    return {
      member_id: member.id,
      confidence: 'high',
      method: 'normalized_name'
    };
  }

  return null;
}

/**
 * Batch match multiple attendees to members
 * Returns both matches and unmatched attendees for reporting
 */
export function batchMatchAttendees(
  attendees: Array<{ name: string; email: string | null }>,
  members: Member[],
  aliases: MemberAlias[]
): {
  matches: Array<{ name: string; email: string | null; match: MatchResult }>;
  unmatched: Array<{ name: string; email: string | null }>;
} {
  const matches: Array<{ name: string; email: string | null; match: MatchResult }> = [];
  const unmatched: Array<{ name: string; email: string | null }> = [];

  for (const attendee of attendees) {
    const match = matchAttendeeToMember(attendee.name, attendee.email, members, aliases);
    if (match) {
      matches.push({ ...attendee, match });
    } else {
      unmatched.push(attendee);
    }
  }

  return { matches, unmatched };
}
