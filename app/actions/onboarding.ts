"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { isOnboardingMarkKey, type OnboardingState } from "@/lib/onboarding";
import { getOnboardingState } from "@/lib/onboarding.server";

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
  return getOnboardingState(user.id, identity.memberId);
}

/** Start (or restart) the tour from the first step not yet done in the member's data. */
export async function startOnboarding(): Promise<Result> {
  return save({ marked_steps: [], dismissed_at: null, completed_at: null }, "startOnboarding");
}

/** Close the tour for good; the user menu can start it again. */
export async function dismissOnboarding(): Promise<Result> {
  return save({ dismissed_at: new Date().toISOString() }, "dismissOnboarding");
}

/** Close the tour once every step is done. */
export async function completeOnboarding(): Promise<Result> {
  return save({ completed_at: new Date().toISOString() }, "completeOnboarding");
}

/** Count a step as done without data to show it: confirmed ("my names look right") or skipped. */
export async function markOnboardingStep(stepId: string): Promise<Result> {
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
