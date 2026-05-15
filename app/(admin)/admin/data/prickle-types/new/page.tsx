import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NewPrickleTypeForm from "./NewPrickleTypeForm";

export default async function NewPrickleTypePage() {
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
          <Link
            href="/data/prickle-types"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm mb-2 inline-block"
          >
            ← Back to Prickle Types
          </Link>
          <h1 className="text-2xl font-bold">Create New Prickle Type</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Add a new type of prickle to categorize writing sessions
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-2xl">
          <NewPrickleTypeForm />
        </div>
      </main>
    </div>
  );
}
