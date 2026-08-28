import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserFeaturePreviews } from "@/lib/features.server";
import PrickleWizard from "./PrickleWizard";

export const metadata: Metadata = {
  title: "Prickle Picker",
};

const BATCH_SIZE = 1000;

export default async function PrickleWizardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [effectiveIdentity, enabledFeatures] = await Promise.all([
    getEffectiveIdentity(user),
    getUserFeaturePreviews(user.id),
  ]);
  if (!effectiveIdentity) redirect("/admin");
  if (!enabledFeatures.includes("prickle_picker")) redirect("/calendar");

  let members: { id: string; name: string; email: string }[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch } = await supabase
      .from("members")
      .select("id, name, email")
      .order("name")
      .range(offset, offset + BATCH_SIZE - 1);
    if (batch && batch.length > 0) {
      members = members.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  // Exclude the hedgie herself from the "who do you want to see" picker.
  const otherMembers = members.filter((m) => m.id !== effectiveIdentity.memberId);

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="max-w-xl mx-auto mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Prickle Picker</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Tell us what you&apos;re after and we&apos;ll find the prickle for it.
        </p>
      </div>
      <div className="flex justify-center">
        <PrickleWizard members={otherMembers} />
      </div>
    </div>
  );
}
