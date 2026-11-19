import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import LandingRender from "@/components/landing/LandingRender";
import { requireAdminPage } from "@/lib/admin-auth";
import { createRepos } from "@/lib/data/repos";
import { withLiveData } from "@/lib/landing/live-server";
import { isValidSlug } from "@/lib/landing/slug";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Preview · Pages", robots: { index: false } };

/** The draft as a visitor would see it, for admins only: drafts never render on the public route. */
export default async function PreviewLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdminPage();
  const { slug } = await params;
  if (!isValidSlug(slug)) notFound();
  const page = await createRepos(await createClient()).landingPages.bySlug(slug);
  if (!page) notFound();
  return (
    <>
      <div role="note" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
        Preview of the draft{page.status === "published" ? " (the live page may differ)" : ""}.{" "}
        <Link href={`/admin/pages/${page.slug}`} className="underline">
          Back to the editor
        </Link>
      </div>
      <LandingRender data={await withLiveData(page.draft_data)} />
    </>
  );
}
