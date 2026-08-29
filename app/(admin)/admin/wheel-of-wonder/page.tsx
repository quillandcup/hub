import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { CONNECTION_CONFIRMATION_MESSAGE_THRESHOLD } from "@/lib/wheel-of-wonder";

export const metadata: Metadata = {
  title: "Wheel of Wonder",
};

interface MatchMember {
  id: string;
  name: string;
}

interface WheelMatchRow {
  id: string;
  status: "proposed" | "confirmed";
  created_at: string;
  confirmed_at: string | null;
  spinner_message_count: number;
  matched_message_count: number;
  spinner: MatchMember | MatchMember[] | null;
  matched: MatchMember | MatchMember[] | null;
}

// Supabase returns the embedded FK relation as an object for a to-one join,
// but the generated type is looser (array-or-object) -- normalize here.
function oneMember(value: MatchMember | MatchMember[] | null): MatchMember | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function WheelOfWonderAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("wheel_of_wonder")) redirect("/admin");

  const { data: matchesData } = await supabase
    .from("wheel_of_wonder_matches")
    .select(
      `
      id,
      status,
      created_at,
      confirmed_at,
      spinner_message_count,
      matched_message_count,
      spinner:members!spinner_member_id(id, name),
      matched:members!matched_member_id(id, name)
    `
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  const matches = (matchesData ?? []) as unknown as WheelMatchRow[];

  const confirmedCount = matches.filter((m) => m.status === "confirmed").length;
  const proposedCount = matches.length - confirmedCount;
  const confirmationRate = matches.length > 0 ? Math.round((confirmedCount / matches.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">🎡 Wheel of Wonder</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Spins, proposed matches, and confirmed connections
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{matches.length}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">total matches</div>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{confirmedCount}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">confirmed connections</div>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">{proposedCount}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              still proposed &middot; {confirmationRate}% confirm rate
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            A match is confirmed once both people have replied in the shared Slack room and their combined
            message count reaches {CONNECTION_CONFIRMATION_MESSAGE_THRESHOLD}.
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {matches.length === 0 ? (
              <div className="p-12 text-center text-slate-500">No spins yet.</div>
            ) : (
              matches.map((match) => {
                const spinner = oneMember(match.spinner);
                const matched = oneMember(match.matched);
                return (
                  <div
                    key={match.id}
                    className="p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-start justify-between gap-4"
                  >
                    <div className="flex-1">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {spinner ? (
                          <Link
                            href={`/admin/members/${spinner.id}`}
                            className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            {spinner.name}
                          </Link>
                        ) : (
                          "Unknown member"
                        )}
                        <span className="text-slate-400 dark:text-slate-600 mx-2">→</span>
                        {matched ? (
                          <Link
                            href={`/admin/members/${matched.id}`}
                            className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            {matched.name}
                          </Link>
                        ) : (
                          "Unknown member"
                        )}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        Spun {new Date(match.created_at).toLocaleString()}
                        {match.confirmed_at && (
                          <> &middot; confirmed {new Date(match.confirmed_at).toLocaleString()}</>
                        )}
                      </div>
                      <div className="text-sm text-slate-500 dark:text-slate-500 mt-1">
                        Messages: {spinner?.name ?? "spinner"} {match.spinner_message_count} &middot;{" "}
                        {matched?.name ?? "matched"} {match.matched_message_count}
                      </div>
                    </div>
                    <div
                      className={`px-3 py-1 rounded-full text-sm font-semibold whitespace-nowrap ${
                        match.status === "confirmed"
                          ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                          : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                      }`}
                    >
                      {match.status === "confirmed" ? "Confirmed" : "Proposed"}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
