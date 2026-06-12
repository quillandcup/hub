import { createClient } from "@/lib/supabase/server";
import { getUserTimezonePreference } from "@/lib/timezone";
import { getEffectiveIdentity } from "@/lib/sudo";
import MemberCalendarClient from "@/components/MemberCalendarClient";

export default async function MemberCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return null;

  const params = await searchParams;
  const rawView = params.view;
  const initialView =
    rawView === "week" ? "week" : rawView === "list" ? "list" : "month";

  const userTimezone = await getUserTimezonePreference();

  const { data: attendance } = await supabase
    .from("prickle_attendance")
    .select(`
      id,
      join_time,
      leave_time,
      prickles(
        id,
        host:members(id, name),
        start_time,
        end_time,
        prickle_types(name)
      )
    `)
    .eq("member_id", effectiveIdentity.memberId)
    .order("join_time", { ascending: false });

  return (
    <div className="container mx-auto px-6 py-8">
      <MemberCalendarClient
        memberId={effectiveIdentity.memberId}
        attendance={attendance || []}
        defaultTimezone={userTimezone}
        memberBasePath="/members"
        initialView={initialView}
      />
    </div>
  );
}
