import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { enforceNetworkRetention } from "@/lib/retention/network-details";
import { RETENTION } from "@/lib/retention";

/**
 * The retention job against the real functions and tables: it keeps the device, then removes the exact IP and the
 * user agent from rows older than the retention period, and only where the device is stored. The clock is fixed,
 * so "old" and "recent" are exact.
 */

const NOW = Date.parse("2026-12-01T00:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const JUNK = "curl/8.1";
const CHROME_DEVICE = { browser: "Chrome", browser_version: "126.0.0.0", os: "macOS", os_version: null, device_type: "desktop" };

describe("enforceNetworkRetention (local database)", () => {
  const db = getTestSupabaseAdminClient() as unknown as SupabaseClient;
  const ts = Date.now();
  const fake = useFakeClock(() => NOW);
  void fake;
  let userId = "";
  let memberId = "";
  let videoId = "";

  const accessRows = async () =>
    (await db.from("access_events").select("path, user_agent, device, ip_address, city, created_at").eq("user_id", userId)).data ?? [];
  const row = async (path: string) => (await accessRows()).find((r) => r.path === path)!;

  beforeAll(async () => {
    const { data: user, error } = await db.auth.admin.createUser({ email: `retention-${ts}@example.com`, email_confirm: true });
    if (error) throw new Error(error.message);
    userId = user.user.id;
    const { data: member } = await db
      .from("members")
      .insert({ name: `Retention ${ts}`, email: `retention-member-${ts}@example.com`, joined_at: daysAgo(400), status: "active" })
      .select("id")
      .single();
    memberId = member!.id;
    const { data: video } = await db.from("videos").insert({ source_kind: "upload", source_key: `retention-${ts}`, status: "ready", mux_playback_id: "pb-retention" }).select("id").single();
    videoId = video!.id;

    const access = (path: string, over: Record<string, unknown>) => ({ user_id: userId, path, is_page: true, city: "Lisbon", ...over });
    const { error: insertError } = await db.from("access_events").insert([
      access("/old-with-agent", { created_at: daysAgo(RETENTION.rawNetworkDays + 10), ip_address: "203.0.113.7", user_agent: CHROME_MAC }),
      access("/old-iphone", { created_at: daysAgo(RETENTION.rawNetworkDays + 10), ip_address: "203.0.113.8", user_agent: SAFARI_IPHONE }),
      access("/old-junk", { created_at: daysAgo(RETENTION.rawNetworkDays + 10), ip_address: "203.0.113.9", user_agent: JUNK }),
      access("/old-no-agent", { created_at: daysAgo(RETENTION.rawNetworkDays + 10), ip_address: "203.0.113.10", user_agent: null }),
      access("/recent", { created_at: daysAgo(RETENTION.rawNetworkDays - 10), ip_address: "203.0.113.11", user_agent: CHROME_MAC }),
      access("/already-parsed", { created_at: daysAgo(RETENTION.rawNetworkDays + 20), ip_address: "203.0.113.12", user_agent: CHROME_MAC, device: CHROME_DEVICE }),
    ]);
    if (insertError) throw new Error(insertError.message);

    const { error: segError } = await db.from("video_watch_segments").insert([
      { member_id: memberId, video_id: videoId, session_id: crypto.randomUUID(), client_segment_id: crypto.randomUUID(), kind: "viewed", start_seconds: 0, end_seconds: 0, started_at: daysAgo(RETENTION.rawNetworkDays + 10), user_agent: SAFARI_IPHONE },
      { member_id: memberId, video_id: videoId, session_id: crypto.randomUUID(), client_segment_id: crypto.randomUUID(), kind: "viewed", start_seconds: 0, end_seconds: 0, started_at: daysAgo(5), user_agent: SAFARI_IPHONE },
    ]);
    if (segError) throw new Error(segError.message);

    const { data: events } = await db.from("analytics_events").insert([
      { user_id: userId, message_id: crypto.randomUUID(), session_id: crypto.randomUUID(), event: "page_viewed", properties: { route: "/dashboard" }, context: { route: "/dashboard", user_agent: CHROME_MAC }, occurred_at: daysAgo(3), source: "client" },
      { user_id: userId, message_id: crypto.randomUUID(), session_id: crypto.randomUUID(), event: "page_viewed", properties: { route: "/dashboard" }, context: { route: "/dashboard", user_agent: JUNK }, occurred_at: daysAgo(2), source: "client" },
    ]).select("id");
    void events;
  });

  afterAll(async () => {
    await db.from("analytics_events").delete().eq("user_id", userId);
    await db.from("access_events").delete().eq("user_id", userId);
    await db.from("video_watch_segments").delete().eq("member_id", memberId);
    await db.from("videos").delete().eq("id", videoId);
    await db.from("members").delete().eq("id", memberId);
    await db.auth.admin.deleteUser(userId);
  });

  it("keeps the device of every visit, then removes the raw IP and user agent from old rows only", async () => {
    const result = await enforceNetworkRetention(db);
    expect(result.stoppedEarly).toBe(false);

    // Old rows: the exact IP and the user agent are gone, the device and the place stay.
    const chrome = await row("/old-with-agent");
    expect(chrome).toMatchObject({ ip_address: null, user_agent: null, device: CHROME_DEVICE, city: "Lisbon" });
    const iphone = await row("/old-iphone");
    expect(iphone).toMatchObject({ ip_address: null, user_agent: null, city: "Lisbon" });
    expect(iphone.device).toEqual({ browser: "Safari", browser_version: "17.5", os: "iOS", os_version: "17.5", device_type: "phone" });
    // Nothing readable: stored as {} (not looked at again), and the string still goes.
    expect(await row("/old-junk")).toMatchObject({ ip_address: null, user_agent: null, device: {} });
    expect(await row("/old-no-agent")).toMatchObject({ ip_address: null, user_agent: null, device: null });
    expect(await row("/already-parsed")).toMatchObject({ ip_address: null, user_agent: null, device: CHROME_DEVICE });

    // A recent row keeps its raw values (they are not 90 days old), but its device is stored already.
    const recent = await row("/recent");
    expect(recent).toMatchObject({ ip_address: "203.0.113.11", user_agent: CHROME_MAC, device: CHROME_DEVICE });
  });

  it("removes the user agent from old lesson views, keeping the device, and leaves recent ones", async () => {
    const { data } = await db.from("video_watch_segments").select("user_agent, device, started_at").eq("member_id", memberId).order("started_at");
    const [old, recent] = data!;
    expect(old.user_agent).toBeNull();
    expect(old.device).toMatchObject({ browser: "Safari", os: "iOS" });
    expect(recent.user_agent).toBe(SAFARI_IPHONE);
    expect(recent.device).toMatchObject({ browser: "Safari", os: "iOS" });
  });

  it("replaces a usage event's raw user agent with the parsed fields, at any age", async () => {
    const { data } = await db.from("analytics_events").select("context, occurred_at").eq("user_id", userId).order("occurred_at");
    const [chrome, junk] = data!;
    expect(chrome.context).toEqual({ route: "/dashboard", browser: "Chrome", browser_version: "126.0.0.0", os: "macOS", device_type: "desktop" });
    expect(junk.context).toEqual({ route: "/dashboard" });
    expect(JSON.stringify(data)).not.toContain("Mozilla");
  });

  it("does nothing a second time", async () => {
    const result = await enforceNetworkRetention(db);
    expect(result.devicesStored).toEqual({ access_events: 0, video_watch_segments: 0, analytics_events: 0 });
    expect(result.removed).toEqual({ access_events: 0, video_watch_segments: 0 });
  });

  it("never removes a user agent before its device is stored, though the IP goes", async () => {
    // A row old enough to lose its raw values, whose device has not been stored yet (a race with the backfill).
    const { error } = await db.from("access_events").insert({ user_id: userId, path: "/guarded", is_page: true, created_at: daysAgo(200), ip_address: "203.0.113.20", user_agent: CHROME_MAC });
    expect(error).toBeNull();
    const { data } = await db.rpc("retention_remove_raw_network", { p_cutoff: daysAgo(RETENTION.rawNetworkDays), p_limit: 5000 });
    expect(data).toEqual([
      { source: "access_events", removed: 1 },
      { source: "video_watch_segments", removed: 0 },
    ]);
    expect(await row("/guarded")).toMatchObject({ ip_address: null, user_agent: CHROME_MAC, device: null });
  });
});
