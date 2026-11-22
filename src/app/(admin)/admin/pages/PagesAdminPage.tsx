import { requireAdminPage } from "@/lib/admin-auth";
import { Tabs } from "@/components/Tabs";
import { APP_URL } from "@/lib/config";
import { createRepos } from "@/lib/data/repos";
import { siteVersionSummaries } from "@/lib/landing/site-versions";
import { createClient } from "@/lib/supabase/server";
import NewPageButton from "./NewPageButton";
import DesignEditor from "./design/DesignEditor";
import PagesTable from "./PagesTable";

/**
 * Admin > Pages: one sheet with a tab for the website pages (shared header, footer and style), one for the landing pages
 * (standalone), one for the templates to start them from, and Design: the header and footer the website pages share. The tabs
 * are paths (`/admin/pages`, `/admin/pages/landing`, `/admin/pages/templates`, `/admin/pages/design`).
 */
export const PAGES_TAB_IDS = ["website", "landing", "templates", "design"] as const;
export type PagesTab = (typeof PAGES_TAB_IDS)[number];
export const PAGES_TAB_LABELS: Record<PagesTab, string> = { website: "Website", landing: "Landing", templates: "Templates", design: "Design" };
export const PAGES_SECTION = "Pages";

export default async function PagesAdminPage({ tab }: { tab: PagesTab }) {
  await requireAdminPage();
  const repos = createRepos(await createClient());
  const [website, landing, templates, usable, site, siteVersions] = await Promise.all([
    repos.landingPages.list("page", "website"),
    repos.landingPages.list("page", "landing"),
    repos.landingPages.list("template"),
    repos.landingPages.usableTemplates(),
    repos.landingSiteTemplate.state(),
    siteVersionSummaries(repos),
  ]);

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Pages</h1>
        <NewPageButton defaultType={tab === "landing" ? "landing" : "website"} templates={usable.map((t) => ({ id: t.id, name: t.title, pageType: t.pageType }))} />
      </div>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Website pages are the connected pages of the site (home, ...). Landing pages stand alone, for one purpose such as a sign-up or a campaign. Edits save to a draft as you go; nothing is public until you publish. Templates are pages you keep to start other pages from: they are never public.
      </p>
      <Tabs
        key={tab}
        initialTab={tab}
        basePath="/admin/pages"
        pageTitle={{ section: PAGES_SECTION }}
        tabs={[
          { id: "website", label: `${PAGES_TAB_LABELS.website} (${website.length})`, title: PAGES_TAB_LABELS.website, content: <PagesTable pages={website} publicBase={APP_URL} pageType="website" /> },
          { id: "landing", label: `${PAGES_TAB_LABELS.landing} (${landing.length})`, title: PAGES_TAB_LABELS.landing, content: <PagesTable pages={landing} publicBase={APP_URL} pageType="landing" /> },
          { id: "templates", label: `${PAGES_TAB_LABELS.templates} (${templates.length})`, title: PAGES_TAB_LABELS.templates, content: <PagesTable pages={templates} publicBase={APP_URL} kind="template" /> },
          {
            id: "design",
            label: PAGES_TAB_LABELS.design,
            content: (
              <DesignEditor
                initial={site.draft}
                publishedAt={site.publishedAt}
                hasPublished={site.published !== null}
                unpublished={site.published === null || JSON.stringify(site.draft) !== JSON.stringify(site.published)}
                versions={siteVersions}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
