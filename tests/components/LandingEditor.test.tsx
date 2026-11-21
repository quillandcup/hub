// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { tooltipText } from "@/tests/helpers/tooltip";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  restore: vi.fn(),
  reset: vi.fn(),
  starter: vi.fn(),
  template: vi.fn(),
  saveTemplate: vi.fn(),
  importJson: vi.fn(),
  details: vi.fn(),
  dispatch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  width: 1280,
  height: "auto" as number | "auto",
  change: undefined as undefined | ((data: unknown) => void),
}));

vi.mock("@puckeditor/core/no-external.css", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/landing/editor-config", () => ({ editorConfig: {} }));
vi.mock("@/components/media/MediaPicker", () => ({ default: () => <div>picker</div> }));
vi.mock("../../app/(admin)/admin/pages/actions", () => ({
  saveLandingDraft: mocks.save,
  publishLandingPage: mocks.publish,
  unpublishLandingPage: mocks.unpublish,
  restoreLandingPageVersion: mocks.restore,
  resetLandingDraftToPublished: mocks.reset,
  replaceLandingDraftWithStarter: mocks.starter,
  importLandingDraftJson: mocks.importJson,
  updateLandingPageDetails: mocks.details,
}));
vi.mock("../../app/(admin)/admin/pages/template-actions", () => ({ replaceLandingDraftWithTemplate: mocks.template, saveLandingTemplate: mocks.saveTemplate }));
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
      appState: { ui: { leftSideBarVisible: true, rightSideBarVisible: false, viewports: { current: { width: mocks.width, height: mocks.height }, controlsVisible: false, options: [] } } },
    }),
}));

import LandingEditor, { type EditorPage } from "@/app/(admin)/admin/pages/[slug]/LandingEditor";

const page: EditorPage = { id: "lpg_AAAAAAAAAAA1", slug: "spring", title: "Spring sprint", status: "draft", seoTitle: "", seoDescription: "", socialImageAssetId: "", publishedJson: null, publicPath: "/p/spring" };
const heading = { type: "Heading", props: { id: "h", text: "Welcome", level: "h1", align: "center" } };
const data = { content: [heading], root: {} };
const STARTERS = [{ key: "home", label: "Homepage", description: "The public front door." }];

