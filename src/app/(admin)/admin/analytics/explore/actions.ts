"use server";

import { requireAdminAction } from "@/lib/admin-auth";
import { isEventName } from "@/lib/analytics/events";
import { isDeclaredProperty } from "@/lib/analytics/explore";

const SUGGESTION_WINDOW_MS = 90 * 24 * 60 * 60_000;
const MAX_SUGGESTIONS = 30;

/**
 * The values a property actually has in the log (most frequent first, last 90 days), so a filter
 * box can offer them instead of asking for one from memory. Empty for anything the tracking plan
 * doesn't declare.
 */
export async function suggestFilterValues(event: string, property: string): Promise<string[]> {
  const auth = await requireAdminAction();
  if (!auth.ok) return [];
  if (!isEventName(event) || !isDeclaredProperty(event, property)) return [];

  const { data, error } = await auth.supabase.rpc("analytics_property_breakdown", {
    event_name: event,
    property,
    since: new Date(Date.now() - SUGGESTION_WINDOW_MS).toISOString(),
  });
  if (error) return [];
  return (data as { value: string | null }[])
    .map((row) => row.value)
    .filter((value): value is string => value !== null)
    .slice(0, MAX_SUGGESTIONS);
}
