"use server";

import { createClient as createServiceClient } from "@supabase/supabase-js";

// Don't re-send more often than this, so the public login form can't be used to flood an
// invitee's inbox.
const RESEND_COOLDOWN_MS = 60_000;

function getServiceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
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
