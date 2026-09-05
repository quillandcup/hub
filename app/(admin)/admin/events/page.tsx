import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import EventsClient from "./EventsClient";

export const metadata: Metadata = {
  title: "Events",
};

export default async function EventsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("events")) redirect("/admin");

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Retreats and other events — dates, location, agenda, and a photo gallery imported from Google Photos.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <EventsClient />
      </main>
    </div>
  );
}
