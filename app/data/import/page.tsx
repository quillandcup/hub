import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ZoomImportAndProcessForm from "./ZoomImportAndProcessForm";
import CalendarImportForm from "./CalendarImportForm";
import ApplyAliasesButton from "./ApplyAliasesButton";
import ManualReprocessingSection from "./ManualReprocessingSection";

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
          {/* Kajabi API Import - TODO */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Kajabi API Import</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Import member and subscription data directly from Kajabi API.
              </p>
            </div>

            {/* TODO: Create KajabiApiImportForm component using KAJABI_CLIENT_ID/KAJABI_CLIENT_SECRET */}
            <div className="p-6 bg-yellow-50 dark:bg-yellow-900/20 border-2 border-dashed border-yellow-300 dark:border-yellow-700 rounded-lg">
              <p className="text-yellow-800 dark:text-yellow-200 font-semibold mb-2">
                🚧 Coming Soon: API-Based Import
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                This will use the Kajabi API to fetch members and subscriptions directly. For now, use the <Link href="/data/import/testing" className="underline">CSV testing import page</Link>.
              </p>
            </div>
          </div>

          {/* Apply Member Aliases */}
          <ApplyAliasesButton />

          {/* Google Calendar Import */}
          <CalendarImportForm />

          {/* Slack API Import - TODO */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Slack API Import</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Import Slack data directly from Slack API (users, channels, messages, reactions).
              </p>
            </div>

            {/* TODO: Create SlackApiImportForm component using SLACK_BOT_TOKEN - convert scripts/export-slack-data.ts into API endpoint */}
            <div className="p-6 bg-yellow-50 dark:bg-yellow-900/20 border-2 border-dashed border-yellow-300 dark:border-yellow-700 rounded-lg">
              <p className="text-yellow-800 dark:text-yellow-200 font-semibold mb-2">
                🚧 Coming Soon: API-Based Import
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                This will use the Slack API to fetch users, channels, messages, and reactions directly. For now, use the <Link href="/data/import/testing" className="underline">CSV testing import page</Link>.
              </p>
            </div>
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
