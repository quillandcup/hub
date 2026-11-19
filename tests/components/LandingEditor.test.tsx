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
  resetLandingDraftToPublished: mocks.reset,
  replaceLandingDraftWithStarter: mocks.starter,
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
      appState: { ui: { leftSideBarVisible: true, rightSideBarVisible: false, viewports: { current: { width: 1280, height: "auto" }, controlsVisible: false, options: [] } } },
    }),
}));

import LandingEditor, { type EditorPage } from "@/app/(admin)/admin/pages/[slug]/LandingEditor";

const page: EditorPage = { id: "lpg_AAAAAAAAAAA1", slug: "spring", title: "Spring sprint", status: "draft", seoTitle: "", seoDescription: "", socialImageAssetId: "", publishedJson: null, publicPath: "/p/spring" };
const heading = { type: "Heading", props: { id: "h", text: "Welcome", level: "h1", align: "center" } };
const data = { content: [heading], root: {} };
const STARTERS = [{ key: "home", label: "Homepage", description: "The public front door." }];

function editor(over: Partial<EditorPage> = {}, versions: { id: string; title: string; createdAt: string; kind?: "published" | "before_import" | "before_starter" }[] = []) {
  return render(<LandingEditor page={{ ...page, ...over }} data={data} versions={versions} starters={STARTERS} />);
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
  it("switches the preview size, and undoes and redoes through Puck's history", () => {
    editor();
    fireEvent.click(screen.getByRole("button", { name: "Phone preview" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 390, height: "auto" } }) } });
    fireEvent.click(screen.getByRole("button", { name: "Tablet portrait preview" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 768, height: "auto" } }) } });
    fireEvent.click(screen.getByRole("button", { name: "Tablet landscape preview" }));
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "setUi", ui: { viewports: expect.objectContaining({ current: { width: 1024, height: "auto" } }) } });
    expect(screen.getByRole("button", { name: "Desktop preview" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(mocks.back).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
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
      expect(screen.getByText(/kept in History as "Your draft before starting over"/)).toBeInTheDocument();
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
      expect(screen.getByText(/Your draft before starting over/, { selector: "time" })).toBeInTheDocument();
    });
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
