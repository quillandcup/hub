import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getEffectiveIdentity } from "@/lib/sudo";
import { getMyProjects } from "./actions";
import { getMyBooks } from "@/app/(member)/bookshelf/actions";
import { getMyAwards } from "@/app/(member)/awards/actions";
import ProjectsClient from "./ProjectsClient";
import MyBooksPanel from "./MyBooksPanel";
import MyAwardsPanel from "./MyAwardsPanel";
import { Tabs } from "@/components/Tabs";
import { RememberTabUrl } from "@/components/ReturnToTab";

/** My Writing tabs, at /projects (Projects) and /projects/<id> (lib/tab-routes.ts). */
export const MY_WRITING_TAB_IDS = ["projects", "books", "awards"] as const;
export type MyWritingTabId = (typeof MY_WRITING_TAB_IDS)[number];
export const MY_WRITING_TITLE = "My Writing";
export const MY_WRITING_TAB_LABELS: Record<MyWritingTabId, string> = {
  projects: "Projects",
  books: "Books",
  awards: "Awards",
};

/** My Writing, rendered by /projects and each /projects/<tab> route with that tab open. */
export default async function ProjectsPage({ tab }: { tab: MyWritingTabId }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) redirect("/admin");

  const [projects, books, awards] = await Promise.all([getMyProjects(), getMyBooks(), getMyAwards()]);
  const projectTitles = Object.fromEntries(projects.map((p) => [p.id, p.title]));

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">My Writing</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Track what you&apos;re writing, the books you&apos;ve published, and the awards you&apos;ve won.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Suspense fallback={null}>
          <RememberTabUrl path="/projects" />
        </Suspense>
        <Tabs
          key={tab}
          initialTab={tab}
          basePath="/projects"
          pageTitle={{ section: MY_WRITING_TITLE }}
          className="max-w-3xl mx-auto"
          tabs={[
            {
              id: "projects",
              label: MY_WRITING_TAB_LABELS.projects,
              content: <ProjectsClient initialProjects={projects} />,
            },
            {
              id: "books",
              label: MY_WRITING_TAB_LABELS.books,
              content: <MyBooksPanel initialBooks={books} projectTitles={projectTitles} />,
            },
            {
              id: "awards",
              label: MY_WRITING_TAB_LABELS.awards,
              content: <MyAwardsPanel initialAwards={awards} myBooks={books} />,
            },
          ]}
        />
      </main>
    </div>
  );
}
