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
    for (const name of ["Closed captions", "Copy link with thumbnail", "Download video", "Remove video"]) expect(screen.getByRole("menuitem", { name })).toBeDisabled();
  });

  it("says why Download video and Copy link with thumbnail aren't available", async () => {
    await open();
    expect(screen.getByRole("menuitem", { name: "Download video" })).toHaveAttribute("title", expect.stringMatching(/MP4.*Mux/));
    expect(screen.getByRole("menuitem", { name: "Copy link with thumbnail" })).toHaveAttribute("title", expect.stringMatching(/private/));
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
