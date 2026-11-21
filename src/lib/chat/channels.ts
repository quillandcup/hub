import type { SupabaseClient } from "@supabase/supabase-js";

// The parts of the chat loaders that the browser also runs (the sidebar sorts and refreshes unread counts). They live apart
// from src/lib/chat/load.ts, which pulls in the server-only picture proxy (node:crypto): a client component that imported
// load.ts made the browser bundle a copy of the Node crypto and vm shims, and the vm shim calls eval(), which a
// Content-Security-Policy without 'unsafe-eval' blocks (docs/TODO.md, "CSP for scripts and styles (nonces)").

export interface ChannelSummary {
  id: string;
  kind: "channel" | "dm" | "group_dm";
  /** "#name" for channels, the other participants for group DMs. */
  label: string;
  visibility: "public" | "private";
  restricted: boolean;
  archived: boolean;
  joined: boolean;
  slackChannelId: string | null;
  /** When it last had a message: direct and group messages are listed by it, newest first, as in Slack. */
  lastMessageAt: string | null;
  /** A direct message with an app (a bot), listed under Apps rather than Direct messages; its label is the app's name. */
  app?: boolean;
}

/** Newest message first; a conversation with none goes last. */
export const byRecency = (a: Pick<ChannelSummary, "lastMessageAt">, b: Pick<ChannelSummary, "lastMessageAt">): number =>
  (b.lastMessageAt ? Date.parse(b.lastMessageAt) : -Infinity) - (a.lastMessageAt ? Date.parse(a.lastMessageAt) : -Infinity) || 0;

/** Unread top-level messages per conversation the signed-in member is in (capped at 100 each; none = absent). */
export async function loadUnreadCounts(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data } = await supabase.rpc("chat_unread_counts");
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { channel_id: string; unread: number }[]) counts[row.channel_id] = row.unread;
  return counts;
}
