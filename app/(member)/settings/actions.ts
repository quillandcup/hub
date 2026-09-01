"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface SessionRow {
  id: string;
  created_at: string;
  updated_at: string | null;
  refreshed_at: string | null;
  not_after: string | null;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean;
}

// Self-service session management. Deliberately scoped to the *real*
// authenticated auth user (supabase.auth.getUser()), not getEffectiveIdentity
// — sessions belong to auth.users, not to the members table, so sudo'd
// identity is irrelevant here even on member-facing pages. See
// supabase/migrations/20260827150000_create_session_management_functions.sql
// for why these are the only two session operations Supabase Auth actually
// supports self-service (list + revoke-by-id via a SECURITY DEFINER RPC
// scoped to auth.uid(), and bulk "sign out everywhere else" via the
// supabase-js signOut({ scope }) API — there's no per-session revoke in
// supabase-js itself).

export type GetMySessionsResult =
  | { sessions: SessionRow[]; error?: undefined }
  | { sessions?: undefined; error: string };

export async function getMySessions(): Promise<GetMySessionsResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { data, error } = await supabase.rpc("get_my_sessions");

  if (error) {
    return { error: error.message };
  }

  return { sessions: (data ?? []) as SessionRow[] };
}

export async function revokeSession(sessionId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { data, error } = await supabase.rpc("revoke_my_session", {
    target_session_id: sessionId,
  });

  if (error) {
    return { error: error.message };
  }

  if (!data) {
    return { error: "That session was already signed out" };
  }

  revalidatePath("/settings");
  return { success: true };
}

// Bulk revoke: the only session operation Supabase Auth itself exposes
// directly (scope: 'others' signs out every session except the one making
// this request). Deliberately does not accept a session id — "others" is a
// server-side concept in GoTrue keyed off the request's own access token.
export async function signOutOtherSessions() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase.auth.signOut({ scope: "others" });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/settings");
  return { success: true };
}

export async function updateTimezonePreference(timezone: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("user_profiles")
    .update({ timezone_preference: timezone })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/settings");
  return { success: true };
}
