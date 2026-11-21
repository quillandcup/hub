/**
 * Hand-overs need both sides (docs/product/HEDGIE_CARE.md, "Owners"; .claude/rules/hand-overs.md, "Hand-overs need both sides"): what the signed-in staff
 * user may do with a care plan's hand-over, for the page to show or hide a control. Pure. It mirrors what the database allows
 * (`propose_care_handover` and its siblings) and only decides what is offered: the database is the check.
 */
import type { HandoverRefusal } from "@/lib/data/care";

/** The part of a care plan this reads. */
export type HandoverPlan = { owned_by: string | null; handover_to: string | null; handover_by: string | null; closed_at: string | null };

/** The signed-in staff user; `isAdmin` is the role they act as (an admin may act for an owner who is gone or unreachable). */
export type HandoverViewer = { userId: string; isAdmin: boolean };

export type HandoverControls = {
  /** An offer is waiting for the receiver to answer. The plan keeps its owner meanwhile. */
  pending: boolean;
  /** The offer is to this viewer: they can accept or decline it. */
  offeredToMe: boolean;
  /** They may offer this plan to someone: its owner, or an admin, when nothing is pending. */
  canPropose: boolean;
  /** They may take the offer back: whoever made it, the owner, or an admin. */
  canCancel: boolean;
  /** The plan has no owner (its owner's account was removed): any staff member who may own plans can take it. */
  canClaim: boolean;
  /**
   * An admin may take an open plan from its owner without their agreement (the one exception to hand-overs needing both sides:
   * for an owner who is unreachable, or when an admin has to step in; the previous owner is told on their page). Not for a closed
   * plan, which keeps its owner, nor for a plan that is already theirs. Nobody else: a community manager needs the receiver's agreement.
   */
  canTakeOver: boolean;
};

export function handoverControls(plan: HandoverPlan, viewer: HandoverViewer): HandoverControls {
  const pending = plan.handover_to !== null;
  const isOwner = plan.owned_by === viewer.userId;
  return {
    pending,
    offeredToMe: pending && plan.handover_to === viewer.userId,
    canPropose: !pending && (isOwner || viewer.isAdmin),
    canCancel: pending && (viewer.userId === plan.handover_by || isOwner || viewer.isAdmin),
    canClaim: plan.owned_by === null,
    canTakeOver: viewer.isAdmin && plan.owned_by !== null && !isOwner && plan.closed_at === null,
  };
}

/** What each refusal says, in the page's voice (the action returns it as the error). */
export const HANDOVER_REFUSAL_MESSAGES: Record<HandoverRefusal, string> = {
  not_found: "That care plan is gone.",
  not_allowed: "Only the owner, or an admin, can do that.",
  receiver_not_allowed: "Pick someone on the team who looks after care plans.",
  same_owner: "They already own this care plan.",
  self: "Pick someone else. They will be asked to accept it.",
  already_pending: "A hand-over is already waiting for an answer.",
  no_handover: "That hand-over is no longer waiting. Refresh the list.",
  has_owner: "Someone owns this care plan now. Refresh the list.",
  already_yours: "You already own this care plan.",
  plan_closed: "That care plan is closed, so it stays with its owner.",
  no_notice: "That notice is already gone.",
};
