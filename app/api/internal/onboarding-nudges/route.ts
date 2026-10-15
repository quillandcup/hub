import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { withCronHeartbeat } from "@/lib/cron-heartbeats";
import { sendOnboardingNudges } from "@/lib/onboarding-nudges";
import { membersWithFeatureForOutreach } from "@/lib/features.server";

// Triggered hourly by the Supabase pg_cron job `send-onboarding-nudges`
// (supabase/migrations/20261105000000_onboarding_nudges.sql).
export const maxDuration = 60;

const FLAG_FOR_KIND = { intro_nudge: "intro_reminders", prickle_nudge: "prickle_reminders" } as const;

/**
 * Member reminders: newcomers introduce themselves in #start-here, and members without a prickle
 * coming up are asked to schedule one (lib/onboarding-nudges.ts). Each member's reminders go out in
 * their own hour, so most runs send nothing. Each kind has its own feature flag (`intro_reminders`,
 * `prickle_reminders`): only members it covers (globally, a segment, or their own preview) get that
 * reminder for real; for everyone else it only logs who would have been reminded and why.
 */
export async function POST(request: NextRequest) {
  return withCronHeartbeat("onboarding-nudges", await runOnboardingNudges(request));
}

async function runOnboardingNudges(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_INTERNAL_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServiceRoleClient();
  const result = await sendOnboardingNudges(supabase, new Date(), {
    liveFor: (kind, memberIds) => membersWithFeatureForOutreach(supabase, FLAG_FOR_KIND[kind], memberIds),
  });
  return NextResponse.json(result);
}
