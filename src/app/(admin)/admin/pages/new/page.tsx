import type { Metadata } from "next";
import { requirePermission } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { aiConfigured } from "@/lib/landing/ai";
import { createClient } from "@/lib/supabase/server";
import NewPageForm from "./NewPageForm";

export const metadata: Metadata = { title: "New page · Pages" };

/** "Build with AI" calls the Claude API from the form's action, which can take a minute or two. */
export const maxDuration = 120;

export default async function NewLandingPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePermission("pages.edit");
  const { type } = await searchParams;
  const templates = await createRepos(await createClient()).landingPages.usableTemplates();
  return (
    <div className="container mx-auto max-w-xl px-6 py-8">
      <h1 className="mb-6 text-3xl font-bold">New page</h1>
      <NewPageForm aiAvailable={aiConfigured()} defaultType={type === "landing" ? "landing" : "website"} templates={templates.map((t) => ({ id: t.id, name: t.title, pageType: t.pageType }))} />
    </div>
  );
}
