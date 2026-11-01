// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, renderServerPage, resetServerPageMocks, signInAs } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: vi.fn(async () => ["work_queue"]) }));

// Roles and everything the page lists come from the repositories, in memory here.
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));
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
  dataset = new InMemoryDataset();
  resetServerPageMocks();
  signInAs(ADMIN_USER);
});

describe("work queue page", () => {
  it("names each member in the queue by display name, falling back to the legal name", async () => {
    const today = new Date().toISOString().slice(0, 10);
    dataset = new InMemoryDataset({
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E", firstJoinedAt: "2025-01-01", totalActiveMonths: 3 },
        { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", firstJoinedAt: "2025-01-01", totalActiveMonths: 3 },
      ],
      memberHiatuses: [
        { id: "hia_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", start_date: "2026-01-01", end_date: today, reason: null, notes: null, created_at: null, created_by: null, updated_at: "2026-01-01T00:00:00Z" },
        { id: "hia_AAAAAAAAAAA2", member_id: "mbr_AAAAAAAAAAA2", start_date: "2026-01-01", end_date: today, reason: null, notes: null, created_at: null, created_by: null, updated_at: "2026-01-01T00:00:00Z" },
      ],
    });

    await renderServerPage(WorkQueuePage, {});

    const names = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(names.sort()).toEqual(["Ada E", "Bo Example"]);
  });
});
