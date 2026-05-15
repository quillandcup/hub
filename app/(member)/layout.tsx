import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import MemberNavigation from "@/components/MemberNavigation";
import UserMenu from "@/components/UserMenu";

export default async function MemberLayout({
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

  const isAdmin = profile?.role === "admin";

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <MemberNavigation isAdmin={isAdmin} />
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
