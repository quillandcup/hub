"use server";

import { withAction } from "@/lib/analytics/server";
import { chatCaller, postingCaller, type ChatCaller } from "@/lib/chat/caller";
import { isUuid } from "@/lib/chat/format";
import { loadChannelForMember } from "@/lib/chat/load";
import { inviteToSlackChannel, kickFromSlackChannel, slackUserIdsFor } from "@/lib/chat/slack-membership";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { clock } from "@/lib/clock";

/**
 * Who is in a conversation, from the Hub (docs/SLACK_BRIDGED_CHAT.md, "Membership"): add people, remove
 * people, join and leave. For a conversation bridged to Slack the change is made in Slack first (as the
 * bot) and then here, so the Hub never says someone is in a conversation that Slack disagrees with.
 *
 * Who may do what is decided here, because the bot bypasses Slack's own per-user checks:
 * - anyone in a conversation can add other members to it; anyone can join a public channel;
 * - anyone can leave; removing someone else is for staff only;
 * - never in sudo, never in an archived conversation, and never in a group message (Slack can't change
 *   who is in one);
 * - a member who isn't in Slack can be added to a public channel (the Hub alone knows they're in it) but
 *   not to a private one: that would let them read a private Slack conversation they aren't in.
 */

export type MembershipResult = { ok: true; message?: string } | { ok: false; error: string };

const MAX_ADD_AT_ONCE = 20;

interface ManagedChannel {
  id: string;
  slackChannelId: string;
  label: string;
  isPrivate: boolean;
  joined: boolean;
}

/** The conversation, if its membership can be changed from the Hub at all, or why not. */
async function manageableChannel(caller: ChatCaller, channelId: string): Promise<{ ok: true; channel: ManagedChannel } | { ok: false; error: string }> {
  const supabase = await createClient();
  const summary = await loadChannelForMember(supabase, channelId, caller.identity.memberId, false);
  if (!summary) return { ok: false, error: "That conversation isn't available." };

  const { data: row } = await createServiceRoleClient()
    .from("chat_channels")
    .select("kind, visibility, slack_channel_id, bridge_mode, bridge_disabled, bridge_status, archived_at")
    .eq("id", channelId)
    .maybeSingle();
  if (!row) return { ok: false, error: "That conversation isn't available." };
  if (row.kind !== "channel") return { ok: false, error: "Slack doesn't allow changing who is in a group message." };
  if (row.archived_at) return { ok: false, error: "This conversation is archived." };
  if (row.bridge_mode !== "bridged" || row.bridge_disabled || row.bridge_status !== "ok" || !row.slack_channel_id) {
    return { ok: false, error: "This conversation isn't connected to Slack, so its members can't be changed from here." };
  }
  return {
    ok: true,
    channel: { id: channelId, slackChannelId: row.slack_channel_id as string, label: summary.label, isPrivate: row.visibility === "private", joined: summary.joined },
  };
}

/** The member's name, for saying who couldn't be added. */
async function namesOf(memberIds: string[]): Promise<Map<string, string>> {
  const { data } = await createServiceRoleClient().from("member_directory").select("id, name, display_name").in("id", memberIds);
  return new Map((data ?? []).map((m) => [m.id as string, (m.display_name || m.name) as string]));
}

async function isStaff(caller: ChatCaller): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("user_profiles").select("role").eq("id", caller.userId).single();
  return data?.role === "admin";
}

/** Put people in the conversation here (after Slack agreed). A member who left and returns is back, not added twice. */
async function recordJoined(channelId: string, people: { memberId: string; source: "slack" | "app" }[]) {
  if (people.length === 0) return;
  const now = new Date(clock.now()).toISOString();
  const { error } = await createServiceRoleClient()
    .from("chat_channel_members")
    .upsert(
      people.map((p) => ({ channel_id: channelId, member_id: p.memberId, joined_at: now, left_at: null, source: p.source })),
      { onConflict: "channel_id,member_id" }
    );
  if (error) throw error;
}

