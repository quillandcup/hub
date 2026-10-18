"use client";

import { useEffect, useRef } from "react";
import { setAnalyticsUserId } from "@/lib/analytics-identity";

/**
 * Keeps GA's user_id in step with who is signed in when that changes without a
 * full page load. The first load is covered by the inline script in
 * app/layout.tsx; after a sign-in or sign-out the root layout re-renders with
 * the new user, but that script doesn't run again.
 *
 * Starts from the first render's user, which that inline script already sent
 * (or, for an anonymous visitor, correctly didn't: Google says not to send
 * user_id for someone who never signed in), so only real changes reach GA.
 */
export function AnalyticsIdentity({ userId }: { userId: string | null }) {
  const sent = useRef<string | null>(userId);

  useEffect(() => {
    if (userId === sent.current) return;
    setAnalyticsUserId(userId);
    sent.current = userId;
  }, [userId]);

  return null;
}
