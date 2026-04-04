import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ZoomImportForm from "./ZoomImportForm";
import MemberImportForm from "./MemberImportForm";

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
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Member CSV Import */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Member Import (CSV)</h2>
              <p className="text-slate-600 dark:text-slate-400 mb-3">
                Upload a CSV file with member data. Automatically detects Kajabi exports or custom CSV format.
              </p>
              <details className="text-sm text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer font-medium hover:text-slate-700 dark:hover:text-slate-300">
                  CSV Format Details
                </summary>
                <div className="mt-2 pl-4 space-y-2">
                  <p><strong>Kajabi Export:</strong> Go to Contacts → All Contacts → Filter "Customers" → Select All → Bulk Action "Export"</p>
                  <p><strong>Custom CSV:</strong> Include columns: name, email, joined_at, status (active/inactive/on_hiatus), plan (optional)</p>
                </div>
              </details>
            </div>

            <MemberImportForm />
          </div>

          {/* Zoom Attendance Import */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Zoom Attendance Import</h2>
              <p className="text-slate-600 dark:text-slate-400">
                Import Zoom meeting attendance data for a specific date range.
                This will fetch all meetings and participants from Zoom and store them in the database.
              </p>
            </div>

            <ZoomImportForm />
          </div>
        </div>
      </main>
    </div>
  );
}
