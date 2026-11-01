import { afterAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/data/db";
import { createRepos } from "@/lib/data/repos";
import { clearProfile, loadProfile } from "@/lib/data/seed-loader";
import { FIRST_WEEK, HOSTING_HEAVY } from "@/lib/data/profiles/index";
import { buildDataset, type SeedProfile } from "@/lib/data/seed-profile";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const repos = createRepos(db);
const RUN = `${Date.now()}`;
const ZONE = "America/New_York";
// Far from any date other tests use, and different for each run, so these rows never fall into another test's range.
const NOW = new Date(Date.UTC(2090, 0, 1) + (Number(RUN) % 300) * 86_400_000 + 18 * 3_600_000);
const loaded: string[] = [];

/** The profile with addresses, prickle types and badge keys that belong to this run only: shared reference rows are not touched and nothing collides with another run. */
function mine(profile: SeedProfile): SeedProfile {
  const name = `${profile.name}-${RUN}`;
  loaded.push(name);
  return {
    ...profile,
    name,
    people: profile.people.map((p) => ({ ...p, email: p.email.replace("@", `.${name}@`) })),
    weeklyPattern: profile.weeklyPattern.map((s) => ({ ...s, summary: s.summary.replace(" Prickle", ` Prickle ${RUN}`) })),
    badges: profile.badges?.map((b) => ({ ...b, key: `${b.key}_${RUN}` })),
  };
}

afterAll(async () => {
  for (const name of loaded) await clearProfile(db, name);
  await db.from("prickle_types").delete().like("name", `% Prickle ${RUN}`);
  await db.from("badge_types").delete().like("key", `%\\_${RUN}`);
});

describe("loadProfile", () => {
  it("writes a profile that the repositories read back", async () => {
    const profile = mine(FIRST_WEEK);
    const dataset = buildDataset(profile, NOW, { timeZone: ZONE });

    const result = await loadProfile(db, dataset, { profile: profile.name });

    expect(result).toMatchObject({ members: 4, mentorships: 1, notifications: 1 });
    expect(result.prickles).toBe(dataset.prickles.length);
    const nora = (await repos.members.byEmail(`nora.newcomer.first-week-${RUN}@example.com`))!;
    const bea = (await repos.members.byEmail(`bea.buddy.first-week-${RUN}@example.com`))!;
    expect(nora.name).toBe("Nora Newcomer");
    expect(await repos.attendance.countForMember(nora.id)).toBe(dataset.attendance.filter((a) => a.memberId === nora.id).length);
    const matches = (await repos.mentorship.listWithMembers()).filter((m) => m.new_member_id === nora.id);
    expect(matches).toHaveLength(1);
    expect(matches[0].mentor_member_id).toBe(bea.id);
    expect(matches[0].new_member?.name).toBe("Nora Newcomer");
    expect(await repos.notifications.inAppCount(nora.id, { unreadOnly: true })).toBe(1);
    const hosted = await repos.prickles.startingBetween({ from: "2089-01-01", hostId: (await repos.members.byEmail(`hana.example.first-week-${RUN}@example.com`))!.id });
    expect(hosted.length).toBeGreaterThan(0);
    expect(hosted[0].type?.name).toMatch(new RegExp(`Prickle ${RUN}$`));
  });

  it("loads badges, and a re-run replaces the earlier load instead of piling up", async () => {
    const profile = mine(HOSTING_HEAVY);
    const hana = () => repos.members.byEmail(`hana.hostess.hosting-heavy-${RUN}@example.com`);

    await loadProfile(db, buildDataset(profile, NOW, { timeZone: ZONE }), { profile: profile.name });
    const firstPrickles = (await db.from("prickles").select("id").eq("type", `seed:${profile.name}`)).data!.map((p) => p.id);
    expect((await repos.badges.awardsOf((await hana())!.id)).length).toBe(1);

    const later = new Date(NOW.getTime() + 7 * 86_400_000);
    await loadProfile(db, buildDataset(profile, later, { timeZone: ZONE }), { profile: profile.name });
    const secondPrickles = (await db.from("prickles").select("id").eq("type", `seed:${profile.name}`)).data!.map((p) => p.id);

    expect(firstPrickles.length).toBeGreaterThan(0);
    expect(secondPrickles.length).toBe(firstPrickles.length);
    expect(secondPrickles.filter((id) => firstPrickles.includes(id)).length).toBeLessThan(firstPrickles.length); // the window moved
    expect((await db.from("members").select("id").eq("raw_payload->>seed_profile", profile.name)).data).toHaveLength(5);
    expect((await repos.badges.awardsOf((await hana())!.id)).length).toBe(1);
  });

  it("clears only its own profile", async () => {
    const profile = mine(HOSTING_HEAVY);
    const other = mine(FIRST_WEEK);
    await loadProfile(db, buildDataset(profile, NOW, { timeZone: ZONE }), { profile: profile.name });
    await loadProfile(db, buildDataset(other, NOW, { timeZone: ZONE }), { profile: other.name });

    await clearProfile(db, profile.name);

    expect((await db.from("members").select("id").eq("raw_payload->>seed_profile", profile.name)).data).toHaveLength(0);
    expect((await db.from("prickles").select("id").eq("type", `seed:${profile.name}`)).data).toHaveLength(0);
    expect((await db.from("members").select("id").eq("raw_payload->>seed_profile", other.name)).data).toHaveLength(4);
  });

  it("writes only the parts asked for, and links the people to their accounts", async () => {
    const profile = mine(HOSTING_HEAVY);
    const dataset = buildDataset(profile, NOW, { timeZone: ZONE });
    const email = `hana.hostess.hosting-heavy-${RUN}@example.com`;
    const account = await db.auth.admin.createUser({ email, email_confirm: true });
    expect(account.error).toBeNull();
    const userId = account.data.user!.id;

    try {
      const result = await loadProfile(db, dataset, { profile: profile.name, include: ["badges"], userIdByEmail: new Map([[email, userId]]) });

      expect(result).toMatchObject({ members: 5, prickles: 0, attendance: 0, notifications: 0, mentorships: 0, badges: 1 });
      expect((await db.from("prickles").select("id").eq("type", `seed:${profile.name}`)).data).toHaveLength(0);
      expect((await db.from("members").select("user_id").eq("email", email).single()).data?.user_id).toBe(userId);
      await expect(loadProfile(db, dataset, { profile: profile.name, include: ["attendance"] })).rejects.toThrow(/attendance needs the prickles/);
    } finally {
      await clearProfile(db, profile.name);
      await db.auth.admin.deleteUser(userId);
    }
  });

  it("refuses to take over addresses that belong to someone else", async () => {
    const profile = mine(FIRST_WEEK);
    await clearProfile(db, profile.name);
    const clash = await db.from("members").insert({ name: "Someone Else", email: `nora.newcomer.first-week-${RUN}@example.com`, joined_at: "2026-01-01", status: "active" }).select("id").single();
    expect(clash.error).toBeNull();

    await expect(loadProfile(db, buildDataset(profile, NOW, { timeZone: ZONE }), { profile: profile.name })).rejects.toThrow(/already belong to members no seed profile wrote/);

    await db.from("members").delete().eq("id", clash.data!.id);
  });
});
