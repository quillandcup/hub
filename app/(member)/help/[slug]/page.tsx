import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listHelpArticles, loadHelpArticle } from "@/lib/help";
import { SUPPORT_EMAIL } from "@/lib/config";
import HelpMarkdown from "@/components/help/HelpMarkdown";
import HelpArticleViewed from "@/components/help/HelpArticleViewed";

export const dynamicParams = false;

export function generateStaticParams() {
  return listHelpArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: PageProps<"/help/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = loadHelpArticle(slug);
  return { title: article ? `${article.title} · Hedgie Help` : "Hedgie Help" };
}

export default async function HelpArticlePage({ params }: PageProps<"/help/[slug]">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { slug } = await params;
  const article = loadHelpArticle(slug);
  if (!article) notFound();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <HelpArticleViewed slug={article.slug} />
      <Link href="/help" className="text-sm text-plum-700 dark:text-plum-300 hover:underline">
        ← Hedgie Help
      </Link>
      <h1 className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100 font-serif">{article.title}</h1>
      <div className="mt-6">
        <HelpMarkdown markdown={article.body} />
      </div>
      <p className="mt-10 text-sm text-slate-600 dark:text-slate-400">
        Still stuck?{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-plum-700 dark:text-plum-300 underline">
          Email support
        </a>
        .
      </p>
    </div>
  );
}
