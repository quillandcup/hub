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
const reply = (body: unknown) => fetchMock.mockResolvedValueOnce({ json: async () => body });

async function openDialog() {
  const user = userEvent.setup();
  render(<NewPageButton />);
  await user.click(screen.getByRole("button", { name: "More ways to start a page" }));
  await user.click(screen.getByRole("menuitem", { name: /Import from Kajabi/ }));
  await user.upload(screen.getByLabelText(/Export file/), new File(["zip"], "export.zip", { type: "application/zip" }));
  await user.type(screen.getByLabelText(/Page title/), "Example Sprint");
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

  it("uploads the export with its title and shows what came across and what didn't", async () => {
    reply(imported());
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Created a draft: Example Sprint");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/landing-pages/import");
    expect((init.body as FormData).get("title")).toBe("Example Sprint");
    expect((init.body as FormData).get("confirm")).toBeNull();
    expect(screen.getByText("Choose the Kajabi form.")).toBeInTheDocument();
    expect(screen.getByText(/Hidden in Kajabi, not imported: button Old/)).toBeInTheDocument();
    expect(screen.getByText("Footer block is not imported.")).toBeInTheDocument();
    expect(screen.getByText("A picture has no description.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the draft" })).toHaveAttribute("href", "/admin/pages/example-sprint");
  });

  it("says the live page didn't change when an import updates a published page's draft", async () => {
    reply(imported({ action: "updated", published: true, keptBefore: true }));
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Updated the draft");
    expect(screen.getByText(/The live version has not changed/)).toBeInTheDocument();
    expect(screen.getByText(/draft before an import/)).toBeInTheDocument();
  });

  it("asks before replacing a draft with edits, and only then sends the confirmation", async () => {
    reply({ status: "confirm", reasons: ["Its draft was edited after the last import."], existing: { title: "Example Sprint", slug: "example-sprint" } });
    reply(imported({ action: "updated", keptBefore: true }));
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText(/Its draft was edited after the last import/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Replace the draft" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[1][1].body as FormData).get("confirm")).toBe("true");
    expect(await screen.findByRole("status")).toHaveTextContent("Updated the draft");
  });

  it("shows an error and lets the admin try again", async () => {
    reply({ status: "error", error: "That isn't a zip file." });
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That isn't a zip file.");
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("shows a calm message when the server can't be reached", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const user = await openDialog();
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server");
  });

  it("shows the Ctrl/Cmd+Enter hint on Import, and the key imports", async () => {
    reply(imported());
    const user = await openDialog();
    const button = screen.getByRole("button", { name: "Import" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    expect(button.querySelector("[data-kbd]")).not.toBeNull();
    await user.click(screen.getByLabelText(/Page title/));
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByRole("status")).toHaveTextContent("Created a draft: Example Sprint");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
