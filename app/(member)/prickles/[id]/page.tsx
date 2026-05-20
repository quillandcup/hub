import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PrickleDetails from "./PrickleDetails";
import { getUserTimezonePreference } from "@/lib/timezone";
import { getEffectiveIdentity } from "@/lib/sudo";

export default async function PrickleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [profileResult, effectiveIdentity] = await Promise.all([
    supabase.from("user_profiles").select("role").eq("id", user.id).single(),
    getEffectiveIdentity(user),
  ]);
  const isAdmin = profileResult.data?.role === "admin";
  const isActingAsAdmin = isAdmin && !effectiveIdentity?.isSudo;
  const memberBasePath = isActingAsAdmin ? "/admin/members" : "/members";
  const backHref = isActingAsAdmin ? "/admin/calendar" : "/calendar";

  const { data: prickle } = await supabase
    .from("prickles")
    .select(`
      id,
      host:members(id, name),
      start_time,
      end_time,
      source,
      zoom_meeting_uuid,
      type_id,
      prickle_types:type_id(name, description)
    `)
    .eq("id", id)
    .single();

  if (!prickle) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Prickle not found</h1>
          <Link href={backHref} className="text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Back to Calendar
          </Link>
        </div>
      </div>
    );
  }

  const { data: attendanceRecords } = await supabase
    .from("prickle_attendance")
    .select(`
      id,
      join_time,
      leave_time,
      confidence_score,
      member_id,
      members!inner(id, name, email)
    `)
    .eq("prickle_id", id)
    .order("join_time", { ascending: true });

  const host = Array.isArray(prickle.host) ? prickle.host[0] : prickle.host;
  const hostId = host?.id;
  let hostMissing = false;
  let hostLate = false;

  if (hostId) {
    const hostAttendance = attendanceRecords?.find((a: any) => a.member_id === hostId);
    if (!hostAttendance) {
      hostMissing = true;
    } else {
      const prickleStart = new Date(prickle.start_time);
      const hostJoin = new Date(hostAttendance.join_time);
      if (hostJoin.getTime() - prickleStart.getTime() > 5 * 60 * 1000) {
        hostLate = true;
      }
    }
  }

  const userTimezone = await getUserTimezonePreference();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href={backHref} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Calendar
          </Link>
          <h1 className="text-2xl font-bold mt-2">Prickle Details</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <PrickleDetails
            prickle={prickle}
            attendanceRecords={attendanceRecords || []}
            hostMissing={hostMissing}
            hostLate={hostLate}
            userTimezonePreference={userTimezone}
            memberBasePath={memberBasePath}
            showMemberEmails={isActingAsAdmin}
          />
        </div>
      </main>
    </div>
  );
}
