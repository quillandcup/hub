"use server";

import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserTimezonePreference } from "@/lib/timezone";
import { revalidatePath } from "next/cache";
import {
  getPrickleRecommendations as computeRecommendations,
  type CandidatePrickle,
  type HistoricalAttendanceRow,
  type HostVibeRow,
  type PickerHost,
  type PickerPrickleType,
  type PickerRecommendation,
  type PurposePreference,
  type TimeOfDay,
  type Vibe,
  type VibePreference,
} from "@/lib/prickle-picker";

const BATCH_SIZE = 1000;
const HISTORY_MONTHS = 6;
const DEFAULT_TIMEZONE = "America/New_York";

export interface WizardAnswers {
  /** How many days out from now to look for candidates. */
  windowDays: number;
  timeOfDay: TimeOfDay;
  vibe: VibePreference;
  purpose: PurposePreference;
  withMemberIds: string[];
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
  if (prickleIds.length === 0) return [];

  const CHUNK = 500;
  const rows: HistoricalAttendanceRow[] = [];

  for (let i = 0; i < prickleIds.length; i += CHUNK) {
    const idsChunk = prickleIds.slice(i, i + CHUNK);
    const chunkRows = await fetchAllPaginated<HistoricalAttendanceRow>((offset) =>
      supabase
        .from("prickle_attendance")
        .select("prickle_id, member_id")
        .in("prickle_id", idsChunk)
        .range(offset, offset + BATCH_SIZE - 1)
    );
    rows.push(...chunkRows);
  }

  return rows;
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const timezonePref = await getUserTimezonePreference();
  const timezone = timezonePref === "browser" ? DEFAULT_TIMEZONE : timezonePref;

  const now = new Date();
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + answers.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const historyStart = new Date(now);
  historyStart.setMonth(historyStart.getMonth() - HISTORY_MONTHS);

  const [typesResult, membersResult, candidates, historical, vibesResult] = await Promise.all([
    supabase.from("prickle_types").select("id, name, purpose, solo_task_friendly"),
    fetchAllPaginated<PickerHost>((offset) =>
      supabase.from("members").select("id, name").range(offset, offset + BATCH_SIZE - 1)
    ),
    fetchAllPaginated<CandidatePrickle>((offset) =>
      supabase
        .from("prickles")
        .select("id, type_id, host_id:host, start_time")
        .gte("start_time", windowStart)
        .lte("start_time", windowEnd)
        .order("start_time")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
    fetchAllPaginated<CandidatePrickle>((offset) =>
      supabase
        .from("prickles")
        .select("id, type_id, host_id:host, start_time")
        .gte("start_time", historyStart.toISOString())
        .lt("start_time", windowStart)
        .order("start_time")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
    fetchAllPaginated<HostVibeRow>((offset) =>
      supabase
        .from("prickle_host_vibes")
        .select("type_id, host_id, vibe, notes")
        .range(offset, offset + BATCH_SIZE - 1)
    ),
  ]);

  if (typesResult.error) return { error: typesResult.error.message };

  const typesMap = new Map<string, PickerPrickleType>(
    (typesResult.data ?? []).map((t) => [
      t.id,
      { id: t.id, name: t.name, purpose: t.purpose, soloTaskFriendly: t.solo_task_friendly },
    ])
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
      timeOfDay: answers.timeOfDay,
      vibe: answers.vibe,
      purpose: answers.purpose,
      withMemberIds: answers.withMemberIds,
      timezone,
    }
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
 * window, each with their current vibe tag (or the 'balanced' default if
 * they haven't tagged it yet).
 */
export async function getHostedVibes(): Promise<HostedVibeInfo[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return [];

  const historyStart = new Date();
  historyStart.setMonth(historyStart.getMonth() - HISTORY_MONTHS);

  const { data: hostedPrickles } = await supabase
    .from("prickles")
    .select("type_id, prickle_types(id, name)")
    .eq("host", effectiveIdentity.memberId)
    .gte("start_time", historyStart.toISOString());

  const typeNameById = new Map<string, string>();
  for (const p of hostedPrickles ?? []) {
    if (!p.type_id) continue;
    const type = Array.isArray(p.prickle_types) ? p.prickle_types[0] : p.prickle_types;
    if (type) typeNameById.set(p.type_id, type.name);
  }

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
      vibe: vibeByTypeId.get(typeId)?.vibe ?? "balanced",
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
export async function saveHostVibe(
  typeId: string,
  vibe: Vibe,
  notes: string
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  const { data: hostedPrickle } = await supabase
    .from("prickles")
    .select("id")
    .eq("type_id", typeId)
    .eq("host", effectiveIdentity.memberId)
    .limit(1)
    .maybeSingle();

  if (!hostedPrickle) {
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

  revalidatePath("/settings");
  return { success: true };
}
