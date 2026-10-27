import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { requireAdminPage } from "@/lib/admin-auth";
import CalendarEventsClient from "./CalendarEventsClient";

export const metadata: Metadata = {
  title: "Calendar items · Events",
};

export default async function CalendarEventsPage() {
  await requireAdminPage();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("events")) redirect("/admin");

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin/events" className="text-sm text-plum-600 dark:text-plum-400 hover:underline">
            ← Events
          </Link>
          <h1 className="text-2xl font-bold mt-1">Calendar items</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Everything coming up on the shared calendar. Show an item in Events to give it a page members can open; its title, description and
            location follow the calendar until you change them. You can also add #event to an item&apos;s description in Google Calendar, or
            open it from the admin calendar.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <CalendarEventsClient />
      </main>
    </div>
  );
}
