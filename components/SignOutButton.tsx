"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface SignOutButtonProps {
  onSignOut?: () => void;
}

export default function SignOutButton({ onSignOut }: SignOutButtonProps = {}) {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    onSignOut?.();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <button
      onClick={handleSignOut}
      className="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
    >
      Sign Out
    </button>
  );
}
