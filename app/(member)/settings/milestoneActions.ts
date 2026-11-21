"use server";

import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { clock } from "@/lib/clock";
import { hasStory, parseMilestoneAnswer, parseMilestoneSelfAdd, type MilestoneAnswerInput } from "@/lib/finishers";
import { parseWork } from "@/lib/finishers-works";
import { isVisibility } from "@/lib/writing-visibility";
import { WRITER_PROFILES_NOT_AVAILABLE, memberHasWriterProfiles } from "@/lib/writer-profiles-access";
import { revalidateMilestoneSurfaces } from "@/lib/milestone-revalidate";
import { actionOutcome, withAction } from "@/lib/analytics/server";

/**
 * A member answers a milestone staff or a course proposed (docs/product/FINISHERS.md): "yes, this is me" with an optional date,
 * stories and the share tick (off unless ticked), or "not me / not yet". Confirming starts it at "other members can see it". Only the member answers for themselves:
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
    const repos = createRepos(await createClient());
    const saved = await repos.milestones.answer(input.id, identity.memberId, answer, new Date(clock.now()));
    if (!saved) return { error: "We couldn't find that milestone. It may have been taken back." };
    await revalidateMilestoneSurfaces(repos, identity.memberId);
  } catch (error) {
    console.error("milestones.answer failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't save that. Please try again in a moment." };
  }
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
 * (docs/product/FINISHERS.md), with the optional date, stories and the share tick (off unless ticked), at "other members can see it", for
 * one of their own projects or books or a title. When they already have one of that kind it is returned instead of an error. Never in sudo:
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
    await revalidateMilestoneSurfaces(repos, identity.memberId);
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
    const repos = createRepos(await createClient());
    const done = await repos.milestones.takeBack(id, identity.memberId, new Date(clock.now()));
    if (!done) return { error: "We couldn't find that milestone. It may already be taken back." };
    await revalidateMilestoneSurfaces(repos, identity.memberId);
  } catch (error) {
    console.error("milestones.takeBack failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't take that back. Please try again in a moment." };
  }
  return { success: true };
}

export async function takeBackMilestone(...args: Parameters<typeof takeBackMilestoneImpl>) {
  return withAction("milestone_taken_back", () => takeBackMilestoneImpl(...args));
}

/**
 * A member sets who can see one of their confirmed milestones, and the story with it: only them, other members, or the web
 * (the globe, which needs the `writer_profiles` flag, as every other item on the profile). Never in sudo (an admin viewing as
 * the member can look, and the database refuses the write too), and a proposal has no level: it is private until the member
 * confirms. The change is an audit row as the member (the trigger; never the story), and an Activity Log sentence.
 */
async function setMilestoneVisibilityImpl(id: string, level: string): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "We couldn't find your member record." };
  if (identity.isSudo) return { error: "Only you can change who sees this." };
  if (!id) return { error: "We couldn't find that milestone." };
  if (!isVisibility(level)) return { error: "That choice is not available." };

  try {
    if (level === "public" && !(await memberHasWriterProfiles(getServiceRepos(), identity.memberId))) return { error: WRITER_PROFILES_NOT_AVAILABLE };
    const repos = createRepos(await createClient());
    const saved = await repos.milestones.setVisibility(id, identity.memberId, level, new Date(clock.now()));
    if (!saved) return { error: "We couldn't find that milestone. It may have been taken back, or you haven't confirmed it yet." };
    await revalidateMilestoneSurfaces(repos, identity.memberId);
  } catch (error) {
    console.error("milestones.setVisibility failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't save that. Please try again in a moment." };
  }
  return { success: true };
}

// Usage analytics: whether it worked, and the level chosen (a fixed word, never anything the member wrote).
export async function setMilestoneVisibility(...args: Parameters<typeof setMilestoneVisibilityImpl>) {
  return withAction("milestone_visibility_set", () => setMilestoneVisibilityImpl(...args), (result) => ({
    ...actionOutcome(result),
    detail: isVisibility(args[1]) ? args[1] : undefined,
  }));
}

/**
 * A member ticks or unticks "Share my story to inspire other writers" on a confirmed milestone, after the first save. Ticking
 * needs a story to share. Unticking is neutral and takes effect on the next read of the pages that use it. Never in sudo.
 */
async function setMilestoneShareImpl(id: string, share: boolean): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "We couldn't find your member record." };
  if (identity.isSudo) return { error: "Only the member can change this." };
  if (!id) return { error: "We couldn't find that milestone." };

  try {
    const repos = createRepos(await createClient());
    if (share) {
      const mine = (await repos.milestones.ofMember(identity.memberId)).find((m) => m.id === id);
      if (mine && !hasStory(mine)) return { error: "Write a story first, and then you can share it." };
    }
    const saved = await repos.milestones.setShareStory(id, identity.memberId, share === true, new Date(clock.now()));
    if (!saved) return { error: "We couldn't find that milestone. It may have been taken back, or you haven't confirmed it yet." };
    await revalidateMilestoneSurfaces(repos, identity.memberId);
  } catch (error) {
    console.error("milestones.setShareStory failed", error instanceof Error ? error.message : String(error));
    return { error: "We couldn't save that. Please try again in a moment." };
  }
  return { success: true };
}

export async function setMilestoneShare(...args: Parameters<typeof setMilestoneShareImpl>) {
  return withAction("milestone_share_set", () => setMilestoneShareImpl(...args), (result) => ({
    ...actionOutcome(result),
    detail: args[1] ? "shared" : "withdrawn",
  }));
}
