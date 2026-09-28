import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReturnToTabLink } from "@/components/ReturnToTab";
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
  if ("error" in result) return { title: "Project" };
  return { title: result.project.title };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) redirect("/admin");

  const result = await getProject(id);

  if ("error" in result) {
    return (
      <div className="min-h-screen bg-canvas dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Project not found</h1>
          <ReturnToTabLink path="/projects" fallbackHref="/projects" className="text-plum-600 hover:text-plum-700 dark:text-plum-400">
            ← Back to My Writing
          </ReturnToTabLink>
        </div>
      </div>
    );
  }

  const archivedGoals = await getArchivedGoals(id);

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <ReturnToTabLink path="/projects" fallbackHref="/projects" className="text-sm text-plum-600 hover:text-plum-700 dark:text-plum-400">
            ← My Writing
          </ReturnToTabLink>
          <h1 className="text-2xl font-bold mt-1">{result.project.title}</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <ProjectDetailClient project={result.project} entries={result.entries} archivedGoals={archivedGoals} />
      </main>
    </div>
  );
}
