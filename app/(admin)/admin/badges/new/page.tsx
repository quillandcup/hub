import Link from "next/link";
import type { Metadata } from "next";
import BadgeTypeForm from "../BadgeTypeForm";

export const metadata: Metadata = {
  title: "New Badge",
};

export default function NewBadgePage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link
            href="/admin/badges"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Badges
          </Link>
          <h1 className="text-2xl font-bold">New Badge</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl">
          <BadgeTypeForm mode="create" />
        </div>
      </main>
    </div>
  );
}
