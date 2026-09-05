import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import EventDetailClient from "./EventDetailClient";

export const metadata: Metadata = {
  title: "Event",
};

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photo_import_error?: string }>;
}) {
  const { id } = await params;
  const { photo_import_error } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("events")) redirect("/admin");

  const { data: event } = await supabase.from("events").select("id, title").eq("id", id).single();
  if (!event) notFound();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/events" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← All Events
          </Link>
          <h1 className="text-2xl font-bold mt-1">{event.title}</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {photo_import_error && (
          <div className="mb-6 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-300">
            Google Photos import didn&apos;t start ({photo_import_error}). Try again.
          </div>
        )}
        <EventDetailClient eventId={id} />
      </main>
    </div>
  );
}
