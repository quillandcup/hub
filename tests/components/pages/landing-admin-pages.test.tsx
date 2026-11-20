// @vitest-environment jsdom
/** The admin pages of the page builder: the list, the new-page form and the editor's server page (client children mocked). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => ({ id: "00000000-0000-4000-a000-0000000000a1", email: "admin@example.test" }));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

const state = { repos: createInMemoryRepos(new InMemoryDataset()) };
vi.mock("@/lib/data/repos", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/data/repos")>()), createRepos: () => state.repos }));

vi.mock("@/app/(admin)/admin/pages/PagesTable", () => ({
  default: ({ pages, publicBase, kind }: { pages: { title: string }[]; publicBase: string; kind?: string }) => (
    <div data-testid="table" data-base={publicBase} data-kind={kind ?? "page"}>
      {pages.map((p) => p.title).join(",")}
    </div>
  ),
}));
vi.mock("@/app/(admin)/admin/pages/new/NewPageForm", () => ({
  default: ({ templates = [] }: { templates?: { id: string; name: string }[] }) => <form aria-label="New page form" data-templates={templates.map((t) => t.name).join(",")} />,
}));
vi.mock("@/app/(admin)/admin/pages/[slug]/LandingEditor", () => ({
  default: ({ page, data, versions, starters = [], templates = [] }: { page: { slug: string; seoTitle: string; publishedJson: string | null; kind?: string; publicPath: string }; data: unknown; versions: unknown[]; starters?: { label: string; group?: string }[]; templates?: { name: string; published: boolean }[] }) => (
    <div data-testid="editor" data-slug={page.slug} data-seo={page.seoTitle} data-published={String(page.publishedJson !== null)} data-versions={versions.length} data-kind={page.kind} data-path={page.publicPath} data-starters={starters.map((s) => `${s.group ?? "built"}:${s.label}`).join(",")} data-templates={templates.map((t) => `${t.name}:${t.published}`).join(",")}>
      {JSON.stringify(data)}
    </div>
  ),
}));

import AdminPagesPage from "@/app/(admin)/admin/pages/page";
import NewLandingPage from "@/app/(admin)/admin/pages/new/page";
import EditLandingPage from "@/app/(admin)/admin/pages/[slug]/page";
import { APP_URL } from "@/lib/config";

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
  state.repos = createInMemoryRepos(new InMemoryDataset());
});

describe("/admin/pages", () => {
  it("checks for an admin, then lists the pages with a link to make one", async () => {
    await state.repos.landingPages.create({ title: "Spring sprint", slug: "spring", createdBy: null });
    await renderServerPage(AdminPagesPage, {});
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New page" })).toHaveAttribute("href", "/admin/pages/new");
    expect(screen.getByTestId("table")).toHaveTextContent("Spring sprint");
    expect(screen.getByTestId("table")).toHaveAttribute("data-base", APP_URL);
  });
});

describe("/admin/pages/templates", () => {
  it("checks for an admin, then lists only the templates on the Templates tab", async () => {
    const { default: TemplatesTab } = await import("@/app/(admin)/admin/pages/templates/page");
    await state.repos.landingPages.create({ title: "A page", slug: "a-page", createdBy: null });
    await state.repos.landingPages.create({ title: "Launch kit", slug: "launch-kit", createdBy: null, kind: "template" });
    await renderServerPage(TemplatesTab, {});
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Templates", selected: true })).toBeInTheDocument();
    expect(screen.getByTestId("table")).toHaveAttribute("data-kind", "template");
    expect(screen.getByTestId("table")).toHaveTextContent("Launch kit");
    expect(screen.getByTestId("table")).not.toHaveTextContent("A page");
  });

  it("keeps templates out of the Pages tab", async () => {
    await state.repos.landingPages.create({ title: "A page", slug: "a-page", createdBy: null });
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
    await renderServerPage(NewLandingPage, {});
    expect(requireAdminPage).toHaveBeenCalled();
    expect(screen.getByRole("form", { name: "New page form" })).toHaveAttribute("data-templates", "Launch kit");
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
    expect(editor.getAttribute("data-starters")).toBe("built:Homepage,template:Launch kit");
    expect(editor.getAttribute("data-templates")?.split(",").sort()).toEqual(["Draft kit:false", "Launch kit:true"]);
    cleanup();
    await renderServerPage(EditLandingPage, params("launch-kit"));
    const asTemplate = screen.getByTestId("editor");
    expect(asTemplate).toHaveAttribute("data-kind", "template");
    expect(asTemplate).toHaveAttribute("data-path", "");
    expect(asTemplate.getAttribute("data-starters")).toBe("built:Homepage");
    expect(asTemplate.getAttribute("data-templates")).toBe("");
  });

  it("answers 404 for an unknown page and an invalid address, whoever asks", async () => {
    await expect(EditLandingPage(params("nothing"))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(EditLandingPage(params("Not Valid"))).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(requireAdminPage).toHaveBeenCalled();
  });
});
