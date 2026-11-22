// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { LandingPageSummary } from "@/lib/data/landing-pages";

const mocks = vi.hoisted(() => ({ save: vi.fn(), create: vi.fn(), createAi: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("../../src/app/(admin)/admin/pages/actions", () => ({ createLandingPage: mocks.create, createLandingPageWithAi: mocks.createAi, duplicateLandingPage: mocks.duplicate, deleteLandingPage: mocks.remove }));
vi.mock("../../src/app/(admin)/admin/pages/template-actions", () => ({ saveLandingTemplate: mocks.save }));

import SaveAsTemplate from "@/app/(admin)/admin/pages/[slug]/SaveAsTemplate";
import TemplateReplace from "@/app/(admin)/admin/pages/[slug]/TemplateReplace";
import NewPageForm from "@/app/(admin)/admin/pages/new/NewPageForm";
import PagesTable from "@/app/(admin)/admin/pages/PagesTable";

const draft = { content: [{ type: "Heading", props: { id: "h", text: "Hi" } }], root: {} };
const kit = { id: "lpg_AAAAAAAAAAA1", name: "Launch kit", published: true };
const unpublishedKit = { id: "lpg_AAAAAAAAAAA2", name: "Draft kit", published: false };

const answer = (name: string) =>
  act(async () => {
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name }));
  });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.save.mockResolvedValue({ templateId: "lpg_BBBBBBBBBBB2", slug: "spring", name: "Spring", published: false });
  mocks.create.mockResolvedValue({ slug: "my-page" });
  mocks.duplicate.mockResolvedValue({ slug: "kit-copy" });
  mocks.remove.mockResolvedValue({});
});
afterEach(cleanup);

describe("Save as template", () => {
  const open = async (templates = [kit, unpublishedKit]) => {
    render(<SaveAsTemplate templates={templates} getDraft={() => draft} pageId="lpg_SOURCE000001" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save as template/ }));
    });
  };

  it("makes a new template from the page, as a draft, and says so with a link to its editor", async () => {
    await open();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Spring" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save as template" }));
    });
    expect(mocks.save).toHaveBeenCalledWith(draft, { name: "Spring", publish: false, fromPageId: "lpg_SOURCE000001" });
    expect(screen.getByRole("status")).toHaveTextContent("Saved as the template “Spring”: it is a draft until you publish it.");
    expect(screen.getByRole("link", { name: "the template's editor" })).toHaveAttribute("href", "/admin/pages/spring");
  });

  it("can publish the template in the same step", async () => {
    mocks.save.mockResolvedValue({ templateId: "lpg_BBBBBBBBBBB2", slug: "spring", name: "Spring", published: true });
    await open();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Spring" } });
    fireEvent.click(within(dialog).getByLabelText("Publish the template now"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save as template" }));
    });
    expect(mocks.save).toHaveBeenCalledWith(draft, { name: "Spring", publish: true, fromPageId: "lpg_SOURCE000001" });
    expect(screen.getByRole("status")).toHaveTextContent("Saved as the template “Spring” and published it.");
  });

  it("asks before replacing a template's draft, saying the old draft is kept and the published copy is not touched, then replaces it", async () => {
    mocks.save.mockResolvedValue({ templateId: kit.id, slug: "launch-kit", name: kit.name, published: false });
    await open();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Replace a template's draft with this page"));
    expect(within(dialog).getByLabelText("Template whose draft to replace")).toHaveValue(kit.id);
    expect(within(dialog).getByRole("option", { name: "Draft kit (not published)" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Replace template draft" }));
    });
    expect(mocks.save).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    expect(within(confirm).getByText("Replace the template's draft?")).toBeInTheDocument();
    expect(confirm).toHaveTextContent("keeps its current draft in its History, and you can bring it back");
    expect(confirm).toHaveTextContent("Its published copy doesn't change until you publish it.");
    await answer("Replace template draft");
    expect(mocks.save).toHaveBeenCalledWith(draft, { replaceId: kit.id, publish: false, fromPageId: "lpg_SOURCE000001" });
    expect(screen.getByRole("status")).toHaveTextContent("Replaced the draft of “Launch kit”.");
  });

  it("replaces and publishes in one step, and the confirmation says the published copy changes", async () => {
    mocks.save.mockResolvedValue({ templateId: kit.id, slug: "launch-kit", name: kit.name, published: true });
    await open();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Replace a template's draft with this page"));
    fireEvent.click(within(dialog).getByLabelText("Publish the template now"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Replace template draft" }));
    });
    expect(screen.getAllByRole("dialog").at(-1)).toHaveTextContent("The template is published right after, so its published copy changes.");
    await answer("Replace template draft");
    expect(mocks.save).toHaveBeenCalledWith(draft, { replaceId: kit.id, publish: true, fromPageId: "lpg_SOURCE000001" });
    expect(screen.getByRole("status")).toHaveTextContent("Replaced the draft of “Launch kit” and published it.");
  });

  it("lets the person choose which template's draft to replace", async () => {
    mocks.save.mockResolvedValue({ templateId: unpublishedKit.id, slug: "draft-kit", name: unpublishedKit.name, published: false });
    await open();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Replace a template's draft with this page"));
    fireEvent.change(within(dialog).getByLabelText("Template whose draft to replace"), { target: { value: unpublishedKit.id } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Replace template draft" }));
    });
    expect(screen.getAllByRole("dialog").at(-1)).toHaveTextContent("“Draft kit” keeps its current draft in its History");
    await answer("Replace template draft");
    expect(mocks.save).toHaveBeenCalledWith(draft, { replaceId: unpublishedKit.id, publish: false, fromPageId: "lpg_SOURCE000001" });
  });

  it("saves nothing when the replacement is cancelled", async () => {
    await open();
    fireEvent.click(within(screen.getByRole("dialog")).getByLabelText("Replace a template's draft with this page"));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Replace template draft" }));
    });
    await answer("Cancel");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("offers only a new template when there are none, needs a name, and shows the server's reason when it is refused", async () => {
    await open([]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Replace a template's draft with this page")).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Give the template a name.");
    mocks.save.mockResolvedValue({ error: "A template with that name already exists." });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Launch kit" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save as template" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
  });
});

