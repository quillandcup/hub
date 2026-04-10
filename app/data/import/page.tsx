import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ZoomImportAndProcessForm from "./ZoomImportAndProcessForm";
import MemberImportForm from "./MemberImportForm";
import SubscriptionImportForm from "./SubscriptionImportForm";
import CalendarImportForm from "./CalendarImportForm";
import SlackImportForm from "./SlackImportForm";
import ApplyAliasesButton from "./ApplyAliasesButton";

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
          <Link href="/dashboard" className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Import Data</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Member CSV Import & Process */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Member Import & Processing</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Upload a CSV file with member data, then process it to populate the members table.
              </p>
              <details className="text-sm text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer font-medium hover:text-slate-700 dark:hover:text-slate-300">
                  CSV Format Details
                </summary>
                <div className="mt-2 pl-4 space-y-2">
                  <p className="font-semibold text-green-600 dark:text-green-400">Recommended: Kajabi Members Export</p>
                  <p className="pl-4">Go to Contacts → All Contacts → Filter "Customers" → Select All → Bulk Action "Export"</p>
                  <p className="text-xs text-slate-400">Expected columns: Name, Email, Products, Tags, Member Created At</p>
                  <p className="mt-2"><strong>Alternative: Kajabi Subscriptions Export</strong> (auto-detected, but use Members export for best results)</p>
                  <p className="text-xs text-slate-400">Expected columns: Customer Name, Customer Email, Status, Created At, Offer Title</p>
                  <p className="mt-2"><strong>Custom CSV:</strong> Include columns: name, email, joined_at, status (active/inactive/on_hiatus), plan (optional)</p>
                </div>
              </details>
            </div>

            <MemberImportForm />
          </div>

          {/* Subscription Import for Hiatus Tracking */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Subscription Import (Hiatus Tracking)</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Upload subscription CSV exports to track hiatus periods over time. Re-export and upload regularly (weekly/monthly) to detect status changes.
              </p>
              <details className="text-sm text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer font-medium hover:text-slate-700 dark:hover:text-slate-300">
                  How It Works
                </summary>
                <div className="mt-2 pl-4 space-y-2">
                  <p>• Export subscriptions CSV from <a href="https://app.kajabi.com/admin/sites/2147577478/payments/subscriptions" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">Kajabi Payments → Subscriptions</a></p>
                  <p>• Upload the CSV here to create a snapshot</p>
                  <p>• System compares snapshots over time to detect when members pause/resume</p>
                  <p>• Hiatus periods are automatically tracked in member profiles and dashboard</p>
                  <p className="text-yellow-600 dark:text-yellow-400 font-medium">⚠️ Regular exports required: Upload weekly or monthly to track changes accurately</p>
                </div>
              </details>
            </div>

            <SubscriptionImportForm />
          </div>

          {/* Apply Member Aliases */}
          <ApplyAliasesButton />

          {/* Google Calendar Import */}
          <CalendarImportForm />

          {/* Slack Import & Processing */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Slack Import & Processing</h2>
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
                  <p className="pl-4"><code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">npx ts-node scripts/export-slack-data.ts 30 exports</code></p>
                  <p className="text-xs text-slate-400">(exports last 30 days to exports/ directory)</p>
                  <p><strong>Step 3: Upload the 4 generated CSV files below</strong></p>
                  <p className="pl-4">Files: slack_users.csv, slack_channels.csv, slack_messages.csv, slack_reactions.csv</p>
                </div>
              </details>
            </div>

            <SlackImportForm />
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
        </div>
      </main>
    </div>
  );
}
