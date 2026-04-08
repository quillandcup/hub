import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { TimezoneSwitcher } from "./TimezoneSwitcher";

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch user profile to get timezone preference
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("timezone_preference")
    .eq("id", user.id)
    .single();

  const timezonePreference = profile?.timezone_preference || "browser";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Profile Settings</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Manage your account preferences and settings
          </p>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="bg-white dark:bg-slate-900 shadow rounded-lg p-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-4">
                Account Information
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Email
                  </label>
                  <p className="text-sm text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 px-3 py-2 rounded-md">
                    {user.email}
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
              <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-4">
                Preferences
              </h2>
              <div className="space-y-6">
                <ThemeSwitcher />

                <TimezoneSwitcher initialTimezone={timezonePreference} />
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
