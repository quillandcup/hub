"use client";

import { useEffect, useState } from "react";
import { loadMemberNotifications, type NotificationsResult } from "./notifications-actions";
import MemberNotificationsPanel from "./MemberNotificationsPanel";

/** The Notifications tab: asks for the member's devices and choices once it is on screen, however the tab was reached. */
export default function MemberNotifications({ memberId, email }: { memberId: string; email: string }) {
  const [result, setResult] = useState<NotificationsResult | null>(null);
  useEffect(() => {
    let current = true;
    loadMemberNotifications(memberId)
      .then((r) => current && setResult(r))
      .catch(() => current && setResult({ error: "Couldn't load the notification settings." }));
    return () => {
      current = false;
    };
  }, [memberId]);

  if (!result) return <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Loading notification settings…</p>;
  if ("error" in result) return <p role="alert" className="text-sm text-red-700 dark:text-red-400">{result.error}</p>;
  return <MemberNotificationsPanel email={email} {...result} />;
}
