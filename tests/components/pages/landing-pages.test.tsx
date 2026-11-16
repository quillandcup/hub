// @vitest-environment jsdom
/**
 * The public landing page (/p/<slug>) and the admin preview: a published page renders for anyone, and a draft, a deleted
 * page, an unknown address and an invalid one are all the same 404. The repository is the in-memory twin; markup, metadata
 * and the 404 are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks, signInAs, ADMIN_USER } from "@/tests/helpers/server-page";
import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: async () => ({ id: "00000000-0000-4000-a000-0000000000a1", email: "admin@example.test" }) }));

const state = { repos: createInMemoryRepos(new InMemoryDataset()) };
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

import PublicLandingPage, { generateMetadata } from "@/app/p/[slug]/page";
import PreviewLandingPage from "@/app/(admin)/admin/pages/[slug]/preview/page";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const doc = (text: string) => ({ content: [{ type: "Heading", props: { id: "h", text, level: "h1", align: "center" } }], root: {} });

async function makePage(slug: string, text: string, { publish = true } = {}) {
  const page = await state.repos.landingPages.create({ title: `Title of ${slug}`, slug, data: doc(text), createdBy: null });
  await state.repos.landingPages.updateDetails(page.id, { title: page.title, slug, seoTitle: "Search title", seoDescription: "About this page", socialImageAssetId: null }, null);
  if (publish) await state.repos.landingPages.publish(page.id);
  return page;
}

beforeEach(() => {
  resetServerPageMocks();
  state.repos = createInMemoryRepos(new InMemoryDataset());
  signInAs(null);
});

describe("/p/[slug]", () => {
  it("shows a published page to a signed-out visitor", async () => {
    await makePage("spring", "Spring sprint");
    await renderServerPage(PublicLandingPage, params("spring"));
    expect(screen.getByRole("heading", { level: 1, name: "Spring sprint" })).toBeInTheDocument();
  });

  it("shows the published version, not the draft being edited", async () => {
    const page = await makePage("live", "Live words");
    await state.repos.landingPages.saveDraft(page.id, doc("Draft words") as never, null);
    await renderServerPage(PublicLandingPage, params("live"));
    expect(screen.getByText("Live words")).toBeInTheDocument();
    expect(screen.queryByText("Draft words")).toBeNull();
  });

  it("answers 404 for a draft, a taken-down page, a deleted page, an unknown address and an invalid one", async () => {
    await makePage("draft-only", "Secret", { publish: false });
    const down = await makePage("taken-down", "Down");
    await state.repos.landingPages.unpublish(down.id, null);
    const gone = await makePage("deleted", "Gone");
    await state.repos.landingPages.remove(gone.id, null);

    for (const slug of ["draft-only", "taken-down", "deleted", "never-made", "Not Valid", "../etc"]) {
      await expect(PublicLandingPage(params(slug))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    }
  });

  it("takes the title, description and canonical address for search and shared links from the page", async () => {
    await makePage("meta", "Words");
    const metadata = await generateMetadata(params("meta"));
    expect(metadata.title).toBe("Search title");
    expect(metadata.description).toBe("About this page");
    expect(metadata.alternates?.canonical).toBe(`${APP_URL}/p/meta`);
    expect(metadata.openGraph).toMatchObject({ title: "Search title", url: `${APP_URL}/p/meta` });
  });

  it("keeps a missing page out of search results", async () => {
    expect(await generateMetadata(params("missing"))).toMatchObject({ title: "Not found", robots: { index: false } });
  });
});

describe("/admin/pages/[slug]/preview", () => {
  it("shows an admin the draft, with a note that it is a preview", async () => {
    await makePage("preview-me", "Published words", { publish: false });
    await renderServerPage(PreviewLandingPage, params("preview-me"));
    expect(screen.getByRole("note")).toHaveTextContent("Preview of the draft");
    expect(screen.getByRole("heading", { name: "Published words" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the editor" })).toHaveAttribute("href", "/admin/pages/preview-me");
  });

  it("answers 404 for an unknown page", async () => {
    signInAs(ADMIN_USER);
    await expect(PreviewLandingPage(params("nothing"))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});
