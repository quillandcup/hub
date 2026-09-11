export interface ConflictEntry {
  externalId: string;
  email: string;
  name: string | null;
  detail?: string;
}

export interface ConflictGroup {
  canonicalEmail: string;
  memberId: string | null;
  memberName: string | null;
  entries: ConflictEntry[];
}

/**
 * Groups items by canonical email (via the given alias map) and returns only
 * the groups with more than one entry — i.e. the same person with more than
 * one account in an external system.
 */
export function groupByCanonical<T extends { email: string | null }>(
  items: T[],
  aliasMap: Map<string, string>,
  getId: (item: T) => string,
  getName: (item: T) => string | null,
  getDetail?: (item: T) => string | undefined,
): ConflictGroup[] {
  const grouped = new Map<string, ConflictEntry[]>();
  for (const item of items) {
    // Slack users (and, rarely, Kajabi contacts/Stripe customers) can have a
    // null email at the DB level — nothing to group without one.
    if (!item.email) continue;
    const normalized = item.email.toLowerCase();
    const canonical = aliasMap.get(normalized) ?? normalized;
    const entries = grouped.get(canonical) ?? [];
    entries.push({ externalId: getId(item), email: normalized, name: getName(item), detail: getDetail?.(item) });
    grouped.set(canonical, entries);
  }
  return Array.from(grouped.entries())
    .filter(([, entries]) => entries.length > 1)
    .map(([canonicalEmail, entries]) => ({ canonicalEmail, memberId: null, memberName: null, entries }))
    .sort((a, b) => a.canonicalEmail.localeCompare(b.canonicalEmail));
}
