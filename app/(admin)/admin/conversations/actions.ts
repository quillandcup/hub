"use server";

import { revalidatePath } from "next/cache";
import { requireStaffAction } from "@/lib/admin-auth";
import { withAction } from "@/lib/analytics/server";
import { clock } from "@/lib/clock";
import {
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_NEXT_STEP_MAX,
  CONVERSATION_NOTES_MAX,
  CONVERSATION_OUTCOME_LABELS,
  CONVERSATION_REASON_LABELS,
  isConversationChannel,
  isConversationId,
  isConversationOutcome,
  isConversationReason,
  isMessageDirection,
  type ConversationChannel,
  type ConversationOutcome,
  type ConversationReason,
  type MessageDirection,
} from "@/lib/conversations";
import type { ConversationPatch, ConversationRow } from "@/lib/data/conversations";
import { createRepos, type Repos } from "@/lib/data/repos";
import { isId } from "@/lib/ids";
import { memberSearchItem } from "@/lib/member-search-item";
import { staffCan } from "@/lib/staff-access";

/**
 * Server actions for the Conversations page (docs/CONVERSATIONS.md). Staff, not admin-only: the community manager
 * writes here, so each action starts with requireStaffAction() and then asks for the `conversations.write` feature
 * (lib/staff-access.ts). They run as the signed-in user, so row-level security is the second check.
 */

export type ConversationActionResult = { error: string } | { success: true };

const NOT_AUTHORIZED = "Not authorized";
const MISSING = "That conversation is gone.";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const nowIso = () => new Date(clock.now()).toISOString();

