"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { UNHOSTED_LIST_LIMIT } from "@/lib/missing-hosts";
import { triggerPrickleTypeReprocessing } from "@/lib/processing/trigger";
import { isId } from "@/lib/ids";
import { saveEventDecision } from "@/lib/prickle-event-decisions";

const PAGE = "/admin/data-health/missing-hosts";

export type UnhostedPrickle = { id: string; title: string | null; startTime: string; endTime: string; typeName: string };

/** Flip whether a prickle type needs a host. */
export async function setRequiresHost(typeId: string, requiresHost: boolean): Promise<{ error?: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  try {
    await createRepos(auth.supabase).prickles.updateType(typeId, { requiresHost });
  } catch (error) {
    console.error("Error updating prickle type:", error);
    return { error: (error as Error).message };
  }
  revalidatePath(PAGE);
  return {};
}

export type DefaultHostChoice = { typeId: string; memberId: string | null };

/**
 * Set (or clear, with null) the default host of several prickle types, then rebuild the calendar prickles once so
 * each type's existing hostless prickles take it. Saving everything before one rebuild is what keeps a batch of
 * choices from running the (slow) rebuild per type.
 */
export async function setDefaultHosts(choices: DefaultHostChoice[]): Promise<{ error?: string; saved?: number }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (choices.length === 0) return { saved: 0 };
  if (choices.some((c) => c.memberId !== null && !isId(c.memberId, "mbr"))) return { error: "Pick a member" };

  const prickles = createRepos(auth.supabase).prickles;
  const results = await Promise.allSettled(choices.map((c) => prickles.updateType(c.typeId, { defaultHostId: c.memberId })));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) {
    console.error("Error setting default host:", failed.reason);
    revalidatePath(PAGE);
    return { error: (failed.reason as Error).message };
  }

  const { processed } = await triggerPrickleTypeReprocessing();
  revalidatePath(PAGE);
  const calendar = processed.find((p) => p.table === "calendar");
  if (calendar && !calendar.success) return { error: `Saved, but rebuilding the calendar prickles failed: ${calendar.error}`, saved: choices.length };
  return { saved: choices.length };
}

/** The newest calendar prickles of a type that have no host (the detail view of one row). */
export async function getUnhostedPrickles(typeId: string): Promise<{ error: string } | { prickles: UnhostedPrickle[] }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  try {
    const found = await createRepos(auth.supabase).prickles.hostlessCalendarOfType(typeId, UNHOSTED_LIST_LIMIT);
    return { prickles: found.map((p) => ({ id: p.id, title: p.title, startTime: p.startTime, endTime: p.endTime, typeName: p.type?.name ?? "Prickle" })) };
  } catch (err) {
    console.error("Error loading unhosted prickles:", err);
    return { error: (err as Error).message };
  }
}

const ASSIGN_ROUND = 200;
const ASSIGN_PARALLEL = 10;

/**
 * Credits one member as the host of every calendar prickle of a type that has none, the way "Change host"
 * does on a single prickle (the event's decision first, so a reprocess keeps it, then the prickle). For a
 * type nobody hosts any more, where the past ones should still say who did. Any member will do, a former
 * one included, since this is a record of who hosted.
 */
export async function assignHostToUnhostedPrickles(typeId: string, memberId: string): Promise<{ error?: string; assigned?: number }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };
  if (!isId(memberId, "mbr")) return { error: "Pick a member" };

  const repos = createRepos(auth.supabase);
  if (!(await repos.members.byId(memberId))) return { error: "Member not found" };

  let assigned = 0;
  // Each round takes the prickles that still have no host, so it ends when none are left.
  for (let rounds = 0; rounds < 50; rounds++) {
    const round = await repos.prickles.hostlessCalendarOfType(typeId, ASSIGN_ROUND);
    if (round.length === 0) break;
    for (let i = 0; i < round.length; i += ASSIGN_PARALLEL) {
      const results = await Promise.all(
        round.slice(i, i + ASSIGN_PARALLEL).map(async (p) => {
          if (!p.calendarEventId) return { error: "A prickle has no calendar event" };
          const failed = await saveEventDecision(auth.supabase, p.calendarEventId, { resolved_host_id: memberId });
          if (failed) return failed;
          await repos.prickles.setHost(p.id, memberId);
          return null;
        })
      );
      assigned += results.filter((r) => r === null).length;
      const failure = results.find((r) => r !== null);
      if (failure) {
        revalidatePath(PAGE);
        return { error: `${failure.error}. Assigned ${assigned} before it stopped.`, assigned };
      }
    }
  }

  revalidatePath(PAGE);
  return { assigned };
}
