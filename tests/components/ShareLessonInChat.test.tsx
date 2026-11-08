// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { share } = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("@/app/(member)/chat/actions", () => ({ shareLessonVideoInChat: share }));
import ShareLessonInChat from "@/app/(member)/courses/ShareLessonInChat";

const TARGETS = [
  { id: "chn_AAAAAAAAAAA1", label: "#writing" },
  { id: "chn_AAAAAAAAAAA2", label: "#craft" },
];
const LESSON = "les_AAAAAAAAAAA1";
const LINK = "https://hub.example.com/courses/ready-writer/lessons/les_AAAAAAAAAAA1";

const open = () => userEvent.click(screen.getByRole("button", { name: /share this video in chat/i }));
/** Picks a conversation from the searchable list. */
const pick = async (label: string) => {
  await userEvent.click(screen.getByRole("combobox", { name: "Where to share" }));
  await userEvent.click(screen.getByRole("option", { name: label }));
};
const shareButton = () => screen.getByRole("button", { name: "Share" });

beforeEach(() => share.mockReset());

describe("ShareLessonInChat", () => {
  it("offers only the copy button when there is nowhere to pick from", () => {
    render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={[]} />);

    expect(screen.queryByRole("button", { name: /share this video in chat/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link to paste in chat" })).toBeInTheDocument();
  });

  describe("copy link to paste in chat", () => {
    const writeText = vi.fn();
    beforeEach(() => {
      writeText.mockReset();
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    });

    it("copies the lesson's address and says where to paste it", async () => {
      writeText.mockResolvedValue(undefined);
      render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} />);

      await userEvent.click(screen.getByRole("button", { name: "Copy link to paste in chat" }));

      expect(writeText).toHaveBeenCalledWith(LINK);
      expect(await screen.findByRole("status")).toHaveTextContent(/Paste it into any message in Hub Chat, in a thread or a direct message too/);
    });

    it("says so, and points at the address bar, when the browser won't copy", async () => {
      writeText.mockRejectedValue(new Error("denied"));
      render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} />);

      await userEvent.click(screen.getByRole("button", { name: "Copy link to paste in chat" }));

      expect(await screen.findByRole("status")).toHaveTextContent(/Couldn't copy.*address bar/);
    });
  });

  it("lists every conversation on focus, filters as you type, and doesn't preselect one when there are several", async () => {
    render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} />);
    await open();

    expect(shareButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("combobox", { name: "Where to share" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["#writing", "#craft"]);

    await userEvent.type(screen.getByRole("combobox", { name: "Where to share" }), "cra");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["#craft"]);
  });

  it("says when no conversation matches", async () => {
    render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} />);
    await open();

    await userEvent.type(screen.getByRole("combobox", { name: "Where to share" }), "zzz");

    expect(screen.getByText("No conversation matches")).toBeInTheDocument();
  });

  it("preselects the conversation when it is the only one", async () => {
    share.mockResolvedValue({ ok: true, id: "msg_AAAAAAAAAAA1" });
    render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={[TARGETS[0]]} />);
    await open();

    expect(screen.getByText("#writing")).toBeInTheDocument();
    await userEvent.click(shareButton());

    expect(share).toHaveBeenCalledWith("chn_AAAAAAAAAAA1", LESSON, "", false);
  });

  it("shares into the chosen conversation with the member's words and links to it", async () => {
    share.mockResolvedValue({ ok: true, id: "msg_AAAAAAAAAAA1" });
    render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} />);

    await open();
    await pick("#craft");
    await userEvent.type(screen.getByLabelText(/say something/i), "Worth a watch");
    await userEvent.click(shareButton());

    expect(share).toHaveBeenCalledWith("chn_AAAAAAAAAAA2", LESSON, "Worth a watch", false);
    expect(await screen.findByRole("status")).toHaveTextContent("Shared.");
    expect(screen.getByRole("link", { name: /open the conversation/i })).toHaveAttribute("href", "/chat/chn_AAAAAAAAAAA2");
    expect(screen.getByLabelText(/say something/i)).toHaveValue("");
  });

  it("lets the member change their mind about the conversation", async () => {
    share.mockResolvedValue({ ok: true, id: "msg_AAAAAAAAAAA1" });
    render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} />);
    await open();
    await pick("#writing");

    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(shareButton()).toBeDisabled();
    await pick("#craft");
    await userEvent.click(shareButton());

    expect(share).toHaveBeenCalledWith("chn_AAAAAAAAAAA2", LESSON, "", false);
  });

  it("shows why it didn't work", async () => {
    share.mockResolvedValue({ ok: false, error: "That video can't be shared." });
    render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} />);

    await open();
    await pick("#writing");
    await userEvent.click(shareButton());

    expect(await screen.findByRole("status")).toHaveTextContent("That video can't be shared.");
    expect(share).toHaveBeenCalledWith("chn_AAAAAAAAAAA1", LESSON, "", false);
  });

  describe("opening it to the whole conversation", () => {
    it("is offered to admins only, and off unless they choose it", async () => {
      share.mockResolvedValue({ ok: true, id: "msg_AAAAAAAAAAA1" });
      const { unmount } = render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} />);
      await open();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      unmount();

      render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} canOpenToChannel />);
      await open();
      expect(screen.getByRole("checkbox", { name: /even without the course/i })).not.toBeChecked();
      await pick("#writing");
      await userEvent.click(shareButton());
      expect(share).toHaveBeenLastCalledWith("chn_AAAAAAAAAAA1", LESSON, "", false);
    });

    it("sends the choice when an admin makes it", async () => {
      share.mockResolvedValue({ ok: true, id: "msg_AAAAAAAAAAA1" });
      render(<ShareLessonInChat lessonId={LESSON} shareUrl={LINK} targets={TARGETS} canOpenToChannel />);

      await open();
      await pick("#writing");
      await userEvent.click(screen.getByRole("checkbox", { name: /even without the course/i }));
      await userEvent.click(shareButton());

      expect(share).toHaveBeenCalledWith("chn_AAAAAAAAAAA1", LESSON, "", true);
    });
  });
});
