import Link from "next/link";
import { readFileSync } from "fs";
import { join } from "path";
import MarkdownRenderer from "./MarkdownRenderer";

export default function PRDPage() {
  // Read the PRD markdown file
  const prdPath = join(process.cwd(), "docs", "PRD.md");
  const prdContent = readFileSync(prdPath, "utf8");

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <Link href="/" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
            ← Back to Home
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-6 py-12 max-w-4xl">
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-8 md:p-12">
          <MarkdownRenderer content={prdContent} />

          <div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-700">
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
