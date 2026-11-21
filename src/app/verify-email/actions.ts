"use server";

import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { confirmVerification } from "@/lib/email-verification";
import { createRepos } from "@/lib/data/repos";

/** The verify page's button. Authorized by the signed token alone: only the address's inbox has the link. */
export async function confirmEmailFromToken(formData: FormData): Promise<void> {
  await confirmVerification(createRepos(createServiceRoleClient()), String(formData.get("token") ?? ""));
  revalidatePath("/verify-email");
}
