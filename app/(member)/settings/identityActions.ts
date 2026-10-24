"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findNameAliasConflict, MEMBER_NAME_ALIAS_CONFLICT_MESSAGES } from "@/lib/name-alias-conflict";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { createKajabiClient } from "@/lib/kajabi/client";
import { revalidatePath } from "next/cache";
import { SUPPORT_EMAIL } from "@/lib/config";
import { createRepos } from "@/lib/data/repos";

import { withAction } from "@/lib/analytics/server";
export interface NameAliasRow {
  id: string;
  alias: string;
  source: string;
  active: boolean;
  createdAt: string;
}

export interface EmailAliasRow {
  id: string;
  aliasEmail: string;
  source: string;
  active: boolean;
  createdAt: string;
}

export interface IdentitySettings {
  realName: string;
  /** Pen name staff chose as the community-facing name, or null when the real name is shown. */
  displayName: string | null;
  primaryEmail: string;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  nameAliases: NameAliasRow[];
  emailAliases: EmailAliasRow[];
  /** Heuristic only — nothing links a specific alias to the attendance it
   * produced, so this just flags "you have history, be careful" rather than
   * "this specific alias is load-bearing". See migration
   * 20260831170000_add_alias_self_service.sql. */
  hasAttendanceHistory: boolean;
  /** True once the member has used their one self-service legal-name change. */
  nameChangeLocked: boolean;
}

type IdentityContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      effectiveIdentity: NonNullable<Awaited<ReturnType<typeof getEffectiveIdentity>>>;
    };

async function requireIdentity(): Promise<IdentityContext> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) return { error: "No member record" };

  return { supabase, effectiveIdentity };
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

export async function getIdentitySettings(): Promise<IdentitySettings | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const [memberResult, nameAliasResult, emailAliasResult, attendanceCount] = await Promise.all([
    createRepos(supabase).members.profile(effectiveIdentity.memberId),
    supabase
      .from("member_name_aliases")
      .select("id, alias, source, active, created_at")
      .eq("member_id", effectiveIdentity.memberId)
      .order("created_at", { ascending: false }),
    supabase
      .from("member_email_aliases")
      .select("id, alias_email, source, active, created_at")
      .eq("member_id", effectiveIdentity.memberId)
      .order("created_at", { ascending: false }),
    createRepos(supabase).attendance.countForMember(effectiveIdentity.memberId),
  ]);

  return {
    realName: memberResult?.name ?? effectiveIdentity.memberName,
    displayName: memberResult?.displayName ?? null,
    primaryEmail: memberResult?.email ?? effectiveIdentity.memberEmail,
    birthdayMonth: memberResult?.birthdayMonth ?? null,
    birthdayDay: memberResult?.birthdayDay ?? null,
    nameAliases: (nameAliasResult.data ?? []).map((row) => ({
      id: row.id,
      alias: row.alias,
      source: row.source,
      active: row.active,
      createdAt: row.created_at,
    })),
    emailAliases: (emailAliasResult.data ?? []).map((row) => ({
      id: row.id,
      aliasEmail: row.alias_email,
      source: row.source,
      active: row.active,
      createdAt: row.created_at,
    })),
    hasAttendanceHistory: attendanceCount > 0,
    nameChangeLocked: memberResult?.selfServiceNameChangedAt != null,
  };
}

async function updateRealNameImpl(name: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name can't be empty" };
  if (trimmed.length > 200) return { error: "Name is too long" };

  const current = await createRepos(supabase).members.profile(effectiveIdentity.memberId);

  if (!current) return { error: "Couldn't load your member record" };

  if (current.selfServiceNameChangedAt != null) {
    return {
      error: `You've already used your one name change. Email ${SUPPORT_EMAIL} to update it further.`,
    };
  }

  // A no-op save shouldn't burn the one allowed change.
  if (trimmed === current.name) return { success: true };

  if (current.kajabiId) {
    try {
      await createKajabiClient().updateContact(current.kajabiId, { name: trimmed });
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't update your name in Kajabi" };
    }
  }

  const { data, error } = await supabase
    .from("members")
    .update({ name: trimmed, self_service_name_changed_at: new Date().toISOString() })
    .eq("id", effectiveIdentity.memberId)
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Couldn't update your name" };

  revalidatePath("/settings", "layout");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

async function setDisplayNameImpl(alias: string | null): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  if (alias !== null) {
    const { data: row } = await supabase
      .from("member_name_aliases")
      .select("id")
      .eq("member_id", effectiveIdentity.memberId)
      .eq("alias", alias)
      .eq("active", true)
      .maybeSingle();
    if (!row) return { error: "Pick one of your active names" };
  }

  const { data, error } = await supabase
    .from("members")
    .update({ display_name: alias })
    .eq("id", effectiveIdentity.memberId)
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Couldn't update your display name" };

  revalidatePath("/settings", "layout");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

/**
 * Display name typed by hand: makes sure it's one of the member's active pen names (adding or
 * reactivating it), then chooses it. Typing the Real Name just clears the display name.
 */
async function setCustomDisplayNameImpl(name: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name first" };
  if (trimmed.length > 200) return { error: "That name is too long" };

  const member = await createRepos(supabase).members.byId(effectiveIdentity.memberId);
  if (trimmed === (member?.name ?? effectiveIdentity.memberName)) return setDisplayNameImpl(null);

  const { data: existing } = await supabase
    .from("member_name_aliases")
    .select("id, active")
    .eq("member_id", effectiveIdentity.memberId)
    .eq("alias", trimmed)
    .maybeSingle();

  if (!existing) {
    const added = await addNameAliasImpl(trimmed);
    if ("error" in added) return added;
  } else if (!existing.active) {
    const reactivated = await setNameAliasActive(existing.id, true);
    if ("error" in reactivated) return reactivated;
  }

  return setDisplayNameImpl(trimmed);
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

async function updateBirthdayImpl(
  month: number | null,
  day: number | null
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  if ((month === null) !== (day === null)) {
    return { error: "Enter both a month and a day, or leave both blank" };
  }
  if (month !== null && day !== null) {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { error: "That's not a valid month" };
    }
    if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[month - 1]) {
      return { error: "That's not a valid day for that month" };
    }
  }

  const { data, error } = await supabase
    .from("members")
    .update({ birthday_month: month, birthday_day: day })
    .eq("id", effectiveIdentity.memberId)
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Couldn't update your birthday" };

  revalidatePath("/settings", "layout");
  return { success: true };
}

