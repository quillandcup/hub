"use server";

import { getMemberDisplayName } from "@/lib/member-display-name";
import { createRepos } from "@/lib/data/repos";
import type { PrickleDetail } from "@/lib/data/prickles";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserTimezonePreference } from "@/lib/timezone";
import { revalidatePath } from "next/cache";
import {
  getPrickleRecommendations as computeRecommendations,
  seriesKeyFor,
  type CandidatePrickle,
  type PersonalCheckin,
  type HistoricalAttendanceRow,
  type HostVibeRow,
  type PickerHost,
  type PickerPrickleType,
  type PickerRecommendation,
  type PurposePreference,
  type TimeOfDay,
  type MoodNow,
  type Vibe,
  type PrickleTypePurpose,
  type VibePreference,
  PICKER_HISTORY_MONTHS as HISTORY_MONTHS,
} from "@/lib/prickle-picker";
import { getHostVibeTypes } from "@/lib/host-vibes";
import { ORG_TIMEZONE } from "@/lib/config";
import { EMPTY_CHECKIN, validateCheckin, type Emotion, type Need } from "@/lib/prickle-checkins";

import { withAction } from "@/lib/analytics/server";
const BATCH_SIZE = 1000;
const DEFAULT_TIMEZONE = ORG_TIMEZONE;
const FALLBACK_WINDOW_DAYS = 14;

export interface WizardAnswers {
  /** How many days out from now to look for candidates. */
  windowDays: number;
  timeOfDay: TimeOfDay;
  vibe: VibePreference;
  purpose: PurposePreference;
  withMemberIds: string[];
  /** "How are you feeling?" step; all optional. */
  mood?: MoodNow;
  need?: Need | null;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function fetchAllPaginated<T>(
  queryFn: (offset: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  let all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await queryFn(offset);
    if (data && data.length > 0) {
      all = all.concat(data);
      offset += data.length;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return all;
}

async function fetchAttendanceForPrickleIds(
  supabase: SupabaseClient,
  prickleIds: string[]
): Promise<HistoricalAttendanceRow[]> {
  const links = await createRepos(supabase).attendance.forPrickles(prickleIds);
  return links.map((l) => ({ prickle_id: l.prickleId, member_id: l.memberId }));
}

/**
 * Every check-in where the member said whether they got what they came for, keyed to its prickle's series -- the personal history the
 * picker weighs against how they feel now. All time, not just HISTORY_MONTHS: check-ins are
 * sparse and a series' character changes slowly.
 */
async function fetchMyRatedCheckins(supabase: SupabaseClient, memberId: string): Promise<PersonalCheckin[]> {
  const rows = await createRepos(supabase).prickleActivity.ratedCheckinsOf(memberId);
  return rows.map((r) => ({
    seriesKey: seriesKeyFor(r.typeId, r.hostId),
    pleasantBefore: r.pleasantBefore,
    energyBefore: r.energyBefore,
    emotionBefore: (r.emotionBefore ?? null) as Emotion | null,
    need: (r.need ?? null) as Need | null,
    intentionMet: r.intentionMet,
  }));
}

/**
 * Loads reference/historical data and scores upcoming prickles against the
 * wizard's answers. Returns an error string on failure instead of throwing,
 * matching this app's existing server-action convention.
 */
export async function getWizardRecommendations(
  answers: WizardAnswers
): Promise<{ recommendations: PickerRecommendation[] } | { error: string }> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const mood: MoodNow = {
    pleasant: answers.mood?.pleasant ?? null,
    energy: answers.mood?.energy ?? null,
    emotion: answers.mood?.emotion ?? null,
  };
  const need = answers.need ?? null;
  // Same rules as a saved check-in's "coming in" answers.
  const moodError = validateCheckin({
    ...EMPTY_CHECKIN,
    pleasantBefore: mood.pleasant,
    energyBefore: mood.energy,
    emotionBefore: mood.emotion,
    need,
  });
  if (moodError) return { error: moodError };

  const timezonePref = await getUserTimezonePreference();
  const timezone = timezonePref === "browser" ? DEFAULT_TIMEZONE : timezonePref;

  const now = new Date();
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + answers.windowDays * 24 * 60 * 60 * 1000).toISOString();
  // Look further ahead than asked so there's something to offer when the window is empty.
  const fallbackWindowEnd = new Date(
    now.getTime() + Math.max(answers.windowDays, FALLBACK_WINDOW_DAYS) * 24 * 60 * 60 * 1000
  ).toISOString();
  const historyStart = new Date(now);
  historyStart.setMonth(historyStart.getMonth() - HISTORY_MONTHS);

  const prickleRepo = createRepos(supabase).prickles;
  const toCandidates = (rows: PrickleDetail[]): CandidatePrickle[] =>
    rows.map((p) => ({ id: p.id, type_id: p.typeId, host_id: p.hostId, start_time: p.startTime }));

  const [types, membersResult, candidates, historical, vibesResult, myCheckins] = await Promise.all([
    prickleRepo.types(),
    createRepos(supabase).directory.all().then((rows): PickerHost[] => rows.map((m) => ({ id: m.id, name: getMemberDisplayName(m) }))),
    prickleRepo.startingBetween({ from: windowStart, to: fallbackWindowEnd, inclusiveEnd: true }).then(toCandidates),
    prickleRepo.startingBetween({ from: historyStart.toISOString(), to: windowStart }).then(toCandidates),
    // The vibe column is plain text with a check constraint; HostVibeRow narrows it to the Vibe union.
    fetchAllPaginated<Omit<HostVibeRow, "vibe"> & { vibe: string }>((offset) =>
      supabase
        .from("prickle_host_vibes")
        .select("type_id, host_id, vibe, notes")
        .range(offset, offset + BATCH_SIZE - 1)
    ).then((rows) => rows as HostVibeRow[]),
    fetchMyRatedCheckins(supabase, effectiveIdentity.memberId),
  ]);

  const typesMap = new Map<string, PickerPrickleType>(
    types.map((t) => [t.id, { id: t.id, name: t.name, purpose: t.purpose as PrickleTypePurpose, soloTaskFriendly: t.soloTaskFriendly }])
  );
  const hostsMap = new Map<string, PickerHost>(membersResult.map((m) => [m.id, m]));

  const historicalIds = historical.map((p) => p.id);
  const historicalAttendance = await fetchAttendanceForPrickleIds(supabase, historicalIds);

  const recommendations = computeRecommendations(
    candidates,
    typesMap,
    hostsMap,
    historical,
    historicalAttendance,
    vibesResult,
    {
      windowStart,
      windowEnd,
      fallbackWindowEnd,
      timeOfDay: answers.timeOfDay,
      vibe: answers.vibe,
      purpose: answers.purpose,
      withMemberIds: answers.withMemberIds,
      timezone,
      mood,
      need,
    },
    undefined,
    myCheckins
  );

  return { recommendations };
}

// ---------------------------------------------------------------------------
// Host self-tagging
// ---------------------------------------------------------------------------

export interface HostedVibeInfo {
  typeId: string;
  typeName: string;
  vibe: Vibe;
  notes: string;
}

/**
 * Returns the prickle types the acting member has hosted in the trailing
 * window or signed up to host this month or later, each with their current vibe tag (or the 'balanced' default if
 * they haven't tagged it yet).
 */
export async function getHostedVibes(): Promise<HostedVibeInfo[]> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return [];

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return [];

