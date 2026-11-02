"use server";

import { redirect } from "next/navigation";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { takeNextPath } from "@/lib/next-path-cookie";
import type { Database } from "@/lib/data/database.types";

// Don't re-send more often than this, so the public login form can't be used to flood an
// invitee's inbox.
const RESEND_COOLDOWN_MS = 60_000;

function getServiceClient() {
  return createServiceClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Called by the login form when a magic-link request fails with `signup_disabled`. That's what
 * Supabase returns for an invited user who never accepted (e.g. their invite link expired): it
 * treats the request as a signup. If the email has a pending invite, send a fresh one.
 * Unknown emails get `invited: false` and nothing is sent — this never creates a user.
 */
export async function resendPendingInvite(email: string): Promise<{ invited: boolean }> {
  if (!email?.trim()) return { invited: false };

  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("find_pending_invite", { p_email: email });
  if (error) {
    console.error("find_pending_invite failed:", error);
    return { invited: false };
  }

  const pending = (data as { user_id: string; invited_at: string }[] | null)?.[0];
  if (!pending) return { invited: false };

  if (Date.now() - new Date(pending.invited_at).getTime() < RESEND_COOLDOWN_MS) {
    return { invited: true };
  }

  const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email.trim().toLowerCase());
  if (inviteError) {
    console.error("Re-sending invite from login failed:", inviteError);
    return { invited: false };
  }
  return { invited: true };
}

export interface EmailCodeResult {
  error: string;
}

/**
 * The code from the sign-in email, typed on /login. The link in the same email only works in the
 * browser the member asked from (the PKCE verifier lives in that browser's cookies), so opening it
 * from a phone's mail app fails; a code works anywhere. Supabase checks it against the member's own
 * code and applies its per-IP verification limit.
 */
export async function verifyEmailCode(email: string, code: string): Promise<EmailCodeResult> {
  const token = code.replace(/\s+/g, "");
  if (!email?.trim() || !/^\d{6,8}$/.test(token)) {
    return { error: "Enter the code from the email, digits only." };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "email" });
  if (error) {
    return { error: "That code didn't work. It may have expired or been replaced by a newer email. Request a new link." };
  }
  redirect(await takeNextPath());
}
