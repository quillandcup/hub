/**
 * Normalize prickle type name for matching
 * Examples:
 * - "HEADS DOWN" → "heads-down"
 * - "Heads Down Prickle" → "heads-down"
 * - "Sprint PRICKLE" → "sprint-prickle"
 */
export function normalizePrickleType(rawType: string): string {
  return rawType
    .toLowerCase()
    .replace(/\s*prickle\s*/gi, "") // Remove "prickle" suffix/prefix
    .trim()
    .replace(/[^\w\s-]/g, "") // Remove special chars except hyphen
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens
}

/**
 * Extract prickle type and host from calendar event summary
 * Patterns:
 * - "Prickle w/Lili" → { type: null (default Progress Prickle), host: "Lili" }
 * - "HEADS DOWN w/Cody" → { type: "HEADS DOWN", host: "Cody" }
 * - "Pitch Prickle w/Sarah" → { type: "Pitch Prickle", host: "Sarah" }
 */
export function parsePrickleFromSummary(summary: string): {
  type: string | null;
  host: string | null;
} {
  // Pattern: [TYPE] w/[HOST]
  const match = summary.match(/^(.+?)\s*w\/\s*(.+?)$/i);

  if (!match) {
    return { type: null, host: null };
  }

  const beforeW = match[1].trim();
  const host = match[2].trim();

  // If it's just "Prickle w/Host", that's a Progress Prickle (no explicit type)
  if (beforeW.toLowerCase() === "prickle") {
    return { type: null, host }; // null type = default to Progress Prickle
  }

  // Otherwise extract the type
  return { type: beforeW, host };
}

/**
 * Match normalized type to database prickle_types
 * Returns type_id if found, or null if needs admin review
 */
export async function matchPrickleType(
  supabase: any,
  rawType: string | null
): Promise<string | null> {
  // Default to Progress Prickle if no type specified
  if (!rawType) {
    const { data } = await supabase
      .from("prickle_types")
      .select("id")
      .eq("normalized_name", "progress-prickle")
      .single();
    return data?.id || null;
  }

  const normalized = normalizePrickleType(rawType);

  // Try exact match first
  const { data } = await supabase
    .from("prickle_types")
    .select("id")
    .eq("normalized_name", normalized)
    .single();

  return data?.id || null;
}
