import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-auth";
import { CHANGELOG_AUDIENCES, CHANGELOG_CATEGORIES } from "@/lib/changelog/entries";
import { findAnyChangelogEntry, listChangelog } from "@/lib/changelog";
import ChangelogMarkdown from "@/components/changelog/ChangelogMarkdown";

export const dynamicParams = false;

export function generateStaticParams() {
  return listChangelog().map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: PageProps<"/admin/changelog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const entry = findAnyChangelogEntry(slug);
  return { title: entry ? `${entry.title} · Changelog` : "Changelog" };
}

/** One changelog entry, product or engineering (an engineering entry has no member page). */
export default async function AdminChangelogEntryPage({ params }: PageProps<"/admin/changelog/[slug]">) {
  await requireAdminPage();

  const { slug } = await params;
  const entry = findAnyChangelogEntry(slug);
  if (!entry) notFound();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Link href="/admin/changelog" className="text-sm text-plum-700 dark:text-plum-300 hover:underline">
        ← Changelog
      </Link>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {CHANGELOG_AUDIENCES[entry.audience]} · {CHANGELOG_CATEGORIES[entry.category]} · <time dateTime={entry.date}>{entry.date}</time>
        {entry.major && (
          <span className="ml-2 rounded-full bg-plum-700 px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-white">Major</span>
        )}
      </p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-slate-100 font-serif">{entry.title}</h1>
      <p className="mt-3 text-slate-700 dark:text-slate-300">{entry.summary}</p>
      <div className="mt-6">
        <ChangelogMarkdown slug={entry.slug} markdown={entry.body} />
      </div>
      {entry.audience === "product" && (
        <p className="mt-8 text-sm text-slate-600 dark:text-slate-400">
          <Link href={`/changelog/${entry.slug}`} className="text-plum-700 dark:text-plum-300 underline">
            See it as members do
          </Link>
        </p>
      )}
    </div>
  );
}
