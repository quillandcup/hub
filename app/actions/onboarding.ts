"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { allOnboardingKeys, isOnboardingMarkKey, type OnboardingState } from "@/lib/onboarding";
import { getOnboardingState } from "@/lib/onboarding.server";

import { withAction } from "@/lib/analytics/server";
type Result = { success: true } | { error: string };

/**
 * The signed-in member, or an error. Refuses during sudo: the tour is the member's own, and an
 * admin browsing as them shouldn't start, skip or close it for them.
 */
async function requireOwnMember() {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in" } as const;
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { ok: false, error: "No member record" } as const;
  if (identity.isSudo) return { ok: false, error: "The tour can't be changed while browsing as a member" } as const;
  return { ok: true, supabase: await createClient(), memberId: identity.memberId } as const;
}

async function save(fields: Record<string, unknown>, label: string): Promise<Result> {
  const ctx = await requireOwnMember();
  if (!ctx.ok) return { error: ctx.error };
  const { error } = await ctx.supabase
    .from("member_onboarding")
    .upsert({ member_id: ctx.memberId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
  if (error) {
    console.error(`${label}: upsert failed`, { memberId: ctx.memberId, error });
    return { error: "Couldn't save that — please try again." };
  }
  revalidatePath("/", "layout");
  return { success: true };
}

/**
 * Fresh tour state for the guide. The member layout passes the first state in, but layouts don't
 * re-render on client navigation, so the guide asks again as the member moves page to page.
 * Null during sudo or without a member record.
 */
export async function getMyOnboardingState(): Promise<OnboardingState | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const identity = await getEffectiveIdentity(user);
  if (!identity || identity.isSudo) return null;
  return getOnboardingState(identity.memberId);
}

/** Start (or restart) the tour from the first step not yet done in the member's data. */
async function startOnboardingImpl(): Promise<Result> {
  return save({ marked_steps: [], dismissed_at: null, completed_at: null, acknowledged_steps: null }, "startOnboarding");
}

/** Close the tour for good; the user menu can start it again. */
async function dismissOnboardingImpl(): Promise<Result> {
  return save({ dismissed_at: new Date().toISOString() }, "dismissOnboarding");
}

/** Close the tour once every step is done. */
async function completeOnboardingImpl(): Promise<Result> {
  return save({ completed_at: new Date().toISOString(), acknowledged_steps: allOnboardingKeys() }, "completeOnboarding");
}

/** Count a step as done without data to show it: confirmed ("my names look right") or skipped. */
async function markOnboardingStepImpl(stepId: string): Promise<Result> {
  if (!isOnboardingMarkKey(stepId)) return { error: "Unknown step" };
  const ctx = await requireOwnMember();
  if (!ctx.ok) return { error: ctx.error };

  const { data: existing } = await ctx.supabase
    .from("member_onboarding")
    .select("marked_steps")
    .eq("member_id", ctx.memberId)
    .maybeSingle();
  const marked = new Set<string>(existing?.marked_steps ?? []);
  marked.add(stepId);
  return save({ marked_steps: [...marked] }, "markOnboardingStep");
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function startOnboarding(...args: Parameters<typeof startOnboardingImpl>): ReturnType<typeof startOnboardingImpl> {
  return withAction("onboarding_started", () => startOnboardingImpl(...args));
}

export async function dismissOnboarding(...args: Parameters<typeof dismissOnboardingImpl>): ReturnType<typeof dismissOnboardingImpl> {
  return withAction("onboarding_dismissed", () => dismissOnboardingImpl(...args));
}

export async function completeOnboarding(...args: Parameters<typeof completeOnboardingImpl>): ReturnType<typeof completeOnboardingImpl> {
  return withAction("onboarding_completed", () => completeOnboardingImpl(...args));
}

export async function markOnboardingStep(...args: Parameters<typeof markOnboardingStepImpl>): ReturnType<typeof markOnboardingStepImpl> {
  return withAction("onboarding_step_marked", () => markOnboardingStepImpl(...args));
}
