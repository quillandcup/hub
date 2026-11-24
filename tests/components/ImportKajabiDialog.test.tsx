// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/(admin)/admin/pages/actions", () => ({ createLandingPage: vi.fn(), createLandingPageFromJson: vi.fn() }));

import NewPageButton from "@/app/(admin)/admin/pages/NewPageButton";

const fetchMock = vi.fn();
const imported = (over: Record<string, unknown> = {}) => ({
  status: "imported",
  action: "created",
  slug: "example-sprint",
  title: "Example Sprint",
  published: false,
  keptBefore: false,
  notes: [
    { kind: "todo", text: "Choose the Kajabi form." },
    { kind: "hidden", text: "Hidden in Kajabi, not imported: button Old." },
    { kind: "left_out", text: "Footer block is not imported." },
  ],
  issues: [{ severity: "error", block: "Image", message: "A picture has no description." }],
  counts: { blocks: 5, hidden: 1, pictures: 2, picturesFailed: 0 },
  ...over,
});
const inspected = (over: Record<string, unknown> = {}) => ({
  status: "inspected",
  start: { heading: "Write a little, every day", lines: ["Join the Example Sprint.", "Second line."] },
  suggestedTitle: "Write a little, every day",
  blocks: 5,
  countdowns: 0,
  matches: [],
  pages: [],
  ...over,
});
const match = (over: Record<string, unknown> = {}) => ({ id: "lpg_a", title: "Example Sprint", slug: "example-sprint", draftHeading: "Draft heading", published: false, edited: false, unpublishedChanges: false, ...over });

/** The server answers by what the form says: an inspection for `mode=inspect`, else the next answer in the list. */
function server(inspection: unknown, ...answers: unknown[]) {
  fetchMock.mockImplementation(async (_url: string, init: { body: FormData }) => ({ json: async () => (init.body.get("mode") === "inspect" ? inspection : answers.shift()) }));
}
const sent = (n: number) => fetchMock.mock.calls[n][1].body as FormData;
const zip = (name = "export.zip") => new File(["zip"], name, { type: "application/zip" });

