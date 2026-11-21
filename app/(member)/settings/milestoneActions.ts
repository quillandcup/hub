"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { clock } from "@/lib/clock";
import { parseMilestoneAnswer, parseMilestoneSelfAdd, type MilestoneAnswerInput } from "@/lib/finishers";
import { parseWork } from "@/lib/finishers-works";
import { actionOutcome, withAction } from "@/lib/analytics/server";

/**
 * A member answers a milestone staff or a course proposed (docs/product/FINISHERS.md): "yes, this is me" with an optional date,
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

type AddInput = { kind: string; projectId?: string | null; bookId?: string | null; title?: string | null } & Omit<MilestoneAnswerInput, "answer">;

/**
 * A member adds a milestone themselves ("I wrote THE END") without waiting for staff: one step, already confirmed
 * (docs/product/FINISHERS.md), with the optional date, stories and the ticks they chose (all off unless ticked), and optionally
 * one of their own projects. When they already have one of that kind it is returned instead of an error. Never in sudo:
 * an admin viewing as the member can look, and the database refuses the write too.
 */
async function addMilestoneImpl(input: AddInput): Promise<{ success: true; added: boolean } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "We couldn't find your member record." };
  if (identity.isSudo) return { error: "Only the member can add this." };

  const parsed = parseMilestoneSelfAdd(input, clock.now());
  if ("error" in parsed) return { error: parsed.error };

  try {
    const repos = createRepos(await createClient());
    const named = parseWork(input);
    if ("error" in named) return { error: named.error };
    let work = named;
    if (work.projectId !== null && !(await repos.writing.ownsProject(identity.memberId, work.projectId))) return { error: "We couldn't find that project." };
    if (work.bookId !== null) {
      // A book and its project are one work: take the project from the book, and refuse a project that is not its own.
      const book = (await repos.books.mine(identity.memberId)).find((b) => b.id === work.bookId);
      if (!book) return { error: "We couldn't find that book." };
      if (work.projectId !== null && book.project_id !== work.projectId) return { error: "That book belongs to a different project." };
      work = { projectId: book.project_id ?? null, bookId: book.id, title: null };
    }
    const { result } = await repos.milestones.addOwn({ memberId: identity.memberId, kind: parsed.kind, answer: parsed.answer, work, createdBy: user.id }, new Date(clock.now()));
    revalidatePath("/settings/profile");
    return { success: true, added: result === "added" };
  } catch (error) {
    console.error("milestones.addOwn failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't save that. Please try again in a moment." };
  }
}

export async function addMilestone(...args: Parameters<typeof addMilestoneImpl>) {
  return withAction("milestone_added", () => addMilestoneImpl(...args), (result) => ({
    ...actionOutcome(result),
    detail: "success" in result ? (result.added ? "added" : "already_there") : undefined,
  }));
}

/** A member takes back a milestone they added themselves (it is a soft delete; they can add it again). Never in sudo. */
async function takeBackMilestoneImpl(id: string): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "We couldn't find your member record." };
  if (identity.isSudo) return { error: "Only the member can take this back." };
  if (!id) return { error: "We couldn't find that milestone." };

  try {
    const done = await createRepos(await createClient()).milestones.takeBack(id, identity.memberId, new Date(clock.now()));
    if (!done) return { error: "We couldn't find that milestone. It may already be taken back." };
  } catch (error) {
    console.error("milestones.takeBack failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't take that back. Please try again in a moment." };
  }
  revalidatePath("/settings/profile");
  return { success: true };
}

export async function takeBackMilestone(...args: Parameters<typeof takeBackMilestoneImpl>) {
  return withAction("milestone_taken_back", () => takeBackMilestoneImpl(...args));
}