function editor(over: Partial<EditorPage> = {}, versions: { id: string; title: string; createdAt: string; kind?: "published" | "before_import" | "before_starter"; by?: string; note?: string | null }[] = []) {
  return render(<LandingEditor page={{ ...page, ...over }} data={data} versions={versions} starters={STARTERS} />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  Object.values(mocks).forEach((m) => typeof m === "function" && "mockReset" in m && m.mockReset());
  mocks.width = 1280;
  mocks.height = "auto";
  mocks.save.mockResolvedValue({ savedAt: "2027-01-01T00:00:00Z" });
  mocks.publish.mockResolvedValue({ publishedAt: "2027-01-01T00:00:00Z", issues: [] });
  mocks.unpublish.mockResolvedValue({ slug: "spring" });
  mocks.details.mockResolvedValue({ slug: "spring" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Answers the confirm dialog that is open (the topmost one), by its button. */
const answer = (name: string) =>
  act(async () => {
    fireEvent.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name }));
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
  it("switches the preview size to each device's width and height, and undoes and redoes through Puck's history", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Phone preview" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 402, height: 874 } }) } });
    fireEvent.click(screen.getByRole("button", { name: "Tablet portrait preview" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 820, height: 1180 } }) } });
    fireEvent.click(screen.getByRole("button", { name: "Tablet landscape preview" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 1180, height: 820 } }) } });
    expect(screen.getByRole("button", { name: "Desktop preview" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(mocks.back).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("offers no device model list and no fold toggle at desktop size", () => {
    editor();
    expect(screen.queryByRole("combobox", { name: /model/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fold line" })).toBeNull();
  });

  it("lists tablet models at a tablet size and sets the canvas to the width and height of the one picked", () => {
    mocks.width = 820;
    mocks.height = 1180;
    editor();
    const box = screen.getByRole("combobox", { name: "Tablet model" });
    expect(screen.queryByRole("combobox", { name: "Phone model" })).toBeNull();
    expect(box).toHaveAttribute("placeholder", "iPad");
    fireEvent.focus(box);
    fireEvent.click(screen.getByText("iPad Pro 11-inch"));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 834, height: 1210 } }) } });
  });

  it("lists phone models at a phone size, can search them, and sets the canvas to the one picked", () => {
    mocks.width = 402;
    mocks.height = 874;
    editor();
    const box = screen.getByRole("combobox", { name: "Phone model" });
    expect(box).toHaveAttribute("placeholder", "iPhone 17");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "pixel" } });
    expect(screen.queryByText("iPhone 16")).toBeNull();
    fireEvent.click(screen.getByText("Google Pixel 9"));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 412, height: 923 } }) } });
  });

  it("keeps the picked model when the tablet is turned, and the size follows the swap", () => {
    // The mock canvas follows what is dispatched, as Puck's store would.
    mocks.dispatch.mockImplementation((action: { ui: { viewports: { current: { width: number; height: number } } } }) => {
      mocks.width = action.ui.viewports.current.width;
      mocks.height = action.ui.viewports.current.height;
    });
    mocks.width = 820;
    mocks.height = 1180;
    const view = editor();
    const again = () => view.rerender(<LandingEditor page={page} data={data} versions={[]} starters={STARTERS} />);

    fireEvent.focus(screen.getByRole("combobox", { name: "Tablet model" }));
    fireEvent.click(screen.getByText("iPad Pro 13-inch"));
    again();
    expect(screen.getByRole("combobox", { name: "Tablet model" })).toHaveAttribute("placeholder", "iPad Pro 13-inch");

    fireEvent.click(screen.getByRole("button", { name: "Tablet landscape preview" }));
    expect(mocks.dispatch).toHaveBeenLastCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 1376, height: 1032 } }) } });
    again();
    expect(screen.getByRole("combobox", { name: "Tablet model" })).toHaveAttribute("placeholder", "iPad Pro 13-inch");

    fireEvent.click(screen.getByRole("button", { name: "Tablet portrait preview" }));
    expect(mocks.dispatch).toHaveBeenLastCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 1032, height: 1376 } }) } });
    again();
    expect(screen.getByRole("combobox", { name: "Tablet model" })).toHaveAttribute("placeholder", "iPad Pro 13-inch");

    // Picking another model while on its side stays on its side.
    fireEvent.click(screen.getByRole("button", { name: "Tablet landscape preview" }));
    again();
    fireEvent.focus(screen.getByRole("combobox", { name: "Tablet model" }));
    fireEvent.click(screen.getByText("iPad mini"));
    expect(mocks.dispatch).toHaveBeenLastCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 1133, height: 744 } }) } });
  });

  it("shows no model list at a size that is not a model's", () => {
    mocks.width = 500;
    editor();
    expect(screen.queryByRole("combobox", { name: /model/i })).toBeNull();
  });

  it("offers a toggle for the fold line at a device size, which can be turned off", () => {
    mocks.width = 390;
    mocks.height = 844;
    editor();
    const toggle = screen.getByRole("button", { name: "Fold line" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("shows or hides each side panel", () => {
    editor();
    const left = screen.getByRole("button", { name: "Blocks panel" });
    const right = screen.getByRole("button", { name: "Settings panel" });
    expect(left).toHaveAttribute("aria-pressed", "true");
    expect(right).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(left);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { leftSideBarVisible: false } });
    fireEvent.click(right);
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { rightSideBarVisible: true } });
  });

  it("labels a template, links back to the templates, has no public link even when published, and can't be saved as a template", () => {
    editor({ kind: "template", publicPath: "", status: "published", publishedJson: JSON.stringify(data) });
    expect(screen.getByText("Template")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to templates" })).toHaveAttribute("href", "/admin/pages/templates");
    expect(screen.queryByRole("link", { name: "View live" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByRole("heading", { name: "Save as a template" })).toBeNull();
  });

  it("publishes a template whose checks only warn: it is never blocked and never says it goes live", async () => {
    mocks.publish.mockResolvedValue({ publishedAt: "2027-01-01T00:00:00Z", issues: [{ severity: "warning", block: "Button", message: "The button has no link." }] });
    editor({ kind: "template", publicPath: "" });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = screen.getByRole("dialog", { name: "Publish this template" });
    expect(dialog).toHaveTextContent("never on the public site");
    expect(within(dialog).getByRole("button", { name: /Publish/ })).not.toBeDisabled();
    expect(dialog).not.toHaveTextContent("goes live");
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

  it("keeps the controls as icons with a name and a tooltip each, so the header fits on one line", () => {
    editor({ status: "published", publishedJson: JSON.stringify(data) });
    edit("Different");
    for (const name of ["Details", "History", "Reset to published", "Preview", "Unpublish"]) {
      const button = screen.getByRole("button", { name });
      expect(tooltipText(button), name).toBe(name);
      expect(button, name).toHaveTextContent("");
      expect(button.querySelector("svg"), name).not.toBeNull();
    }
    const live = screen.getByRole("link", { name: "View live" });
    expect(tooltipText(live)).toBe("View live");
    expect(live).toHaveAttribute("target", "_blank");
    expect(live).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Publish changes" })).toHaveTextContent("Publish changes");
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
    expect(mocks.publish).toHaveBeenCalledWith(page.id, data, { note: "" });
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

  it("takes a published template down with its own words: it stops being offered, nothing public changes", async () => {
    editor({ kind: "template", publicPath: "", status: "published", publishedJson: JSON.stringify(data) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    });
    expect(screen.getByText(/no longer offered when you start a page/)).toBeInTheDocument();
  });

  it("takes a published page down only after confirming", async () => {
    editor({ status: "published", publishedJson: JSON.stringify(data) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    });
    expect(screen.getByRole("heading", { name: "Take this page down?" })).toBeInTheDocument();
    await answer("Cancel");
    expect(mocks.unpublish).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    });
    await answer("Unpublish");
    expect(mocks.unpublish).toHaveBeenCalledWith(page.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });
});

describe("reset to published", () => {
  const publishedPage = { status: "published", publishedJson: JSON.stringify(data) };
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockReset();
    vi.stubGlobal("location", { ...window.location, reload });
    mocks.reset.mockResolvedValue({ slug: "spring" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is hidden until the draft differs from what is published", () => {
    editor(publishedPage);
    expect(screen.queryByRole("button", { name: "Reset to published" })).toBeNull();
    edit("Welcome back");
    expect(tooltipText(screen.getByRole("button", { name: "Reset to published" }))).toEqual("Reset to published");
  });

  it("is never offered on a page that was not published", () => {
    editor();
    edit("Welcome back");
    expect(screen.queryByRole("button", { name: "Reset to published" })).toBeNull();
  });

  it("does nothing unless confirmed", async () => {
    editor(publishedPage);
    edit("Welcome back");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset to published" }));
    });
    expect(screen.getByRole("heading", { name: "Reset to published?" })).toBeInTheDocument();
    await answer("Cancel");
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("resets the draft, stops the pending autosave and reloads the editor", async () => {
    editor(publishedPage);
    edit("Welcome back");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset to published" }));
    });
    await answer("Reset to published");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mocks.reset).toHaveBeenCalledWith(page.id);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it("shows why it failed and does not reload", async () => {
    mocks.reset.mockResolvedValue({ error: "Couldn't reset the draft." });
    editor(publishedPage);
    edit("Welcome back");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset to published" }));
    });
    await answer("Reset to published");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reset the draft.");
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("history and details", () => {
  it("shows who made each version, when, how it came to be and the note, and says Someone when it can't tell", () => {
    editor({}, [
      { id: "lpgv_AAAAAAAAAAA2", title: "Spring sprint", createdAt: "2027-01-02T00:00:00Z", kind: "before_starter", by: "Bramble Admin", note: "Replaced by the starter “Homepage”" },
      { id: "lpgv_AAAAAAAAAAA1", title: "Spring sprint", createdAt: "2027-01-01T00:00:00Z", note: null },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText(/Your draft before it was replaced by Bramble Admin,/)).toBeInTheDocument();
    expect(screen.getByText("“Replaced by the starter “Homepage””")).toBeInTheDocument();
    expect(screen.getByText(/Published by Someone,/)).toBeInTheDocument();
  });

  it("sends the note typed in the publish dialog, and clears it for the next publish", async () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.change(screen.getByLabelText("What changed? (optional)"), { target: { value: "New headline" } });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Publish" }).at(-1)!);
    });
    expect(mocks.publish).toHaveBeenCalledWith(page.id, data, { note: "New headline" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    expect(screen.getByLabelText("What changed? (optional)")).toHaveValue("");
  });

  it("lists the versions kept at each publish and brings one back after confirming", async () => {
    mocks.restore.mockResolvedValue({ error: "That version no longer exists." });
    editor({}, [{ id: "lpgv_AAAAAAAAAAA1", title: "Spring sprint", createdAt: "2027-01-01T00:00:00Z" }]);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bring back" }));
    });
    await answer("Cancel");
    expect(mocks.restore).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Bring back" }));
    });
    await answer("Bring back");
    expect(mocks.restore).toHaveBeenCalledWith("lpgv_AAAAAAAAAAA1");
    expect(screen.getByRole("alert")).toHaveTextContent("That version no longer exists.");
  });

  describe("starting over from a template", () => {
    const reload = vi.fn();
    const TEMPLATE_ID = "lpg_TEMPLATEAAA1";
    beforeEach(() => {
      reload.mockReset();
      vi.stubGlobal("location", { ...window.location, reload });
      mocks.template.mockResolvedValue({ slug: "spring" });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("lists published templates beside the starters, and replaces the draft through the template action, not the starter one", async () => {
      render(<LandingEditor page={page} data={data} versions={[]} starters={[...STARTERS, { key: TEMPLATE_ID, label: "Launch kit", description: "A template you published.", group: "template" }]} />);
      fireEvent.click(screen.getByRole("button", { name: "History" }));
      fireEvent.change(screen.getByLabelText("Starter"), { target: { value: TEMPLATE_ID } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Replace draft with template" }));
      });
      await answer("Replace draft");
      expect(mocks.template).toHaveBeenCalledWith(page.id, TEMPLATE_ID);
      expect(mocks.starter).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
    });

    it("shows the template's reason when it can't be used", async () => {
      mocks.template.mockResolvedValue({ error: "That template is no longer available." });
      render(<LandingEditor page={page} data={data} versions={[]} starters={[{ key: TEMPLATE_ID, label: "Launch kit", description: "A template you published.", group: "template" }]} />);
      fireEvent.click(screen.getByRole("button", { name: "History" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Replace draft with template" }));
      });
      await answer("Replace draft");
      expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
      expect(reload).not.toHaveBeenCalled();
    });
  });

  describe("starting over from a starter", () => {
    const reload = vi.fn();
    beforeEach(() => {
      reload.mockReset();
      vi.stubGlobal("location", { ...window.location, reload });
      mocks.starter.mockResolvedValue({ slug: "spring" });
    });
    afterEach(() => vi.unstubAllGlobals());

    const open = async () => {
      editor();
      fireEvent.click(screen.getByRole("button", { name: "History" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Replace draft with starter" }));
      });
    };

    it("is offered in History, lists the starters, and asks first, saying what is kept and that nothing goes live", async () => {
      await open();
      expect(screen.getByRole("option", { name: "Homepage" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Replace your draft with the Homepage starter?" })).toBeInTheDocument();
      expect(screen.getByText(/kept in History as "Your draft before it was replaced"/)).toBeInTheDocument();
      expect(screen.getByText(/nothing goes live/)).toBeInTheDocument();
      await answer("Cancel");
      expect(mocks.starter).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it("replaces the draft and reloads the editor on the new one", async () => {
      await open();
      await answer("Replace draft");
      expect(mocks.starter).toHaveBeenCalledWith(page.id, "home");
      expect(reload).toHaveBeenCalled();
    });

    it("shows why it failed and does not reload", async () => {
      mocks.starter.mockResolvedValue({ error: "Couldn't replace the draft." });
      await open();
      await answer("Replace draft");
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't replace the draft.");
      expect(reload).not.toHaveBeenCalled();
    });

    it("saves what is typed first, so the kept draft is the one on screen", async () => {
      editor();
      edit("Welcome back");
      fireEvent.click(screen.getByRole("button", { name: "History" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Replace draft with starter" }));
      });
      await answer("Replace draft");
      expect(mocks.save).toHaveBeenCalled();
      expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.starter.mock.invocationCallOrder[0]);
    });

    it("names a draft kept before starting over in the list", () => {
      editor({}, [{ id: "lpgv_AAAAAAAAAAA2", title: "Spring sprint", createdAt: "2027-01-01T00:00:00Z", kind: "before_starter" }]);
      fireEvent.click(screen.getByRole("button", { name: "History" }));
      expect(screen.getByText(/Your draft before it was replaced/, { selector: "time" })).toBeInTheDocument();
    });
  });

  describe("export and import as JSON", () => {
    const reload = vi.fn();
    const summary = { blocksBefore: 1, blocksAfter: 3, leftOut: [{ type: "Gizmo", count: 2 }, { type: "Widget", count: 1 }], droppedProps: 0, removedPictures: 2, issues: [{ severity: "error", block: "Button", message: 'The button "Join" has no link.' }], identical: false };
    const FILE = JSON.stringify({ format: "hedgie-landing-page", version: 1, data: { content: [], root: {} } });
    beforeEach(() => {
      reload.mockReset();
      vi.stubGlobal("location", { ...window.location, reload });
      mocks.importJson.mockResolvedValue({ summary, applied: false });
    });
    afterEach(() => vi.unstubAllGlobals());

    const openHistory = () => {
      editor();
      fireEvent.click(screen.getByRole("button", { name: "History" }));
    };
    const pasteAndCheck = async (text = FILE) => {
      openHistory();
      fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
      fireEvent.change(screen.getByLabelText("Or paste the JSON"), { target: { value: text } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Check the JSON" }));
      });
    };
    const replaceButton = () => within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name: "Replace draft" });

    it("copies the draft as it is on screen, in the wrapper, with no ids of rows", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      openHistory();
      edit("Welcome back");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
      });
      const file = JSON.parse(writeText.mock.calls[0][0]);
      expect(file).toMatchObject({ format: "hedgie-landing-page", version: 1, slug: "spring", title: "Spring sprint", kind: "draft" });
      expect(file.data.content[0].props.text).toBe("Welcome back");
      expect(JSON.stringify(file)).not.toContain(page.id);
      expect(screen.getByText("Copied the page's JSON.")).toBeInTheDocument();
    });

    it("says when copying is not possible", async () => {
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
      openHistory();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
      });
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't copy");
    });

    it("downloads a file named from the address, which copy and the day", async () => {
      const created: Blob[] = [];
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      vi.stubGlobal("URL", { createObjectURL: (b: Blob) => (created.push(b), "blob:x"), revokeObjectURL: vi.fn() });
      editor({ publishedJson: JSON.stringify({ content: [], root: {} }), status: "published" });
      fireEvent.click(screen.getByRole("button", { name: "History" }));
      fireEvent.click(screen.getByLabelText("Published"));
      fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
      expect(click).toHaveBeenCalled();
      expect(screen.getByText(/^Downloaded spring-published-\d{4}-\d{2}-\d{2}\.json\.$/)).toBeInTheDocument();
      expect(JSON.parse(await created[0].text())).toMatchObject({ kind: "published", data: { content: [] } });
      click.mockRestore();
    });

    it("offers the published copy only when there is one", () => {
      openHistory();
      expect(screen.getByLabelText("Published")).toBeDisabled();
    });

    it("previews first: what was left out, removed and flagged, and writes nothing", async () => {
      await pasteAndCheck();
      expect(mocks.importJson).toHaveBeenCalledWith(page.id, FILE, { dryRun: true });
      expect(screen.getByText(/The file has 3 blocks\. Your draft has 1 block\./)).toBeInTheDocument();
      expect(screen.getByText(/3 blocks the builder doesn't have were left out: Gizmo \(2\), Widget\./)).toBeInTheDocument();
      expect(screen.getByText(/2 pictures were not found in this media library and were removed\./)).toBeInTheDocument();
      expect(screen.getByText(/The button "Join" has no link\./)).toBeInTheDocument();
      expect(mocks.importJson).toHaveBeenCalledTimes(1);
    });

    it("asks before replacing, saying what is kept and that nothing goes live, then reloads on the new draft", async () => {
      await pasteAndCheck();
      mocks.importJson.mockResolvedValue({ summary, applied: true });
      await act(async () => {
        fireEvent.click(replaceButton());
      });
      expect(screen.getByRole("heading", { name: "Replace your draft with this file?" })).toBeInTheDocument();
      expect(screen.getByText(/kept in History as "Your draft before it was replaced"/)).toBeInTheDocument();
      expect(screen.getByText(/nothing goes live/)).toBeInTheDocument();
      await answer("Replace draft");
      expect(mocks.importJson).toHaveBeenLastCalledWith(page.id, FILE);
      expect(reload).toHaveBeenCalled();
    });

    it("does nothing when the confirm is cancelled", async () => {
      await pasteAndCheck();
      await act(async () => {
        fireEvent.click(replaceButton());
      });
      await answer("Cancel");
      expect(mocks.importJson).toHaveBeenCalledTimes(1);
      expect(reload).not.toHaveBeenCalled();
    });

    it("saves what is typed before the preview", async () => {
      openHistory();
      edit("Typed just now");
      fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
      fireEvent.change(screen.getByLabelText("Or paste the JSON"), { target: { value: FILE } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Check the JSON" }));
      });
      expect(mocks.save).toHaveBeenCalled();
      expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.importJson.mock.invocationCallOrder[0]);
    });

    it("shows the server's reason for a file it can't read, and keeps Replace draft off", async () => {
      mocks.importJson.mockResolvedValue({ error: "That isn't JSON. Choose a file exported from the page builder, or paste its whole text." });
      await pasteAndCheck("nope");
      expect(screen.getByRole("alert")).toHaveTextContent("That isn't JSON");
      expect(replaceButton()).toBeDisabled();
    });

    it("says when the file matches the draft already and will not replace it", async () => {
      mocks.importJson.mockResolvedValue({ summary: { ...summary, leftOut: [], removedPictures: 0, issues: [], identical: true }, applied: false });
      await pasteAndCheck();
      expect(screen.getByText(/same as your draft, so nothing would change/)).toBeInTheDocument();
      expect(replaceButton()).toBeDisabled();
    });

    it("shows why a replacement failed and does not reload", async () => {
      await pasteAndCheck();
      mocks.importJson.mockResolvedValue({ error: "Couldn't import the page." });
      await act(async () => {
        fireEvent.click(replaceButton());
      });
      await answer("Replace draft");
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't import the page.");
      expect(reload).not.toHaveBeenCalled();
    });

    it("reads a chosen file and previews it without a button press", async () => {
      openHistory();
      fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
      const file = new File([FILE], "home-draft.json", { type: "application/json" });
      Object.defineProperty(file, "text", { value: () => Promise.resolve(FILE) });
      await act(async () => {
        fireEvent.change(screen.getByLabelText("File"), { target: { files: [file] } });
      });
      expect(screen.getByText("Using home-draft.json.")).toBeInTheDocument();
      expect(mocks.importJson).toHaveBeenCalledWith(page.id, FILE, { dryRun: true });
    });

    it("refuses a file over the size limit without sending it", async () => {
      openHistory();
      fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
      const big = new File(["x"], "big.json", { type: "application/json" });
      Object.defineProperty(big, "size", { value: 2_000_001 });
      await act(async () => {
        fireEvent.change(screen.getByLabelText("File"), { target: { files: [big] } });
      });
      expect(screen.getByRole("alert")).toHaveTextContent("over the 2 MB limit");
      expect(mocks.importJson).not.toHaveBeenCalled();
    });
  });

  it("says when nothing has been published yet", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText(/Nothing has been published yet/)).toBeInTheDocument();
  });

  it("keeps a template's details to its name and editor address, with no search fields", async () => {
    editor({ kind: "template", publicPath: "" });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByLabelText(/Address in the editor/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Title in search results and shared links")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    });
    expect(mocks.details).toHaveBeenCalled();
  });

  it("shows the kind of page in the details, read only", () => {
    editor({ pageType: "website" });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText(/Website page/)).toBeInTheDocument();
    expect(screen.getByText(/Shares the site's header, footer and style/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("shows a landing page as standalone", () => {
    editor({ pageType: "landing" });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText(/Stands alone and is styled on its own/)).toBeInTheDocument();
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
