import { redirect } from "next/navigation";
import { clock } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import type { Metadata } from "next";
import NetworkGraph from "./NetworkGraph";
import { requireAdminPage } from "@/lib/admin-auth";
import {
  CHAT_MODES,
  WINDOW_DAYS,
  buildNetworkEdges,
  parseChatMode,
  parseWindowDays,
  type ChatMode,
  type ChatPairRow,
} from "@/lib/member-network";

export const metadata: Metadata = {
  title: "Member Network",
};

const CHAT_MODE_LABELS: Record<ChatMode, string> = { off: "Off", public: "Public channels", all: "Everything" };

/** Interactions between each pair of members since a date, paged past the API's 1000-row limit. */
async function loadChatPairs(supabase: Awaited<ReturnType<typeof createClient>>, since: Date, includePrivate: boolean) {
  const rows: ChatPairRow[] = [];
  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .rpc("member_interaction_pairs", { p_since: since.toISOString(), p_include_private: includePrivate })
      .range(offset, offset + BATCH_SIZE - 1);
    const page = (batch ?? []) as ChatPairRow[];
    rows.push(...page.map((r) => ({ ...r, n: Number(r.n) })));
    offset += page.length;
    hasMore = page.length === BATCH_SIZE;
  }
  return rows;
}

export default async function MemberNetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string | string[]; days?: string | string[] }>;
}) {
  await requireAdminPage();
  const supabase = await createClient();
  const params = await searchParams;
  const chatMode = parseChatMode(params.chat);
  const windowDays = parseWindowDays(params.days);

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // Calculate network data inline (simpler than API call for server component)
  // Get all active members
  const { data: members } = await supabase
    .from("members")
    .select("id, name, email, status")
    .eq("status", "active")
    .order("name");

  if (!members || members.length === 0) {
    return (
      <div className="min-h-screen bg-canvas dark:bg-slate-950">
        <main className="container mx-auto px-6 py-8">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-12 text-center">
            <p className="text-slate-500 dark:text-slate-400">
              No active members found.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Get all attendance records
  const { data: attendance } = await supabase
    .from("prickle_attendance")
    .select(`
      member_id,
      prickle_id
    `)
    .order("prickle_id");

  // Group attendance by prickle to find co-attendees
  const prickleAttendees = new Map<string, Set<string>>();
  const memberPrickleCounts = new Map<string, number>();

  (attendance || []).forEach(record => {
    if (!prickleAttendees.has(record.prickle_id)) {
      prickleAttendees.set(record.prickle_id, new Set());
    }
    prickleAttendees.get(record.prickle_id)!.add(record.member_id);
    memberPrickleCounts.set(
      record.member_id,
      (memberPrickleCounts.get(record.member_id) || 0) + 1
    );
  });

  // Calculate connections
  const connections = new Map<string, number>();

  for (const attendeeSet of prickleAttendees.values()) {
    const attendeeList = Array.from(attendeeSet);
    for (let i = 0; i < attendeeList.length; i++) {
      for (let j = i + 1; j < attendeeList.length; j++) {
        const key = [attendeeList[i], attendeeList[j]].sort().join("||");
        connections.set(key, (connections.get(key) || 0) + 1);
      }
    }
  }

  // Build network data
  const nodes = members.map(m => ({
    id: m.id,
    name: m.name,
    email: m.email,
    totalPrickles: memberPrickleCounts.get(m.id) || 0,
  }));

  // Chat: who talked with whom in the window (never what was said), when asked for.
  const chatPairs =
    chatMode === "off"
      ? []
      : await loadChatPairs(supabase, new Date(clock.now() - windowDays * 24 * 60 * 60 * 1000), chatMode === "all");
  const edges = buildNetworkEdges({
    prickleConnections: connections,
    prickleTotals: memberPrickleCounts,
    chatPairs,
    activeIds: new Set(members.map((m) => m.id)),
  });

  const networkData = { nodes, edges };

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin/members"
            className="text-plum-600 hover:text-plum-700 dark:text-plum-400 text-sm mb-2 inline-block"
          >
            ← Back to Members
          </Link>
          <div className="mt-2">
            <h1 className="text-2xl font-bold">Member Network</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Connections between members from shared prickle attendance and, if you include it, from chat: replies,
              mentions, reactions and direct messages (who talked with whom, never what was said).
            </p>
          </div>
          <nav aria-label="Network options" className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-600 dark:text-slate-400">Chat:</span>
              {CHAT_MODES.map((mode) => (
                <Link
                  key={mode}
                  href={`/admin/members/network?chat=${mode}&days=${windowDays}`}
                  aria-current={mode === chatMode ? "true" : undefined}
                  className={`rounded px-2 py-1 ${mode === chatMode ? "bg-plum-100 font-medium text-plum-800 dark:bg-plum-900/40 dark:text-plum-200" : "text-plum-600 hover:underline dark:text-plum-400"}`}
                >
                  {CHAT_MODE_LABELS[mode]}
                </Link>
              ))}
            </div>
            {chatMode !== "off" && (
              <div className="flex items-center gap-2">
                <span className="text-slate-600 dark:text-slate-400">Last:</span>
                {WINDOW_DAYS.map((days) => (
                  <Link
                    key={days}
                    href={`/admin/members/network?chat=${chatMode}&days=${days}`}
                    aria-current={days === windowDays ? "true" : undefined}
                    className={`rounded px-2 py-1 ${days === windowDays ? "bg-plum-100 font-medium text-plum-800 dark:bg-plum-900/40 dark:text-plum-200" : "text-plum-600 hover:underline dark:text-plum-400"}`}
                  >
                    {days === 365 ? "1 year" : `${days} days`}
                  </Link>
                ))}
              </div>
            )}
          </nav>
          {chatMode === "all" && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Includes private channels and direct messages, which members are told staff can see the activity of (not the content).
            </p>
          )}
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {networkData.nodes.length > 0 ? (
          <NetworkGraph nodes={networkData.nodes} edges={networkData.edges} />
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-12 text-center">
            <p className="text-slate-500 dark:text-slate-400">
              No network data available. Import attendance data to see member connections.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
