// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ADMIN_USER, expectRedirect, renderServerPage, resetServerPageMocks, signInAs, useFakeSupabase } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { eventSeed } from "@/tests/helpers/event-fixtures";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
vi.mock("@/lib/features.server", () => ({ getUserFeaturePreviews: async () => ["events"] }));
vi.mock("@/components/RecordHistoryButton", () => ({ default: () => null }));
vi.mock("@/app/(admin)/admin/events/[slug]/EventDetailClient", () => ({ default: ({ eventId }: { eventId: string }) => <div data-testid="client">{eventId}</div> }));
vi.mock("@/app/(admin)/admin/events/[slug]/import-photos/ImportPhotosClient", () => ({
  default: ({ eventId, slug }: { eventId: string; slug: string }) => <div data-testid="import">{eventId}|{slug}</div>,
}));
vi.mock("@/lib/google-photos-picker/import-session-cookie", () => ({ getImportSessionCookie: async () => ({ pickerUri: "https://picker.example.test" }) }));
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

import EventPage from "@/app/(admin)/admin/events/[slug]/page";
import ImportPhotosPage from "@/app/(admin)/admin/events/[slug]/import-photos/page";

const ID = "evt_AAAAAAAAAAA1";
const params = (slug: string) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  resetServerPageMocks();
  signInAs(ADMIN_USER);
  useFakeSupabase({});
  dataset = new InMemoryDataset(eventSeed([
    { id: ID, slug: "spring-retreat", title: "Spring Retreat" },
    { id: "evt_AAAAAAAAAAA2", slug: "quiet-one", title: "Quiet One", deleted_at: "2097-01-01T00:00:00Z" },
  ]));
});

describe("admin event page at /admin/events/<slug>", () => {
  it("opens the event with that slug, and one that is removed from Events too", async () => {
    await renderServerPage(EventPage, params("spring-retreat"));
    expect(screen.getByRole("heading", { name: "Spring Retreat" })).toBeInTheDocument();
    expect(screen.getByTestId("client")).toHaveTextContent(ID);

    await renderServerPage(EventPage, params("quiet-one"));
    expect(screen.getByRole("heading", { name: "Quiet One" })).toBeInTheDocument();
  });

  it("is a 404 for a slug no event has", async () => {
    await expect(renderServerPage(EventPage, params("nope"))).rejects.toThrow();
  });

  it("sends an older link that carries the event's id to its slug, keeping the import error", async () => {
    await expectRedirect(EventPage, { params: Promise.resolve({ slug: ID }), searchParams: Promise.resolve({ photo_import_error: "start_failed" }) }, "/admin/events/spring-retreat?photo_import_error=start_failed");
    await expectRedirect(EventPage, params(ID), "/admin/events/spring-retreat");
  });

  it("is a 404 for an id no event has", async () => {
    await expect(renderServerPage(EventPage, params("evt_ZZZZZZZZZZZ9"))).rejects.toThrow();
  });
});

describe("photo import page at /admin/events/<slug>/import-photos", () => {
  it("hands the client the event's id and slug, sends the id form to the slug, and 404s on an unknown slug", async () => {
    await renderServerPage(ImportPhotosPage, params("spring-retreat"));
    expect(screen.getByTestId("import")).toHaveTextContent(`${ID}|spring-retreat`);

    await expectRedirect(ImportPhotosPage, params(ID), "/admin/events/spring-retreat/import-photos");
    await expect(renderServerPage(ImportPhotosPage, params("nope"))).rejects.toThrow();
  });
});
