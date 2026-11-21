import type { MemberEmailAlias } from "./member-matching";

export interface StripeCustomerLike {
  email: string | null;
  data?: { metadata?: { kjb_member_id?: string } };
}

export interface MemberLike {
  id: string;
  email: string;
  kajabi_id?: string | null;
}

/** Builds canonical_email → Set<alias_email> reverse lookup. */
export function buildReverseAliasMap(
  aliases: MemberEmailAlias[]
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const alias of aliases) {
    const canonical = alias.canonical_email.toLowerCase();
    if (!map.has(canonical)) map.set(canonical, new Set());
    map.get(canonical)!.add(alias.alias_email.toLowerCase());
  }
  return map;
}

/** Returns all emails belonging to a member: canonical + any alias emails. */
export function getMemberEmails(
  member: MemberLike,
  reverseAliasMap: Map<string, Set<string>>
): Set<string> {
  const canonical = member.email.toLowerCase();
  return new Set([canonical, ...(reverseAliasMap.get(canonical) ?? [])]);
}

/**
 * Matches a Stripe customer to a member record.
 * Priority:
 *   1. kjb_member_id metadata matches member.kajabi_id
 *   2. Stripe customer email matches member canonical or alias email
 */
export function matchStripeCustomerToMember<T extends MemberLike>(
  stripeCustomer: StripeCustomerLike,
  members: T[],
  reverseAliasMap: Map<string, Set<string>>
): T | null {
  const kjbMemberId = stripeCustomer.data?.metadata?.kjb_member_id;
  const customerEmail = stripeCustomer.email?.toLowerCase() ?? null;

  for (const member of members) {
    if (kjbMemberId && member.kajabi_id && kjbMemberId === member.kajabi_id) {
      return member;
    }
    if (customerEmail) {
      const memberEmails = getMemberEmails(member, reverseAliasMap);
      if (memberEmails.has(customerEmail)) return member;
    }
  }
  return null;
}
