import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import ProgramsClient from "./ProgramsClient";

export const metadata: Metadata = {
  title: "Programs",
};

export default async function ProgramsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("program_cohorts")) redirect("/admin");

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Programs</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Cohort-based programs and courses (180 Program, Self-Editing Academy, ...) — manage cohorts,
            enroll members, and see who hasn&apos;t converted after their window lapsed.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <ProgramsClient />
      </main>
    </div>
  );
}
