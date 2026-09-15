/**
 * The name shown to the community for a member: their chosen default pen
 * name if one is set, otherwise their legal name. Admin-only pages should
 * keep using `member.name` directly instead of this helper.
 */
export function getMemberDisplayName(member: { name: string; display_name?: string | null }): string {
  return member.display_name?.trim() || member.name;
}
