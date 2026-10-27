import { getMemberDisplayName } from "@/lib/member-display-name";

/**
 * A member as a picker row: the name the community knows them by leads, and the second line holds
 * what else finds them (their legal name when it differs, their email), since pickers search both
 * lines. So "bestie" and "laura may" both find the same person.
 */
export function memberSearchItem(m: { id: string; name: string; displayName?: string | null; email?: string | null }) {
  const shown = getMemberDisplayName({ name: m.name, display_name: m.displayName });
  const detail = [shown !== m.name ? m.name : null, m.email].filter(Boolean).join(" · ");
  return { id: m.id, name: shown, detail: detail || null };
}
