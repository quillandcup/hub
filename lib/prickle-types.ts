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
 * - "Open Table Prickle" → { type: "Open Table Prickle", host: null }
 * - "'Midnight Crew' w/member13-display" → { type: "Midnight Crew", host: "member13-display" }
 */
export function parsePrickleFromSummary(summary: string): {
  type: string | null;
  host: string | null;
} {
  // Remove surrounding quotes if present
  const cleaned = summary.replace(/^['"](.+?)['"]$/, "$1").trim();

  // Pattern: [TYPE] w/[HOST]
  const matchWithHost = cleaned.match(/^(.+?)\s*w\/\s*(.+?)$/i);

  if (matchWithHost) {
    const beforeW = matchWithHost[1].replace(/^['"]|['"]$/g, "").trim();
    const host = matchWithHost[2].trim();

    // If it's just "Prickle w/Host", that's a Progress Prickle
    if (beforeW.toLowerCase() === "prickle") {
      return { type: "Prickle", host };
    }

    // Otherwise extract the type
    return { type: beforeW, host };
  }

  // No "w/" found - it's a standalone prickle type (no host)
  // e.g., "Open Table Prickle", "Heads Down Prickle"
  if (cleaned) {
    return { type: cleaned, host: null };
  }

  return { type: null, host: null };
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
      .eq("normalized_name", "progress")
      .single();
    return data?.id || null;
  }

  const normalized = normalizePrickleType(rawType);

  // If normalization resulted in empty string (e.g., "Prickle" → ""), treat as Progress Prickle
  if (!normalized || normalized === "") {
    const { data } = await supabase
      .from("prickle_types")
      .select("id")
      .eq("normalized_name", "progress")
      .single();
    return data?.id || null;
  }

  // Try exact match first
  const { data } = await supabase
    .from("prickle_types")
    .select("id")
    .eq("normalized_name", normalized)
    .single();

  return data?.id || null;
}
