import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import { APP_URL } from "@/lib/config";
import { createRepos } from "@/lib/data/repos";
import { createClient } from "@/lib/supabase/server";
import NewPageButton from "./NewPageButton";
import PagesTable from "./PagesTable";

export const metadata: Metadata = { title: "Pages" };

export default async function AdminPagesPage() {
  await requireAdminPage();
  const pages = await createRepos(await createClient()).landingPages.list();

  return (
    <div className="container mx-auto max-w-6xl px-6 py-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Pages</h1>
        <NewPageButton />
      </div>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
        Landing pages for people who aren&apos;t signed in. Edits save to a draft as you go; nothing is public until you publish.
      </p>
      <PagesTable pages={pages} publicBase={APP_URL} />
    </div>
  );
}
