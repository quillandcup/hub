"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { triggerReprocessing } from "@/lib/processing/trigger";
import { revalidatePath } from "next/cache";

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
  primaryEmail: string;
  nameAliases: NameAliasRow[];
  emailAliases: EmailAliasRow[];
  /** Heuristic only — nothing links a specific alias to the attendance it
   * produced, so this just flags "you have history, be careful" rather than
   * "this specific alias is load-bearing". See migration
   * 20260831170000_add_alias_self_service.sql. */
  hasAttendanceHistory: boolean;
}

type IdentityContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      effectiveIdentity: NonNullable<Awaited<ReturnType<typeof getEffectiveIdentity>>>;
    };

async function requireIdentity(): Promise<IdentityContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const [memberResult, nameAliasResult, emailAliasResult, attendanceResult] = await Promise.all([
    supabase.from("members").select("name, email").eq("id", effectiveIdentity.memberId).single(),
    supabase
      .from("member_name_aliases")
      .select("id, alias, source, active, created_at")
      .eq("member_id", effectiveIdentity.memberId)
      .order("created_at", { ascending: false }),
    supabase
      .from("member_email_aliases")
      .select("id, alias_email, source, active, created_at")
      .eq("canonical_email", effectiveIdentity.memberEmail)
      .order("created_at", { ascending: false }),
    supabase
      .from("prickle_attendance")
      .select("id", { count: "exact", head: true })
      .eq("member_id", effectiveIdentity.memberId),
  ]);

  return {
    realName: memberResult.data?.name ?? effectiveIdentity.memberName,
    primaryEmail: memberResult.data?.email ?? effectiveIdentity.memberEmail,
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
    hasAttendanceHistory: (attendanceResult.count ?? 0) > 0,
  };
}

export async function updateRealName(name: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name can't be empty" };
  if (trimmed.length > 200) return { error: "Name is too long" };

  const { data, error } = await supabase
    .from("members")
    .update({ name: trimmed })
    .eq("id", effectiveIdentity.memberId)
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Couldn't update your name" };

  revalidatePath("/settings");
  revalidatePath(`/members/${effectiveIdentity.memberId}`);
  return { success: true };
}

export async function addNameAlias(alias: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmed = alias.trim();
  if (!trimmed) return { error: "Enter a name first" };
  if (trimmed.length > 200) return { error: "That name is too long" };

  const { error } = await supabase.from("member_name_aliases").insert({
    member_id: effectiveIdentity.memberId,
    alias: trimmed,
    source: "member",
  });

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        error: "That name is already registered as an alias for someone — ask an admin for help if it's actually yours.",
      };
    }
    return { error: error.message };
  }

  // Backfill matching over the recent window so attendance under this name
  // shows up without waiting for the next scheduled reprocess. Runs after
  // the response is sent so the member isn't stuck waiting on it.
  after(() => triggerReprocessing("member_name_aliases", "local"));

  revalidatePath("/settings");
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

  revalidatePath("/settings");
  return { success: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addEmailAlias(email: string): Promise<{ success: true } | { error: string }> {
  const ctx = await requireIdentity();
  if ("error" in ctx) return ctx;
  const { supabase, effectiveIdentity } = ctx;

  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { error: "Enter an email first" };
  if (!EMAIL_RE.test(trimmed)) return { error: "Enter a valid email address" };
  if (trimmed === effectiveIdentity.memberEmail.toLowerCase()) {
    return { error: "That's already your primary email" };
  }

  const { error } = await supabase.from("member_email_aliases").insert({
    canonical_email: effectiveIdentity.memberEmail,
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

  revalidatePath("/settings");
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
    .eq("canonical_email", effectiveIdentity.memberEmail)
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Alias not found" };

  if (active) {
    after(() => triggerReprocessing("member_email_aliases", "local"));
  }

  revalidatePath("/settings");
  return { success: true };
}
