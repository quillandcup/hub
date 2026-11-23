// @vitest-environment jsdom
/**
 * The home route (/): on the root host the published landing page with slug `home`, else the plain fallback; on the app host the
 * dashboard or login redirect. /p/home is not a second address for the same content.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resetServerPageMocks } from "@/tests/helpers/server-page";
import { APP_URL, JOIN_URL, KAJABI_LOGIN_URL, ROOT_HOST, SITE_URL } from "@/lib/config";
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

const state = vi.hoisted(() => ({ host: "" as string, user: null as { id: string } | null, repos: undefined as never as ReturnType<typeof import("@/lib/data/repos").createInMemoryRepos> }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: state.host }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...args: never[]) => unknown) => fn }));

import Home, { generateMetadata } from "@/app/page";
import PublicLandingPage, { generateMetadata as landingMetadata } from "@/app/p/[slug]/page";
import RootHomepage from "@/components/site/RootHomepage";

// The state after the cutover (config/app.ts publicSiteLive true); the state before it is in the "not live" tests (tests/lib/public-site-flag.test.ts lists them).
vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.liveConfigModule()));

const doc = (text: string) => ({ content: [{ type: "Heading", props: { id: "h", text, level: "h1", align: "center" } }], root: {} });

async function makeHome(text: string, { publish = true, slug = "home" } = {}) {
  const page = await state.repos.landingPages.create({ title: "Home", slug, data: doc(text) as never, createdBy: null });
  await state.repos.landingPages.updateDetails(page.id, { title: "Home", slug, seoTitle: "Welcome to Quill and Cup", seoDescription: "Writers, together", socialImageAssetId: null }, null);
  if (publish) await state.repos.landingPages.publish(page.id);
  return page;
}

beforeEach(() => {
  cleanup();
  resetServerPageMocks();
  state.repos = createInMemoryRepos(new InMemoryDataset());
  state.host = ROOT_HOST;
  state.user = null;
});

describe("RootHomepage (the fallback)", () => {
  it("has a Join link, a Member login link to the Hub, and a Kajabi sign-in note", () => {
    render(<RootHomepage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", JOIN_URL);
    expect(screen.getByRole("link", { name: "Member login" })).toHaveAttribute("href", `${APP_URL}/login`);
    expect(screen.getByText(/Still on Kajabi\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in there" })).toHaveAttribute("href", KAJABI_LOGIN_URL);
  });

  it("joins at the free trial page on the public site", () => {
    expect(JOIN_URL).toBe(`${SITE_URL}/free-trial`);
  });
});

describe("/ on the root host", () => {
  it("renders the published landing page with slug home", async () => {
    await makeHome("Welcome, writers");
    render(await Home());
    expect(screen.getByRole("heading", { level: 1, name: "Welcome, writers" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Member login" })).toBeNull();
  });

  it("shows the published version, never the draft being edited", async () => {
    const page = await makeHome("Live words");
    await state.repos.landingPages.saveDraft(page.id, doc("Draft words") as never, null);
    render(await Home());
    expect(screen.getByText("Live words")).toBeInTheDocument();
    expect(screen.queryByText("Draft words")).toBeNull();
  });

  it("falls back to the plain homepage when there is no home page, only a draft, or it was taken down", async () => {
    render(await Home());
    expect(screen.getByRole("link", { name: "Join" })).toBeInTheDocument();

    cleanup();
    await makeHome("Secret draft", { publish: false });
    render(await Home());
    expect(screen.getByRole("link", { name: "Join" })).toBeInTheDocument();
    expect(screen.queryByText("Secret draft")).toBeNull();
  });

  it("falls back when the page was taken down, and when the read fails", async () => {
    const page = await makeHome("Gone soon");
    await state.repos.landingPages.unpublish(page.id, null);
    render(await Home());
    expect(screen.getByRole("link", { name: "Join" })).toBeInTheDocument();

    cleanup();
    vi.spyOn(state.repos.landingPages, "published").mockRejectedValue(new Error("down"));
    render(await Home());
    expect(screen.getByRole("link", { name: "Join" })).toBeInTheDocument();
  });

  it("uses a template or another slug for nothing: only the page with slug home", async () => {
    await makeHome("Not the home page", { slug: "about" });
    render(await Home());
    expect(screen.getByRole("link", { name: "Join" })).toBeInTheDocument();
  });

  it("takes the title, description and canonical address (the root, `/`) from the home page", async () => {
    await makeHome("Welcome");
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Welcome to Quill and Cup");
    expect(metadata.description).toBe("Writers, together");
    expect(metadata.alternates?.canonical).toBe(`${SITE_URL}/`);
    expect(metadata.openGraph).toMatchObject({ url: `${SITE_URL}/` });
  });

  it("describes Quill & Cup in the head when there is no home page", async () => {
    expect(await generateMetadata()).toMatchObject({ title: { absolute: "Quill & Cup" }, description: expect.stringContaining("community of writers") });
  });
});

describe("/p/home is not a second address", () => {
  it("redirects to / on the root host", async () => {
    await makeHome("Welcome");
    await expect(PublicLandingPage({ params: Promise.resolve({ slug: "home" }) })).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/;307;" });
  });

  it("names / on the public site as its canonical address", async () => {
    await makeHome("Welcome");
    const metadata = await landingMetadata({ params: Promise.resolve({ slug: "home" }) });
    expect(metadata.alternates?.canonical).toBe(`${SITE_URL}/`);
  });
});

describe("/ on the app host", () => {
  beforeEach(() => {
    state.host = new URL(APP_URL).host;
  });

  it("keeps sending a signed-in member to the dashboard, even with a home page published", async () => {
    await makeHome("Welcome");
    state.user = { id: "u1" };
    await expect(Home()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
  });

  it("keeps sending a signed-out visitor to login", async () => {
    await makeHome("Welcome");
    await expect(Home()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/login;307;" });
  });

  it("leaves the layout's head alone", async () => {
    await makeHome("Welcome");
    expect(await generateMetadata()).toEqual({});
  });
});
