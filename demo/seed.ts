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
import { seedChat } from "./chat-seed";

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

  // A cast that was renamed leaves its old members behind: remove demo members (example.com) who are no longer in it.
  const { data: demoMembers } = await admin.from("members").select("id, email").like("email", "%@example.com");
  const current = new Set(members.map((m) => m.email));
  const staleMembers = (demoMembers ?? []).filter((m) => !current.has(m.email as string)).map((m) => m.id as string);
  if (staleMembers.length > 0) {
    const { error } = await admin.from("members").delete().in("id", staleMembers);
    if (error) throw new Error(`members cleanup: ${error.message}`);
  }

  // The Getting started tour is for new members; the demo members have put it away so it doesn't cover the page.
  const { data: seeded, error: seededError } = await admin.from("members").select("id").in("email", members.map((m) => m.email));
  if (seededError) throw new Error(`members: ${seededError.message}`);
  const dismissedAt = now.toISOString();
  const { error: onboardingError } = await admin
    .from("member_onboarding")
    .upsert((seeded ?? []).map((m) => ({ member_id: m.id, dismissed_at: dismissedAt })), { onConflict: "member_id" });
  if (onboardingError) throw new Error(`member_onboarding: ${onboardingError.message}`);

  // Short bios, so the member directory and profiles read like a community, not a list of names.
  const bios: Record<string, string> = {
    "Maya Example": "Drafting a cozy mystery set in a lighthouse bakery 🧁 Tea first, words second. WIP: 12k and counting!",
    "Hazel Hosting": "I host the early Progress Prickles ☀️ Revising a middle-grade fantasy, one chapter at a time. Coffee-powered.",
    "Julia Sample": "Short stories + the occasional sonnet ✨ Sprint Prickles keep me honest. Poet problems, always.",
    "Rosa Demo": "Plotting my very first novel 📓 Plot or Plan Prickles are my favorite hour of the week. Index cards everywhere.",
  };
  const fillerBios = [
    "Cozy fantasy, strong tea, and a very large TBR pile 📚",
    "Writing a memoir in 20-minute bursts between school runs 🚌",
    "Poet by night, accountant by day. Here for the morning Prickles ✍️",
    "Finishing my second draft before the leaves are gone 🍂",
    "Sci-fi short stories and too many half-finished notebooks 🚀",
    "Romance writer. Sprint Prickles are my secret weapon 💌",
    "Turning a screenplay into a novel, one scene at a time 🎬",
    "Here to build a daily writing habit and make writer friends 🌱",
    "Historical fiction with a lot of research rabbit holes 🕰️",
    "Writing picture books after the kids are in bed 🌙",
  ];
  FILLER_MEMBERS.forEach((f, i) => {
    bios[f.name] = fillerBios[i % fillerBios.length];
  });
  for (const [name, bio] of Object.entries(bios)) {
    const { error } = await admin.from("members").update({ bio }).eq("name", name);
    if (error) throw new Error(`member bio ${name}: ${error.message}`);
  }

  // What the member writes: the demo member's projects and a few weeks of progress, so My Writing and the streaks
  // read as lived-in. Replaced on every run (external ids start with "demo-").
  const memberEmail = PERSONAS.find((p) => p.key === "member")?.email;
  const { data: memberRow } = await admin.from("members").select("id").eq("email", memberEmail ?? "").single();
  const memberId = memberRow?.id;
  if (memberId) {
    // An active commitment (Progress Prickles, Mondays and Wednesdays at 9) so Commitments isn't empty. Replaced each run.
    const { error: commitWipeError } = await admin.from("prickle_commitments").delete().eq("member_id", memberId);
    if (commitWipeError) throw new Error(`prickle_commitments clear: ${commitWipeError.message}`);
    const { data: progressType } = await admin.from("prickle_types").select("id").eq("name", "Progress Prickle").maybeSingle();
    if (progressType) {
      const { data: commitment, error: commitError } = await admin
        .from("prickle_commitments")
        .insert({ member_id: memberId, start_date: orgDate(-7, now), weeks: 4, status: "active" })
        .select("id")
        .single();
      if (commitError || !commitment) throw new Error(`prickle_commitments: ${commitError?.message}`);
      const { error: slotError } = await admin.from("prickle_commitment_slots").insert(
        [1, 3].map((day_of_week) => ({ commitment_id: commitment.id, type_id: progressType.id, day_of_week, start_time_local: "09:00", timezone: ORG_TIMEZONE })),
      );
      if (slotError) throw new Error(`prickle_commitment_slots: ${slotError.message}`);
    }

    // Prickles the member added to their calendar by hand (the recording does it), so each run starts with none.
    const { error: feedError } = await admin.from("calendar_feed_items").delete().eq("member_id", memberId);
    if (feedError) throw new Error(`calendar_feed_items clear: ${feedError.message}`);
    const { error: wipeError } = await admin.from("writing_projects").delete().eq("member_id", memberId).like("external_id", "demo-%");
    if (wipeError) throw new Error(`writing_projects clear: ${wipeError.message}`);
    const projects = [
      { external_id: "demo-lighthouse", title: "The Lighthouse Bakery Murders", phase: "drafting", description: "A cozy mystery about a baker who finds a body in the proofing room.", show_on_profile: true },
      { external_id: "demo-tide", title: "Tide Tables (short story)", phase: "revising", description: "A quiet story about two sisters and a very old tide chart.", show_on_profile: true },
      { external_id: "demo-seed", title: "Seed Notes", phase: "planning", description: "Ideas for the next book, collected a line at a time.", show_on_profile: false },
    ];
    const { data: created, error: projectError } = await admin.from("writing_projects").insert(projects.map((p) => ({ ...p, member_id: memberId }))).select("id, external_id");
    if (projectError) throw new Error(`writing_projects: ${projectError.message}`);
    const projectId = (key: string) => created?.find((p) => p.external_id === key)?.id;
    const words = [820, 0, 640, 1100, 450, 0, 930, 760, 0, 1250, 520, 880, 0, 700, 960, 610, 0, 1040, 780, 890];
    const entries = words.flatMap((amount, i) => {
      if (amount === 0) return [];
      const lighthouse = projectId("demo-lighthouse");
      return lighthouse
        ? [{ member_id: memberId, project_id: lighthouse, entry_date: orgDate(-(words.length - i), now), measure: "words", mode: "delta", amount, tags: [] as string[] }]
        : [];
    });
    const tide = projectId("demo-tide");
    if (tide) {
      for (const [daysAgo, amount] of [[12, 3], [9, 2], [5, 4], [2, 3]] as const) {
        entries.push({ member_id: memberId, project_id: tide, entry_date: orgDate(-daysAgo, now), measure: "pages", mode: "delta", amount, tags: [] });
      }
    }
    const { error: entriesError } = await admin.from("writing_progress_entries").insert(entries);
    if (entriesError) throw new Error(`writing_progress_entries: ${entriesError.message}`);
  }

  // Chat: the features on, and a few days of conversation in four channels.
  await seedChat(admin, now);

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
