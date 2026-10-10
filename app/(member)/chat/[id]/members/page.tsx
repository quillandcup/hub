import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireChat } from "@/lib/chat/access";
import { isUuid } from "@/lib/chat/format";
import { loadChannelForMember, loadChannelMembers } from "@/lib/chat/load";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";

export const metadata: Metadata = {
  title: "Members · Chat",
};

/** Who is in a conversation, each linking to their profile. Same scoping as the conversation itself. */
export default async function ChatMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { identity } = await requireChat();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, id, identity.memberId, identity.isSudo);
  if (!channel) notFound();
  const people = await loadChannelMembers(supabase, channel.id);

  return (
    <div>
      <header className="mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
        <Link href={`/chat/${channel.id}`} className="text-sm text-plum-700 dark:text-plum-300 hover:underline">
          ← Back to {channel.label}
        </Link>
        <h1 className="text-2xl font-bold mt-1">
          {channel.label} members <span className="text-base font-normal text-slate-500">({people.length})</span>
        </h1>
      </header>
      {people.length === 0 ? (
        <p className="text-sm text-slate-500">No members to show.</p>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2">
          {people.map((p) => (
            <li key={p.memberId}>
              <Link
                href={`/members/${p.memberId}`}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <MemberAvatar name={p.name} photoUrl={p.photoUrl} size={32} />
                <span className="text-sm font-medium">{p.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
