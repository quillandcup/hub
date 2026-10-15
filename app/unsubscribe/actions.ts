"use server";

import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { parseUnsubscribeToken, setEmailEnabled } from "@/lib/email-unsubscribe";

/** The unsubscribe page's button: `enabled` is "true" to turn the kind's emails back on. Authorized by the signed token alone. */
export async function setEmailFromToken(formData: FormData): Promise<void> {
  const parsed = parseUnsubscribeToken(String(formData.get("token") ?? ""));
  if (!parsed) return;
  await setEmailEnabled(createServiceRoleClient(), parsed.memberId, parsed.kind, formData.get("enabled") === "true");
  revalidatePath("/unsubscribe");
}
