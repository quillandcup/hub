import type { Repos } from "@/lib/data/repos";
import { normalizeHandle, parsePastedProspects } from "./candidates";
import { scoreProspect } from "./score";

export type ImportSummary = {
  added: number;
  /** Handles we already had (a reviewed prospect is never overwritten). */
  alreadyProspects: number;
  /** Handles that belong to a member or lead already in the Hub. */
  alreadyMembers: number;
  /** Lines that were not a handle or profile link. */
  unreadable: string[];
};

/** Handles of every member and lead whose Instagram we know, to keep people we already have out of the list. */
export async function knownMemberHandles(members: Repos["members"]): Promise<Set<string>> {
  const handles = new Set<string>();
  for (const url of await members.instagramUrls()) {
    const handle = normalizeHandle(url);
    if (handle) handles.add(handle);
  }
  return handles;
}

/** Parses pasted profile lines, drops people already in the Hub, scores the rest and adds them as new prospects. */
export async function importPastedProspects(repos: Pick<Repos, "members" | "prospects">, text: string, userId: string | null): Promise<ImportSummary> {
  const { candidates, rejectedLines } = parsePastedProspects(text);
  const known = await knownMemberHandles(repos.members);
  const fresh = candidates.filter((c) => !known.has(c.handle));

  const { added, existing } = await repos.prospects.addMany(
    fresh.map((c) => {
      const { score, reasons } = scoreProspect(c);
      return { ...c, platform: "instagram" as const, source: "paste", fitScore: score, fitReasons: reasons };
    }),
    userId,
  );

  return { added: added.length, alreadyProspects: existing.length, alreadyMembers: candidates.length - fresh.length, unreadable: rejectedLines };
}
