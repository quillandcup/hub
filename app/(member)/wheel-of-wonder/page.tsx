import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getUserFeaturePreviews } from "@/lib/features.server";
import Wheel from "./Wheel";

export const metadata: Metadata = {
  title: "Wheel of Wonder",
};

export const maxDuration = 60;

export default async function WheelOfWonderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [effectiveIdentity, enabledFeatures, confirmedMatchesResult] = await Promise.all([
    getEffectiveIdentity(user),
    getUserFeaturePreviews(user.id),
    supabase
      .from("wheel_of_wonder_matches")
      .select("*", { count: "exact", head: true })
      .eq("status", "confirmed"),
  ]);
  if (!effectiveIdentity) redirect("/admin");
  if (!enabledFeatures.includes("wheel_of_wonder")) redirect("/dashboard");

  const confirmedConnectionCount = confirmedMatchesResult.count ?? 0;

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="max-w-xl mx-auto mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Wheel of Wonder</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Give the Wheel of Wonder a spin and find out who&apos;s online right now. It leans toward
          hedgies who could use a new connection.
        </p>
      </div>
      <div className="flex justify-center">
        <Wheel confirmedConnectionCount={confirmedConnectionCount} />
      </div>
    </div>
  );
}
