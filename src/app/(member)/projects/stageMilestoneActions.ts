"use server";

import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { clock } from "@/lib/clock";
import { isMilestoneKind, parseMilestoneSelfAdd, type MilestoneAnswerInput } from "@/lib/finishers";
import { STAGE_PROMPT, stageGroupOf } from "@/lib/milestone-prompts";
import { revalidateMilestoneSurfaces } from "@/lib/milestone-revalidate";
import { actionOutcome, withAction } from "@/lib/analytics/server";

type StageAnswerInput = { projectId: string; kind: string; answer: "yes" | "not_yet" | "not_for_this_work" } & Omit<MilestoneAnswerInput, "answer">;

/**
 * A member answers the prompt that follows a project moving to a stage that means a milestone (docs/product/FINISHERS.md, "The
 * project-stage prompt"). "Yes" records it for that project as `project_stage`, already confirmed (their own action), with the
 * optional date, stories and the share tick (off unless ticked) like the milestone form. "Not yet" is a snooze: we remember
 * the stage group the project is in and ask again once it reaches a later one (never a milestone, never counted as declined).
 * "Not for this work" records a declined row, which is how we remember never to ask again. Either way, when the project already
 * has a milestone of that kind nothing is written. Never in
 * sudo: an admin viewing as the member can look, and the database refuses the write too.
 */
async function answerStageMilestoneImpl(input: StageAnswerInput): Promise<{ success: true; saved: boolean } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "We couldn't find your member record." };
  if (identity.isSudo) return { error: "Only the member can answer this." };
  if (!input.projectId) return { error: STAGE_PROMPT.notFound };
  if (!isMilestoneKind(input.kind)) return { error: "Choose which milestone this is." };
  const kind = input.kind;

  const parsed = input.answer === "yes" ? parseMilestoneSelfAdd({ ...input, kind }, clock.now()) : null;
  if (parsed && "error" in parsed) return { error: parsed.error };

  try {
    const repos = createRepos(await createClient());
    if (!(await repos.writing.ownsProject(identity.memberId, input.projectId))) return { error: STAGE_PROMPT.notFound };
    const now = new Date(clock.now());
    const work = { projectId: input.projectId, bookId: null, title: null };
    let saved: boolean;
    if (parsed) {
      const { result } = await repos.milestones.addOwn({ memberId: identity.memberId, kind, answer: parsed.answer, work, createdBy: user.id, source: "project_stage" }, now);
      saved = result === "added";
    } else if (input.answer === "not_for_this_work") {
      saved = (await repos.milestones.recordNotForThisWork({ memberId: identity.memberId, kind, projectId: input.projectId, createdBy: user.id }, now)) === "recorded";
    } else {
      // The stage group the project is in now: the prompt comes back only at a later one.
      const phase = (await repos.writing.projectSummary(identity.memberId, input.projectId))?.phase ?? null;
      saved = (await repos.milestones.snooze({ memberId: identity.memberId, kind, projectId: input.projectId, stageGroup: stageGroupOf(phase) }, now)) === "snoozed";
    }
    await revalidateMilestoneSurfaces(repos, identity.memberId);
    return { success: true, saved };
  } catch (error) {
    console.error("milestones.stageAnswer failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't save that. Please try again in a moment." };
  }
}

// Usage analytics: each action records whether it worked, and what the member said (a fixed word, never anything they wrote).
export async function answerStageMilestone(...args: Parameters<typeof answerStageMilestoneImpl>) {
  return withAction("milestone_stage_answered", () => answerStageMilestoneImpl(...args), (result) => ({
    ...actionOutcome(result),
    detail: "success" in result ? (!result.saved ? "already_there" : args[0].answer === "yes" ? "confirmed" : args[0].answer === "not_for_this_work" ? "not_for_this_work" : "not_yet") : undefined,
  }));
}
