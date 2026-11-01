import { describe, it, expect } from "vitest";
import { SupabaseNotificationRepository } from "@/lib/data/notifications";
import { createFakeSupabase } from "@/tests/helpers/server-page";

// preferencesForKind keeps each `.in("member_id", ...)` URL short by loading in chunks.
describe("SupabaseNotificationRepository.preferencesForKind chunking", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);

  it("loads preferences in chunks for large batches", async () => {
    const fake = createFakeSupabase();
    await new SupabaseNotificationRepository(fake as never).preferencesForKind("prickle_checkin", ids(450));

    expect(fake.queries.filter((q) => q.table === "notification_preferences")).toHaveLength(3);
  });

  it("throws, rather than returning partial preferences, when a later chunk fails", async () => {
    let batch = 0;
    const fake = createFakeSupabase({ notification_preferences: () => (++batch === 1 ? { data: [] } : { error: { message: "unavailable" } }) });

    await expect(new SupabaseNotificationRepository(fake as never).preferencesForKind("prickle_checkin", ids(201))).rejects.toThrow("unavailable");
  });
});