async function addNameAliasImpl(alias: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmed = alias.trim();
  if (!trimmed) return { error: "Enter a name first" };
  if (trimmed.length > 200) return { error: "That name is too long" };

  // Members can't read each other's names, so the check runs as the service role (lib/name-alias-conflict.ts).
  const checked = await findNameAliasConflict(effectiveIdentity.memberId, trimmed);
  if ("error" in checked) return { error: checked.error };
  if (checked.conflict) return { error: MEMBER_NAME_ALIAS_CONFLICT_MESSAGES[checked.conflict.kind] };

  const { error } = await supabase.from("member_name_aliases").insert({
    member_id: effectiveIdentity.memberId,
    alias: trimmed,
    source: "member",
  });

  if (error) {
    // Two members adding the same text at once: the check above passed for both.
    if (isUniqueViolation(error)) return { error: MEMBER_NAME_ALIAS_CONFLICT_MESSAGES.other_alias };
    return { error: error.message };
  }

  // Backfill matching over the recent window so attendance under this name
  // shows up without waiting for the next scheduled reprocess. Runs after
  // the response is sent so the member isn't stuck waiting on it.
  after(() => triggerReprocessing("member_name_aliases", "local"));

  revalidatePath("/settings", "layout");
  return { success: true };
}

export async function setNameAliasActive(
  id: string,
  active: boolean
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  // RLS scopes this to the acting member's own rows (or an admin's, during
  // sudo) -- a zero-row result means the id didn't belong to them, not a
  // silent no-op. This is always a soft toggle (active flag), never a hard
  // delete -- see the migration comment for why.
  const { data, error } = await supabase
    .from("member_name_aliases")
    .update({ active })
    .eq("id", id)
    .eq("member_id", effectiveIdentity.memberId)
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Alias not found" };

  // Reactivating backfills recent matching, same as adding a new one.
  // Deactivating intentionally does NOT trigger reprocessing -- the whole
  // point of the soft delete is that existing historical attendance stays
  // untouched until it's naturally reprocessed for other reasons.
  if (active) {
    after(() => triggerReprocessing("member_name_aliases", "local"));
  }

  revalidatePath("/settings", "layout");
  return { success: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function addEmailAliasImpl(email: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { error: "Enter an email first" };
  if (!EMAIL_RE.test(trimmed)) return { error: "Enter a valid email address" };
  if (trimmed === effectiveIdentity.memberEmail.toLowerCase()) {
    return { error: "That's already your primary email" };
  }

  // canonical_email is filled in from member_id by a trigger.
  const { error } = await supabase.from("member_email_aliases").insert({
    member_id: effectiveIdentity.memberId,
    alias_email: trimmed,
    source: "manual",
  });

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        error: "That email is already registered as an alias, possibly for another member — ask an admin for help.",
      };
    }
    return { error: error.message };
  }

  after(() => triggerReprocessing("member_email_aliases", "local"));

  revalidatePath("/settings", "layout");
  return { success: true };
}

export async function setEmailAliasActive(
  id: string,
  active: boolean
): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const { data, error } = await supabase
    .from("member_email_aliases")
    .update({ active })
    .eq("id", id)
    .eq("member_id", effectiveIdentity.memberId)
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Alias not found" };

  if (active) {
    after(() => triggerReprocessing("member_email_aliases", "local"));
  }

  revalidatePath("/settings", "layout");
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function updateRealName(...args: Parameters<typeof updateRealNameImpl>): ReturnType<typeof updateRealNameImpl> {
  return withAction("real_name_changed", () => updateRealNameImpl(...args));
}

export async function setCustomDisplayName(...args: Parameters<typeof setCustomDisplayNameImpl>): ReturnType<typeof setCustomDisplayNameImpl> {
  return withAction("display_name_changed", () => setCustomDisplayNameImpl(...args));
}

export async function updateBirthday(...args: Parameters<typeof updateBirthdayImpl>): ReturnType<typeof updateBirthdayImpl> {
  return withAction("birthday_saved", () => updateBirthdayImpl(...args));
}

export async function addEmailAlias(...args: Parameters<typeof addEmailAliasImpl>): ReturnType<typeof addEmailAliasImpl> {
  return withAction("email_alias_added", () => addEmailAliasImpl(...args));
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function setDisplayName(...args: Parameters<typeof setDisplayNameImpl>): ReturnType<typeof setDisplayNameImpl> {
  return withAction("display_name_changed", () => setDisplayNameImpl(...args));
}

export async function addNameAlias(...args: Parameters<typeof addNameAliasImpl>): ReturnType<typeof addNameAliasImpl> {
  return withAction("name_alias_added", () => addNameAliasImpl(...args));
}
