/**
 * The name a member is known by: their chosen default pen name if one is
 * set, otherwise their legal name. Used in member pages and admin pages alike;
 * admin tables show the legal name beside it where identity matters, and keep
 * the legal name for billing, merging and name-matching (see CLAUDE.md,
 * "Display Names").
 */
export function getMemberDisplayName(member: { name: string; display_name?: string | null }): string {
  return member.display_name?.trim() || member.name;
}
