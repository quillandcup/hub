import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { createRepos } from "@/lib/data/repos";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import Wheel from "./Wheel";

export const metadata: Metadata = {
  title: "Wheel of Wonder",
};

export const maxDuration = 60;

export default async function WheelOfWonderPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [effectiveIdentity, confirmedConnectionCount] = await Promise.all([
    getEffectiveIdentity(user),
    createRepos(supabase).wheelOfWonder.confirmedCount(),
  ]);
  if (!effectiveIdentity) redirect("/admin");

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="max-w-xl mx-auto mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Wheel of Wonder</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Give the Wheel of Wonder a spin and find out who&apos;s online right now. It leans toward
          Hedgies who could use a new connection.
        </p>
      </div>
      <div className="flex justify-center">
        <Wheel confirmedConnectionCount={confirmedConnectionCount} />
      </div>
    </div>
  );
}
