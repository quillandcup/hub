import { createRepos } from "@/lib/data/repos";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { getVolunteerEligibility, volunteerEligibilityMessage } from "@/lib/big-sister-volunteers";
import { getMyMentorships } from "@/lib/my-mentorship";
import { getSlackDmLinksForMembers } from "@/lib/member-slack-links";
import BigSisterCards from "@/components/member/BigSisterCards";
import VolunteerCard from "./VolunteerCard";

export const metadata: Metadata = {
  title: "Big Sisters",
};

export default async function BigSistersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const identity = await getEffectiveIdentity(user);
  if (!identity) redirect("/admin");
  // Behind the big_sisters preview (the sudo'd member's own flag in sudo, so an admin sees what they would).
  if (!(await effectiveMemberHasFeature("big_sisters", identity, await getUserFeaturePreviews(user.id)))) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const mentorships = await getMyMentorships(supabase, identity.memberId, new Date().toISOString().slice(0, 10));
  const partnerIds = [mentorships.bigSister?.memberId, ...mentorships.mentees.map((m) => m.memberId)].filter(
    (id): id is string => !!id
  );
  const [{ data: volunteer }, member] = await Promise.all([
    supabase
      .from("big_sister_volunteers")
      .select("note")
      .eq("member_id", identity.memberId)
      .is("deleted_at", null)
      .maybeSingle(),
    createRepos(supabase).members.byId(identity.memberId),
  ]);
  const eligibility = member
    ? getVolunteerEligibility(
        { firstJoinedAt: member.firstJoinedAt, mostRecentJoinedAt: member.mostRecentJoinedAt },
        new Date()
      )
    : null;

  // Only the ids of this member's own partners: the lookup uses the service role.
  const slackLinks = Object.fromEntries(await getSlackDmLinksForMembers(partnerIds));

  return (
    <div className="container mx-auto px-6 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Big Sisters</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
        Every new member is matched with a big sister for their first 30 days: someone already in the community who shows them around.
      </p>

      <BigSisterCards mentorships={mentorships} slackLinks={slackLinks} />

      <VolunteerCard
        volunteering={volunteer !== null}
        initialNote={volunteer?.note ?? ""}
        blockedReason={eligibility && !eligibility.eligible ? volunteerEligibilityMessage(eligibility) : null}
        readOnly={identity.isSudo}
      />

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-6 space-y-3 text-sm text-slate-700 dark:text-slate-300">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          How it works
        </h2>
        <p>
          When you join (or come back), we match you with a big sister. They reach out, help you find prickles that suit your week,
          and answer the questions that are easier to ask a person than a help page. You don&apos;t have to do
          anything to be matched, and you&apos;re free to find your own way too.
        </p>
        <p>
          Big sisters earn a Big Sister badge on their profile that grows as they look after more new members.
        </p>
      </div>
    </div>
  );
}
