import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ZoomImportAndProcessForm from "./ZoomImportAndProcessForm";
import CalendarImportForm from "./CalendarImportForm";
import SlackApiImportForm from "./SlackApiImportForm";
import ApplyAliasesButton from "./ApplyAliasesButton";
import ManualReprocessingSection from "./ManualReprocessingSection";
import KajabiApiImportForm from "./KajabiApiImportForm";

export default async function ImportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/dashboard" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
                ← Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold">Import Data</h1>
            </div>
            <Link
              href="/data/import/testing"
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-lg transition-colors text-sm"
            >
              CSV Testing Import →
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Kajabi API Import */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Kajabi API Import</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Import member and subscription data directly from Kajabi API.
              </p>
            </div>

            <KajabiApiImportForm />
          </div>

          {/* Apply Member Aliases */}
          <ApplyAliasesButton />

          {/* Google Calendar Import */}
          <CalendarImportForm />

          {/* Slack API Import */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Slack API Import</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Import Slack data directly from Slack API (users, channels, messages, reactions).
              </p>
            </div>

            <SlackApiImportForm />
          </div>

          {/* Zoom Attendance Import & Process */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Zoom Import & Processing</h2>
              <p className="text-slate-600 dark:text-slate-400">
                Import Zoom meeting attendance for a date range, then process it to match attendees to members and create attendance records.
              </p>
            </div>

            <ZoomImportAndProcessForm />
          </div>

          {/* Manual Reprocessing */}
          <ManualReprocessingSection />
        </div>
      </main>
    </div>
  );
}
