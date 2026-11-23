// @vitest-environment jsdom
/** The admin pages of the page builder: the list, the new-page form and the editor's server page (client children mocked). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { normalizeSiteTemplate } from "@/lib/landing/site-template";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requirePermission = vi.fn(async () => ({ id: "00000000-0000-4000-a000-0000000000a1", email: "admin@example.test" }));
vi.mock("@/lib/admin-auth", () => ({ requirePermission: () => requirePermission() }));

const state = { repos: createInMemoryRepos(new InMemoryDataset()) };
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

vi.mock("@/app/(admin)/admin/pages/PagesTable", () => ({
  default: ({ pages, publicBase, kind, pageType }: { pages: { title: string }[]; publicBase: string; kind?: string; pageType?: string }) => (
    <div data-testid="table" data-base={publicBase} data-kind={kind ?? "page"} data-type={pageType ?? ""}>
      {pages.map((p) => p.title).join(",")}
    </div>
  ),
}));
vi.mock("@/app/(admin)/admin/pages/design/DesignEditor", () => ({
  default: ({ initial, publishedAt, hasPublished, unpublished }: { initial: { footer: { text: string } }; publishedAt: string | null; hasPublished: boolean; unpublished: boolean }) => (
    <div data-testid="design" data-footer={initial.footer.text} data-published-at={publishedAt ?? ""} data-has-published={String(hasPublished)} data-unpublished={String(unpublished)} />
  ),
}));
vi.mock("@/app/(admin)/admin/pages/new/NewPageForm", () => ({
  default: ({ templates = [], defaultType }: { templates?: { id: string; name: string }[]; defaultType?: string }) => <form aria-label="New page form" data-default={defaultType} data-templates={templates.map((t) => t.name).join(",")} />,
}));
vi.mock("@/app/(admin)/admin/pages/[slug]/LandingEditor", () => ({
  default: ({ page, data, versions, replaceChoices = [], templates = [], site = null }: { page: { slug: string; seoTitle: string; publishedJson: string | null; kind?: string; pageType?: string; publicPath: string }; data: unknown; versions: unknown[]; replaceChoices?: { label: string }[]; templates?: { name: string; published: boolean }[]; site?: { footer: { text: string } } | null }) => (
    <div data-testid="editor" data-slug={page.slug} data-seo={page.seoTitle} data-published={String(page.publishedJson !== null)} data-versions={versions.length} data-kind={page.kind} data-type={page.pageType} data-site={site ? site.footer.text : "none"} data-path={page.publicPath} data-choices={replaceChoices.map((s) => s.label).join(",")} data-templates={templates.map((t) => `${t.name}:${t.published}`).join(",")}>
      {JSON.stringify(data)}
    </div>
  ),
}));

import AdminPagesPage from "@/app/(admin)/admin/pages/page";
import NewLandingPage from "@/app/(admin)/admin/pages/new/page";
import EditLandingPage from "@/app/(admin)/admin/pages/[slug]/page";
import { SITE_URL } from "@/lib/config";

// The state after the cutover (config/app.ts publicSiteLive true); the state before it is in tests/lib/public-site-flag.test.ts and the "not live" tests it lists.
vi.mock("@/lib/config", () => import("@/tests/helpers/public-site").then((m) => m.liveConfigModule()));

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  resetServerPageMocks();
  requirePermission.mockClear();
  state.repos = createInMemoryRepos(new InMemoryDataset());
});

describe("/admin/pages", () => {
  it("checks for an admin, then lists the website pages on the first tab with a link to make one, and counts each tab", async () => {
    await state.repos.landingPages.create({ title: "Home", slug: "home", createdBy: null, pageType: "website" });
    await state.repos.landingPages.create({ title: "Spring sprint", slug: "spring", createdBy: null });
    await state.repos.landingPages.create({ title: "Fall sprint", slug: "fall", createdBy: null });
    await renderServerPage(AdminPagesPage, {});
    expect(requirePermission).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New page" })).toHaveAttribute("href", "/admin/pages/new?type=website");
    expect(screen.getByRole("tab", { name: "Website (1)", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Landing (2)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Templates (0)" })).toBeInTheDocument();
    expect(screen.getByTestId("table")).toHaveTextContent("Home");
    expect(screen.getByTestId("table")).not.toHaveTextContent("Spring sprint");
    expect(screen.getByTestId("table")).toHaveAttribute("data-type", "website");
    expect(screen.getByTestId("table")).toHaveAttribute("data-base", SITE_URL);
  });

  it("lists only the landing pages on the Landing tab, and New page there starts a landing page", async () => {
    const { default: LandingTab } = await import("@/app/(admin)/admin/pages/landing/page");
    await state.repos.landingPages.create({ title: "Home", slug: "home", createdBy: null, pageType: "website" });
    await state.repos.landingPages.create({ title: "Spring sprint", slug: "spring", createdBy: null });
    await renderServerPage(LandingTab, {});
    expect(requirePermission).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /^Landing/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New page" })).toHaveAttribute("href", "/admin/pages/new?type=landing");
    expect(screen.getByTestId("table")).toHaveTextContent("Spring sprint");
    expect(screen.getByTestId("table")).not.toHaveTextContent("Home");
  });
});

describe("/admin/pages/design", () => {
  const draft = (text: string) => normalizeSiteTemplate({ footer: { show: true, text } });

  it("checks for an admin, then shows the Design tab with the site template's draft and whether it is published", async () => {
    const { default: DesignTab } = await import("@/app/(admin)/admin/pages/design/page");
    await state.repos.landingSiteTemplate.saveDraft(draft("Fern Quills"), null);
    await renderServerPage(DesignTab, {});
    expect(requirePermission).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Design", selected: true })).toBeInTheDocument();
    expect(screen.getByTestId("design")).toHaveAttribute("data-footer", "Fern Quills");
    expect(screen.getByTestId("design")).toHaveAttribute("data-has-published", "false");
    expect(screen.getByTestId("design")).toHaveAttribute("data-unpublished", "true");
  });

  it("is not unpublished once the draft is what was published", async () => {
    const { default: DesignTab } = await import("@/app/(admin)/admin/pages/design/page");
    await state.repos.landingSiteTemplate.saveDraft(draft("Live"), null);
    await state.repos.landingSiteTemplate.publish(null);
    await renderServerPage(DesignTab, {});
    expect(screen.getByTestId("design")).toHaveAttribute("data-has-published", "true");
    expect(screen.getByTestId("design")).toHaveAttribute("data-unpublished", "false");
  });
});

describe("/admin/pages/templates", () => {
  it("checks for an admin, then lists only the templates on the Templates tab", async () => {
    const { default: TemplatesTab } = await import("@/app/(admin)/admin/pages/templates/page");
    await state.repos.landingPages.create({ title: "A page", slug: "a-page", createdBy: null });
    await state.repos.landingPages.create({ title: "Launch kit", slug: "launch-kit", createdBy: null, kind: "template" });
    await renderServerPage(TemplatesTab, {});
    expect(requirePermission).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /^Templates/, selected: true })).toBeInTheDocument();
    expect(screen.getByTestId("table")).toHaveAttribute("data-kind", "template");
    expect(screen.getByTestId("table")).toHaveTextContent("Launch kit");
    expect(screen.getByTestId("table")).not.toHaveTextContent("A page");
  });

  it("keeps templates out of the Pages tab", async () => {
    await state.repos.landingPages.create({ title: "A page", slug: "a-page", createdBy: null, pageType: "website" });
    await state.repos.landingPages.create({ title: "Launch kit", slug: "launch-kit", createdBy: null, kind: "template" });
    await renderServerPage(AdminPagesPage, {});
    expect(screen.getByTestId("table")).toHaveTextContent("A page");
    expect(screen.getByTestId("table")).not.toHaveTextContent("Launch kit");
  });
});

describe("/admin/pages/new", () => {
  it("checks for an admin and shows the form, offering only published templates", async () => {
    const kit = await state.repos.landingPages.create({ title: "Launch kit", slug: "launch-kit", createdBy: null, kind: "template" });
    await state.repos.landingPages.publish(kit.id);
    await state.repos.landingPages.create({ title: "Draft kit", slug: "draft-kit", createdBy: null, kind: "template" });
    await renderServerPage(NewLandingPage, { searchParams: Promise.resolve({}) });
    expect(requirePermission).toHaveBeenCalled();
    expect(screen.getByRole("form", { name: "New page form" })).toHaveAttribute("data-templates", "Launch kit");
    expect(screen.getByRole("form", { name: "New page form" })).toHaveAttribute("data-default", "website");
  });

  it("opens on the kind named in the address", async () => {
    await renderServerPage(NewLandingPage, { searchParams: Promise.resolve({ type: "landing" }) });
    expect(screen.getByRole("form", { name: "New page form" })).toHaveAttribute("data-default", "landing");
  });
});

describe("/admin/pages/[slug]", () => {
  it("opens the editor on the draft, with the page's details and versions", async () => {
    const page = await state.repos.landingPages.create({ title: "Spring sprint", slug: "spring", data: { content: [{ type: "Heading", props: { text: "Draft words" } }], root: {} }, createdBy: null });
    await state.repos.landingPages.publish(page.id);
    await renderServerPage(EditLandingPage, params("spring"));
    const editor = screen.getByTestId("editor");
    expect(editor).toHaveAttribute("data-slug", "spring");
    expect(editor).toHaveAttribute("data-published", "true");
    expect(editor).toHaveAttribute("data-versions", "1");
    expect(editor).toHaveTextContent("Draft words");
  });

  it("offers the published templates to start over from, lists every template to save over, and opens a template with no public address", async () => {
    const kit = await state.repos.landingPages.create({ title: "Launch kit", slug: "launch-kit", createdBy: null, kind: "template" });
    await state.repos.landingPages.publish(kit.id);
    await state.repos.landingPages.create({ title: "Draft kit", slug: "draft-kit", createdBy: null, kind: "template" });
    await state.repos.landingPages.create({ title: "Spring sprint", slug: "spring", createdBy: null });
    await renderServerPage(EditLandingPage, params("spring"));
    const editor = screen.getByTestId("editor");
    expect(editor).toHaveAttribute("data-kind", "page");
    expect(editor).toHaveAttribute("data-type", "landing");
    expect(editor.getAttribute("data-choices")).toBe("Launch kit");
    expect(editor.getAttribute("data-templates")?.split(",").sort()).toEqual(["Draft kit:false", "Launch kit:true"]);
    cleanup();
    await renderServerPage(EditLandingPage, params("launch-kit"));
    const asTemplate = screen.getByTestId("editor");
    expect(asTemplate).toHaveAttribute("data-kind", "template");
    expect(asTemplate).toHaveAttribute("data-path", "");
    expect(asTemplate.getAttribute("data-choices")).toBe("");
    expect(asTemplate.getAttribute("data-templates")).toBe("");
  });

  it("offers only the website templates (no built-in starter), on a website page", async () => {
    const site = await state.repos.landingPages.create({ title: "Site kit", slug: "site-kit", createdBy: null, kind: "template", pageType: "website" });
    await state.repos.landingPages.publish(site.id);
    const funnel = await state.repos.landingPages.create({ title: "Funnel kit", slug: "funnel-kit", createdBy: null, kind: "template" });
    await state.repos.landingPages.publish(funnel.id);
    await state.repos.landingPages.create({ title: "About", slug: "about", createdBy: null, pageType: "website" });
    await renderServerPage(EditLandingPage, params("about"));
    expect(screen.getByTestId("editor")).toHaveAttribute("data-type", "website");
    expect(screen.getByTestId("editor").getAttribute("data-choices")).toBe("Site kit");
  });

  it("gives every page the site design draft: a website page's regions come from it, and a landing page takes its style from it", async () => {
    await state.repos.landingSiteTemplate.saveDraft(normalizeSiteTemplate({ header: { show: true }, footer: { show: true, text: "Fern Quills" } }), null);
    await state.repos.landingPages.create({ title: "About", slug: "about", createdBy: null, pageType: "website" });
    await state.repos.landingPages.create({ title: "Funnel", slug: "funnel", createdBy: null });
    await renderServerPage(EditLandingPage, params("about"));
    expect(screen.getByTestId("editor")).toHaveAttribute("data-site", "Fern Quills");
    cleanup();
    await renderServerPage(EditLandingPage, params("funnel"));
    expect(screen.getByTestId("editor")).toHaveAttribute("data-site", "Fern Quills");
  });

  it("answers 404 for an unknown page and an invalid address, whoever asks", async () => {
    await expect(EditLandingPage(params("nothing"))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(EditLandingPage(params("Not Valid"))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(requirePermission).toHaveBeenCalled();
  });
});
