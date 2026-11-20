import { requireAdminPage } from "@/lib/admin-auth";
import { Tabs } from "@/components/Tabs";
import { APP_URL } from "@/lib/config";
import { createRepos } from "@/lib/data/repos";
import { editorNames, UNKNOWN_EDITOR } from "@/lib/landing/template-people";
import { createClient } from "@/lib/supabase/server";
import NewPageButton from "./NewPageButton";
import PagesTable from "./PagesTable";
import TemplatesPanel from "./templates/TemplatesPanel";

/** Admin > Pages: the pages, and the saved templates to start them from. The tabs are paths (`/admin/pages`, `/admin/pages/templates`). */
export const PAGES_TAB_IDS = ["pages", "templates"] as const;
export type PagesTab = (typeof PAGES_TAB_IDS)[number];
export const PAGES_TAB_LABELS: Record<PagesTab, string> = { pages: "Pages", templates: "Templates" };
export const PAGES_SECTION = "Pages";

export default async function PagesAdminPage({ tab }: { tab: PagesTab }) {
  await requireAdminPage();
  const repos = createRepos(await createClient());
  const [pages, templates] = await Promise.all([repos.landingPages.list(), repos.landingTemplates.list()]);
  const names = await editorNames(repos, templates.map((t) => t.updated_by));

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Pages</h1>
        <NewPageButton />
      </div>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Landing pages for people who aren&apos;t signed in. Edits save to a draft as you go; nothing is public until you publish.
      </p>
      <Tabs
        key={tab}
        initialTab={tab}
        basePath="/admin/pages"
        pageTitle={{ section: PAGES_SECTION }}
        tabs={[
          { id: "pages", label: PAGES_TAB_LABELS.pages, content: <PagesTable pages={pages} publicBase={APP_URL} /> },
          {
            id: "templates",
            label: PAGES_TAB_LABELS.templates,
            content: (
              <TemplatesPanel
                templates={templates.map((t) => ({
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  versions: t.current_version,
                  updatedBy: (t.updated_by && names.get(t.updated_by)) || UNKNOWN_EDITOR,
                  updatedAt: t.updated_at,
                }))}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