  const typeNameById = await getHostVibeTypes(supabase, effectiveIdentity.memberId);
  const typeIds = [...typeNameById.keys()];
  if (typeIds.length === 0) return [];

  const { data: vibes } = await supabase
    .from("prickle_host_vibes")
    .select("type_id, vibe, notes")
    .eq("host_id", effectiveIdentity.memberId)
    .in("type_id", typeIds);

  const vibeByTypeId = new Map((vibes ?? []).map((v) => [v.type_id, v]));

  return typeIds
    .map((typeId) => ({
      typeId,
      typeName: typeNameById.get(typeId) ?? "Prickle",
      vibe: (vibeByTypeId.get(typeId)?.vibe ?? "balanced") as Vibe,
      notes: vibeByTypeId.get(typeId)?.notes ?? "",
    }))
    .sort((a, b) => a.typeName.localeCompare(b.typeName));
}

/**
 * Upserts the acting member's own vibe tag for a prickle type they host.
 * Scoped to `effectiveIdentity.memberId` as host_id, so a member can never
 * write another host's row through this action — including while sudo'd,
 * since getEffectiveIdentity already resolves to the sudo'd member's own id.
 */
async function saveHostVibeImpl(
  typeId: string,
  vibe: Vibe,
  notes: string
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const types = await getHostVibeTypes(supabase, effectiveIdentity.memberId);
  if (!types.has(typeId)) {
    return { error: "You can only tag prickle types you host" };
  }

  const { error } = await supabase.from("prickle_host_vibes").upsert(
    {
      type_id: typeId,
      host_id: effectiveIdentity.memberId,
      vibe,
      notes: notes.trim() || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "type_id,host_id" }
  );

  if (error) return { error: error.message };

  revalidatePath("/settings", "layout");
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function saveHostVibe(...args: Parameters<typeof saveHostVibeImpl>): ReturnType<typeof saveHostVibeImpl> {
  return withAction("host_vibe_saved", () => saveHostVibeImpl(...args));
}
