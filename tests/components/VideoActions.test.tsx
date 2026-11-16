// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@/app/(member)/courses/actions", () => ({ clearMyLessonProgress: (...a: unknown[]) => clearMyLessonProgress(...a) }));
const clearMyLessonProgress = vi.fn();
import VideoActions from "@/app/(admin)/admin/courses/[id]/lessons/[lessonId]/VideoActions";

const URL = "https://hub.example/courses/the-ready-writer/lessons/les_AAAAAAAAAAA1";
const STATS = "/admin/courses/k1/stats/les_AAAAAAAAAAA1";

const writeText = vi.fn();
// userEvent.setup() installs its own clipboard, so ours goes in after it.
const stubClipboard = () => Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

const open = async (ui = <VideoActions statsHref={STATS} lessonUrl={URL} seconds={95} />) => {
  const user = userEvent.setup();
  stubClipboard();
  render(ui);
  await user.click(screen.getByRole("button", { name: /Video actions/ }));
  return user;
};

describe("VideoActions", () => {
  it("is closed until opened, and closes on Escape and on a click elsewhere", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <VideoActions statsHref={STATS} lessonUrl={URL} />
        <p>elsewhere</p>
      </div>
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Video actions/ }));
    expect(screen.getByRole("menu", { name: "Video actions" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Video actions/ }));
    await user.click(screen.getByText("elsewhere"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lists Kajabi's actions: the reading ones work, the editing ones and the ones that need more are disabled", async () => {
    await open();
    expect(screen.getByRole("menuitem", { name: "Video stats" })).toHaveAttribute("href", STATS);
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeEnabled();
    for (const name of ["Closed captions", "Download video", "Remove video"]) expect(screen.getByRole("menuitem", { name })).toBeDisabled();
  });

  it("says why Download video isn't available", async () => {
    await open();
    expect(screen.getByRole("menuitem", { name: "Download video" })).toHaveAttribute("title", expect.stringMatching(/MP4.*Mux/));
  });

  describe("staff tools", () => {
    const staff = { lessonId: "les_AAAAAAAAAAA1", lessonPath: "/courses/the-ready-writer/lessons/les_AAAAAAAAAAA1", preview: true };

    it("has no staff items without staff props", async () => {
      await open();
      expect(screen.queryByRole("menuitem", { name: /Record my watching|Clear my progress/ })).not.toBeInTheDocument();
    });

    it("lists record (a link, preview only) and clear, and clears through the same action after a confirm", async () => {
      clearMyLessonProgress.mockResolvedValue({ segments: 2 });
      const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} staff={staff} />);
      expect(screen.getByRole("menuitem", { name: "Record my watching in this preview" })).toHaveAttribute("href", `${staff.lessonPath}?track=1`);
      await user.click(screen.getByRole("menuitem", { name: "Clear my progress for this lesson" }));
      expect(clearMyLessonProgress).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Yes, clear" }));
      expect(clearMyLessonProgress).toHaveBeenCalledWith("les_AAAAAAAAAAA1");
      expect(await screen.findByRole("status")).toHaveTextContent("Cleared 2 watch segments");
    });

    it("leaves out recording when members can open the lesson", async () => {
      await open(<VideoActions statsHref={STATS} lessonUrl={URL} staff={{ ...staff, preview: false }} />);
      expect(screen.queryByRole("menuitem", { name: /Record my watching/ })).not.toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Clear my progress for this lesson" })).toBeInTheDocument();
    });
  });

  describe("Copy with thumbnail", () => {
    const link = { url: URL, imageUrl: "https://hub.example/api/courses/image/lesson/les_AAAAAAAAAAA1", title: 'Reader "Expectations" & <more>' };

    it("is disabled with the reason on hover while the lesson has no public link", async () => {
      await open(<VideoActions statsHref={STATS} lessonUrl={URL} thumbnailLink={null} thumbnailLinkBlocked="Only a lesson that is open to members has a public link" />);
      const item = screen.getByRole("menuitem", { name: "Copy with thumbnail" });
      expect(item).toBeDisabled();
      expect(item).toHaveAttribute("title", "Only a lesson that is open to members has a public link");
    });

    it("copies the picture as a link to the lesson, with the plain address as text, escaping the title", async () => {
      const written: { type: string; text: string }[][] = [];
      class FakeClipboardItem {
        constructor(public items: Record<string, Blob>) {}
      }
      vi.stubGlobal("ClipboardItem", FakeClipboardItem);
      const write = vi.fn(async (items: FakeClipboardItem[]) => {
        written.push(await Promise.all(Object.entries(items[0].items).map(async ([type, blob]) => ({ type, text: await blob.text() }))));
      });
      const user = userEvent.setup();
      render(<VideoActions statsHref={STATS} lessonUrl={URL} thumbnailLink={link} thumbnailLinkBlocked="" />);
      Object.defineProperty(navigator, "clipboard", { value: { writeText, write }, configurable: true });
      await user.click(screen.getByRole("button", { name: /Video actions/ }));
      await user.click(screen.getByRole("menuitem", { name: "Copy with thumbnail" }));

      expect(written[0]).toEqual([
        { type: "text/html", text: `<a href="${URL}"><img src="${link.imageUrl}" alt="Reader &quot;Expectations&quot; &amp; &lt;more&gt;" width="480"></a>` },
        { type: "text/plain", text: URL },
      ]);
      expect(screen.getByRole("status")).toHaveTextContent("Copied a link with the thumbnail.");
      vi.unstubAllGlobals();
    });

    it("copies just the address where the browser can't copy rich text", async () => {
      vi.stubGlobal("ClipboardItem", undefined);
      const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} thumbnailLink={link} thumbnailLinkBlocked="" />);
      await user.click(screen.getByRole("menuitem", { name: "Copy with thumbnail" }));
      expect(writeText).toHaveBeenCalledWith(URL);
      vi.unstubAllGlobals();
    });

    it("says when the clipboard refuses", async () => {
      vi.stubGlobal("ClipboardItem", undefined);
      writeText.mockRejectedValue(new Error("denied"));
      const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} thumbnailLink={link} thumbnailLinkBlocked="" />);
      await user.click(screen.getByRole("menuitem", { name: "Copy with thumbnail" }));
      expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy the link.");
      vi.unstubAllGlobals();
    });
  });

  it("copies the lesson's address at the playhead, and says so", async () => {
    const user = await open();
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(`${URL}?t=95`);
    expect(screen.getByRole("status")).toHaveTextContent("Copied the link at 1:35.");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("copies the plain lesson address when the video hasn't started", async () => {
    const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} seconds={0} />);
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(screen.getByRole("status")).toHaveTextContent("Copied the link.");
  });

  it("says when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const user = await open();
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy the link.");
  });

  it("disables stats and copying for a lesson that isn't in the Hub yet", async () => {
    await open(<VideoActions statsHref={null} lessonUrl={null} />);
    expect(screen.getByRole("menuitem", { name: "Video stats" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeDisabled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("tells the admin that pasting the link into Hub Chat shares the video, when chat sharing is on", async () => {
    const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} chatShare seconds={95} />);
    await user.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(writeText).toHaveBeenLastCalledWith(`${URL}?t=95`);
    expect(screen.getByRole("status")).toHaveTextContent("Paste it into Hub Chat to share the video there.");
  });

  describe("the open-to-everyone link", () => {
    it("is left out unless chat sharing is on, and there is no separate paste-in-chat link", async () => {
      await open(<VideoActions statsHref={STATS} lessonUrl={URL} />);
      expect(screen.queryByRole("menuitem", { name: /open to everyone/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: /paste in chat/ })).not.toBeInTheDocument();
    });

    it("copies the address with the open marker, then says what happens", async () => {
      const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} chatShare />);
      await user.click(screen.getByRole("menuitem", { name: "Copy link, open to everyone" }));
      expect(writeText).toHaveBeenLastCalledWith(`${URL}?share=open`);
      expect(screen.getByRole("status")).toHaveTextContent(/everyone in that conversation can watch the video, even without the course/);
    });

    it("is disabled for a lesson that isn't in the Hub yet, and says so when the browser won't copy", async () => {
      await open(<VideoActions statsHref={null} lessonUrl={null} chatShare />);
      expect(screen.getByRole("menuitem", { name: "Copy link, open to everyone" })).toBeDisabled();
      cleanup();
      writeText.mockRejectedValue(new Error("denied"));
      const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} chatShare />);
      await user.click(screen.getByRole("menuitem", { name: "Copy link, open to everyone" }));
      expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy the link.");
    });
  });
});
