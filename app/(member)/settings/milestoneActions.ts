"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { clock } from "@/lib/clock";
import { parseMilestoneAnswer, type MilestoneAnswerInput } from "@/lib/finishers";
import { actionOutcome, withAction } from "@/lib/analytics/server";

/**
 * A member answers a milestone staff or a course proposed (docs/FINISHERS.md): "yes, this is me" with an optional date,
 * stories and one tick per use (all off unless ticked), or "not me / not yet". Only the member answers for themselves:
 * an admin viewing as them (sudo) can look, and the database refuses the write too.
 */
async function answerMilestoneImpl(input: { id: string } & MilestoneAnswerInput): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "We couldn't find your member record." };
  if (identity.isSudo) return { error: "Only the member can answer this." };
  if (!input.id) return { error: "We couldn't find that milestone." };

  const answer = parseMilestoneAnswer(input, clock.now());
  if ("error" in answer) return { error: answer.error };

  try {
    const saved = await createRepos(await createClient()).milestones.answer(input.id, identity.memberId, answer, new Date(clock.now()));
    if (!saved) return { error: "We couldn't find that milestone. It may have been taken back." };
  } catch (error) {
    console.error("milestones.answer failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't save that. Please try again in a moment." };
  }
  revalidatePath("/settings/profile");
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function answerMilestone(...args: Parameters<typeof answerMilestoneImpl>) {
  return withAction("milestone_answered", () => answerMilestoneImpl(...args), (result) => ({
    ...actionOutcome(result),
    detail: args[0].answer === "decline" ? "declined" : "confirmed",
  }));
}
