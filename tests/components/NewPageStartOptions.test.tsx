// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const push = vi.fn();
const createLandingPage = vi.fn();
const createLandingPageFromJson = vi.fn();

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/app/(admin)/admin/pages/actions", () => ({
  createLandingPage: (...args: unknown[]) => createLandingPage(...args),
  createLandingPageFromJson: (...args: unknown[]) => createLandingPageFromJson(...args),
}));

import NewPageButton from "@/app/(admin)/admin/pages/NewPageButton";

const TEMPLATES = [
  { id: "lpg_AAAAAAAAAAA1", name: "Launch kit", pageType: "landing" as const },
  { id: "lpg_AAAAAAAAAAA2", name: "About us", pageType: "website" as const },
];

const summary = (over: Record<string, unknown> = {}) => ({ blocksBefore: 0, blocksAfter: 3, leftOut: [], droppedProps: 0, removedPictures: 0, issues: [], identical: false, source: { title: "Spring sprint" }, ...over });

async function openMenu(props: Parameters<typeof NewPageButton>[0] = {}) {
  const user = userEvent.setup();
  render(<NewPageButton {...props} />);
  await user.click(screen.getByRole("button", { name: "More ways to start a page" }));
  return user;
}

beforeEach(() => {
  push.mockReset();
  createLandingPage.mockReset();
  createLandingPageFromJson.mockReset();
});

describe("the ways to start a page, in the New page menu", () => {
  it("lists the template, the JSON file and Kajabi, in that order, each with a hint", async () => {
    await openMenu({ templates: TEMPLATES });
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Start from a templateOne of your published templates. Makes a draft.",
      "Import from JSONA file or pasted text from the builder. Makes a draft.",
      "Import from KajabiFrom a page export (zip). Makes a draft.",
    ]);
  });
});

