"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import { postingCaller } from "@/lib/chat/caller";
import { withAction } from "@/lib/analytics/server";
import { chatTransport } from "@/lib/chat/transports";
import type { DmControlPress } from "@/lib/chat/dm-controls";
import { pressDmControl, type DmControlResult } from "@/lib/chat/dm-controls-press";

/**
 * The signed-in member used a control in one of Billie Bot's check-in or check-out DMs, drawn in the Hub chat
 * (src/components/chat/DmControls.tsx). Never in sudo (read-only, like every member write). The checks and the work are in
 * src/lib/chat/dm-controls-press.ts, shared with Slack's own buttons through src/lib/prickle-dm-interactions.ts.
 */
async function pressDmControlImpl(press: DmControlPress): Promise<DmControlResult> {
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Answering isn't available to you right now." };
  return pressDmControl(
    {
      viewer: createRepos(await createClient()),
      service: createRepos(createServiceRoleClient()),
      memberId: caller.identity.memberId,
      updateSlack: (channel, ts, message) => chatTransport().updateAppMessage({ channelRef: channel, ref: ts, message: message as Record<string, unknown> }),
    },
    press
  );
}

// Usage analytics: each action records whether it worked (src/lib/analytics/server.ts).
export async function pressChatDmControl(...args: Parameters<typeof pressDmControlImpl>): ReturnType<typeof pressDmControlImpl> {
  return withAction("chat_dm_control_pressed", () => pressDmControlImpl(...args));
}
