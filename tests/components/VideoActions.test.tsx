// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByRole("menuitem", { name: "Copy timestamp URL" })).toBeEnabled();
    for (const name of ["Closed captions", "Download video", "Remove video"]) expect(screen.getByRole("menuitem", { name })).toBeDisabled();
  });

  it("says why Download video isn't available", async () => {
    await open();
    expect(screen.getByRole("menuitem", { name: "Download video" })).toHaveAttribute("title", expect.stringMatching(/MP4.*Mux/));
  });

  describe("Copy link with thumbnail", () => {
    const link = { url: URL, imageUrl: "https://hub.example/api/courses/image/lesson/les_AAAAAAAAAAA1", title: 'Reader "Expectations" & <more>' };

    it("is disabled with the reason on hover while the lesson has no public link", async () => {
      await open(<VideoActions statsHref={STATS} lessonUrl={URL} thumbnailLink={null} thumbnailLinkBlocked="Only a lesson that is open to members has a public link" />);
      const item = screen.getByRole("menuitem", { name: "Copy link with thumbnail" });
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
      await user.click(screen.getByRole("menuitem", { name: "Copy link with thumbnail" }));

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
      await user.click(screen.getByRole("menuitem", { name: "Copy link with thumbnail" }));
      expect(writeText).toHaveBeenCalledWith(URL);
      vi.unstubAllGlobals();
    });

    it("says when the clipboard refuses", async () => {
      vi.stubGlobal("ClipboardItem", undefined);
      writeText.mockRejectedValue(new Error("denied"));
      const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} thumbnailLink={link} thumbnailLinkBlocked="" />);
      await user.click(screen.getByRole("menuitem", { name: "Copy link with thumbnail" }));
      expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy the link.");
      vi.unstubAllGlobals();
    });
  });

  it("copies the lesson's address at the playhead, and says so", async () => {
    const user = await open();
    await user.click(screen.getByRole("menuitem", { name: "Copy timestamp URL" }));
    expect(writeText).toHaveBeenCalledWith(`${URL}?t=95`);
    expect(screen.getByRole("status")).toHaveTextContent("Copied a link to 1:35.");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("copies the plain lesson address when the video hasn't started", async () => {
    const user = await open(<VideoActions statsHref={STATS} lessonUrl={URL} seconds={0} />);
    await user.click(screen.getByRole("menuitem", { name: "Copy timestamp URL" }));
    expect(writeText).toHaveBeenCalledWith(URL);
    expect(screen.getByRole("status")).toHaveTextContent("Copied a link to the lesson.");
  });

  it("says when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    const user = await open();
    await user.click(screen.getByRole("menuitem", { name: "Copy timestamp URL" }));
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't copy the link.");
  });

  it("disables stats and copying for a lesson that isn't in the Hub yet", async () => {
    await open(<VideoActions statsHref={null} lessonUrl={null} />);
    expect(screen.getByRole("menuitem", { name: "Video stats" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Copy timestamp URL" })).toBeDisabled();
    expect(writeText).not.toHaveBeenCalled();
  });
});
