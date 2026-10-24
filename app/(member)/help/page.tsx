import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { helpArticlePath, listHelpArticles } from "@/lib/help";
import { SUPPORT_EMAIL } from "@/lib/config";

export const metadata: Metadata = { title: "Hedgie Help" };

export default async function HelpPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const articles = listHelpArticles();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 font-serif">Hedgie Help</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-400">How things work in the Hedgie House.</p>

      {articles.length === 0 ? (
        <p className="mt-8 text-slate-500 dark:text-slate-400">No articles yet.</p>
      ) : (
        <ul className="mt-8 divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {articles.map((a) => (
            <li key={a.slug}>
              <Link href={helpArticlePath(a.slug) ?? "/help"} className="block px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{a.title}</span>
                {a.summary && <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">{a.summary}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-sm text-slate-600 dark:text-slate-400">
        Can&apos;t find it?{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-plum-700 dark:text-plum-300 underline">
          Email support
        </a>
        .
      </p>
    </div>
  );
}
