// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { MEMBER_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import type { EventRow } from "@/lib/data/events";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

const previews = vi.fn(async (_userId: string): Promise<string[]> => ["events"]);
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: (id: string) => previews(id) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: async () => "America/New_York" }));
vi.mock("@/app/(member)/events/past/PastEventsBrowser", () => ({
  default: (props: { initialMonth: string | null; events: { title: string }[] }) => (
    <div data-testid="browser">{props.initialMonth ?? "none"}|{props.events.map((e) => e.title).join(",")}</div>
  ),
}));

import PastEventsPage from "@/app/(member)/events/past/page";

const event = (id: string, title: string, starts_at: string, ends_at = starts_at, extra: Partial<EventRow> = {}): EventRow => ({
  id: `evnt_AAAAAAAAAAA${id}`, slug: `e${id}`, title, event_type: "other", starts_at, ends_at, ...extra,
});

beforeEach(() => {
  resetServerPageMocks();
  previews.mockResolvedValue(["events"]);
  signInAs(MEMBER_USER);
  useFakeSupabase({});
  dataset = new InMemoryDataset({
    events: [
      event("1", "Old Retreat", "2020-03-01", "2020-03-03"),
      event("2", "Far Future", "2097-04-01"),
      event("3", "Removed", "2020-05-01", "2020-05-01", { deleted_at: "2020-06-01T00:00:00Z" }),
      event("4", "Book Fair", "2020-07-01", "2020-07-01", { speakers: "Ada Example" }),
    ],
  });
});

describe("member past events page", () => {
  it("hands the browser the events that have ended, not the upcoming or removed ones, named the way members know them", async () => {
    await renderServerPage(PastEventsPage, { searchParams: Promise.resolve({ month: "2020-03" }) });

    expect(screen.getByTestId("browser")).toHaveTextContent("2020-03|Book Fair with Ada Example,Old Retreat");
    expect(screen.getByRole("link", { name: "← Upcoming events" })).toHaveAttribute("href", "/events");
  });

  it("passes no month when none is asked for", async () => {
    await renderServerPage(PastEventsPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByTestId("browser")).toHaveTextContent(/^none\|/);
  });

  it("sends a member without the events feature to the dashboard", async () => {
    previews.mockResolvedValue([]);

    await expectRedirect(PastEventsPage, { searchParams: Promise.resolve({}) }, "/dashboard");
  });
});
