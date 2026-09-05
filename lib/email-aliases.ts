/**
 * Shared forward email-alias resolution: alias_email -> canonical_email.
 * See member_email_aliases table. Distinct from the reverse-direction helpers
 * in lib/stripe-matching.ts (buildReverseAliasMap/getMemberEmails), which
 * answer "what are all the emails for this member" rather than "what is the
 * canonical form of this external email."
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
