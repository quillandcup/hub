import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { TimezoneSwitcher } from "./TimezoneSwitcher";
import { SessionsPanel } from "./SessionsPanel";
import { IdentityPanel } from "./IdentityPanel";
import { getUserFeaturePreviews } from "@/lib/features.server";
import { getHostedVibes } from "@/app/(member)/prickle-picker/actions";
import HostVibePanel from "@/components/HostVibePanel";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch user profile to get timezone preference
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("timezone_preference, role")
    .eq("id", user.id)
    .single();

  const timezonePreference = profile?.timezone_preference || "browser";

  // Feature previews are currently admin-only (see MemberLayout), so mirror
  // that gating here rather than showing the vibe panel to everyone.
  const isAdmin = profile?.role === "admin";
  const enabledFeatures = isAdmin ? await getUserFeaturePreviews(user.id) : [];
  const hostedVibes = enabledFeatures.includes("prickle_picker") ? await getHostedVibes() : [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">Settings</h1>
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
                Identity
              </h2>
              <IdentityPanel />
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

            <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
              <SessionsPanel />
            </div>

            <HostVibePanel hostedVibes={hostedVibes} />
          </div>
        </div>
      </main>
    </div>
  );
}
