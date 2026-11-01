// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: vi.fn(async () => ["work_queue"]) }));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/work-queue/WorkQueueSections", () => ({
  default: ({ welcomeBackQueue }: { welcomeBackQueue: { memberName: string }[] }) => (
    <ul aria-label="welcome back">
      {welcomeBackQueue.map((i) => (
        <li key={i.memberName}>{i.memberName}</li>
      ))}
    </ul>
  ),
}));

import WorkQueuePage from "@/app/(admin)/admin/work-queue/page";

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
});

describe("work queue page", () => {
  it("names each member in the queue by display name, falling back to the legal name", async () => {
    const today = new Date().toISOString().slice(0, 10);
    useFakeSupabase({
      members: {
        data: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", display_name: "Ada E", first_joined_at: "2025-01-01", total_active_months: 3 },
          { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", display_name: null, first_joined_at: "2025-01-01", total_active_months: 3 },
        ],
      },
      member_hiatus_history: {
        data: [
          { id: "h1", member_id: "mbr_AAAAAAAAAAA1", start_date: "2026-01-01", end_date: today },
          { id: "h2", member_id: "mbr_AAAAAAAAAAA2", start_date: "2026-01-01", end_date: today },
        ],
      },
    });

    await renderServerPage(WorkQueuePage, {});

    const names = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(names.sort()).toEqual(["Ada E", "Bo Example"]);
  });
});
