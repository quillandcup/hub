"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { pauseBrowserPush } from "@/lib/browser-push";
import { setAnalyticsUserId } from "@/lib/analytics-identity";

interface SignOutButtonProps {
  onSignOut?: () => void;
}

export default function SignOutButton({ onSignOut }: SignOutButtonProps = {}) {
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    onSignOut?.();
    // Pause while the member is still authenticated; local unsubscribe also works if the server fails.
    // Cleanup errors must never trap someone in a signed-in session.
    try {
      await pauseBrowserPush();
    } catch (error) {
      console.error("[notifications] Clearing browser push on sign-out failed", error);
    }
    // Before navigating, so the /login page view isn't credited to this user.
    setAnalyticsUserId(null);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <button
      onClick={handleSignOut}
      data-track="user-menu-sign-out"
      className="block w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
    >
      Sign Out
    </button>
  );
}
