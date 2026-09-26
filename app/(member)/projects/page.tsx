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
import { Tabs } from "@/components/Tabs";

export const metadata: Metadata = {
  title: "My Writing",
};

const TAB_IDS = ["projects", "books", "awards"] as const;
type TabId = (typeof TAB_IDS)[number];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const effectiveIdentity = await getEffectiveIdentity(user);
  if (!effectiveIdentity) redirect("/admin");

  const { tab: rawTab } = await searchParams;
  const initialTab: TabId = (TAB_IDS as readonly string[]).includes(rawTab ?? "") ? (rawTab as TabId) : "projects";

  const [projects, books, awards] = await Promise.all([getMyProjects(), getMyBooks(), getMyAwards()]);
  const projectTitles = Object.fromEntries(projects.map((p) => [p.id, p.title]));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">My Writing</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Track what you&apos;re writing, the books you&apos;ve published, and the awards you&apos;ve won.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Tabs
          key={initialTab}
          initialTab={initialTab}
          className="max-w-3xl mx-auto"
          tabs={[
            {
              id: "projects",
              label: "Projects",
              content: <ProjectsClient initialProjects={projects} />,
            },
            {
              id: "books",
              label: "Books",
              content: <MyBooksPanel initialBooks={books} projectTitles={projectTitles} />,
            },
            {
              id: "awards",
              label: "Awards",
              content: <MyAwardsPanel initialAwards={awards} myBooks={books} />,
            },
          ]}
        />
      </main>
    </div>
  );
}
