import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CHANGELOG_CATEGORIES } from "@/lib/changelog/entries";
import { findChangelogEntry, listChangelog } from "@/lib/changelog";
import ChangelogMarkdown from "@/components/changelog/ChangelogMarkdown";
import ChangelogEntryViewed from "@/components/changelog/ChangelogEntryViewed";

export const dynamicParams = false;

export function generateStaticParams() {
  return listChangelog().map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: PageProps<"/changelog/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const entry = findChangelogEntry(slug);
  return { title: entry ? `${entry.title} · What's new` : "What's new" };
}

export default async function ChangelogEntryPage({ params }: PageProps<"/changelog/[slug]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const entry = findChangelogEntry(slug);
  if (!entry) notFound();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <ChangelogEntryViewed slug={entry.slug} />
      <Link href="/changelog" className="text-sm text-plum-700 dark:text-plum-300 hover:underline">
        ← What&apos;s new
      </Link>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {CHANGELOG_CATEGORIES[entry.category]} · <time dateTime={entry.date}>{entry.date}</time>
      </p>
      <h1 className="mt-1 text-3xl font-bold text-slate-900 dark:text-slate-100 font-serif">{entry.title}</h1>
      <div className="mt-6">
        <ChangelogMarkdown slug={entry.slug} markdown={entry.body} />
      </div>
    </div>
  );
}
