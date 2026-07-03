import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import MemberDetails from "./MemberDetails";
import MergeButton from "./MergeButton";
import { getUserTimezonePreference } from "@/lib/timezone";
import { startSudo } from "@/app/actions/sudo";
import { fetchMembershipHistory } from "@/lib/kajabi/membership-history";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { id } = await params;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch member data with metrics and engagement
  const { data: member } = await supabase
    .from("members")
    .select(`
      *,
      member_metrics(*),
      member_engagement(*)
    `)
    .eq("id", id)
    .single();

  if (!member) {
    notFound();
  }

  // Fetch all attendance records for this member with prickle details
  const { data: attendance } = await supabase
    .from("prickle_attendance")
    .select(`
      id,
      join_time,
      leave_time,
      confidence_score,
      prickles(
        id,
        host:members(id, name),
        start_time,
        end_time,
        prickle_types(name)
      )
    `)
    .eq("member_id", id)
    .order("join_time", { ascending: false });

  // Fetch member name aliases
  const { data: aliases } = await supabase
    .from("member_name_aliases")
    .select("alias")
    .eq("member_id", id)
    .order("alias");

  // Fetch email aliases
  const { data: emailAliases } = await supabase
    .from("member_email_aliases")
    .select("alias_email")
    .eq("canonical_email", member.email)
    .order("alias_email");

  // Fetch hiatus history
  const { data: hiatusHistory } = await supabase
    .from("member_hiatus_history")
    .select("*")
    .eq("member_id", id)
    .order("start_date", { ascending: false });

  // Fetch Kajabi membership history — query all customer IDs across primary + alias emails
  const allEmails = [member.email, ...(emailAliases || []).map((a: any) => a.alias_email)];
  const { data: kajabiCustomers } = await supabase
    .schema("bronze")
    .from("kajabi_customers")
    .select("kajabi_customer_id")
    .in("email", allEmails);

  const customerIds = (kajabiCustomers || []).map((c: any) => c.kajabi_customer_id).filter(Boolean);
  const membershipHistory = await fetchMembershipHistory(supabase, customerIds);

  // Fetch Slack activities
  const { data: slackActivities } = await supabase
    .from("member_activities")
    .select("*")
    .eq("member_id", id)
    .eq("source", "slack")
    .order("occurred_at", { ascending: false })
    .limit(50);

  // Get user's timezone preference
  const userTimezone = await getUserTimezonePreference();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/members" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Members
          </Link>
          <div className="mt-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{member.name}</h1>
              {aliases && aliases.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {aliases.map(({ alias }) => (
                      <span
                        key={alias}
                        className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded text-xs border border-slate-200 dark:border-slate-600"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                  <div className="group relative inline-block">
                    <svg
                      className="w-4 h-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-help"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto absolute left-0 top-6 w-64 p-3 bg-slate-900 dark:bg-slate-700 text-white text-xs rounded shadow-lg z-10 transition-opacity duration-200 before:content-[''] before:absolute before:left-0 before:bottom-full before:w-full before:h-6">
                      Aliases help match Zoom names to people. <Link href="/admin/data/aliases" className="underline hover:text-blue-300">Manage aliases →</Link>
                    </div>
                  </div>
                </div>
              )}
              <form action={startSudo.bind(null, member.id)}>
                <button
                  type="submit"
                  className="px-3 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-700 rounded-md hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                >
                  Sudo As
                </button>
              </form>
              <MergeButton member={{ id: member.id, name: member.name, email: member.email }} />
            </div>
            <div className="mt-1 flex flex-col gap-1">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {member.email}
              </p>
              {emailAliases && emailAliases.length > 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic">
                  Also known as: {emailAliases.map(({ alias_email }) => alias_email).join(", ")}
                </p>
              )}
              {(member.kajabi_id || member.stripe_customer_id) && (
                <div className="flex items-center gap-3 text-xs">
                  {member.kajabi_id && (
                    <a
                      href={`https://app.kajabi.com/admin/contacts/${member.kajabi_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Kajabi
                    </a>
                  )}
                  {member.kajabi_id && member.stripe_customer_id && (
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                  )}
                  {member.stripe_customer_id && (
                    <a
                      href={`https://dashboard.stripe.com/customers/${member.stripe_customer_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Stripe
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <MemberDetails
          member={member}
          attendanceRecords={attendance || []}
          hiatusHistory={hiatusHistory || []}
          slackActivities={slackActivities || []}
          userTimezonePreference={userTimezone}
          membershipHistory={membershipHistory}
        />
      </main>
    </div>
  );
}
