import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-auth";
import MediaLibraryClient from "./MediaLibraryClient";

export const metadata: Metadata = {
  title: "Media",
};

export default async function MediaPage() {
  await requireAdminPage();

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Media</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Images for events, book covers and course thumbnails: upload once, pick again anywhere. Sizes are made automatically.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <MediaLibraryClient />
      </main>
    </div>
  );
}
