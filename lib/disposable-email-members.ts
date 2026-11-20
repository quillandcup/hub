import { isDisposableEmail } from "@/lib/disposable-email";

export interface DisposableEmailMember {
  id: string;
  name: string;
  displayName: string | null;
  email: string;
  status: string;
}

export interface DisposableEmailMatch {
  memberId: string;
  name: string;
  displayName: string | null;
  /** The addresses that are temporary-mail ones: the primary first, then aliases in the order given. */
  addresses: { email: string; kind: "primary" | "alias" }[];
}

/**
 * Active members whose primary email, or an email alias, is a temporary-mail address. A flag for staff only: the imports
 * (Kajabi, Stripe) are never refused or changed because of it. An alias belongs to a member through `canonical_email`,
 * which is a copy of that member's `members.email`, so it is matched case-insensitively against the primary.
 */
export function findMembersWithDisposableEmail(
  members: DisposableEmailMember[],
  aliases: { alias_email: string; canonical_email: string }[],
): DisposableEmailMatch[] {
  const aliasesByCanonical = new Map<string, string[]>();
  for (const a of aliases) {
    const key = a.canonical_email.toLowerCase();
    const list = aliasesByCanonical.get(key) ?? [];
    list.push(a.alias_email);
    aliasesByCanonical.set(key, list);
  }

  const matches: DisposableEmailMatch[] = [];
  for (const m of members) {
    if (m.status !== "active") continue;
    const addresses: DisposableEmailMatch["addresses"] = [];
    if (isDisposableEmail(m.email)) addresses.push({ email: m.email, kind: "primary" });
    for (const alias of aliasesByCanonical.get(m.email.toLowerCase()) ?? []) {
      if (isDisposableEmail(alias)) addresses.push({ email: alias, kind: "alias" });
    }
    if (addresses.length > 0) matches.push({ memberId: m.id, name: m.name, displayName: m.displayName, addresses });
  }
  return matches.sort((a, b) => a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId));
}
