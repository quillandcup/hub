import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Navigation from "./Navigation";
import UserMenu from "./UserMenu";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navigation />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Top header bar */}
        <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-end px-6 flex-shrink-0 relative z-30">
          <UserMenu userEmail={user.email || "User"} />
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