/** Trimmed text, or null when empty; an error string when it is over the limit. */
function text(value: unknown, max: number, what: string): { value: string | null } | { error: string } {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: `Check the ${what}.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `The ${what} can be at most ${max} characters.` };
  return { value: trimmed === "" ? null : trimmed };
}

/** A plain day (YYYY-MM-DD), null for none; an error string when it is not a real day. */
function day(value: unknown): { value: string | null } | { error: string } {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string" || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    return { error: "Pick a real day for the follow-up." };
  }
  return { value };
}

function reasonLabel(reason: string, channel: string): string {
  return `${CONVERSATION_REASON_LABELS[reason as ConversationReason] ?? reason} · ${CONVERSATION_CHANNEL_LABELS[channel as ConversationChannel] ?? channel}`;
}

/**
 * The member's timeline row for a conversation opening or closing (like an outreach touch). Best effort, log and
 * continue: the conversation is the record. Nothing the staff member wrote goes in it.
 */
async function mirrorToTimeline(repos: Repos, userId: string, row: ConversationRow, kind: "opened" | "closed") {
  const closed = kind === "closed";
  await repos.activities
    .record({
      memberId: row.member_id,
      type: closed ? "conversation_closed" : "conversation_opened",
      category: "communication",
      title: closed ? "Conversation closed" : "Conversation opened",
      description: closed
        ? `${reasonLabel(row.reason, row.channel)}: ${CONVERSATION_OUTCOME_LABELS[row.outcome as ConversationOutcome] ?? row.outcome}`
        : reasonLabel(row.reason, row.channel),
      actorKind: "staff",
      actorUserId: userId,
      engagementValue: 0, // our action, not the member's engagement
      occurredAt: (closed ? row.closed_at : row.opened_at) ?? nowIso(),
      source: "conversations",
      relatedId: row.id,
    })
    .catch((error) => console.error("Error mirroring a conversation to member_activities:", error instanceof Error ? error.message : error));
}

export type StartConversationInput = {
  memberId: string;
  reason: string;
  channel: string;
  /** The member wrote first (they messaged her), rather than her reaching out. */
  memberWroteFirst?: boolean;
  notes?: string | null;
  nextStep?: string | null;
  followUpOn?: string | null;
};

async function startImpl(repos: Repos, userId: string, input: StartConversationInput): Promise<ConversationActionResult> {
  if (!isId(input.memberId, "mbr")) return { error: "Pick a member." };
  if (!isConversationReason(input.reason)) return { error: "Pick why you are reaching out." };
  if (!isConversationChannel(input.channel)) return { error: "Pick where the conversation is." };
  const notes = text(input.notes, CONVERSATION_NOTES_MAX, "note");
  if ("error" in notes) return notes;
  const nextStep = text(input.nextStep, CONVERSATION_NEXT_STEP_MAX, "next step");
  if ("error" in nextStep) return nextStep;
  const followUpOn = day(input.followUpOn);
  if ("error" in followUpOn) return followUpOn;

  let result;
  try {
    result = await repos.conversations.open({
      memberId: input.memberId,
      reason: input.reason,
      channel: input.channel,
      openedBy: userId,
      openedAt: nowIso(),
      firstMessageFrom: input.memberWroteFirst ? "member" : "staff",
      notes: notes.value,
      nextStep: nextStep.value,
      followUpOn: followUpOn.value,
    });
  } catch (error) {
    console.error("[conversations] open failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't start the conversation." };
  }
  if (!result.ok) return { error: "There is already an open conversation with them on that channel. Log a message there instead." };

  await mirrorToTimeline(repos, userId, result.conversation, "opened");
  revalidatePath("/admin/conversations");
  return { success: true };
}

async function logMessageImpl(repos: Repos, id: string, direction: string): Promise<ConversationActionResult> {
  if (!isConversationId(id) || !isMessageDirection(direction)) return { error: MISSING };
  try {
    if (!(await repos.conversations.logMessage(id, direction as MessageDirection, nowIso()))) return { error: "That conversation is closed or gone." };
  } catch (error) {
    console.error("[conversations] log message failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save that." };
  }
  revalidatePath("/admin/conversations");
  return { success: true };
}

export type UpdateConversationInput = { reason?: string; notes?: string | null; nextStep?: string | null; followUpOn?: string | null };

async function updateImpl(repos: Repos, id: string, input: UpdateConversationInput): Promise<ConversationActionResult> {
  if (!isConversationId(id)) return { error: MISSING };
  const patch: ConversationPatch = {};
  if (input.reason !== undefined) {
    if (!isConversationReason(input.reason)) return { error: "Pick why you are reaching out." };
    patch.reason = input.reason;
  }
  if (input.notes !== undefined) {
    const notes = text(input.notes, CONVERSATION_NOTES_MAX, "note");
    if ("error" in notes) return notes;
    patch.notes = notes.value;
  }
  if (input.nextStep !== undefined) {
    const nextStep = text(input.nextStep, CONVERSATION_NEXT_STEP_MAX, "next step");
    if ("error" in nextStep) return nextStep;
    patch.nextStep = nextStep.value;
  }
  if (input.followUpOn !== undefined) {
    const followUpOn = day(input.followUpOn);
    if ("error" in followUpOn) return followUpOn;
    patch.followUpOn = followUpOn.value;
  }
  try {
    if (!(await repos.conversations.update(id, patch))) return { error: MISSING };
  } catch (error) {
    console.error("[conversations] update failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't save the change." };
  }
  revalidatePath("/admin/conversations");
  return { success: true };
}

async function closeImpl(repos: Repos, userId: string, id: string, outcome: string): Promise<ConversationActionResult> {
  if (!isConversationId(id)) return { error: MISSING };
  if (!isConversationOutcome(outcome)) return { error: "Pick how it ended." };
  let closed;
  try {
    closed = await repos.conversations.close(id, outcome, nowIso());
  } catch (error) {
    console.error("[conversations] close failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't close the conversation." };
  }
  if (!closed) return { error: "That conversation is already closed or gone." };

  await mirrorToTimeline(repos, userId, closed, "closed");
  revalidatePath("/admin/conversations");
  return { success: true };
}

async function deleteImpl(repos: Repos, id: string): Promise<ConversationActionResult> {
  if (!isConversationId(id)) return { error: MISSING };
  try {
    if (!(await repos.conversations.softDelete(id, nowIso()))) return { error: MISSING };
  } catch (error) {
    console.error("[conversations] delete failed:", error instanceof Error ? error.message : error);
    return { error: "Couldn't remove the conversation." };
  }
  revalidatePath("/admin/conversations");
  return { success: true };
}

/** Finds members by name or email for the "start a conversation" picker. Staff with the write feature only. */
export async function searchConversationMembers(query: string) {
  const auth = await requireStaffAction();
  if (!auth.ok || !staffCan(auth.role, "conversations.write")) return [];
  const words = String(query).trim().slice(0, 60).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const found = await createRepos(auth.supabase).members.search({ words, limit: 10 });
  return found.map((m) => memberSearchItem(m));
}

/** Starts a conversation with a member (she reached out, or they wrote to her). One open conversation per member and channel. */
export async function startConversation(input: StartConversationInput): Promise<ConversationActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "conversations.write")) return { error: NOT_AUTHORIZED };
  return withAction("conversation_started", () => startImpl(createRepos(auth.supabase), auth.user.id, input), (r) => ({ ok: "success" in r }));
}

/** Logs that the member replied (`member`) or that she did (`staff`), just now. */
export async function logConversationMessage(id: string, direction: string): Promise<ConversationActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "conversations.write")) return { error: NOT_AUTHORIZED };
  return withAction("conversation_message_logged", () => logMessageImpl(createRepos(auth.supabase), id, direction), (r) => ({ ok: "success" in r }));
}

/** Changes a conversation's reason, notes, next step or follow-up day. */
export async function updateConversation(id: string, input: UpdateConversationInput): Promise<ConversationActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "conversations.write")) return { error: NOT_AUTHORIZED };
  return withAction("conversation_updated", () => updateImpl(createRepos(auth.supabase), id, input), (r) => ({ ok: "success" in r }));
}

/** Closes a conversation with how it ended. */
export async function closeConversation(id: string, outcome: string): Promise<ConversationActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "conversations.write")) return { error: NOT_AUTHORIZED };
  return withAction("conversation_closed", () => closeImpl(createRepos(auth.supabase), auth.user.id, id, outcome), (r) => ({ ok: "success" in r }));
}

/** Removes a conversation from the list (kept in the database, hidden everywhere). */
export async function deleteConversation(id: string): Promise<ConversationActionResult> {
  const auth = await requireStaffAction();
  if (!auth.ok) return { error: auth.error };
  if (!staffCan(auth.role, "conversations.write")) return { error: NOT_AUTHORIZED };
  return withAction("conversation_deleted", () => deleteImpl(createRepos(auth.supabase), id), (r) => ({ ok: "success" in r }));
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
