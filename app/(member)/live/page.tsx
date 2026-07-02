import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserTimezonePreference } from "@/lib/timezone";
import { LiveRefresh, Countdown } from "./LiveClient";

function formatTime(iso: string, timezone: string) {
  const tz = timezone === "browser" ? "America/New_York" : timezone;
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

function formatDuration(startIso: string, endIso: string) {
  const minutes = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000
  );
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

export default async function LivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) redirect("/admin");

  const userTimezone = await getUserTimezonePreference();
  const now = new Date().toISOString();

  const [{ data: livePrickles }, { data: profileResult }] = await Promise.all([
    supabase
      .from("prickles")
      .select(`
        id,
        start_time,
        end_time,
        source,
        host:members(id, name),
        prickle_types:type_id(name)
      `)
      .lte("start_time", now)
      .gte("end_time", now)
      .order("start_time", { ascending: true }),
    supabase.from("user_profiles").select("role").eq("id", user.id).single(),
  ]);

  const isAdmin = profileResult?.role === "admin";
  const memberBasePath = isAdmin && !effectiveIdentity.isSudo ? "/admin/members" : "/members";

  // Fetch attendance for all live prickles in parallel
  const attendanceByPrickle = new Map<string, any[]>();
  if (livePrickles && livePrickles.length > 0) {
    const results = await Promise.all(
      livePrickles.map((p) =>
        supabase
          .from("prickle_attendance")
          .select("id, join_time, leave_time, member_id, members(id, name)")
          .eq("prickle_id", p.id)
          .order("join_time", { ascending: true })
      )
    );
    livePrickles.forEach((p, i) => {
      attendanceByPrickle.set(p.id, results[i].data || []);
    });
  }

  // Next upcoming prickles today
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const { data: upcomingPrickles } = await supabase
    .from("prickles")
    .select(`
      id,
      start_time,
      end_time,
      host:members(id, name),
      prickle_types:type_id(name)
    `)
    .gt("start_time", now)
    .lte("start_time", endOfDay.toISOString())
    .order("start_time", { ascending: true })
    .limit(5);

  const isLive = livePrickles && livePrickles.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <LiveRefresh />

      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4 flex items-center gap-3">
          {isLive && (
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
          )}
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {isLive ? "Live Now" : "Live"}
          </h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-3xl space-y-8">
        {isLive ? (
          livePrickles!.map((prickle) => {
            const host = Array.isArray(prickle.host) ? prickle.host[0] : prickle.host;
            const prickleType = Array.isArray(prickle.prickle_types)
              ? prickle.prickle_types[0]
              : prickle.prickle_types;
            const attendance = attendanceByPrickle.get(prickle.id) || [];
            const currentlyPresent = attendance.filter(
              (a) => new Date(a.leave_time).getTime() >= Date.now()
            );
            const earlierAttendees = attendance.filter(
              (a) => new Date(a.leave_time).getTime() < Date.now()
            );

            return (
              <div
                key={prickle.id}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden"
              >
                <div className="bg-red-50 dark:bg-red-950/30 border-b border-red-100 dark:border-red-900/50 px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">
                          In Progress
                        </span>
                      </div>
                      <Link
                        href={`/prickles/${prickle.id}`}
                        className="text-xl font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {prickleType?.name ?? "Prickle"}
                      </Link>
                      {host && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                          Hosted by{" "}
                          <Link
                            href={`${memberBasePath}/${host.id}`}
                            className="text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
                          >
                            {host.name}
                          </Link>
                        </p>
                      )}
                    </div>
                    <div className="text-right text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">
                      <div>
                        {formatTime(prickle.start_time, userTimezone)} –{" "}
                        {formatTime(prickle.end_time, userTimezone)}
                      </div>
                      <div className="text-red-500 dark:text-red-400 font-medium mt-0.5">
                        <Countdown targetTime={prickle.end_time} label="ends" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-6 py-5">
                  {attendance.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500 italic">
                      Attendance data is available after the session ends and Zoom data is imported.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {currentlyPresent.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                            Currently Present ({currentlyPresent.length})
                          </h3>
                          <ul className="space-y-2">
                            {currentlyPresent.map((a) => {
                              const member = Array.isArray(a.members) ? a.members[0] : a.members;
                              return (
                                <li key={a.id} className="flex items-center gap-3">
                                  <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                                  <Link
                                    href={`${memberBasePath}/${a.member_id}`}
                                    className="text-sm text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
                                  >
                                    {member?.name ?? "Unknown"}
                                  </Link>
                                  <span className="text-xs text-slate-400 dark:text-slate-500">
                                    joined {formatTime(a.join_time, userTimezone)}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {earlierAttendees.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
                            Was Here Earlier ({earlierAttendees.length})
                          </h3>
                          <ul className="space-y-2">
                            {earlierAttendees.map((a) => {
                              const member = Array.isArray(a.members) ? a.members[0] : a.members;
                              return (
                                <li key={a.id} className="flex items-center gap-3">
                                  <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 flex-shrink-0" />
                                  <Link
                                    href={`${memberBasePath}/${a.member_id}`}
                                    className="text-sm text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                                  >
                                    {member?.name ?? "Unknown"}
                                  </Link>
                                  <span className="text-xs text-slate-400 dark:text-slate-500">
                                    {formatTime(a.join_time, userTimezone)} – {formatTime(a.leave_time, userTimezone)}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-6 py-12 text-center">
            <p className="text-4xl mb-3">☕</p>
            <p className="text-slate-600 dark:text-slate-400 font-medium">No prickle happening right now</p>
          </div>
        )}

        {upcomingPrickles && upcomingPrickles.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
              Up Next Today
            </h2>
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              {upcomingPrickles.map((p) => {
                const host = Array.isArray(p.host) ? p.host[0] : p.host;
                const prickleType = Array.isArray(p.prickle_types)
                  ? p.prickle_types[0]
                  : p.prickle_types;
                return (
                  <Link
                    key={p.id}
                    href={`/prickles/${p.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {prickleType?.name ?? "Prickle"}
                      </span>
                      {host && (
                        <span className="text-sm text-slate-500 dark:text-slate-400 ml-2">
                          · {host.name}
                        </span>
                      )}
                    </div>
                    <div className="text-right text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">
                      <div>{formatTime(p.start_time, userTimezone)}</div>
                      <div className="text-xs text-blue-500 dark:text-blue-400">
                        <Countdown targetTime={p.start_time} label="starts" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {!isLive && (!upcomingPrickles || upcomingPrickles.length === 0) && (
          <p className="text-center text-sm text-slate-400 dark:text-slate-500">
            No more prickles scheduled for today.
          </p>
        )}
      </main>
    </div>
  );
}
