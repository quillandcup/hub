// @vitest-environment jsdom
/** The Design view: the shared header and footer, autosaved as a draft and published in one explicit step. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EMPTY_SITE_TEMPLATE, normalizeSiteTemplate } from "@/lib/landing/site-template";

const mocks = vi.hoisted(() => ({ save: vi.fn(), publish: vi.fn(), reset: vi.fn() }));
vi.mock("@/app/(admin)/admin/pages/design/actions", () => ({ saveSiteDraft: mocks.save, publishSiteTemplate: mocks.publish, resetSiteDraft: mocks.reset }));
vi.mock("@/components/media/MediaPicker", () => ({ default: ({ noun }: { noun?: string }) => <div>picker for the {noun}</div> }));

import DesignEditor from "@/app/(admin)/admin/pages/design/DesignEditor";

const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mocks.save.mockResolvedValue({ savedAt: "2026-11-20T12:00:00Z" });
  mocks.publish.mockResolvedValue({ publishedAt: "2026-11-20T12:05:00Z" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const view = (over: Partial<Parameters<typeof DesignEditor>[0]> = {}) => render(<DesignEditor initial={EMPTY_SITE_TEMPLATE} publishedAt={null} hasPublished={false} unpublished {...over} />);

describe("the Design view", () => {
  it("says the header and footer are shared and that visitors see them only after publishing", () => {
    view();
    expect(screen.getByText(/shared by every website page/)).toBeInTheDocument();
    expect(screen.getByText(/Not published yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reset to published" })).toBeNull();
  });

  it("autosaves the draft a moment after a change, once, and counts nothing as published", async () => {
    view();
    fireEvent.click(screen.getByLabelText("Show a footer on website pages"));
    fireEvent.change(screen.getByLabelText(/Text \(for example/), { target: { value: "Fern Quills" } });
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].footer).toMatchObject({ show: true, text: "Fern Quills" });
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Draft saved, not published");
  });

  it("adds, edits, moves and removes header blocks, and shows them in the preview", async () => {
    view();
    fireEvent.click(screen.getByLabelText("Show a header on website pages"));
    fireEvent.click(screen.getByRole("button", { name: "Add call to action" }));
    fireEvent.change(screen.getByLabelText("Button label"), { target: { value: "Join us" } });
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "/join" } });
    fireEvent.click(screen.getByRole("button", { name: "Add sign in" }));
    expect(screen.getByRole("link", { name: "Join us" })).toHaveAttribute("href", "/join");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    fireEvent.click(screen.getByRole("button", { name: "Move signin up" }));
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual(["Sign in", "Call to action"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove signin" }));
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("edits the site's style guide and favicon, saves them with the draft, and shows the style on the preview", async () => {
    const { container } = view();
    fireEvent.change(screen.getByLabelText("Primary colour (buttons, accents and links)"), { target: { value: "teal" } });
    fireEvent.change(screen.getByLabelText("Page background"), { target: { value: "cream" } });
    expect(screen.getByText("picker for the favicon")).toBeInTheDocument();
    expect(container.querySelector(".lp-primary-teal.lp-bg-cream")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(mocks.save.mock.calls[0][0].style).toMatchObject({ primary: "teal", pageBackground: "cream" });
  });

  it("offers a menu with links to add and remove, and the logo's picker", () => {
    view({ initial: normalizeSiteTemplate({ header: { show: true, items: [{ id: "m", type: "menu", links: [{ label: "Home", href: "/" }] }, { id: "l", type: "logo", alt: "" }] } }) });
    fireEvent.click(screen.getByRole("button", { name: "Add a menu link" }));
    expect(screen.getAllByLabelText("Label")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove menu link 1" }));
    expect(screen.getAllByLabelText("Label")).toHaveLength(1);
    expect(screen.getByText("picker for the logo")).toBeInTheDocument();
  });

  it("publishes what is shown and says so, and says what is wrong when the publish is refused", async () => {
    view();
    mocks.publish.mockResolvedValueOnce({ error: "Fix these before publishing.", issues: ["The header button needs a label and a link."] });
    fireEvent.click(screen.getByRole("button", { name: "Publish site design" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Fix these before publishing.");
    expect(screen.getByText("The header button needs a label and a link.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish site design" }));
    await flush();
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Every published website page now shows this header, footer and style.");
    expect(screen.getByRole("button", { name: "Reset to published" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("resets the draft to the published copy after asking", async () => {
    mocks.reset.mockResolvedValue({ site: normalizeSiteTemplate({ footer: { show: true, text: "Live words" } }) });
    view({ publishedAt: "2026-11-01T00:00:00Z", hasPublished: true, unpublished: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset to published" }));
    await flush();
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Reset to published" }));
    });
    await flush();
    expect(mocks.reset).toHaveBeenCalled();
    expect(screen.getByLabelText(/Text \(for example/)).toHaveValue("Live words");
  });

  it("keeps the reset off while the draft is the published copy", () => {
    view({ publishedAt: "2026-11-01T00:00:00Z", hasPublished: true, unpublished: false });
    expect(screen.getByRole("button", { name: "Reset to published" })).toBeDisabled();
  });
});
