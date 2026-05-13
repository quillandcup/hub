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
  source: 'zoom' | 'slack';
}

export interface MatchResult {
  member_id: string;
  confidence: 'high' | 'medium' | 'low';
  method: 'email' | 'alias' | 'normalized_name';
}

export interface AmbiguousMatch {
  reason: 'ambiguous';
  candidates: Member[];
  attempted_name: string;
  attempted_email: string | null;
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
 * Matches a name (and optional email) to a member record
 *
 * Matching rules (in priority order):
 * 1. Email exact match (if email provided and skipEmail=false) - HIGHEST confidence
 * 2. Alias match (case-insensitive) - HIGH confidence
 * 3. First name + last initial (e.g., "Katie P" → "Member 22") - HIGH confidence
 * 4. First name only (if unambiguous) - HIGH confidence
 * 5. Normalized name match - HIGH confidence
 *
 * @param attendeeName - The name to match (from Zoom, calendar, etc.)
 * @param attendeeEmail - Optional email address
 * @param members - Array of all members
 * @param aliases - Array of all name aliases
 * @param skipEmail - If true, skip email matching (useful when email is org account, not person)
 * @returns MatchResult if unique match found, AmbiguousMatch if multiple candidates, null if no match
 */
export function matchAttendeeToMember(
  attendeeName: string,
  attendeeEmail: string | null,
  members: Member[],
  aliases: MemberAlias[],
  skipEmail = false
): MatchResult | AmbiguousMatch | null {
  // Build lookup maps for O(1) matching
  const membersByEmail = new Map<string, Member>();
  const membersByNormalizedName = new Map<string, Member>();
  const aliasToMember = new Map<string, Member>();

  // Index members by email and normalized name
  for (const member of members) {
    membersByEmail.set(member.email.toLowerCase(), member);
    membersByNormalizedName.set(normalizeName(member.name), member);
  }

  // Index aliases (case-insensitive for flexibility)
  // Aliases are disambiguation rules and should be flexible
  for (const alias of aliases) {
    const member = members.find(m => m.id === alias.member_id);
    if (member) {
      aliasToMember.set(alias.alias.trim().toLowerCase(), member);
    }
  }

  // Rule 1: Try email match first (if not skipped and email provided)
  if (!skipEmail && attendeeEmail) {
    const member = membersByEmail.get(attendeeEmail.toLowerCase());
    if (member) {
      return {
        member_id: member.id,
        confidence: 'high',
        method: 'email'
      };
    }
  }

  // Rule 2: Try alias match (case-insensitive for flexibility)
  const normalizedForAlias = attendeeName.trim().toLowerCase();
  if (aliasToMember.has(normalizedForAlias)) {
    const member = aliasToMember.get(normalizedForAlias)!;
    return {
      member_id: member.id,
      confidence: 'high',
      method: 'alias'
    };
  }

  // Rule 3: Try first name + last initial pattern (e.g., "Katie P" → "Member 22")
  const nameInitialPattern = attendeeName.match(/^([A-Za-z]+)\s+([A-Za-z])\.?$/);
  if (nameInitialPattern) {
    const firstName = nameInitialPattern[1].toLowerCase();
    const lastInitial = nameInitialPattern[2].toLowerCase();

    // Find members where first name matches and last name starts with initial
    const candidates = members.filter(m => {
      const nameParts = m.name.toLowerCase().split(/\s+/);
      if (nameParts.length < 2) return false;
      const memberFirstName = nameParts[0];
      const memberLastName = nameParts[nameParts.length - 1];
      return memberFirstName === firstName && memberLastName.startsWith(lastInitial);
    });

    // Only use if exactly one match (unambiguous)
    if (candidates.length === 1) {
      return {
        member_id: candidates[0].id,
        confidence: 'high',
        method: 'normalized_name' // Using normalized_name method for now
      };
    } else if (candidates.length > 1) {
      // Multiple matches - ambiguous
      return {
        reason: 'ambiguous',
        candidates,
        attempted_name: attendeeName,
        attempted_email: attendeeEmail,
      };
    }
  }

  // Rule 4: Try first name only match (if unambiguous)
  if (attendeeName.split(/\s+/).length === 1) {
    // Single word - try matching by first name only
    const firstName = attendeeName.toLowerCase();
    const candidates = members.filter(m => {
      const nameParts = m.name.toLowerCase().split(/\s+/);
      return nameParts[0] === firstName;
    });

    // Only use if exactly one match (unambiguous)
    if (candidates.length === 1) {
      return {
        member_id: candidates[0].id,
        confidence: 'high',
        method: 'normalized_name' // Using normalized_name method for now
      };
    } else if (candidates.length > 1) {
      // Multiple matches - ambiguous
      return {
        reason: 'ambiguous',
        candidates,
        attempted_name: attendeeName,
        attempted_email: attendeeEmail,
      };
    }
  }

  // Rule 5: Try normalized full name match (fallback)
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
    if (match && 'member_id' in match) {
      matches.push({ ...attendee, match });
    } else {
      unmatched.push(attendee);
    }
  }

  return { matches, unmatched };
}
