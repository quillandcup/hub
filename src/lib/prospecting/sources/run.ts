import type { NewProspect } from "@/lib/data/prospects";
import type { Repos } from "@/lib/data/repos";
import { extractHashtags } from "../candidates";
import { knownMemberHandles } from "../import";
import { scoreProspect } from "../score";
import type { FoundProfile, ProspectSource } from "./types";

/** Profiles scoring below this are dropped, not stored: a search returns plenty of people who only share a word. */
export const MIN_SCORE_TO_KEEP = 20;

export type SourceRunSummary = {
  source: string;
  /** Distinct profiles the searches returned. */
  found: number;
  /** Kept because they scored high enough, and new to us. */
  added: number;
  belowMinimum: number;
  alreadyProspects: number;
  alreadyMembers: number;
  /** Queries that failed (the others still ran). */
  failedQueries: string[];
};

/**
 * Runs a source's searches, scores what it finds with the same rules as pasted prospects, and adds
 * the ones that clear `MIN_SCORE_TO_KEEP`. One failed query does not stop the rest.
 */
export async function runSource(repos: Pick<Repos, "members" | "prospects">, source: ProspectSource, userId: string | null, fetchImpl: typeof fetch = fetch): Promise<SourceRunSummary> {
  const profiles = new Map<string, FoundProfile>();
  const failedQueries: string[] = [];
  for (const query of source.queries) {
    try {
      for (const profile of await source.discover(query, fetchImpl)) profiles.set(`${profile.platform}:${profile.handle}`, profile);
    } catch (error) {
      console.error(`Prospect source ${source.id}: query "${query}" failed:`, error);
      failedQueries.push(query);
    }
  }

  const instagramHandles = await knownMemberHandles(repos.members);
  const keep: NewProspect[] = [];
  let belowMinimum = 0;
  let alreadyMembers = 0;
  for (const profile of profiles.values()) {
    if (profile.platform === "instagram" && instagramHandles.has(profile.handle)) {
      alreadyMembers++;
      continue;
    }
    const { score, reasons } = scoreProspect({ bio: profile.bio, hashtags: extractHashtags(profile.bio ?? ""), followerCount: profile.followerCount });
    if (score < MIN_SCORE_TO_KEEP) {
      belowMinimum++;
      continue;
    }
    keep.push({ ...profile, hashtags: extractHashtags(profile.bio ?? ""), source: source.id, fitScore: score, fitReasons: reasons });
  }

  const { added, existing } = await repos.prospects.addMany(keep, userId);
  return { source: source.id, found: profiles.size, added: added.length, belowMinimum, alreadyProspects: existing.length, alreadyMembers, failedQueries };
}
