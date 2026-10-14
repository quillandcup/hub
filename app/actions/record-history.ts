"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { fetchRecordHistory, type ActivityFeedRow } from "@/lib/activity-feed";

/** The change history behind a record's clock icon (components/RecordHistoryButton.tsx). */
export async function loadRecordHistory(
  entityType: string,
  entityId: string
): Promise<{ rows: ActivityFeedRow[] } | { error: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  try {
    return { rows: await fetchRecordHistory(auth.supabase, entityType, entityId) };
  } catch (err) {
    console.error("Error loading record history:", err);
    return { error: "Couldn't load the history." };
  }
}
