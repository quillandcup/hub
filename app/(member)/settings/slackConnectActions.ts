"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { disconnectSlack } from "@/lib/slack-connect";

import { withAction } from "@/lib/analytics/server";
/** The signed-in member disconnects their own Slack account (never in sudo): the token is revoked in Slack and deleted here. */
async function disconnectSlackActionImpl(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const identity = await getEffectiveIdentity(user);
  if (!identity || identity.isSudo) return { ok: false, error: "Not available." };

  try {
    await disconnectSlack(createServiceRoleClient(), identity.memberId);
  } catch (error) {
    console.error("disconnectSlackAction failed:", error);
    return { ok: false, error: "Couldn't disconnect. Try again." };
  }
  revalidatePath("/settings", "layout");
  return { ok: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function disconnectSlackAction(...args: Parameters<typeof disconnectSlackActionImpl>): ReturnType<typeof disconnectSlackActionImpl> {
  return withAction("slack_disconnected", () => disconnectSlackActionImpl(...args));
}
