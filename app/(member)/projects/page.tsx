import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getMyProjects } from "./actions";
import { getMyBooks } from "@/app/(member)/bookshelf/actions";
import { getMyAwards } from "@/app/(member)/awards/actions";
import ProjectsClient from "./ProjectsClient";
import MyBooksPanel from "./MyBooksPanel";
import MyAwardsPanel from "./MyAwardsPanel";

export const metadata: Metadata = {
  title: "Projects",
};

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) redirect("/admin");

  const [projects, books, awards] = await Promise.all([getMyProjects(), getMyBooks(), getMyAwards()]);
  const unlinkedBooks = books.filter((b) => b.projectId === null);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Track what you&apos;re writing, one entry at a time.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-3xl mx-auto mb-6 space-y-6">
          <MyBooksPanel initialBooks={unlinkedBooks} />
          <MyAwardsPanel initialAwards={awards} myBooks={books} />
        </div>
        <ProjectsClient initialProjects={projects} />
      </main>
    </div>
  );
}
