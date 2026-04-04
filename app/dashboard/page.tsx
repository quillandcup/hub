import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SignOutButton from "./SignOutButton";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Extract name from email (before @) as fallback
  const displayName = user.user_metadata?.name || user.email?.split("@")[0] || "User";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Quill & Cup Admin Portal
          </h1>
          <SignOutButton />
        </div>
      </header>

      <main className="container mx-auto px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg p-12 text-center">
            <div className="mb-8">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-3xl font-bold">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <h2 className="text-4xl font-bold mb-2">
                Welcome, {displayName}!
              </h2>
              <p className="text-slate-600 dark:text-slate-400">
                You're signed in as <span className="font-medium">{user.email}</span>
              </p>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-8">
              <p className="text-slate-600 dark:text-slate-400 mb-6">
                The dashboard is under construction. Check back soon!
              </p>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg">
                <span className="text-2xl">🚀</span>
                <span className="font-medium">Coming Soon: Member Analytics & Session Insights</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