describe("Start over lists", () => {
  const choices = [
    { key: kit.id, label: kit.name, description: "A template you published." },
    { key: "lpg_other", label: "Sign-up kit", description: "A template you published." },
  ];

  it("lists only the published templates, with no built-in group, and asks before replacing", async () => {
    const onReplace = vi.fn().mockResolvedValue(null);
    render(<TemplateReplace choices={choices} onReplace={onReplace} />);
    const select = screen.getByLabelText("Template");
    expect(within(select).queryByRole("group")).toBeNull();
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([kit.name, "Sign-up kit"]);
    expect(screen.getByRole("heading", { name: "Start over from a template" })).toBeInTheDocument();
    expect(screen.queryByText("Built in")).toBeNull();
    fireEvent.change(select, { target: { value: kit.id } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace draft with template" }));
    });
    expect(screen.getByText("Replace your draft with the Launch kit template?")).toBeInTheDocument();
    await answer("Replace draft");
    expect(onReplace).toHaveBeenCalledWith(kit.id);
  });

  it("shows nothing when there are no published templates", () => {
    const { container } = render(<TemplateReplace choices={[]} onReplace={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("New page from a template", () => {
  it("lists the published templates, with no built-in group, and creates the page from the template", async () => {
    render(<NewPageForm aiAvailable={false} templates={[{ id: kit.id, name: kit.name, pageType: "website" }]} />);
    const select = screen.getByLabelText(/Start from/);
    expect(within(select).queryByRole("group", { name: "Built in" })).toBeNull();
    expect(within(select).getByRole("group", { name: "Templates" })).toBeInTheDocument();
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["A blank page", "Launch kit"]);
    fireEvent.change(select, { target: { value: kit.id } });
    expect(screen.getByLabelText("Title")).toHaveValue("Launch kit");
    expect(screen.getByText(/Its published copy is saved as a draft/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create page" }));
    });
    expect(mocks.create).toHaveBeenCalledWith({ title: "Launch kit", slug: "", template: kit.id, pageType: "website" });
    expect(mocks.push).toHaveBeenCalledWith("/admin/pages/my-page");
  });

  it("has no templates group when there are none, and shows an error", async () => {
    mocks.create.mockResolvedValue({ error: "That template is no longer available." });
    render(<NewPageForm aiAvailable={false} />);
    expect(screen.queryByRole("group", { name: "Templates" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "X" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create page" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
  });
});

describe("the Templates list", () => {
  const row = (over: Partial<LandingPageSummary>): LandingPageSummary => ({
    id: "lpg_AAAAAAAAAAA1",
    slug: "launch-kit",
    title: "Launch kit",
    kind: "template",
    page_type: "landing",
    status: "published",
    seo_title: null,
    seo_description: null,
    social_image_asset_id: null,
    first_published_at: null,
    published_at: null,
    restored_from_version_id: null,
    restored_at: null,
    import_key: null,
    imported_at: null,
    starter_applied_at: null,
    created_by: null,
    updated_by: null,
    created_at: "2027-01-01T00:00:00Z",
    updated_at: "2027-01-02T00:00:00Z",
    deleted_at: null,
    ...over,
  });

  it("lists templates with a status, an editor link and no public address or link to copy", () => {
    render(<PagesTable pages={[row({}), row({ id: "lpg_AAAAAAAAAAA2", slug: "waitlist", title: "Waitlist kit", status: "draft", updated_at: "2027-01-05T00:00:00Z" })]} publicBase="https://hub.example.test" kind="template" />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Waitlist kit")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Draft")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Published")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: "Customize" })).toHaveAttribute("href", "/admin/pages/launch-kit");
    expect(screen.queryByText("/p/launch-kit")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.getByLabelText("Search templates")).toBeInTheDocument();
  });

  it("says how to make the first template, and deletes with the template wording", async () => {
    const { unmount } = render(<PagesTable pages={[]} publicBase="https://hub.example.test" kind="template" />);
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument();
    unmount();
    render(<PagesTable pages={[row({})]} publicBase="https://hub.example.test" kind="template" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    });
    expect(screen.getByText("Delete template?")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog").at(-1)).toHaveTextContent("It is no longer offered when you start a page.");
    await answer("Delete template");
    expect(mocks.remove).toHaveBeenCalledWith("lpg_AAAAAAAAAAA1");
  });
});
