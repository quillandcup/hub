import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import ProgramDetailClient from "./ProgramDetailClient";

export const metadata: Metadata = {
  title: "Program",
};

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("program_cohorts")) redirect("/admin");

  const { data: program } = await supabase.from("programs").select("id, name").eq("id", id).single();
  if (!program) notFound();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/programs" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← All Programs
          </Link>
          <h1 className="text-2xl font-bold mt-1">{program.name}</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <ProgramDetailClient programId={id} />
      </main>
    </div>
  );
}
