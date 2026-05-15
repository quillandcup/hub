import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminNavigation from "./admin/AdminNavigation";
import UserMenu from "@/components/UserMenu";

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
            href="/calendar"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Return to my view
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <AdminNavigation />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end px-6 flex-shrink-0 relative z-30">
          <UserMenu userEmail={user.email || "User"} />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
