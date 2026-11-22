// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requirePermission: vi.fn(async () => undefined) }));
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/badges/BadgeTypeForm", () => ({
  default: (props: { mode: string; awardCount?: number; events: { id: string }[]; initial?: { name: string; hasLevels: boolean; levels: { name: string; threshold: string }[]; eventId: string | null } }) => (
    <pre data-testid="form">{JSON.stringify({ mode: props.mode, awardCount: props.awardCount, events: props.events.map((e) => e.id), initial: props.initial })}</pre>
  ),
}));
vi.mock("@/app/(admin)/admin/badges/[id]/recipients/BadgeRecipientsTable", () => ({
  default: ({ recipients }: { recipients: { memberName: string }[] }) => <pre data-testid="recipients">{recipients.map((r) => r.memberName).join(",")}</pre>,
}));
vi.mock("@/app/(admin)/admin/badges/[id]/recipients/AwardBadgeForm", () => ({ default: () => null }));

import BadgesPage from "@/app/(admin)/admin/badges/page";
import NewBadgePage from "@/app/(admin)/admin/badges/new/page";
import EditBadgePage, { generateMetadata as editMetadata } from "@/app/(admin)/admin/badges/[id]/edit/page";
import RecipientsPage, { generateMetadata as recipientsMetadata } from "@/app/(admin)/admin/badges/[id]/recipients/page";

const type = (id: string, over: object = {}) => ({
  id, key: id, name: `Badge ${id}`, description: null, icon: "🏅", category: "community", has_levels: false, is_automatic: false, program_id: null, event_id: null, ...over,
});
const award = (id: string, memberId: string, badgeTypeId: string) => ({ id, memberId, badgeTypeId, occurredAt: "2026-03-01", note: null, eventId: null, awardedBy: null });
const ADA = { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.test" };
const FERN = { id: "mbr_AAAAAAAAAAA2", name: "Fern Example", email: "fern@example.test" };
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  resetServerPageMocks();
  dataset = new InMemoryDataset({
    members: [ADA, FERN],
    ...eventSeed([
      { id: "evt-1", title: "Spring", slug: "spring", starts_at: "2026-03-01" },
      { id: "evt-2", title: "Autumn", slug: "autumn", starts_at: "2026-09-01" },
    ]),
    badgeTypes: [type("kind", { has_levels: true }), type("auto", { is_automatic: true }), type("retreat", { category: "retreat", event_id: "evt-1" })],
    badgeLevels: [{ id: "l1", badge_type_id: "kind", level: 1, name: "Warm", threshold: 1 }, { id: "l2", badge_type_id: "kind", level: 2, name: "Glowing", threshold: 5 }],
    memberBadges: [award("a1", ADA.id, "kind"), award("a2", FERN.id, "kind"), award("a3", ADA.id, "retreat")],
  });
});

describe("badges list page", () => {
  it("lists the badge types by category with their level names and how many were awarded", async () => {
    await renderServerPage(BadgesPage, {});

    expect(screen.getByText("Badge kind")).toBeInTheDocument();
    expect(screen.getByText("Warm → Glowing")).toBeInTheDocument();
    expect(screen.getByText("2 awarded")).toBeInTheDocument();
    expect(screen.getByText("1 awarded")).toBeInTheDocument();
    expect(screen.getByText("computed automatically")).toBeInTheDocument();
  });

  it("shows Finisher, Author and Published Author as automatic counted badges, with the real-count text instead of steps", async () => {
    const levels = (id: string, label: string) =>
      [1, 3, 5, 10].map((threshold, i) => ({ id: `${id}-${i}`, badge_type_id: id, level: i + 1, name: i === 0 ? label : `${threshold}x ${label}`, threshold }));
    dataset = new InMemoryDataset({
      members: [ADA],
      badgeTypes: [
        type("finisher", { name: "Finisher", has_levels: true, counted: true, is_automatic: true }),
        type("author", { name: "Author", has_levels: true, counted: true, is_automatic: true }),
        type("published_author", { name: "Published Author", has_levels: true, counted: true, is_automatic: true }),
        type("hostess", { name: "Hostess", has_levels: true, is_automatic: true }),
      ],
      badgeLevels: [...levels("finisher", "Finisher"), ...levels("author", "Author"), ...levels("published_author", "Published Author"), ...levels("hostess", "Hostess")],
    });
    await renderServerPage(BadgesPage, {});

    const text = screen.getAllByTestId("counted-badge-text").map((el) => el.textContent);
    expect([...text].sort()).toEqual([
      "Shows the real count: Author → 2x Author → 3x Author …",
      "Shows the real count: Finisher → 2x Finisher → 3x Finisher …",
      "Shows the real count: Published Author → 2x Published Author → 3x Published Author …",
    ]);
    expect(text).toHaveLength(3);
    // The old step list is gone for them, and a leveled badge that is not counted keeps its levels.
    expect(screen.queryByText(/→ 3x Finisher → 5x/)).not.toBeInTheDocument();
    expect(screen.queryByText(/→ 3x Published Author → 5x/)).not.toBeInTheDocument();
    expect(screen.getByText("Hostess → 3x Hostess → 5x Hostess → 10x Hostess")).toBeInTheDocument();
    expect(screen.getAllByText("Automatic")).toHaveLength(4);
    expect(screen.getAllByText("computed automatically")).toHaveLength(4);
  });
});

describe("new badge page", () => {
  it("offers only the events that don't have a badge yet", async () => {
    await renderServerPage(NewBadgePage, {});

    expect(JSON.parse(screen.getByTestId("form").textContent!)).toMatchObject({ mode: "create", events: ["evt-2"] });
  });
});

describe("edit badge page", () => {
  it("fills the form from the badge type, its levels and its award count, offering its own event too", async () => {
    await renderServerPage(EditBadgePage, idParams("retreat"));

    expect(JSON.parse(screen.getByTestId("form").textContent!)).toMatchObject({
      mode: "edit",
      awardCount: 1,
      events: ["evt-2", "evt-1"], // newest first
      initial: { name: "Badge retreat", eventId: "evt-1" },
    });
  });

  it("shows the levels with their thresholds", async () => {
    await renderServerPage(EditBadgePage, idParams("kind"));

    expect(JSON.parse(screen.getByTestId("form").textContent!).initial).toMatchObject({ hasLevels: true, levels: [{ name: "Warm", threshold: "1" }, { name: "Glowing", threshold: "5" }] });
  });

  it("is not found for a badge type that doesn't exist, and titles the page", async () => {
    await expect(renderServerPage(EditBadgePage, idParams("missing"))).rejects.toThrow();
    expect(await editMetadata(idParams("kind"))).toEqual({ title: "Badge kind" });
    expect(await editMetadata(idParams("missing"))).toEqual({ title: "Edit Badge" });
  });
});

describe("badge recipients page", () => {
  it("lists the members awarded a manual badge, by name", async () => {
    await renderServerPage(RecipientsPage, idParams("kind"));

    expect(screen.getByTestId("recipients")).toHaveTextContent("Ada Example");
    expect(screen.getByTestId("recipients")).toHaveTextContent("Fern Example");
  });

  it("is not found for an unknown badge, and titles the page", async () => {
    await expect(renderServerPage(RecipientsPage, idParams("missing"))).rejects.toThrow();
    expect(await recipientsMetadata(idParams("kind"))).toEqual({ title: "Badge kind recipients" });
    expect(await recipientsMetadata(idParams("missing"))).toEqual({ title: "Badge recipients" });
  });
});