describe("Start from a template", () => {
  it("says so when there are no published templates, and points at the Templates tab", async () => {
    const user = await openMenu({ templates: [] });
    await user.click(screen.getByRole("menuitem", { name: /Start from a template/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/no published templates yet/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Go to Templates" })).toHaveAttribute("href", "/admin/pages/templates");
    expect(within(dialog).queryByRole("button", { name: "Create page" })).toBeNull();
  });

  it("lists the templates with their kind, fills the title from the chosen one and creates the page in the template's kind", async () => {
    createLandingPage.mockResolvedValue({ slug: "launch-kit" });
    const user = await openMenu({ templates: TEMPLATES, defaultType: "website" });
    await user.click(screen.getByRole("menuitem", { name: /Start from a template/ }));
    expect(screen.getByText("Launch kit")).toBeInTheDocument();
    expect(screen.getByText("Landing page")).toBeInTheDocument();
    expect(screen.getByText("Website page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create page" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: /Launch kit/ }));
    expect(screen.getByLabelText("Title")).toHaveValue("Launch kit");
    expect(screen.getByLabelText(/Address/)).toHaveValue("launch-kit");
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Spring Sprint");
    expect(screen.getByLabelText(/Address/)).toHaveValue("spring-sprint");
    await user.click(screen.getByRole("button", { name: "Create page" }));

    // The template's kind (landing) wins over the tab the admin was on (website).
    expect(createLandingPage).toHaveBeenCalledWith({ title: "Spring Sprint", slug: "spring-sprint", template: "lpg_AAAAAAAAAAA1", pageType: "landing" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/pages/launch-kit"));
  });

  it("keeps an address typed by hand when the title changes", async () => {
    const user = await openMenu({ templates: TEMPLATES });
    await user.click(screen.getByRole("menuitem", { name: /Start from a template/ }));
    await user.click(screen.getByRole("radio", { name: /About us/ }));
    await user.clear(screen.getByLabelText(/Address/));
    await user.type(screen.getByLabelText(/Address/), "who-we-are");
    await user.type(screen.getByLabelText("Title"), " 2");
    expect(screen.getByLabelText(/Address/)).toHaveValue("who-we-are");
  });

  it("shows the server's reason and stays open when the page can't be made", async () => {
    createLandingPage.mockResolvedValue({ error: "Another page already has that address." });
    const user = await openMenu({ templates: TEMPLATES });
    await user.click(screen.getByRole("menuitem", { name: /Start from a template/ }));
    await user.click(screen.getByRole("radio", { name: /About us/ }));
    await user.click(screen.getByRole("button", { name: "Create page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another page already has that address.");
    expect(push).not.toHaveBeenCalled();
  });

  it("closes with Cancel and starts clean next time", async () => {
    const user = await openMenu({ templates: TEMPLATES });
    await user.click(screen.getByRole("menuitem", { name: /Start from a template/ }));
    await user.click(screen.getByRole("radio", { name: /About us/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "More ways to start a page" }));
    await user.click(screen.getByRole("menuitem", { name: /Start from a template/ }));
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });
});

describe("Import from JSON", () => {
  const upload = async (user: ReturnType<typeof userEvent.setup>, text = "{}", name = "page.json") => user.upload(screen.getByLabelText(/^File/), new File([text], name, { type: "application/json" }));

  it("previews the file first, then asks for the kind, title and address and makes the page", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ summary: summary({ leftOut: [{ type: "Widget", count: 2 }] }) }).mockResolvedValueOnce({ slug: "spring-sprint" });
    const user = await openMenu({ defaultType: "landing" });
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    expect(screen.queryByLabelText("Title")).toBeNull();
    await upload(user, '{"content":[]}');

    expect(await screen.findByText(/The file has 3 blocks\./)).toBeInTheDocument();
    expect(screen.queryByText(/Your draft has/)).toBeNull();
    expect(screen.getByText(/2 blocks the builder doesn't have were left out: Widget \(2\)/)).toBeInTheDocument();
    expect(createLandingPageFromJson).toHaveBeenCalledWith({ text: '{"content":[]}' }, { dryRun: true });
    // The title comes from the file, the kind from the tab the admin was on.
    expect(screen.getByLabelText("Title")).toHaveValue("Spring sprint");
    expect(screen.getByRole("radio", { name: /Landing page/ })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: /Website page/ }));
    await user.click(screen.getByRole("button", { name: "Create page" }));
    expect(createLandingPageFromJson).toHaveBeenLastCalledWith({ text: '{"content":[]}', title: "Spring sprint", slug: "spring-sprint", pageType: "website" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/pages/spring-sprint"));
  });

  it("shows the publish check's findings in the preview", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ summary: summary({ issues: [{ severity: "error", block: "Image", message: "A picture has no description." }] }) });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    await upload(user);
    expect(await screen.findByText(/A picture has no description\./)).toBeInTheDocument();
  });

  it("says why a file that isn't a page can't be used, and offers no way to make a page from it", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ error: "That isn't JSON. Choose a file exported from the page builder, or paste its whole text." });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    await upload(user, "{ nope");
    expect(await screen.findByRole("alert")).toHaveTextContent("That isn't JSON");
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.getByRole("button", { name: "Create page" })).toBeDisabled();
  });

  it("refuses a file over 2 MB without sending it", async () => {
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    await upload(user, "x".repeat(2_000_001));
    expect(await screen.findByRole("alert")).toHaveTextContent("2 MB limit");
    expect(createLandingPageFromJson).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the page can't be made (a taken address), and stays open", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ summary: summary() }).mockResolvedValueOnce({ error: "Another page already has that address." });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    await upload(user);
    await screen.findByLabelText("Title");
    await user.click(screen.getByRole("button", { name: "Create page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another page already has that address.");
    expect(push).not.toHaveBeenCalled();
  });

  it("needs a title before it makes the page", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ summary: summary({ source: undefined }) });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    await upload(user);
    await screen.findByLabelText("Title");
    expect(screen.getByRole("button", { name: "Create page" })).toBeDisabled();
    await user.type(screen.getByLabelText("Title"), "Fresh");
    expect(screen.getByRole("button", { name: "Create page" })).toBeEnabled();
  });

  it("accepts pasted text: check it, then make the page from that text", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ summary: summary() }).mockResolvedValueOnce({ slug: "spring-sprint" });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    expect(screen.getByRole("button", { name: "Check the JSON" })).toBeDisabled();
    await user.click(screen.getByLabelText(/Or paste the JSON/));
    await user.paste('{"content":[]}');
    await user.click(screen.getByRole("button", { name: "Check the JSON" }));

    expect(await screen.findByText(/The file has 3 blocks\./)).toBeInTheDocument();
    expect(createLandingPageFromJson).toHaveBeenCalledWith({ text: '{"content":[]}' }, { dryRun: true });
    await user.click(screen.getByRole("button", { name: "Create page" }));
    expect(createLandingPageFromJson).toHaveBeenLastCalledWith({ text: '{"content":[]}', title: "Spring sprint", slug: "spring-sprint", pageType: "website" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/pages/spring-sprint"));
  });

  it("drops the preview when the pasted text is edited again", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ summary: summary() });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    await user.click(screen.getByLabelText(/Or paste the JSON/));
    await user.paste("{}");
    await user.click(screen.getByRole("button", { name: "Check the JSON" }));
    await screen.findByLabelText("Title");
    await user.type(screen.getByLabelText(/Or paste the JSON/), " ");
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.queryByText(/The file has/)).toBeNull();
  });

  it("says why pasted text that isn't a page can't be used", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ error: "That JSON isn't a page: it should be an object with a list of blocks." });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    await user.click(screen.getByLabelText(/Or paste the JSON/));
    await user.paste("[]");
    await user.click(screen.getByRole("button", { name: "Check the JSON" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't a page");
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("forgets the file when closed", async () => {
    createLandingPageFromJson.mockResolvedValueOnce({ summary: summary() });
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    await upload(user);
    await screen.findByLabelText("Title");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "More ways to start a page" }));
    await user.click(screen.getByRole("menuitem", { name: /Import from JSON/ }));
    expect(screen.queryByLabelText("Title")).toBeNull();
  });
});
