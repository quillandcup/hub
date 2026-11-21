import type { AuthUser, AuthUserRepository } from "@/lib/data/auth-users";
import type { MemberRepository } from "@/lib/data/members";
import type { ProfileRepository } from "@/lib/data/profiles";

/**
 * Creating Supabase Auth users ahead of launch, without sending any email. Signups are disabled,
 * so a user has to exist in auth.users before a magic link works. `createUser` with
 * `email_confirm: true` sends nothing (unlike `inviteUserByEmail`). New users are created banned,
 * so nobody can sign in until `releaseAuthUsers` clears the ban of the active ones.
 */

/** Active members are banned for this long (about a year) until released. */
export const ACTIVE_HOLD_BAN = "8760h" as const;
/** Members on hiatus have no access: banned for about a hundred years, and the release step never touches them. */
export const HIATUS_BAN = "876000h" as const;

export type ProvisioningRepos = { members: MemberRepository; profiles: ProfileRepository; authUsers: AuthUserRepository };

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

export type ReleaseReport = { considered: number; released: number; /** Still banned because `limit` was reached; the next run releases them. */ deferred: number; alreadyOpen: number; noAuthUser: number; failed: number; failedMemberIds: string[] };

const norm = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

async function loadContext(repos: ProvisioningRepos) {
  const [active, hiatus, users, adminIds] = await Promise.all([
    repos.members.list({ status: "active" }),
    repos.members.list({ status: "on_hiatus" }),
    repos.authUsers.all(),
    repos.profiles.adminIds(),
  ]);
  const byEmail = new Map<string, AuthUser>();
  const byId = new Map<string, AuthUser>();
  for (const u of users) {
    byId.set(u.id, u);
    if (norm(u.email)) byEmail.set(norm(u.email), u);
  }
  return { active, hiatus, byEmail, byId, adminIds: new Set(adminIds) };
}

/** Creates the missing auth users (banned) and links members to existing ones. Idempotent; sends no email. */
export async function provisionAuthUsers(repos: ProvisioningRepos, options: { apply: boolean; limit?: number }): Promise<ProvisionReport> {
  const { active, hiatus, byEmail, byId, adminIds } = await loadContext(repos);
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
    let user: AuthUser;
    try {
      user = await repos.authUsers.create({ email, banDuration: ban });
    } catch {
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

function byByEmail(map: Map<string, AuthUser>, email: string) {
  return map.get(email);
}

/** Clears the ban of active members' auth users. Members on hiatus are never touched. Idempotent. */
export async function releaseAuthUsers(repos: ProvisioningRepos, options: { apply: boolean; limit?: number; now?: Date }): Promise<ReleaseReport> {
  const { active, byEmail, byId } = await loadContext(repos);
  const now = (options.now ?? new Date()).getTime();
  const report: ReleaseReport = { considered: 0, released: 0, deferred: 0, alreadyOpen: 0, noAuthUser: 0, failed: 0, failedMemberIds: [] };
  for (const member of active) {
    report.considered++;
    const email = norm(member.email);
    const user = (member.userId ? byId.get(member.userId) : undefined) ?? (email ? byEmail.get(email) : undefined);
    if (!user) {
      report.noAuthUser++;
      continue;
    }
    const banned = !!user.bannedUntil && new Date(user.bannedUntil).getTime() > now;
    if (!banned) {
      report.alreadyOpen++;
      continue;
    }
    if (options.limit !== undefined && report.released >= options.limit) {
      report.deferred++;
      continue;
    }
    if (options.apply) {
      try {
        await repos.authUsers.setBan(user.id, "none");
      } catch {
        report.failed++;
        report.failedMemberIds.push(member.id);
        continue;
      }
    }
    report.released++;
  }
  return report;
}
