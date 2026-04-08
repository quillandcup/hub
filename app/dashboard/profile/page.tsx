import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          Profile Settings
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Manage your account preferences and settings
        </p>
      </div>

      <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6">
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
                <p className="text-sm text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-md">
                  {user.email}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
            <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-4">
              Preferences
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Default Timezone
                </label>
                <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                  Timezone preferences will be available in a future update
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              More profile settings and customization options coming soon.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
