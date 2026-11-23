// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { LandingPageSummary } from "@/lib/data/landing-pages";

const mocks = vi.hoisted(() => ({ duplicate: vi.fn(), remove: vi.fn(), create: vi.fn(), createAi: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/media/MediaPicker", () => ({ default: () => <div>picker</div> }));
vi.mock("../../src/app/(admin)/admin/pages/actions", () => ({ duplicateLandingPage: mocks.duplicate, deleteLandingPage: mocks.remove, createLandingPage: mocks.create, createLandingPageWithAi: mocks.createAi }));

import { SITE_URL } from "@/lib/config";
import PagesTable from "@/app/(admin)/admin/pages/PagesTable";
import NewPageForm from "@/app/(admin)/admin/pages/new/NewPageForm";
import { ZonedDateTimeField } from "@/components/landing/fields";
import { BLOCK_DEFAULTS, ITEM_BLOCKS } from "@/components/landing/config";
import { editorConfig } from "@/components/landing/editor-config";

const row = (over: Partial<LandingPageSummary>): LandingPageSummary => ({
  id: "lpg_AAAAAAAAAAA1",
  slug: "spring",
  title: "Spring sprint",
  kind: "page",
  page_type: "landing",
  status: "draft",
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

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.duplicate.mockResolvedValue({ slug: "spring-copy" });
  mocks.remove.mockResolvedValue({});
  mocks.create.mockResolvedValue({ slug: "my-page" });
});
afterEach(cleanup);

describe("the pages list", () => {
  const pages = [row({}), row({ id: "lpg_AAAAAAAAAAA2", slug: "waitlist", title: "Waitlist", status: "published", updated_at: "2027-01-05T00:00:00Z" })];

  it("lists pages with their status, newest change first, and links to edit and preview them by address", () => {
    render(<PagesTable pages={pages} publicBase="https://hub.example.test" />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Waitlist")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Published")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Draft")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: "Customize" })).toHaveAttribute("href", "/admin/pages/spring");
    expect(within(rows[1]).getByRole("link", { name: "Preview" })).toHaveAttribute("href", "/admin/pages/spring/preview");
    expect(screen.getByText("/waitlist")).toBeInTheDocument();
  });

  it("shows the page `home` at / (its one address), and copies that", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PagesTable pages={[row({ id: "lpg_AAAAAAAAAAA3", slug: "home", title: "Home", status: "published" })]} publicBase="https://hub.example.test" />);
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.queryByText("/p/home")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith("https://hub.example.test/");
  });

  it("shows no /p/ address anywhere in the list", () => {
    render(<PagesTable pages={pages} publicBase="https://hub.example.test" />);
    expect(document.body.textContent).not.toContain("/p/");
  });

  it("searches by title or address", () => {
    render(<PagesTable pages={pages} publicBase="https://hub.example.test" />);
    fireEvent.change(screen.getByLabelText("Search pages"), { target: { value: "wait" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.queryByText("Spring sprint")).toBeNull();
  });

  it("copies the public link, for a published page only", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PagesTable pages={pages} publicBase="https://hub.example.test" />);
    expect(screen.getAllByRole("button", { name: "Copy link" })).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    });
    expect(writeText).toHaveBeenCalledWith("https://hub.example.test/waitlist");
    expect(screen.getByRole("status")).toHaveTextContent("Link copied.");
  });

  it("duplicates a page and opens the copy", async () => {
    render(<PagesTable pages={[row({})]} publicBase="" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Duplicate page" }));
    });
    expect(mocks.duplicate).toHaveBeenCalledWith("lpg_AAAAAAAAAAA1");
    expect(mocks.push).toHaveBeenCalledWith("/admin/pages/spring-copy");
  });

  it("deletes only after confirming, and shows why when it can't", async () => {
    render(<PagesTable pages={[row({})]} publicBase="" />);
    const answer = async (name: string) =>
      act(async () => {
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
      });
    const askToDelete = async () =>
      act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Delete page" }));
      });

    await askToDelete();
    expect(screen.getByRole("heading", { name: "Delete page?" })).toBeInTheDocument();
    await answer("Cancel");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    mocks.remove.mockResolvedValueOnce({ error: "Couldn't delete the page." });
    await askToDelete();
    await answer("Delete page");
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't delete the page.");

    await askToDelete();
    await answer("Delete page");
    expect(mocks.refresh).toHaveBeenCalled();
  });


  it("invites a first page when there are none", () => {
    render(<PagesTable pages={[]} publicBase="" />);
    expect(screen.getByText(/No pages yet/)).toBeInTheDocument();
  });
});

