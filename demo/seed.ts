/**
 * Seeds the demo community into the demo stack (`pnpm demo:stack up` first) and runs the app's own processing,
 * so Silver is built the way production builds it. Needs the demo app running: `pnpm demo:app`.
 *
 *   pnpm demo:seed
 *
 * Inputs are written (auth users, members, calendar events, Zoom attendance, the join link) and the app's own
 * `/api/process/calendar` and `/api/process/attendance` make the prickles and who attended them. Members are
 * written directly for now: production derives them from Kajabi imports (see docs/TODO.md, "Reproducible demo
 * and help docs"). Safe to run again.
 */
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ORG_TIMEZONE } from "@/lib/config";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";
import { loadDemoEnv } from "./env";
import { ATTENDANCE_RATE, DEMO_JOIN, DEMO_PASSWORD, FILLER_MEMBERS, PERSONAS, demoEvents } from "./personas";
import { DEMO_TOPIC_PREFIX, attendanceRows } from "./attendance";

/** Today's date in the org's timezone as YYYY-MM-DD, plus a number of days. */
export function orgDate(offsetDays: number, now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE }).format(now);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

export async function seed(now: Date = new Date()) {
  const env = loadDemoEnv();
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Accounts: one auth user per persona, with the profile role the app checks.
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userIdByEmail = new Map((existing?.users ?? []).map((u) => [u.email ?? "", u.id]));
  for (const p of PERSONAS) {
    let id = userIdByEmail.get(p.email);
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({ email: p.email, password: DEMO_PASSWORD, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${p.key}: ${error?.message}`);
      id = data.user.id;
      userIdByEmail.set(p.email, id);
    }
    // A zone already chosen, so the "Change time zone?" prompt stays out of screenshots.
    const { error: profileError } = await admin.from("user_profiles").upsert({ id, email: p.email, role: p.role, timezone_preference: ORG_TIMEZONE });
    if (profileError) throw new Error(`user_profiles ${p.key}: ${profileError.message}`);
  }

  // Members: active, linked to their account. The admin is staff without a member record.
  const joinedAt = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);
  const members = [
    ...PERSONAS.filter((p) => p.joinedDaysAgo !== null).map((p) => ({
      name: p.name,
      email: p.email,
      status: "active",
      source: "kajabi",
      user_id: userIdByEmail.get(p.email),
      joined_at: joinedAt(p.joinedDaysAgo ?? 0).toISOString(),
    })),
    // Members who fill the room but never sign in (no account).
    ...FILLER_MEMBERS.map((f) => ({ name: f.name, email: f.email, status: "active", source: "kajabi", user_id: null, joined_at: joinedAt(f.joinedDaysAgo).toISOString() })),
  ];
  const { error: membersError } = await admin.from("members").upsert(members, { onConflict: "email" });
  if (membersError) throw new Error(`members: ${membersError.message}`);

  // The Getting started tour is for new members; the demo members have put it away so it doesn't cover the page.
  const { data: seeded, error: seededError } = await admin.from("members").select("id").in("email", members.map((m) => m.email));
  if (seededError) throw new Error(`members: ${seededError.message}`);
  const dismissedAt = now.toISOString();
  const { error: onboardingError } = await admin
    .from("member_onboarding")
    .upsert((seeded ?? []).map((m) => ({ member_id: m.id, dismissed_at: dismissedAt })), { onConflict: "member_id" });
  if (onboardingError) throw new Error(`member_onboarding: ${onboardingError.message}`);

  // The Zoom room members see under "On air" (append-only: add only when the demo's isn't the latest).
  const { data: latest } = await admin.from("prickle_join_settings").select("join_url").order("effective_from", { ascending: false }).limit(1);
  if (latest?.[0]?.join_url !== DEMO_JOIN.url) {
    const { error } = await admin.from("prickle_join_settings").insert({
      join_url: DEMO_JOIN.url,
      meeting_id: DEMO_JOIN.meetingId,
      passcode: DEMO_JOIN.passcode,
      effective_from: new Date(now.getTime() - 365 * 86_400_000).toISOString(),
    });
    if (error) throw new Error(`prickle_join_settings: ${error.message}`);
  }

  // The calendar, as the importer would have stored it.
  const weekdayOfToday = new Date(`${orgDate(0, now)}T12:00:00Z`).getUTCDay();
  const events = demoEvents(weekdayOfToday).map((e) => {
    const start = zonedTimeToUtc(orgDate(e.dayOffset, now), e.startLocal, ORG_TIMEZONE);
    return {
      google_event_id: `demo-${e.key}`,
      summary: e.summary,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + e.minutes * 60_000).toISOString(),
      raw_data: { demo: true },
    };
  });
  const { error: eventsError } = await admin.schema("bronze").from("calendar_events").upsert(events, { onConflict: "google_event_id" });
  if (eventsError) throw new Error(`calendar_events: ${eventsError.message}`);
  // Demo events this seed no longer defines (an older cast, a changed pattern) go; processing then drops their prickles.
  const keep = new Set(events.map((e) => e.google_event_id));
  const { data: stale } = await admin.schema("bronze").from("calendar_events").select("google_event_id").like("google_event_id", "demo-%");
  const gone = (stale ?? []).map((e) => e.google_event_id).filter((id) => !keep.has(id));
  if (gone.length > 0) {
    const { error } = await admin.schema("bronze").from("calendar_events").delete().in("google_event_id", gone);
    if (error) throw new Error(`calendar_events cleanup: ${error.message}`);
  }

  // Bronze -> Silver with the real route (service role authorizes it, as in the API tests).
  const res = await fetch(`${env.appUrl}/api/process/calendar`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.serviceRoleKey}` },
    body: JSON.stringify({ fromDate: orgDate(-30, now), toDate: orgDate(15, now) }),
  }).catch((e) => {
    throw new Error(`Could not reach the demo app at ${env.appUrl}: start it with \`pnpm demo:app\` (${e.message})`);
  });
  if (!res.ok) throw new Error(`/api/process/calendar ${res.status}: ${await res.text()}`);
  console.log("Seeded:", await res.json());

  // Who came to the prickles that have ended: Zoom's record (Bronze), replaced on every run, then the real
  // attendance processing. The prickles must exist first, so this runs after the calendar is processed.
  const people = [
    ...PERSONAS.filter((p) => p.joinedDaysAgo !== null).map((p) => ({ name: p.name, email: p.email, joinedAt: joinedAt(p.joinedDaysAgo ?? 0), rate: ATTENDANCE_RATE[p.email] ?? 0.5 })),
    ...FILLER_MEMBERS.map((f) => ({ name: f.name, email: f.email, joinedAt: joinedAt(f.joinedDaysAgo), rate: f.rate })),
  ];
  const slots = events.map((e) => ({ key: e.google_event_id.slice("demo-".length), summary: e.summary, start: new Date(e.start_time), end: new Date(e.end_time) }));
  const zoom = admin.schema("bronze").from("zoom_attendees");
  const { error: clearError } = await zoom.delete().like("topic", `${DEMO_TOPIC_PREFIX}%`);
  if (clearError) throw new Error(`zoom_attendees clear: ${clearError.message}`);
  const rows = attendanceRows(slots, people, now, DEMO_JOIN.meetingId.replace(/\s/g, ""));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.schema("bronze").from("zoom_attendees").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`zoom_attendees: ${error.message}`);
  }
  const attendance = await fetch(`${env.appUrl}/api/process/attendance`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.serviceRoleKey}` },
    body: JSON.stringify({ fromDate: orgDate(-30, now), toDate: orgDate(1, now) }),
  });
  if (!attendance.ok) throw new Error(`/api/process/attendance ${attendance.status}: ${await attendance.text()}`);
  console.log(`Attendance: ${rows.length} Zoom rows processed`, await attendance.json());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
