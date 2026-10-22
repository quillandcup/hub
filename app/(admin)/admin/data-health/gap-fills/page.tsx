import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "Chat Gap-fills",
};

const SCOPE_LABELS: Record<string, string> = {
  message: "One message",
  thread: "A thread",
  channel: "Catch-up on open",
};
const SOURCE_LABELS: Record<string, string> = {
  webhook: "A Slack event",
  open: "Opening a conversation",
  manual: "Run by hand",
};

interface GapFillRow {
  id: string;
  source: string;
  scope: string;
  slack_channel_id: string;
  slack_ts: string | null;
  started_at: string;
  finished_at: string | null;
  messages_recovered: number;
  reactions_recovered: number;
  error: string | null;
}

/**
 * Every time the chat fetched something from Slack because it was missing (docs/SLACK_BRIDGED_CHAT.md,
 * "Gap-fill"). A fill that recovers a lot means the webhook was down or dropping events, which
 * Checkly can't see; a run of errors usually means the bot isn't in the conversation.
 */
export default async function ChatGapFillsPage() {
  await requireAdminPage();
  const supabase = await createClient();

  const { data } = await supabase
    .from("chat_gap_fills")
    .select("id, source, scope, slack_channel_id, slack_ts, started_at, finished_at, messages_recovered, reactions_recovered, error")
    .order("started_at", { ascending: false })
    .limit(200);
  const fills = (data ?? []) as GapFillRow[];

  const channelIds = [...new Set(fills.map((f) => f.slack_channel_id))];
  const { data: channels } = channelIds.length
    ? await supabase.from("chat_channels").select("slack_channel_id, name, kind").in("slack_channel_id", channelIds)
    : { data: [] };
  const names = new Map((channels ?? []).map((c) => [c.slack_channel_id as string, c.kind === "channel" ? `#${c.name}` : "Group message"]));

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = fills.filter((f) => Date.parse(f.started_at) >= dayAgo);
  const recovered = recent.reduce((n, f) => n + f.messages_recovered + f.reactions_recovered, 0);
  const failed = recent.filter((f) => f.error).length;

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/hygiene" className="text-sm text-plum-600 hover:underline dark:text-plum-400">
            ← Data health
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Chat gap-fills</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            Each row is a time the chat fetched something from Slack because it was missing: a reaction or edit on a message
            we never stored, a reply whose thread we lacked, or new messages when someone opened a conversation. A fill that
            recovers a lot means the Slack webhook was down or dropping events.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 space-y-6">
        <section aria-label="Last 24 hours" className="@container">
          <div className="grid gap-4 @cards:grid-cols-3">
            {[
              ["Fills", String(recent.length)],
              ["Messages and reactions recovered", String(recovered)],
              ["Failed", String(failed)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm text-slate-600 dark:text-slate-400">{label} (24 h)</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </section>

        {fills.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No gap-fills yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Conversation</th>
                  <th className="px-4 py-2">What</th>
                  <th className="px-4 py-2">Triggered by</th>
                  <th className="px-4 py-2 text-right">Messages</th>
                  <th className="px-4 py-2 text-right">Reactions</th>
                  <th className="px-4 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {fills.map((f) => (
                  <tr key={f.id}>
                    <td className="whitespace-nowrap px-4 py-2">
                      <time dateTime={f.started_at}>{new Date(f.started_at).toLocaleString()}</time>
                    </td>
                    <td className="px-4 py-2">{names.get(f.slack_channel_id) ?? f.slack_channel_id}</td>
                    <td className="px-4 py-2">{SCOPE_LABELS[f.scope] ?? f.scope}</td>
                    <td className="px-4 py-2">{SOURCE_LABELS[f.source] ?? f.source}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{f.messages_recovered}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{f.reactions_recovered}</td>
                    <td className="px-4 py-2">
                      {f.error ? (
                        <span className="text-red-600 dark:text-red-400">{f.error}</span>
                      ) : f.finished_at ? (
                        "Done"
                      ) : (
                        "Running or interrupted"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