/** Which of these members are already in the conversation. */
async function alreadyIn(channelId: string, memberIds: string[]): Promise<Set<string>> {
  const { data } = await createServiceRoleClient()
    .from("chat_channel_members")
    .select("member_id")
    .eq("channel_id", channelId)
    .in("member_id", memberIds)
    .is("left_at", null);
  return new Set((data ?? []).map((r) => r.member_id as string));
}

/** Add `memberIds` (the member's own id to join a public channel). */
async function addMembersImpl(channelId: string, memberIds: string[]): Promise<MembershipResult> {
  const unique = [...new Set(memberIds)];
  if (!isUuid(channelId) || unique.length === 0 || !unique.every(isUuid)) return { ok: false, error: "Something went wrong." };
  if (unique.length > MAX_ADD_AT_ONCE) return { ok: false, error: `Add at most ${MAX_ADD_AT_ONCE} people at a time.` };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Changing who is in a conversation isn't available to you yet." };
  const self = caller.identity.memberId;

  const managed = await manageableChannel(caller, channelId);
  if (!managed.ok) return managed;
  const { channel } = managed;

  // Joining yourself needs a public channel; adding others needs to be in it yourself.
  const onlySelf = unique.length === 1 && unique[0] === self;
  if (onlySelf && channel.isPrivate && !channel.joined) return { ok: false, error: "You can only join a public channel. Ask someone in it to add you." };
  if (!onlySelf && !channel.joined) return { ok: false, error: "Join this channel before adding other people to it." };

  const service = createServiceRoleClient();
  const present = await alreadyIn(channelId, unique);
  const wanted = unique.filter((id) => !present.has(id));
  if (wanted.length === 0) return { ok: true };

  // Only people who are active members can be added.
  const { data: active } = await service.from("members").select("id").in("id", wanted).eq("status", "active");
  const activeIds = new Set((active ?? []).map((m) => m.id as string));
  const notActive = wanted.filter((id) => !activeIds.has(id));
  if (notActive.length > 0) return { ok: false, error: "Only active members can be added." };

  const slackIds = await slackUserIdsFor(service, wanted);
  const withoutSlack = wanted.filter((id) => !slackIds.has(id));
  if (channel.isPrivate && withoutSlack.length > 0) {
    const names = await namesOf(withoutSlack);
    return {
      ok: false,
      error: `${withoutSlack.map((id) => names.get(id) ?? "Someone").join(", ")} ${withoutSlack.length === 1 ? "isn't" : "aren't"} in Slack, so can't be added to a private conversation.`,
    };
  }

  const invited = await inviteToSlackChannel({ channel: channel.slackChannelId, userIds: wanted.flatMap((id) => (slackIds.has(id) ? [slackIds.get(id)!] : [])) });
  if (!invited.ok) return invited;

  await recordJoined(channelId, wanted.map((memberId) => ({ memberId, source: slackIds.has(memberId) ? ("slack" as const) : ("app" as const) })));
  return {
    ok: true,
    message: withoutSlack.length > 0 ? `${withoutSlack.length === 1 ? "One person isn't" : `${withoutSlack.length} people aren't`} in Slack, so they are only in the Hub's copy of this channel.` : undefined,
  };
}

/** Remove `memberId`: oneself leaving, or staff removing someone. */
async function removeMemberImpl(channelId: string, memberId: string): Promise<MembershipResult> {
  if (!isUuid(channelId) || !isUuid(memberId)) return { ok: false, error: "Something went wrong." };
  const caller = await postingCaller();
  if (!caller) return { ok: false, error: "Changing who is in a conversation isn't available to you yet." };
  const isSelf = memberId === caller.identity.memberId;
  if (!isSelf && !(await isStaff(caller))) return { ok: false, error: "Only staff can remove other people from a conversation." };

  const managed = await manageableChannel(caller, channelId);
  if (!managed.ok) return managed;
  const { channel } = managed;
  // Someone who isn't in it (to leave) can't; staff removing from a private conversation they aren't in is out of scope.
  if (isSelf && !channel.joined) return { ok: true };

  const service = createServiceRoleClient();
  const { data: row } = await service
    .from("chat_channel_members")
    .select("source")
    .eq("channel_id", channelId)
    .eq("member_id", memberId)
    .is("left_at", null)
    .maybeSingle();
  if (!row) return { ok: true }; // already out

  // In Slack too, unless the Hub alone knows they were in it.
  if (row.source !== "app") {
    const slackUser = (await slackUserIdsFor(service, [memberId])).get(memberId);
    if (slackUser) {
      const kicked = await kickFromSlackChannel({ channel: channel.slackChannelId, userId: slackUser });
      if (!kicked.ok) return kicked;
    }
  }

  const { error } = await service
    .from("chat_channel_members")
    .update({ left_at: new Date(clock.now()).toISOString() })
    .eq("channel_id", channelId)
    .eq("member_id", memberId)
    .is("left_at", null);
  if (error) throw error;
  return { ok: true };
}

export interface MemberCandidate {
  memberId: string;
  name: string;
  photoUrl: string | null;
  /** Whether the Hub knows their Slack account: without it they can only be added to a public channel. */
  inSlack: boolean;
}

/**
 * Members to offer when adding people: active, not already in the conversation, matching what was typed.
 * Names only (the directory every member can read), and only for someone who could add them.
 */
export async function searchMembersToAdd(channelId: string, query: string): Promise<MemberCandidate[]> {
  const text = query.trim().slice(0, 60);
  if (!isUuid(channelId) || text.length < 2) return [];
  const caller = await postingCaller();
  if (!caller) return [];
  const managed = await manageableChannel(caller, channelId);
  if (!managed.ok || !managed.channel.joined) return [];

  const service = createServiceRoleClient();
  // % and _ are wildcards in a LIKE; the person typing meant the letters.
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  // Two queries, not one .or("name.ilike...,display_name.ilike..."): what was typed would have to be escaped
  // for PostgREST's filter syntax, and a comma or a parenthesis in it would start a filter of its own.
  const [byName, byDisplayName] = await Promise.all([
    service.from("member_directory").select("id, name, display_name, photo_url").ilike("name", pattern).order("name").limit(40),
    service.from("member_directory").select("id, name, display_name, photo_url").ilike("display_name", pattern).order("name").limit(40),
  ]);
  const matches = [...new Map([...(byName.data ?? []), ...(byDisplayName.data ?? [])].map((m) => [m.id as string, m])).values()].sort((a, b) =>
    String(a.name).localeCompare(String(b.name))
  );
  const ids = matches.map((m) => m.id as string).filter((id) => id !== caller.identity.memberId);
  if (ids.length === 0) return [];

  const [{ data: active }, present, slackIds] = await Promise.all([
    service.from("members").select("id").in("id", ids).eq("status", "active"),
    alreadyIn(channelId, ids),
    slackUserIdsFor(service, ids),
  ]);
  const activeIds = new Set((active ?? []).map((m) => m.id as string));
  return matches
    .filter((m) => activeIds.has(m.id as string) && !present.has(m.id as string) && m.id !== caller.identity.memberId)
    .slice(0, 8)
    .map((m) => ({ memberId: m.id as string, name: (m.display_name || m.name) as string, photoUrl: (m.photo_url as string | null) ?? null, inSlack: slackIds.has(m.id as string) }));
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function addChatMembers(channelId: string, memberIds: string[]): Promise<MembershipResult> {
  return withAction("chat_members_added", () => addMembersImpl(channelId, memberIds));
}

export async function joinChatChannel(channelId: string): Promise<MembershipResult> {
  const caller = await chatCaller();
  if (!caller) return { ok: false, error: "Changing who is in a conversation isn't available to you yet." };
  return withAction("chat_channel_joined", () => addMembersImpl(channelId, [caller.identity.memberId]));
}

export async function removeChatMember(channelId: string, memberId: string): Promise<MembershipResult> {
  return withAction("chat_member_removed", () => removeMemberImpl(channelId, memberId));
}
