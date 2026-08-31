import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getProject, getArchivedGoals } from "../actions";
import ProjectDetailClient from "./ProjectDetailClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getProject(id);
  if ("error" in result) return { title: "Writing Project" };
  return { title: result.project.title };
}

export default async function WritingProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) redirect("/admin");

  const result = await getProject(id);

  if ("error" in result) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Project not found</h1>
          <Link href="/writing" className="text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Back to Writing Projects
          </Link>
        </div>
      </div>
    );
  }

  const archivedGoals = await getArchivedGoals(id);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/writing" className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">
            ← Writing Projects
          </Link>
          <h1 className="text-2xl font-bold mt-1">{result.project.title}</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <ProjectDetailClient project={result.project} entries={result.entries} archivedGoals={archivedGoals} />
      </main>
    </div>
  );
}
