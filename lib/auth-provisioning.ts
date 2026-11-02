import type { MemberRepository } from "@/lib/data/members";
import type { ProfileRepository } from "@/lib/data/profiles";

/**
 * Creating Supabase Auth users ahead of launch, without sending any email. Signups are disabled,
 * so a user has to exist in auth.users before a magic link works. `createUser` with
 * `email_confirm: true` sends nothing (unlike `inviteUserByEmail`). New users are created banned,
 * so nobody can sign in until `releaseAuthUsers` clears the ban of the active ones.
 */

/** Active members are banned for this long (about a year) until released. */
export const ACTIVE_HOLD_BAN = "8760h";
/** Members on hiatus have no access: banned for about a hundred years, and the release step never touches them. */
export const HIATUS_BAN = "876000h";

export type AuthUserLite = { id: string; email?: string | null; banned_until?: string | null };

/** The slice of `supabase.auth.admin` used here (the real client satisfies it). */
export interface AdminAuthApi {
  listUsers(params: { page: number; perPage: number }): Promise<{ data: { users: AuthUserLite[] } | null; error: { message: string } | null }>;
  createUser(attrs: { email: string; email_confirm: boolean; ban_duration?: string }): Promise<{ data: { user: AuthUserLite | null } | null; error: { message: string } | null }>;
  updateUserById(id: string, attrs: { ban_duration: string }): Promise<{ data: unknown; error: { message: string } | null }>;
}

export type ProvisioningRepos = { members: MemberRepository; profiles: ProfileRepository };

export type ProvisionReport = {
  /** Members considered (active or on hiatus). */
  considered: number;
  created: number;
  /** Missing users not created because `limit` was reached; the next run creates them. */
  deferred: number;
  createdBanned: number;
  alreadyExisted: number;
  linked: number;
  /** Staff and admins: created without a ban. */
  unbannedStaff: number;
  skipped: number;
  failed: number;
  /** Ids only, never emails or names. */
  failedMemberIds: string[];
};

export type ReleaseReport = { considered: number; released: number; alreadyOpen: number; noAuthUser: number; failed: number; failedMemberIds: string[] };

const PER_PAGE = 1000;

/** Every auth user, paginated past the 1000-per-page limit. */
export async function listAllAuthUsers(auth: AdminAuthApi): Promise<AuthUserLite[]> {
  const all: AuthUserLite[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await auth.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    all.push(...users);
    if (users.length < PER_PAGE) return all;
  }
}

const norm = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

async function loadContext(auth: AdminAuthApi, repos: ProvisioningRepos) {
  const [active, hiatus, users, adminIds] = await Promise.all([
    repos.members.list({ status: "active" }),
    repos.members.list({ status: "on_hiatus" }),
    listAllAuthUsers(auth),
    repos.profiles.adminIds(),
  ]);
  const byEmail = new Map<string, AuthUserLite>();
  const byId = new Map<string, AuthUserLite>();
  for (const u of users) {
    byId.set(u.id, u);
    if (norm(u.email)) byEmail.set(norm(u.email), u);
  }
  return { active, hiatus, byEmail, byId, adminIds: new Set(adminIds) };
}

/** Creates the missing auth users (banned) and links members to existing ones. Idempotent; sends no email. */
export async function provisionAuthUsers(auth: AdminAuthApi, repos: ProvisioningRepos, options: { apply: boolean; limit?: number }): Promise<ProvisionReport> {
  const { active, hiatus, byEmail, byId, adminIds } = await loadContext(auth, repos);
  const report: ProvisionReport = { considered: 0, created: 0, deferred: 0, createdBanned: 0, alreadyExisted: 0, linked: 0, unbannedStaff: 0, skipped: 0, failed: 0, failedMemberIds: [] };
  const fail = (id: string) => {
    report.failed++;
    report.failedMemberIds.push(id);
  };

  for (const member of [...active, ...hiatus]) {
    report.considered++;
    const email = norm(member.email);
    const existing = (member.userId ? byId.get(member.userId) : undefined) ?? (email ? byByEmail(byEmail, email) : undefined);
    if (existing) {
      report.alreadyExisted++;
      if (!member.userId) {
        if (options.apply) {
          try {
            await repos.members.linkAuthUser(member.id, existing.id, { onlyIfUnlinked: true });
          } catch {
            fail(member.id);
            continue;
          }
        }
        report.linked++;
      }
      continue;
    }
    if (!email) {
      report.skipped++;
      continue;
    }
    if (options.limit !== undefined && report.created >= options.limit) {
      report.deferred++;
      continue;
    }
    const isStaff = member.staffRole !== null || (member.userId !== null && adminIds.has(member.userId));
    const ban = isStaff ? undefined : member.status === "on_hiatus" ? HIATUS_BAN : ACTIVE_HOLD_BAN;
    if (!options.apply) {
      report.created++;
      if (ban) report.createdBanned++;
      else report.unbannedStaff++;
      continue;
    }
    const { data, error } = await auth.createUser({ email, email_confirm: true, ...(ban ? { ban_duration: ban } : {}) });
    const user = data?.user;
    if (error || !user) {
      fail(member.id);
      continue;
    }
    byEmail.set(email, user);
    byId.set(user.id, user);
    try {
      await repos.members.linkAuthUser(member.id, user.id, { onlyIfUnlinked: true });
      report.linked++;
    } catch {
      fail(member.id);
      continue;
    }
    report.created++;
    if (ban) report.createdBanned++;
    else report.unbannedStaff++;
  }
  return report;
}

function byByEmail(map: Map<string, AuthUserLite>, email: string) {
  return map.get(email);
}

/** Clears the ban of active members' auth users. Members on hiatus are never touched. Idempotent. */
export async function releaseAuthUsers(auth: AdminAuthApi, repos: ProvisioningRepos, options: { apply: boolean; now?: Date }): Promise<ReleaseReport> {
  const { active, byEmail, byId } = await loadContext(auth, repos);
  const now = (options.now ?? new Date()).getTime();
  const report: ReleaseReport = { considered: 0, released: 0, alreadyOpen: 0, noAuthUser: 0, failed: 0, failedMemberIds: [] };
  for (const member of active) {
    report.considered++;
    const email = norm(member.email);
    const user = (member.userId ? byId.get(member.userId) : undefined) ?? (email ? byEmail.get(email) : undefined);
    if (!user) {
      report.noAuthUser++;
      continue;
    }
    const banned = !!user.banned_until && new Date(user.banned_until).getTime() > now;
    if (!banned) {
      report.alreadyOpen++;
      continue;
    }
    if (options.apply) {
      const { error } = await auth.updateUserById(user.id, { ban_duration: "none" });
      if (error) {
        report.failed++;
        report.failedMemberIds.push(member.id);
        continue;
      }
    }
    report.released++;
  }
  return report;
}
