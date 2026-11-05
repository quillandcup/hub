import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CHANGELOG_CATEGORIES } from "@/lib/changelog/entries";
import { changelogEntryPath, listProductChangelog } from "@/lib/changelog";

export const metadata: Metadata = { title: "What's new" };

export default async function ChangelogPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const entries = listProductChangelog();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 font-serif">What&apos;s new</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-400">
        What we&apos;ve added and fixed in the Hedgie Hub. Choose how you hear about updates in{" "}
        <Link href="/settings/notifications" className="text-plum-700 dark:text-plum-300 underline">
          Settings → Notifications
        </Link>
        .
      </p>

      {entries.length === 0 ? (
        <p className="mt-8 text-slate-600 dark:text-slate-400">Nothing yet.</p>
      ) : (
        <ul className="mt-8 space-y-6">
          {entries.map((e) => (
            <li key={e.slug}>
              <Link
                href={changelogEntryPath(e.slug) ?? "/changelog"}
                className="block rounded-xl border border-slate-200 bg-white p-5 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/50"
              >
                <span className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  {CHANGELOG_CATEGORIES[e.category]} · <time dateTime={e.date}>{e.date}</time>
                </span>
                <span className="mt-1 block text-lg font-semibold text-slate-900 dark:text-slate-100">{e.title}</span>
                <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">{e.summary}</span>
                {e.image && (
                  // eslint-disable-next-line @next/next/no-img-element -- a committed screenshot
                  <img src={e.image.src} alt={e.image.alt} loading="lazy" className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
