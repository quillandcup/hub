import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/admin-auth";
import RestrictionToggle from "./RestrictionToggle";

export const metadata: Metadata = {
  title: "Slack Channels",
};

// Lifting a restriction rebuilds 90 days of Slack activity before it returns.
export const maxDuration = 300;

interface ChannelRow {
  channel_id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  is_mpim: boolean;
  member_count: number | null;
}

/**
 * Which Slack channels staff can read messages in. Channels are readable unless
 * restricted here; group DMs and direct messages are always restricted
 * (docs/SLACK_BRIDGED_CHAT.md, "Access control").
 */
export default async function SlackChannelsPage() {
  await requireAdminPage();
  const supabase = await createClient();

  // Workspace channel count stays well under 1000.
  const [{ data: channelRows }, { data: restrictedRows }] = await Promise.all([
    supabase
      .schema("bronze")
      .from("slack_channels")
      .select("channel_id, name, is_private, is_archived, is_mpim, member_count")
      .order("name"),
    supabase.from("restricted_slack_channels").select("channel_id, created_at"),
  ]);

  const conversations = (channelRows ?? []) as ChannelRow[];
  const channels = conversations.filter((c) => !c.is_mpim);
  const groupDmCount = conversations.length - channels.length;
  const restrictedSince = new Map((restrictedRows ?? []).map((r) => [r.channel_id, r.created_at as string]));

  return (
    <div className="container mx-auto px-6 py-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Slack Channels</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Staff can read messages in public channels, and in private channels unless they are restricted here. Who posted, where and when stays visible
          either way. Every change here is in the{" "}
          <Link href="/admin/activity?view=privacy" className="text-plum-600 dark:text-plum-400 hover:underline">
            activity log
          </Link>
          .
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
              <th className="px-6 py-3 font-medium">Channel</th>
              <th className="px-6 py-3 font-medium">Members</th>
              <th className="px-6 py-3 font-medium">Staff can read messages</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => {
              const since = restrictedSince.get(c.channel_id);
              return (
                <tr key={c.channel_id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-6 py-3">
                    <span className="font-medium">#{c.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {c.is_private ? "Private" : "Public"}
                      {c.is_archived ? " · Archived" : ""}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{c.member_count ?? "—"}</td>
                  <td className="px-6 py-3">
                    {since ? `No, restricted ${new Date(since).toLocaleDateString()}` : "Yes"}
                  </td>
                  <td className="px-6 py-3">
                    {(c.is_private || since) && (
                      <RestrictionToggle channelId={c.channel_id} channelName={c.name} restricted={Boolean(since)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-400 mt-4">
        {groupDmCount} group {groupDmCount === 1 ? "DM" : "DMs"} and all direct messages are always restricted.
      </p>
    </div>
  );
}