async function openDialog(files: File[] = [zip()]) {
  const user = userEvent.setup();
  render(<NewPageButton />);
  await user.click(screen.getByRole("button", { name: "More ways to start a page" }));
  await user.click(screen.getByRole("menuitem", { name: /Import from Kajabi/ }));
  await user.upload(screen.getByLabelText(/Export files/), files);
  return user;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("New page with Import from Kajabi", () => {
  it("keeps New page as a link, with the import in a menu beside it", async () => {
    render(<NewPageButton />);
    expect(screen.getByRole("link", { name: "New page" })).toHaveAttribute("href", "/admin/pages/new?type=website");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "More ways to start a page" }));
    expect(screen.getByRole("menuitem", { name: /Import from Kajabi/ })).toBeInTheDocument();
  });

  it("reads the file first, shows what it starts with, and prefills a title the admin can change", async () => {
    server(inspected(), imported());
    const user = await openDialog();

    expect(await screen.findByText(/This export starts with/)).toHaveTextContent("Write a little, every day");
    expect(screen.getByText("Join the Example Sprint.")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/landing-pages/import");
    expect((init.body as FormData).get("mode")).toBe("inspect");

    const title = screen.getByLabelText(/Page title/);
    expect(title).toHaveValue("Write a little, every day");
    await user.clear(title);
    await user.type(title, "Example Sprint");
    await user.click(screen.getByRole("button", { name: /^Import/ }));

    expect(await screen.findByRole("status")).toHaveTextContent("Created a draft: Example Sprint");
    expect(sent(1).get("title")).toBe("Example Sprint");
    expect(sent(1).get("asNew")).toBe("true");
    expect(sent(1).get("replacePageId")).toBeNull();
    expect(sent(1).get("mode")).toBeNull();
    expect(screen.getByText("Choose the Kajabi form.")).toBeInTheDocument();
    expect(screen.getByText(/Hidden in Kajabi, not imported: button Old/)).toBeInTheDocument();
    expect(screen.getByText("Footer block is not imported.")).toBeInTheDocument();
    expect(screen.getByText("A picture has no description.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the draft" })).toHaveAttribute("href", "/admin/pages/example-sprint");
  });

  it("needs a title for a new page, and not for a replace", async () => {
    server(inspected({ suggestedTitle: "", pages: [{ id: "lpg_old", title: "Old Import", slug: "old-import" }] }));
    const user = await openDialog();
    await screen.findByText(/This export starts with/);

    expect(screen.getByRole("button", { name: /^Import/ })).toBeDisabled();
    await user.click(screen.getByLabelText("Replace the draft of another imported page"));
    expect(screen.queryByLabelText(/Page title/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Replace the draft/ })).toBeDisabled(); // no page chosen yet
    await user.selectOptions(screen.getByLabelText("Page to replace"), "lpg_old");
    expect(screen.getByRole("button", { name: /^Replace the draft/ })).toBeEnabled();
    expect(screen.getByText(/Any edits in that draft will be replaced/)).toBeInTheDocument();
  });

  it("does not default to replacing: a page with the same layout is offered, nothing is chosen, and the cost is said", async () => {
    server(inspected({ matches: [match({ edited: true, published: true, unpublishedChanges: true })], pages: [{ id: "lpg_a", title: "Example Sprint", slug: "example-sprint" }] }), imported({ action: "updated", published: true, keptBefore: true }));
    const user = await openDialog();

    await screen.findByText(/This looks like a page you already have/);
    expect(screen.getByText(/nothing is replaced unless you choose it/)).toBeInTheDocument();
    expect(screen.getByText(/Its draft starts with: .Draft heading./)).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(screen.getByRole("button", { name: /^Import/ })).toBeDisabled();
    expect(screen.queryByText(/Any edits in this draft will be replaced/)).toBeNull();
    // Nothing in the title wording compares the typed title with the page's.
    expect(screen.queryByText(/which you named/)).toBeNull();

    await user.click(screen.getByLabelText(/Replace the draft of .Example Sprint. \(\/example-sprint\)/));
    expect(screen.getByText("Any edits in this draft will be replaced by the import.")).toBeInTheDocument();
    expect(screen.getByText(/edited in the editor after the last import/)).toBeInTheDocument();
    expect(screen.getByText(/changes that are not published/)).toBeInTheDocument();
    expect(screen.getByText(/old draft is kept in the page.s Version history/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Page title/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Replace the draft/ }));

    expect(await screen.findByRole("status")).toHaveTextContent("Updated the draft");
    expect(sent(1).get("replacePageId")).toBe("lpg_a");
    expect(sent(1).get("asNew")).toBeNull();
    expect(screen.getByText(/The live version has not changed/)).toBeInTheDocument();
    expect(screen.getByText(/draft before an import/)).toBeInTheDocument();
  });

  it("imports as a new page when the admin says it is a different page", async () => {
    server(inspected({ matches: [match()], pages: [{ id: "lpg_a", title: "Example Sprint", slug: "example-sprint" }] }), imported());
    const user = await openDialog();
    await screen.findByText(/This looks like a page you already have/);

    await user.click(screen.getByLabelText("Import as a new page"));
    await user.click(screen.getByRole("button", { name: /^Import/ }));

    expect(await screen.findByRole("status")).toHaveTextContent("Created a draft");
    expect(sent(1).get("asNew")).toBe("true");
    expect(sent(1).get("replacePageId")).toBeNull();
  });

  it("asks again when a page with the layout appeared since the file was read", async () => {
    server(inspected({ pages: [] }), { status: "choose", matches: [match()], pages: [{ id: "lpg_a", title: "Example Sprint", slug: "example-sprint" }] });
    const user = await openDialog();
    await screen.findByText(/This export starts with/);
    await user.click(screen.getByRole("button", { name: /^Import/ }));

    expect(await screen.findByText(/This looks like a page you already have/)).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
  });

  it("handles several files, each with its own title and choice", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { body: FormData }) => {
      const file = init.body.get("file") as File;
      if (init.body.get("mode") === "inspect") return { json: async () => inspected({ start: { heading: `Heading of ${file.name}`, lines: [] }, suggestedTitle: `Title of ${file.name}` }) };
      return { json: async () => imported({ title: init.body.get("title"), slug: `slug-of-${file.name}` }) };
    });
    const user = await openDialog([zip("first.zip"), zip("second.zip")]);

    expect(await screen.findByText(/Heading of first.zip/)).toBeInTheDocument();
    expect(await screen.findByText(/Heading of second.zip/)).toBeInTheDocument();
    const titles = screen.getAllByLabelText(/Page title/);
    expect(titles.map((t) => (t as HTMLInputElement).value)).toEqual(["Title of first.zip", "Title of second.zip"]);

    await user.click(screen.getAllByRole("button", { name: /^Import/ })[1]);
    expect(await screen.findByRole("status")).toHaveTextContent("Created a draft: Title of second.zip");
    // The first is still waiting for its own choice.
    expect(screen.getAllByLabelText(/Page title/)).toHaveLength(1);

    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.queryByLabelText(/Page title/)).toBeNull();
  });

  it("shows an error for a file that can't be read, and lets it be removed", async () => {
    server({ status: "error", error: "That isn't a zip file." });
    const user = await openDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("That isn't a zip file.");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error from the import and lets the admin try again", async () => {
    server(inspected(), { status: "error", error: "Couldn't find a free address for the page." }, imported());
    const user = await openDialog();
    await screen.findByText(/This export starts with/);

    await user.click(screen.getByRole("button", { name: /^Import/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("free address");
    await user.click(screen.getByRole("button", { name: /^Import/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Created a draft");
  });

  it("shows a calm message when the server can't be reached", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await openDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server");
  });

  it("shows the Ctrl/Cmd+Enter hint on Import, and the key imports", async () => {
    server(inspected(), imported());
    const user = await openDialog();
    await screen.findByText(/This export starts with/);
    const button = screen.getByRole("button", { name: /^Import/ });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    expect(button.querySelector("[data-kbd]")).not.toBeNull();
    await user.click(screen.getByLabelText(/Page title/));
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByRole("status")).toHaveTextContent("Created a draft: Example Sprint");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("the page address for a countdown's date", () => {
  it("is not asked for when the export has no countdown", async () => {
    server(inspected(), imported());
    await openDialog();
    await screen.findByText(/This export starts with/);
    expect(screen.queryByLabelText(/Address of the page on the Kajabi site/)).toBeNull();
  });

  it("is asked for when it has one, and sent with the import only when typed", async () => {
    server(inspected({ countdowns: 1 }), imported(), imported());
    const user = await openDialog();
    await screen.findByLabelText(/Address of the page on the Kajabi site/);
    expect(screen.getByText(/has a countdown/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Import/ }));
    await screen.findByRole("status");
    expect(sent(1).get("originalPath")).toBeNull();
  });

  it("sends the typed path, trimmed", async () => {
    server(inspected({ countdowns: 2 }), imported());
    const user = await openDialog();
    await user.type(await screen.findByLabelText(/Address of the page on the Kajabi site/), "  /example-program ");
    expect(screen.getByText(/has 2 countdowns/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Import/ }));
    await screen.findByRole("status");
    expect(sent(1).get("originalPath")).toBe("/example-program");
  });
});
