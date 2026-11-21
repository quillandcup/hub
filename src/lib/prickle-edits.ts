import type { Db } from "@/lib/data/db";
import { createRepos } from "@/lib/data/repos";
import { loadEventDecision, saveEventDecision, type EventDecisionChoice } from "@/lib/prickle-event-decisions";
import { triggerReprocessing } from "@/lib/processing/trigger";

/** What an admin changed on a calendar prickle; a field left out was not touched, text left empty follows the calendar. */
export interface PrickleEdits {
  typeId?: string;
  hostId?: string;
  title?: string | null;
  description?: string | null;
  guestSpeaker?: string | null;
  location?: string | null;
}

/** The text fields of a calendar-backed event an admin has set by hand; the others follow the calendar. */
export interface EventOverrides {
  title: boolean;
  description: boolean;
  guestSpeaker: boolean;
  location: boolean;
}

export type ApplyPrickleEditsResult = { ok: true } | { ok: false; error: string; status: 400 | 404 | 500 };

/**
 * Saves an admin's edit of a calendar prickle: its type, host, title, description, guest speaker and location. They are
 * kept as the calendar event's decision (see saveEventDecision) because the sync rebuilds every calendar prickle from the
 * calendar and applies the decision on top, so an edit survives reprocessing. Only what really changed is saved, so a
 * form saved untouched sets no override; text emptied goes back to following the calendar, which is reprocessed straight
 * away (the days around the prickle) so the calendar's text is back at once.
 *
 * The one place a calendar prickle is edited: the prickle page (`updatePrickle`) and the event page
 * (`PATCH /api/admin/events/[id]`) both call it, so they can never disagree. The caller checks the admin first.
 */
export async function applyPrickleEdits(supabase: Db, prickleId: string, edits: PrickleEdits): Promise<ApplyPrickleEditsResult> {
  const repos = createRepos(supabase);
  const [prickle, types] = await Promise.all([repos.prickles.byId(prickleId), repos.prickles.types()]);
  if (!prickle) return { ok: false, error: "Prickle not found", status: 404 };
  if (!prickle.calendarEventId) return { ok: false, error: "Only prickles made from a calendar event can be edited here", status: 400 };
  if (edits.typeId !== undefined && !types.some((t) => t.id === edits.typeId)) return { ok: false, error: "Unknown prickle type", status: 400 };
  if (edits.hostId !== undefined && !(await repos.members.byId(edits.hostId))) return { ok: false, error: "Member not found", status: 400 };

  const decision = await loadEventDecision(supabase, prickle.calendarEventId);
  const choice: EventDecisionChoice = {};
  const immediate: { title?: string | null; description?: string | null; guestSpeaker?: string | null; location?: string | null } = {};
  let followsCalendar = false;

  if (edits.typeId !== undefined && edits.typeId !== prickle.typeId) choice.resolved_type_id = edits.typeId;
  if (edits.hostId !== undefined && edits.hostId !== prickle.hostId) choice.resolved_host_id = edits.hostId;

  const texts = [
    ["title", edits.title, prickle.title, decision.resolved_title, "resolved_title"],
    ["description", edits.description, prickle.description, decision.resolved_description, "resolved_description"],
    ["guestSpeaker", edits.guestSpeaker, prickle.guestSpeaker, decision.resolved_guest_speaker, "resolved_guest_speaker"],
    ["location", edits.location, prickle.location ?? null, decision.resolved_location, "resolved_location"],
  ] as const;
  for (const [field, edited, current, overridden, column] of texts) {
    if (edited === undefined) continue;
    const value = edited?.trim() || null;
    if (value === null) {
      if (overridden !== null) {
        choice[column] = null; // follow the calendar again
        followsCalendar = true;
      }
    } else if (value !== (current?.trim() || null)) {
      choice[column] = value;
      immediate[field] = value;
    }
  }

  if (Object.keys(choice).length === 0) return { ok: true };

  const failed = await saveEventDecision(supabase, prickle.calendarEventId, choice);
  if (failed) return { ok: false, error: failed.error, status: 500 };

  if (choice.resolved_type_id) await repos.prickles.setType(prickleId, choice.resolved_type_id);
  if (choice.resolved_host_id) await repos.prickles.setHost(prickleId, choice.resolved_host_id);
  if (Object.keys(immediate).length > 0) await repos.prickles.setText(prickleId, immediate);

  // A new type changes what the calendar title makes of the title and the guest speaker, and text that follows the
  // calendar again has to be taken from it: reprocess the days around this prickle.
  if (choice.resolved_type_id || followsCalendar) {
    const day = 24 * 60 * 60 * 1000;
    await triggerReprocessing("prickle_types", "local", {
      dateRange: { from: new Date(new Date(prickle.startTime).getTime() - day), to: new Date(new Date(prickle.endTime).getTime() + day) },
    });
  }
  return { ok: true };
}
