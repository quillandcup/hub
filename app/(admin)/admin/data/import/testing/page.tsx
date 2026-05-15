import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import KajabiImportForm from "../KajabiImportForm";
import SlackImportForm from "../SlackImportForm";

export default async function TestingImportPage() {
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
          <Link href="/data/import" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Production Import
          </Link>
          <h1 className="text-2xl font-bold">CSV Import (Testing)</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            File-based imports for development and testing. Use the <Link href="/data/import" className="text-blue-600 dark:text-blue-400 underline">production import page</Link> for API-based imports.
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Kajabi CSV Import */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Kajabi CSV Import</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Import member and subscription data from Kajabi CSV exports, then process to populate members table and track hiatus periods.
              </p>
              <details className="text-sm text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer font-medium hover:text-slate-700 dark:hover:text-slate-300">
                  How to Export from Kajabi
                </summary>
                <div className="mt-2 pl-4 space-y-2">
                  <p className="font-semibold text-green-600 dark:text-green-400">Members Export</p>
                  <p className="pl-4"><a href="https://app.kajabi.com/admin/sites/2147577478/contacts?segment_id=members&is_member=true" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">Open Customers in Kajabi</a> → Select All → Bulk Action "Export"</p>
                  <p className="text-xs text-slate-400">Expected columns: Name, Email, Products, Tags, Member Created At</p>

                  <p className="mt-3 font-semibold text-green-600 dark:text-green-400">Subscriptions Export</p>
                  <p className="pl-4">Go to <a href="https://app.kajabi.com/admin/sites/2147577478/payments/subscriptions" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">Payments → Subscriptions</a> → Click the three dots (...) → Export subscriptions</p>
                  <p className="text-xs text-slate-400">Expected columns: Customer Name, Customer Email, Status, Created At, Offer Title</p>
                </div>
              </details>
            </div>

            <KajabiImportForm />
          </div>

          {/* Slack CSV Import */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Slack CSV Import</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Import Slack data from CSV exports, then process it to create member activity records.
              </p>
              <details className="text-sm text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer font-medium hover:text-slate-700 dark:hover:text-slate-300">
                  How to Export from Slack
                </summary>
                <div className="mt-2 pl-4 space-y-2">
                  <p><strong>Step 1: Set SLACK_BOT_TOKEN environment variable</strong></p>
                  <p className="pl-4">Get your token from Slack App settings and add to <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">.env.local</code></p>
                  <p><strong>Step 2: Run export script</strong></p>
                  <p className="pl-4"><code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">npx tsx scripts/export-slack-data.ts 30 exports</code></p>
                  <p className="text-xs text-slate-400">(exports last 30 days to exports/ directory)</p>
                  <p><strong>Step 3: Upload the 4 generated CSV files below</strong></p>
                  <p className="pl-4">Files: slack_users.csv, slack_channels.csv, slack_messages.csv, slack_reactions.csv</p>
                </div>
              </details>
            </div>

            <SlackImportForm />
          </div>

          {/* TODO: Zoom CSV Import */}
          <div className="bg-slate-100 dark:bg-slate-800 rounded-lg shadow p-6 border-2 border-dashed border-slate-300 dark:border-slate-700">
            <h2 className="text-xl font-bold mb-2 text-slate-700 dark:text-slate-300">Zoom CSV Import</h2>
            <p className="text-slate-600 dark:text-slate-400">
              TODO: Add CSV upload option for Zoom meeting data for testing purposes.
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-500 mt-2">
              Use the <Link href="/data/import" className="text-blue-600 dark:text-blue-400 underline">production import page</Link> for API-based Zoom imports.
            </p>
          </div>

          {/* TODO: Calendar CSV Import */}
          <div className="bg-slate-100 dark:bg-slate-800 rounded-lg shadow p-6 border-2 border-dashed border-slate-300 dark:border-slate-700">
            <h2 className="text-xl font-bold mb-2 text-slate-700 dark:text-slate-300">Calendar CSV Import</h2>
            <p className="text-slate-600 dark:text-slate-400">
              TODO: Add CSV upload option for Google Calendar event data for testing purposes.
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-500 mt-2">
              Use the <Link href="/data/import" className="text-blue-600 dark:text-blue-400 underline">production import page</Link> for API-based calendar sync.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
