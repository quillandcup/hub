import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { isId } from "@/lib/ids";
import { loadChannelForMember, loadChannelMembers } from "@/lib/chat/load";
import { membershipAbilities } from "@/lib/chat/membership-abilities";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import MembersManager from "@/components/chat/MembersManager";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isId(id, "chn")) return { title: "Members · Chat" };
  const { identity } = await requireChat();
  const channel = await loadChannelForMember(await createClient(), id, identity.memberId, identity.isSudo);
  return { title: channel ? `Members · ${channel.label} · Chat` : "Members · Chat" };
}

/**
 * Who is in a conversation, each linking to their profile, with the controls for changing it (join or
 * leave, add people, and staff removing someone) when the member has them. Same scoping as the
 * conversation itself.
 */
export default async function ChatMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, identity } = await requireChat();
  const { id } = await params;
  if (!isId(id, "chn")) notFound();

  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, id, identity.memberId, identity.isSudo);
  if (!channel) notFound();
  const [people, features, profile, bridge] = await Promise.all([
    loadChannelMembers(supabase, channel.id),
    getUserFeaturePreviews(user.id),
    supabase.from("user_profiles").select("role").eq("id", user.id).single(),
    supabase.from("chat_channels").select("bridge_mode, bridge_disabled, bridge_status").eq("id", channel.id).maybeSingle(),
  ]);
  const abilities = membershipAbilities({
    kind: channel.kind,
    visibility: channel.visibility,
    archived: channel.archived,
    joined: channel.joined,
    postingOn: await effectiveMemberHasFeature("chat_posting", identity, features),
    isSudo: identity.isSudo,
    isStaff: profile.data?.role === "admin",
    bridge: bridge.data ?? null,
    slackChannelId: channel.slackChannelId,
  });

  return (
    <div className="p-6 max-w-3xl">
      <header className="mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
        <Link data-track="chat-members-back-to" href={`/chat/${channel.id}`} className="text-sm text-plum-700 dark:text-plum-300 hover:underline">
          ← Back to {channel.label}
        </Link>
        <h1 className="text-2xl font-bold mt-1">
          {channel.label} members <span className="text-base font-normal text-slate-600 dark:text-slate-400">({people.length})</span>
        </h1>
      </header>
      <MembersManager
        channelId={channel.id}
        channelLabel={channel.label}
        isPrivate={channel.visibility === "private"}
        people={people}
        viewerId={identity.memberId}
        abilities={abilities}
      />
    </div>
  );
}
