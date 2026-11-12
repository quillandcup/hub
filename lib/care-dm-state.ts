/**
 * What a row of the Hedgie Care "Your DMs" tab says about the member's care plans, and what the row offers
 * (docs/HEDGIE_CARE.md, "The DMs tab"). Pure: no database, no Slack. A DM is tracked because a care plan of hers exists with
 * that member, so there is no bare "Track": a member with no plan is offered "Start a care plan", which tracks the DM as it
 * starts. The page reads the plans and hands them in; the one rule is here so the tab and its tests cannot disagree.
 */
import { careStatus, isActiveStatus, periodNumber, planOrdinal, type CareSettings, type CareStatus, type CareTimes } from "@/lib/care";
import { careOwnerOf } from "@/lib/care-dm-rules";
import { ownerName, type CareOwner } from "@/lib/care-owners";

/** The part of a care plan this needs: its dates and who spoke last (for the status), the chain it belongs to and who holds it. */
export type CareDmPlan = CareTimes & { id: string; member_id: string; owned_by: string | null; opened_by: string | null; renewed_from: string | null };

/** Which tab of Hedgie Care shows a plan: Active, or Earlier for one that lapsed. */
export type CarePlanTab = "active" | "earlier";

/** A plan as a row of the tab names it: its place in the chain ("first") and where it stands. */
export type CareDmPlanRef = { ordinal: string; status: CareStatus; tab: CarePlanTab };

export type CareDmPlanState =
  /** The member has no care plan, hers or anyone's: the row offers to start one. */
  | { kind: "none" }
  /** She holds the member's open plan. `tracked` is whether the plan reads this DM now (it does unless she stopped it). */
  | ({ kind: "in_plan"; tracked: boolean } & CareDmPlanRef)
  /** The member has only plans that ended: the row offers a new one. The DM stays tracked after a plan closes. */
  | { kind: "earlier_plan" }
  /** Someone else holds the member's open plan; her tracking would not fill it, so there is nothing to track. */
  | ({ kind: "held_by_other"; /** Null when the plan has no owner. */ ownerName: string | null } & CareDmPlanRef);

/** What the tab shows for one DM. `plans` are every plan of this member (open and ended; a removed plan is not one). */
export function careDmPlanState(input: {
  userId: string;
  plans: readonly CareDmPlan[];
  /** Whether she tracks this DM now. */
  tracked: boolean;
  now: Date;
  owners?: readonly CareOwner[];
  settings?: CareSettings;
}): CareDmPlanState {
  const { userId, plans, tracked, now, owners = [], settings } = input;
  if (plans.length === 0) return { kind: "none" };
  const open = plans.find((plan) => plan.closed_at === null);
  if (!open) return { kind: "earlier_plan" };
  const status = careStatus(open, now, settings);
  const ref: CareDmPlanRef = {
    ordinal: planOrdinal(periodNumber(open, new Map(plans.map((plan) => [plan.id, plan])))),
    status,
    tab: isActiveStatus(status) ? "active" : "earlier",
  };
  const owner = careOwnerOf(open);
  if (owner === userId) return { kind: "in_plan", tracked, ...ref };
  return { kind: "held_by_other", ownerName: owner ? ownerName(owner, owners) : null, ...ref };
}
