"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { isValidTimeZone } from "@/lib/time-zone";

import { withAction } from "@/lib/analytics/server";
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
//
// The three session functions below intentionally keep the network
// getUser() rather than getCurrentUser()'s local JWT verification: they
// act on auth sessions themselves, so they should confirm with Supabase Auth
// that the caller's own session is still live, not just that its JWT hasn't
// expired yet. They're rare, user-initiated calls, so the round trip is cheap.

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

async function revokeSessionImpl(sessionId: string) {
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

  revalidatePath("/settings", "layout");
  return { success: true };
}

// Bulk revoke: the only session operation Supabase Auth itself exposes
// directly (scope: 'others' signs out every session except the one making
// this request). Deliberately does not accept a session id — "others" is a
// server-side concept in GoTrue keyed off the request's own access token.
async function signOutOtherSessionsImpl() {
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

  revalidatePath("/settings", "layout");
  return { success: true };
}

/** Saves the member's time zone, an IANA name ("browser" and other non-zones are refused). */
async function updateTimezonePreferenceImpl(timezone: string) {
  if (!isValidTimeZone(timezone)) {
    return { error: "Choose a valid time zone" };
  }

  const supabase = await createClient();

  const user = await getCurrentUser();

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

  revalidatePath("/settings", "layout");
  return { success: true };
}

/** Saves (or, with null, turns off) the member's secondary time zone, shown beside their own on prickle times. */
async function updateSecondaryTimezoneImpl(timezone: string | null) {
  if (timezone !== null && !isValidTimeZone(timezone)) {
    return { error: "Choose a valid time zone" };
  }

  const supabase = await createClient();

  const user = await getCurrentUser();

  if (!user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("user_profiles")
    .update({ secondary_timezone: timezone })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts).
export async function updateTimezonePreference(...args: Parameters<typeof updateTimezonePreferenceImpl>): ReturnType<typeof updateTimezonePreferenceImpl> {
  return withAction("timezone_changed", () => updateTimezonePreferenceImpl(...args));
}

export async function updateSecondaryTimezone(...args: Parameters<typeof updateSecondaryTimezoneImpl>): ReturnType<typeof updateSecondaryTimezoneImpl> {
  return withAction("secondary_timezone_changed", () => updateSecondaryTimezoneImpl(...args));
}

export async function revokeSession(...args: Parameters<typeof revokeSessionImpl>): ReturnType<typeof revokeSessionImpl> {
  return withAction("session_revoked", () => revokeSessionImpl(...args));
}

export async function signOutOtherSessions(...args: Parameters<typeof signOutOtherSessionsImpl>): ReturnType<typeof signOutOtherSessionsImpl> {
  return withAction("session_revoked", () => signOutOtherSessionsImpl(...args));
}
