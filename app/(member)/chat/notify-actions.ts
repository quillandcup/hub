"use server";

import { withAction } from "@/lib/analytics/server";
import { chatCaller } from "@/lib/chat/caller";
import { isId } from "@/lib/ids";
import { createClient } from "@/lib/supabase/server";

/** What notifies the signed-in member about one conversation they are in (docs/SLACK_BRIDGED_CHAT.md, "Notifications"). */
export const NOTIFY_SETTINGS = ["default", "all", "mentions", "nothing"] as const;
export type NotifySettingChoice = (typeof NOTIFY_SETTINGS)[number];

export type SetNotifyResult = { ok: true } | { ok: false; error: string };

/**
 * Sets the member's own notification setting for a conversation: default, every message, only mentions, or nothing (muted).
 * `chat_set_notify_setting` only ever touches the caller's own row in a conversation they are in. Never in sudo: the setting
 * is the viewed member's, not the admin's.
 */
async function setChatNotifySettingImpl(channelId: string, setting: NotifySettingChoice): Promise<SetNotifyResult> {
  if (!isId(channelId, "chn") || !NOTIFY_SETTINGS.includes(setting)) return { ok: false, error: "Something went wrong." };
  const caller = await chatCaller();
  if (!caller) return { ok: false, error: "Chat isn't available to you." };
  if (caller.identity.isSudo) return { ok: false, error: "Notification settings can't be changed in sudo mode." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("chat_set_notify_setting", { p_channel_id: channelId, p_setting: setting });
  if (error) {
    console.error("chat_set_notify_setting failed:", error.message);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  return { ok: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function setChatNotifySetting(...args: Parameters<typeof setChatNotifySettingImpl>): ReturnType<typeof setChatNotifySettingImpl> {
  return withAction("chat_notify_setting_set", () => setChatNotifySettingImpl(...args));
}