describe("the new page form, kind of page", () => {
  it("asks which kind, offers no built-in starting point for either kind, and sends the kind", async () => {
    render(<NewPageForm aiAvailable={false} defaultType="landing" />);
    expect(screen.getByRole("radio", { name: /Landing page/ })).toBeChecked();
    expect(screen.queryByRole("option", { name: "Homepage" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Website page/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Landing page/ }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Opt in" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create page" }));
    });
    expect(mocks.create).toHaveBeenLastCalledWith({ title: "Opt in", slug: "opt-in", pageType: "landing" });
  });

  it("offers only the templates of the chosen kind, and drops a choice that no longer fits", () => {
    render(<NewPageForm aiAvailable={false} defaultType="website" templates={[{ id: "t1", name: "Site kit", pageType: "website" }, { id: "t2", name: "Funnel kit", pageType: "landing" }]} />);
    expect(screen.getByRole("option", { name: "Site kit" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Funnel kit" })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Start from/), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("radio", { name: /Landing page/ }));
    expect(screen.getByLabelText(/Start from/)).toHaveValue("");
    expect(screen.getByRole("option", { name: "Funnel kit" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Site kit" })).toBeNull();
  });
});

describe("the new page form", () => {
  it("shows the root host's address before the field, never /p/", () => {
    render(<NewPageForm aiAvailable={false} />);
    expect(screen.getByText(`${new URL(SITE_URL).host}/`)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("/p/");
  });

  it("fills the address in from the title until it is typed over, then opens the editor", async () => {
    render(<NewPageForm aiAvailable={false} />);
    const title = screen.getByLabelText("Title");
    const address = screen.getByLabelText(/Address/) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "My Page!" } });
    expect(address.value).toBe("my-page");
    fireEvent.change(address, { target: { value: "custom" } });
    fireEvent.change(title, { target: { value: "My Page, again" } });
    expect(address.value).toBe("custom");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create page" }));
    });
    expect(mocks.create).toHaveBeenCalledWith({ title: "My Page, again", slug: "custom", starter: undefined, pageType: "website" });
    expect(mocks.push).toHaveBeenCalledWith("/admin/pages/my-page");
  });

  it("shows why a page couldn't be made", async () => {
    mocks.create.mockResolvedValueOnce({ error: "Another page already has that address." });
    render(<NewPageForm aiAvailable={false} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Taken" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create page" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Another page already has that address.");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("the new page form, starting points", () => {
  const templates = [
    { id: "lpg_siteKit", name: "Site kit", pageType: "website" as const },
    { id: "lpg_funnelKit", name: "Funnel kit", pageType: "landing" as const },
  ];

  it("offers a blank page and only the templates for the chosen kind, with nothing built in", () => {
    render(<NewPageForm aiAvailable defaultType="website" templates={templates} />);
    const select = screen.getByLabelText(/Start from/);
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["A blank page", "Site kit"]);
    expect(screen.queryByText("Built in")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Landing page/ }));
    expect(Array.from((screen.getByLabelText(/Start from/) as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["A blank page", "Funnel kit"]);
  });

  it("creates a blank page with no starting point", async () => {
    mocks.create.mockResolvedValueOnce({ slug: "about" });
    render(<NewPageForm aiAvailable templates={templates} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "About" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create page" }));
    });
    expect(mocks.create).toHaveBeenCalledWith({ title: "About", slug: "about", pageType: "website" });
    expect(mocks.push).toHaveBeenCalledWith("/admin/pages/about");
  });

  it("fills in the title from a template, keeps a title already typed, and turns the AI description off", () => {
    render(<NewPageForm aiAvailable templates={templates} />);
    fireEvent.change(screen.getByLabelText(/Start from/), { target: { value: "lpg_siteKit" } });
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Site kit");
    expect(screen.getByLabelText(/Describe the page/)).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Start from/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My home" } });
    fireEvent.change(screen.getByLabelText(/Start from/), { target: { value: "lpg_siteKit" } });
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("My home");
  });
});

describe("the new page form, Build with AI", () => {
  it("drafts the page from the description and opens the editor", async () => {
    mocks.createAi.mockResolvedValueOnce({ slug: "spring" });
    render(<NewPageForm aiAvailable />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Spring" } });
    fireEvent.change(screen.getByLabelText(/Describe the page/), { target: { value: "A spring sprint for new writers" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Draft the page" }));
    });
    expect(mocks.createAi).toHaveBeenCalledWith({ title: "Spring", slug: "spring", prompt: "A spring sprint for new writers", pageType: "website" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/admin/pages/spring");
  });

  it("says so, and stays disabled, when the assistant isn't set up", () => {
    render(<NewPageForm aiAvailable={false} />);
    expect(screen.getByLabelText(/Describe the page/)).toBeDisabled();
  });

  it("shows why the assistant failed and does not leave the form", async () => {
    mocks.createAi.mockResolvedValueOnce({ error: "The page builder's assistant didn't answer. Nothing was created; try again." });
    render(<NewPageForm aiAvailable />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Spring" } });
    fireEvent.change(screen.getByLabelText(/Describe the page/), { target: { value: "anything" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Draft the page" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("didn't answer");
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("the editor's config", () => {
  it("has fields for every block, a slot in the section, and header and footer fields on the page", () => {
    for (const name of Object.keys(BLOCK_DEFAULTS)) {
      const component = editorConfig.components[name];
      expect(component, name).toBeDefined();
      expect(Object.keys(component.fields ?? {}).length, name).toBeGreaterThan(0);
      expect(component.defaultProps, name).toBeDefined();
    }
    // A Section holds any block except the parts of other blocks (a lone step or Finisher card).
    expect(editorConfig.components.Section.fields?.content).toEqual({ type: "slot", disallow: ITEM_BLOCKS });
    expect(Object.keys(editorConfig.root?.fields ?? {})).toEqual(expect.arrayContaining(["logoAssetId", "navLinks", "footerText", "footerLinks"]));
  });

  it("gives every field of every block a label, so none is a bare unlabelled input", () => {
    for (const [name, component] of Object.entries(editorConfig.components)) {
      for (const [key, field] of Object.entries(component.fields ?? {})) {
        if (field.type === "slot") continue;
        expect((field as { label?: string }).label, `${name}.${key}`).toBeTruthy();
      }
    }
  });
});

describe("the date field", () => {
  it("takes a time in the organization's zone and hands back an instant", () => {
    const onChange = vi.fn();
    render(<ZonedDateTimeField label="Counts down to" value="2027-01-15T14:00:00.000Z" onChange={onChange} />);
    const input = screen.getByLabelText("Counts down to") as HTMLInputElement;
    expect(input.value).toBe("2027-01-15T09:00");
    fireEvent.change(input, { target: { value: "2027-07-15T09:00" } });
    expect(onChange).toHaveBeenCalledWith("2027-07-15T13:00:00.000Z");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});
