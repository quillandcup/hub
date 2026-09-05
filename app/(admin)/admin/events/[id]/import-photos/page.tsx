import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getImportSessionCookie } from "@/lib/google-photos-picker/import-session-cookie";
import ImportPhotosClient from "./ImportPhotosClient";

export const metadata: Metadata = {
  title: "Import Photos",
};

export default async function ImportPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("events")) redirect("/admin");

  const { data: event } = await supabase.from("events").select("id, title").eq("id", id).single();
  if (!event) notFound();

  const session = await getImportSessionCookie(id);
  if (!session) {
    redirect(`/admin/events/${id}?photo_import_error=no_session`);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href={`/admin/events/${id}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            ← {event.title}
          </Link>
          <h1 className="text-2xl font-bold mt-1">Import Photos from Google Photos</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-2xl">
        <ImportPhotosClient eventId={id} pickerUri={session.pickerUri} />
      </main>
    </div>
  );
}
