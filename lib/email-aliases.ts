/**
 * Shared forward email-alias resolution: alias_email -> canonical_email.
 * See member_email_aliases table. Distinct from the reverse-direction helpers
 * in lib/stripe-matching.ts (buildReverseAliasMap/getMemberEmails), which
 * answer "what are all the emails for this member" rather than "what is the
 * canonical form of this external email."
 *
 * An alias belongs to a member (member_email_aliases.member_id);
 * canonical_email is a trigger-maintained copy of that member's
 * members.email. Outside the members pipeline that copy is current, so
 * buildAliasMap over (alias_email, canonical_email) is correct. Inside the
 * members pipeline members.email is last run's value, so it uses
 * buildMembersRunAliasMap instead.
 */
export function buildAliasMap(
  aliases: { alias_email: string; canonical_email: string }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of aliases) {
    map.set(a.alias_email.toLowerCase(), a.canonical_email.toLowerCase());
  }
  return map;
}

export function resolveEmail(email: string, aliasMap: Map<string, string>): string {
  const normalized = email.toLowerCase();
  return aliasMap.get(normalized) ?? normalized;
}

export interface RunAliasInput {
  /** Active member_email_aliases rows. */
  aliases: { alias_email: string; member_id: string }[];
  /** Existing members rows (members.email as of the last run). */
  members: { id: string; email: string | null; kajabi_id: string | null }[];
  /** Current Kajabi contacts (bronze.kajabi_contacts). */
  contacts: { kajabi_contact_id: string; email: string | null }[];
}

export interface RunAliasResult {
  /** alias email -> the email that member will have after this run. */
  aliasMap: Map<string, string>;
  /** member id -> the email that member will have after this run. */
  runEmailByMemberId: Map<string, string>;
}

/**
 * Alias map for a members reprocess run. Each alias resolves to the email its
 * member will have *after* this run: the current email of the member's own
 * Kajabi contact (matched by kajabi_id), else members.email. Resolving to
 * members.email instead would send an alias to the member's previous address
 * whenever their Kajabi email just changed — the alias contact would then
 * claim that address on its own and the update would collide with the member
 * who still holds it.
 *
 * Also maps a member's previous email to their new one when it changed in
 * Kajabi (reprocess_members_atomic saves that as an 'auto_detected' alias, but
 * only after this run has resolved everything), so Kajabi customers, Stripe
 * customers and Slack users still filed under the old address stay attached
 * this run. Skipped when a Kajabi contact currently uses the old address:
 * then it's that contact's.
 */
export function buildMembersRunAliasMap({ aliases, members, contacts }: RunAliasInput): RunAliasResult {
  const contactEmailByKajabiId = new Map<string, string>();
  const contactEmails = new Set<string>();
  for (const c of contacts) {
    if (!c.email) continue;
    const email = c.email.toLowerCase();
    contactEmailByKajabiId.set(String(c.kajabi_contact_id), email);
    contactEmails.add(email);
  }

  const runEmailByMemberId = new Map<string, string>();
  for (const m of members) {
    const kajabiEmail = m.kajabi_id ? contactEmailByKajabiId.get(String(m.kajabi_id)) : undefined;
    const email = kajabiEmail ?? m.email?.toLowerCase();
    if (email) runEmailByMemberId.set(m.id, email);
  }

  const aliasMap = new Map<string, string>();

  // Implicit: previous email -> new email, for members whose Kajabi email changed.
  for (const m of members) {
    const previous = m.email?.toLowerCase();
    const next = runEmailByMemberId.get(m.id);
    if (!previous || !next || previous === next || contactEmails.has(previous)) continue;
    aliasMap.set(previous, next);
  }

  // Explicit aliases win over the implicit ones above.
  for (const a of aliases) {
    const alias = a.alias_email.toLowerCase();
    const target = runEmailByMemberId.get(a.member_id);
    if (!target) continue;
    if (alias === target) {
      // Self-alias (the member's email changed back to an address that had
      // become an alias of theirs): nothing to resolve. Drop any implicit
      // mapping so it doesn't send the address elsewhere.
      aliasMap.delete(alias);
      continue;
    }
    aliasMap.set(alias, target);
  }

  return { aliasMap, runEmailByMemberId };
}

export interface KajabiMemberRow {
  email: string;
  kajabi_id: string | null;
}

export interface EmailConflict {
  kajabi_id: string;
  email: string;
  /** Members reprocess_members_atomic would update (matched by kajabi_id). */
  member_ids: string[];
  /** The other member that already has this email. */
  conflicting_member_id: string;
}

/**
 * reprocess_members_atomic updates each row onto the member(s) with its
 * kajabi_id. If that sets an email another member already has, the UPDATE
 * violates members_email_key and the whole run rolls back — every member's
 * sync fails because of one. Pull such rows out so the rest go through; the
 * affected member keeps last run's data until an admin merges the two.
 *
 * A holder that shares the row's kajabi_id is not a conflict: it's a stale
 * duplicate that reprocess_members_atomic Step 1 folds into the original.
 * A holder that is itself moving to a new email this run still counts (one
 * UPDATE statement checks the unique constraint row by row, so the order
 * would decide); the row goes through on the next run, once it has moved.
 */
export function partitionEmailConflicts<T extends KajabiMemberRow>(
  rows: T[],
  members: { id: string; email: string | null; kajabi_id: string | null }[]
): { rows: T[]; conflicts: EmailConflict[] } {
  const memberIdsByKajabiId = new Map<string, string[]>();
  const memberByEmail = new Map<string, { id: string; kajabi_id: string | null }>();
  for (const m of members) {
    if (m.kajabi_id) {
      const ids = memberIdsByKajabiId.get(m.kajabi_id) ?? [];
      ids.push(m.id);
      memberIdsByKajabiId.set(m.kajabi_id, ids);
    }
    if (m.email) memberByEmail.set(m.email.toLowerCase(), m);
  }

  const kept: T[] = [];
  const conflicts: EmailConflict[] = [];
  for (const row of rows) {
    const targets = row.kajabi_id ? memberIdsByKajabiId.get(row.kajabi_id) : undefined;
    const holder = memberByEmail.get(row.email.toLowerCase());
    if (targets && holder && !targets.includes(holder.id)) {
      conflicts.push({
        kajabi_id: row.kajabi_id!,
        email: row.email,
        member_ids: targets,
        conflicting_member_id: holder.id,
      });
      continue;
    }
    kept.push(row);
  }
  return { rows: kept, conflicts };
}
