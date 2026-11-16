// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  restore: vi.fn(),
  details: vi.fn(),
  dispatch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  change: undefined as undefined | ((data: unknown) => void),
}));

vi.mock("@puckeditor/core/puck.css", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/landing/editor-config", () => ({ editorConfig: {} }));
vi.mock("@/components/media/MediaPicker", () => ({ default: () => <div>picker</div> }));
vi.mock("../../app/(admin)/admin/pages/actions", () => ({
  saveLandingDraft: mocks.save,
  publishLandingPage: mocks.publish,
  unpublishLandingPage: mocks.unpublish,
  restoreLandingPageVersion: mocks.restore,
  updateLandingPageDetails: mocks.details,
}));
vi.mock("@puckeditor/core", () => ({
  // The editor itself is Puck's; what is ours is the header, the autosave and the publish step around it.
  Puck: ({ onChange, overrides }: { onChange: (data: unknown) => void; overrides: { header: () => ReactNode } }) => {
    mocks.change = onChange;
    return <div>{overrides.header()}</div>;
  },
  createUsePuck: () => (select: (state: unknown) => unknown) =>
    select({
      history: { hasPast: true, hasFuture: false, back: mocks.back, forward: mocks.forward },
      dispatch: mocks.dispatch,
      appState: { ui: { viewports: { current: { width: 1280, height: "auto" }, controlsVisible: false, options: [] } } },
    }),
}));

import LandingEditor, { type EditorPage } from "@/app/(admin)/admin/pages/[slug]/LandingEditor";

const page: EditorPage = { id: "lpg_AAAAAAAAAAA1", slug: "spring", title: "Spring sprint", status: "draft", seoTitle: "", seoDescription: "", socialImageAssetId: "", publishedJson: null, publicPath: "/p/spring" };
const heading = { type: "Heading", props: { id: "h", text: "Welcome", level: "h1", align: "center" } };
const data = { content: [heading], root: {} };

function editor(over: Partial<EditorPage> = {}, versions: { id: string; title: string; createdAt: string }[] = []) {
  return render(<LandingEditor page={{ ...page, ...over }} data={data} versions={versions} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  Object.values(mocks).forEach((m) => typeof m === "function" && "mockReset" in m && m.mockReset());
  mocks.save.mockResolvedValue({ savedAt: "2027-01-01T00:00:00Z" });
  mocks.publish.mockResolvedValue({ publishedAt: "2027-01-01T00:00:00Z", issues: [] });
  mocks.unpublish.mockResolvedValue({ slug: "spring" });
  mocks.details.mockResolvedValue({ slug: "spring" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const edit = (text: string) => act(() => mocks.change!({ content: [{ ...heading, props: { ...heading.props, text } }], root: {} }));

describe("autosave", () => {
  it("starts as saved, shows unsaved changes while typing and saves once typing pauses", async () => {
    editor();
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    edit("Welcome back");
    edit("Welcome back, writers");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(mocks.save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });

    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(page.id, expect.objectContaining({ content: [expect.objectContaining({ props: expect.objectContaining({ text: "Welcome back, writers" }) })] }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("does not save when nothing changed", async () => {
    editor();
    act(() => mocks.change!(data));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("says so and tries again when a save fails", async () => {
    mocks.save.mockResolvedValueOnce({ error: "Couldn't save." });
    editor();
    edit("Changed");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't save");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("saves at once with Ctrl+S", async () => {
    editor();
    edit("Quick");
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});

describe("the header", () => {
  it("switches the preview size, and undoes and redoes through Puck's history", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Phone preview" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 390, height: "auto" } }) } });
    expect(screen.getByRole("button", { name: "Desktop preview" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(mocks.back).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("shows the page's state, and the live link only once published", () => {
    const { unmount } = editor();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View live" })).toBeNull();
    unmount();
    editor({ status: "published", publishedJson: JSON.stringify(data) });
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View live" })).toHaveAttribute("href", "/p/spring");
  });

  it("notes changes that aren't published yet", () => {
    editor({ status: "published", publishedJson: JSON.stringify(data) });
    expect(screen.queryByText("Changes not published yet")).toBeNull();
    edit("Different");
    expect(screen.getByText("Changes not published yet")).toBeInTheDocument();
  });
});

describe("publishing", () => {
  it("is a separate, explicit step: nothing is published until confirmed", async () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(screen.getByText(/The page goes live at/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Publish" }).at(-1)!);
    });
    expect(mocks.publish).toHaveBeenCalledWith(page.id, data);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("lists what must be fixed and won't publish while there are errors", () => {
    editor();
    act(() => mocks.change!({ content: [{ type: "RichText", props: { id: "r", html: "<p>x</p>" } }], root: {} }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByText(/needs one title/i)).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "Publish" }).at(-1)!;
    expect(confirm).toBeDisabled();
  });

  it("offers to publish anyway when there are only warnings", () => {
    editor();
    act(() => mocks.change!({ content: [heading, { type: "Button", props: { id: "b", label: "Click here", href: "https://example.com" } }], root: {} }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(screen.getByRole("button", { name: "Publish anyway" })).toBeEnabled();
  });

  it("shows why the server refused", async () => {
    mocks.publish.mockResolvedValueOnce({ error: "Fix these before publishing.", issues: [{ severity: "error", block: "Image", message: "A picture needs a description." }] });
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Publish" }).at(-1)!);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Fix these before publishing.");
  });

  it("takes a published page down after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    editor({ status: "published", publishedJson: JSON.stringify(data) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    });
    expect(mocks.unpublish).toHaveBeenCalledWith(page.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });
});

describe("history and details", () => {
  it("lists the versions kept at each publish and brings one back after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.restore.mockResolvedValue({ error: "That version no longer exists." });
    editor({}, [{ id: "lpgv_AAAAAAAAAAA1", title: "Spring sprint", createdAt: "2027-01-01T00:00:00Z" }]);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bring back" }));
    });
    expect(mocks.restore).toHaveBeenCalledWith("lpgv_AAAAAAAAAAA1");
    expect(screen.getByRole("alert")).toHaveTextContent("That version no longer exists.");
  });

  it("says when nothing has been published yet", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText(/Nothing has been published yet/)).toBeInTheDocument();
  });

  it("saves the details and follows a changed address", async () => {
    mocks.details.mockResolvedValueOnce({ slug: "spring-2027" });
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.change(screen.getByLabelText(/Address/), { target: { value: "spring-2027" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    });
    expect(mocks.details).toHaveBeenCalledWith(page.id, expect.objectContaining({ slug: "spring-2027", title: "Spring sprint" }));
    expect(mocks.replace).toHaveBeenCalledWith("/admin/pages/spring-2027");
  });
});
