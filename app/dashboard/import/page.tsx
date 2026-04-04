import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ImportForm from "./ImportForm";

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
          <h1 className="text-2xl font-bold">Import Zoom Data</h1>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Zoom Attendance Import</h2>
              <p className="text-slate-600 dark:text-slate-400">
                Import Zoom meeting attendance data for a specific date range.
                This will fetch all meetings and participants from Zoom and store them in the database.
              </p>
            </div>

            <ImportForm />
          </div>
        </div>
      </main>
    </div>
  );
}
