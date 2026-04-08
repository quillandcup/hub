import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import NetworkGraph from "./NetworkGraph";

export default async function MemberNetworkPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
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
    .from("attendance")
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

  const edges = Array.from(connections.entries()).map(([key, weight]) => {
    const [member1, member2] = key.split("||");
    const member1Total = memberPrickleCounts.get(member1) || 1;
    const member2Total = memberPrickleCounts.get(member2) || 1;
    const minTotal = Math.min(member1Total, member2Total);
    const normalizedWeight = Math.round((weight / minTotal) * 100);

    return {
      source: member1,
      target: member2,
      weight,
      normalizedWeight,
    };
  });

  edges.sort((a, b) => b.weight - a.weight);

  const networkData = { nodes, edges };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/dashboard/members"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Members
          </Link>
          <div className="mt-2">
            <h1 className="text-2xl font-bold">Member Network</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Visualize connections between members based on shared prickle attendance
            </p>
          </div>
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
