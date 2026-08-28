import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import type { FeatureKey } from "@/lib/features";
import AdminNavigation from "./admin/AdminNavigation";
import UserMenu from "@/components/UserMenu";
import FeedbackWidget from "@/components/FeedbackWidget";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Access Denied
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            You don&apos;t have permission to access the admin area.
          </p>
          <a
            href="/dashboard"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Return to my view
          </a>
        </div>
      </div>
    );
  }

  const enabledFeatures: FeatureKey[] = await getUserFeaturePreviews(user.id);

  let members: { id: string; name: string; email: string }[] = []
  let offset = 0
  const BATCH_SIZE = 1000
  let hasMore = true
  while (hasMore) {
    const { data: batch } = await supabase
      .from("members")
      .select("id, name, email")
      .order("name")
      .range(offset, offset + BATCH_SIZE - 1)
    if (batch && batch.length > 0) {
      members = members.concat(batch)
      offset += batch.length
      hasMore = batch.length === BATCH_SIZE
    } else {
      hasMore = false
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <AdminNavigation enabledFeatures={enabledFeatures} />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end px-6 flex-shrink-0 relative z-30">
          <UserMenu
            userEmail={user.email || "User"}
            isAdmin={true}
            members={members}
            enabledFeatures={enabledFeatures}
          />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
      <FeedbackWidget />
    </div>
  );
}
