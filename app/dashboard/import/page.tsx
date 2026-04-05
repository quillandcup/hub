import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ZoomImportAndProcessForm from "./ZoomImportAndProcessForm";
import MemberImportForm from "./MemberImportForm";
import CalendarImportForm from "./CalendarImportForm";

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
                  <p className="font-semibold text-green-600 dark:text-green-400">Recommended: Kajabi Subscriptions Export</p>
                  <p className="pl-4">Go to <a href="https://app.kajabi.com/admin/sites/2147577478/payments/subscriptions" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">Payments → Subscriptions</a> → Click the three dots (...) → Export subscriptions</p>
                  <p className="mt-2"><strong>Alternative: Kajabi Members Export:</strong> Go to Contacts → All Contacts → Filter "Customers" → Select All → Bulk Action "Export"</p>
                  <p><strong>Custom CSV:</strong> Include columns: name, email, joined_at, status (active/inactive/on_hiatus), plan (optional)</p>
                </div>
              </details>
            </div>

            <MemberImportForm />
          </div>

          {/* Google Calendar Import */}
          <CalendarImportForm />

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
