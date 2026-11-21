import { stringSimilarity, tokenize } from './text-similarity';
import type { Repos } from '@/lib/data/repos';

export interface MemberForDuplication {
  id: string;
  name: string;
  email: string;
  status: string;
  /** The pen name they chose to be shown as, if any. */
  displayName?: string | null;
  /** Their active other emails (an old Kajabi or Slack address, one they added). */
  emailAliases?: string[];
  /** Their active other names (pen names, the names Zoom and Slack know them by). */
  nameAliases?: string[];
}

export type DuplicateConfidence = 'high' | 'medium' | 'low';

export interface DuplicateGroup {
  reason: string;
  confidence: DuplicateConfidence;
  members: MemberForDuplication[];
}

// Below this, two names are treated as unrelated — kept high enough that a
// shared first name or a couple of common short tokens (e.g. "Lee") doesn't
// flag two clearly different people.
const FUZZY_NAME_THRESHOLD = 0.85;

function normalizedName(member: MemberForDuplication): string {
  return member.name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function splitFirstLast(name: string): { first: string; last: string } | null {
  const parts = tokenize(name);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

// True when one name is a short-form/nickname of the other (e.g. "rob" of
// "robert") — a plain prefix check, same idea as the length floor used
// elsewhere for substring matches, so a two-letter name can't trivially
// "prefix-match" almost anything.
function isNicknamePrefix(a: string, b: string): boolean {
  return a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * Two full names are only treated as a likely duplicate when BOTH the first
 * and last name agree (exactly, by edit-distance similarity, or via a
 * nickname prefix) — matching on a shared last name alone, or a shared first
 * name alone (the common case: many members share a first name), is not
 * enough evidence that two distinct member records are the same person.
 * Whole-string similarity is kept as a fallback for single-word names and
 * near-identical full strings that the first/last split can't help with.
 */
function nameSimilarity(a: MemberForDuplication, b: MemberForDuplication): number {
  const wholeName = stringSimilarity(normalizedName(a), normalizedName(b));

  const partsA = splitFirstLast(a.name);
  const partsB = splitFirstLast(b.name);
  if (!partsA || !partsB) return wholeName;

  const lastSim = partsA.last === partsB.last ? 1 : stringSimilarity(partsA.last, partsB.last);
  if (lastSim < 0.8) return wholeName;

  const firstSim = partsA.first === partsB.first
    ? 1
    : Math.max(
        stringSimilarity(partsA.first, partsB.first),
        isNicknamePrefix(partsA.first, partsB.first) ? 0.85 : 0
      );
  if (firstSim < 0.6) return wholeName;

  return Math.max(wholeName, (lastSim + firstSim) / 2);
}

export function detectDuplicates(members: MemberForDuplication[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const usedKeys = new Set<string>();
  // Tracks every member id already covered by an exact-match group, so the
  // fuzzy pass below only surfaces near-duplicates that exact matching missed
  // entirely — it should never re-flag a pair already caught with certainty.
  const exactMatchedIds = new Set<string>();

  function groupKey(group: MemberForDuplication[]) {
    return group.map((m) => m.id).sort().join('|');
  }

  // Exact email match — the strongest possible signal, since the same email
  // address always belongs to the same real account. An active email alias
  // counts as the member's address too: when one member's old address is
  // another's current one, they are the same person with two records.
  const byEmail = new Map<string, Map<string, { member: MemberForDuplication; viaAlias: boolean }>>();
  const addEmail = (address: string, member: MemberForDuplication, viaAlias: boolean) => {
    const key = address.toLowerCase().trim();
    if (!key) return;
    if (!byEmail.has(key)) byEmail.set(key, new Map());
    const entries = byEmail.get(key)!;
    if (!entries.has(member.id)) entries.set(member.id, { member, viaAlias });
  };
  for (const member of members) addEmail(member.email, member, false);
  for (const member of members) for (const alias of member.emailAliases ?? []) addEmail(alias, member, true);
  for (const entries of byEmail.values()) {
    if (entries.size > 1) {
      const group = [...entries.values()].map((e) => e.member);
      const key = groupKey(group);
      if (!usedKeys.has(key)) {
        usedKeys.add(key);
        const viaAlias = [...entries.values()].some((e) => e.viaAlias);
        groups.push({ reason: viaAlias ? 'Email matches an alias' : 'Same email', confidence: 'high', members: group });
        for (const m of group) exactMatchedIds.add(m.id);
      }
    }
  }

  // Exact name match — a real signal, but weaker than email: two different
  // people can share a common name, so this stays "medium" rather than "high".
  // A name that is another member's display name or active name alias (a pen
  // name, the name Zoom or Slack knows them by) counts the same way.
  const byName = new Map<string, Map<string, { member: MemberForDuplication; viaAlias: boolean }>>();
  const addName = (name: string, member: MemberForDuplication, viaAlias: boolean) => {
    const key = name.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!key) return;
    if (!byName.has(key)) byName.set(key, new Map());
    const entries = byName.get(key)!;
    if (!entries.has(member.id)) entries.set(member.id, { member, viaAlias });
  };
  for (const member of members) addName(member.name, member, false);
  for (const member of members) {
    if (member.displayName) addName(member.displayName, member, true);
    for (const alias of member.nameAliases ?? []) addName(alias, member, true);
  }
  for (const entries of byName.values()) {
    if (entries.size > 1) {
      const group = [...entries.values()].map((e) => e.member);
      const key = groupKey(group);
      if (!usedKeys.has(key)) {
        usedKeys.add(key);
        const viaAlias = [...entries.values()].some((e) => e.viaAlias);
        groups.push({ reason: viaAlias ? 'Name matches a pen name or alias' : 'Same name', confidence: 'medium', members: group });
        for (const m of group) exactMatchedIds.add(m.id);
      }
    }
  }

  // Fuzzy name match — catches typos, nicknames, and reordered names that
  // exact matching can't see at all. Only compares members not already tied
  // together by an exact match above, and only ever produces pairs (not
  // transitively merged groups) to keep the result easy to reason about.
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      if (exactMatchedIds.has(a.id) && exactMatchedIds.has(b.id)) continue;
      if (normalizedName(a) === normalizedName(b)) continue; // caught above

      const score = nameSimilarity(a, b);
      if (score >= FUZZY_NAME_THRESHOLD) {
        const key = groupKey([a, b]);
        if (!usedKeys.has(key)) {
          usedKeys.add(key);
          const pct = Math.round(score * 100);
          groups.push({
            reason: `Similar name (${pct}% match)`,
            confidence: 'low',
            members: [a, b],
          });
        }
      }
    }
  }

  return groups;
}

/**
 * The members with what `detectDuplicates` needs beyond name and email: their display name and their active
 * email and name aliases, read once each (the alias lists are paginated past 1000 rows by the repository).
 */
export async function withDuplicateAliases<T extends MemberForDuplication>(
  repos: Pick<Repos, 'aliases'>,
  members: T[]
): Promise<T[]> {
  const [emailOwners, nameAliases] = await Promise.all([repos.aliases.emailOwners(), repos.aliases.nameAliases({ activeOnly: true })]);
  const emails = new Map<string, string[]>();
  for (const { member_id, alias_email } of emailOwners) emails.set(member_id, [...(emails.get(member_id) ?? []), alias_email]);
  const names = new Map<string, string[]>();
  for (const { member_id, alias } of nameAliases) names.set(member_id, [...(names.get(member_id) ?? []), alias]);
  return members.map((m) => ({ ...m, emailAliases: emails.get(m.id) ?? [], nameAliases: names.get(m.id) ?? [] }));
}
