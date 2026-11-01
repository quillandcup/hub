import { describe, expect, it } from "vitest";
import { ORG_TIMEZONE } from "@/lib/config";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

// The Eastern day an event starts and ends on is worked out in SQL (the community_event_details view and the
// badge-date functions use public.org_timezone()) and in code (ORG_TIMEZONE, from app.config.ts). SQL can't
// read app.config.ts, so the zone is written in both places; this fails the day only one of them changes.
describe("org_timezone()", () => {
  it("is the organization's timezone from app.config.ts", async () => {
    const { data, error } = await getTestSupabaseAdminClient().rpc("org_timezone");
    expect(error).toBeNull();
    expect(data).toBe(ORG_TIMEZONE);
  });
});
