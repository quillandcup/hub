"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { fetchRecordHistory, type ActivityFeedRow, type HistoryScope } from "@/lib/activity-feed";

/** The change history behind a record's clock icon (components/RecordHistoryButton.tsx). */
export async function loadRecordHistory(
  entityTypes: string[],
  entityId: string | null,
  scope: HistoryScope = {}
): Promise<{ rows: ActivityFeedRow[] } | { error: string }> {
  const auth = await requireAdminAction();
  if (!auth.ok) return { error: auth.error };

  try {
    return { rows: await fetchRecordHistory(auth.supabase, entityTypes, entityId, scope) };
  } catch (err) {
    console.error("Error loading record history:", err);
    return { error: "Couldn't load the history." };
  }
}
