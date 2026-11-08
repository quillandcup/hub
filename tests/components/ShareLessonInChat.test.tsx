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

beforeEach(() => share.mockReset());

describe("ShareLessonInChat", () => {
  it("shows nothing when there is nowhere to share", () => {
    const { container } = render(<ShareLessonInChat lessonId="les_AAAAAAAAAAA1" targets={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shares into the chosen conversation with the member's words and links to it", async () => {
    share.mockResolvedValue({ ok: true, id: "msg_AAAAAAAAAAA1" });
    render(<ShareLessonInChat lessonId="les_AAAAAAAAAAA1" targets={TARGETS} />);

    await userEvent.click(screen.getByRole("button", { name: /share this video in chat/i }));
    await userEvent.selectOptions(screen.getByLabelText(/where/i), "chn_AAAAAAAAAAA2");
    await userEvent.type(screen.getByLabelText(/say something/i), "Worth a watch");
    await userEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(share).toHaveBeenCalledWith("chn_AAAAAAAAAAA2", "les_AAAAAAAAAAA1", "Worth a watch", false);
    expect(await screen.findByRole("status")).toHaveTextContent("Shared.");
    expect(screen.getByRole("link", { name: /open the conversation/i })).toHaveAttribute("href", "/chat/chn_AAAAAAAAAAA2");
    expect(screen.getByLabelText(/say something/i)).toHaveValue("");
  });

  it("shows why it didn't work", async () => {
    share.mockResolvedValue({ ok: false, error: "That video can't be shared." });
    render(<ShareLessonInChat lessonId="les_AAAAAAAAAAA1" targets={TARGETS} />);

    await userEvent.click(screen.getByRole("button", { name: /share this video in chat/i }));
    await userEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByRole("status")).toHaveTextContent("That video can't be shared.");
    expect(share).toHaveBeenCalledWith("chn_AAAAAAAAAAA1", "les_AAAAAAAAAAA1", "", false);
  });

  describe("opening it to the whole conversation", () => {
    const open = async () => userEvent.click(screen.getByRole("button", { name: /share this video in chat/i }));

    it("is offered to admins only, and off unless they choose it", async () => {
      share.mockResolvedValue({ ok: true, id: "msg_AAAAAAAAAAA1" });
      const { unmount } = render(<ShareLessonInChat lessonId="les_AAAAAAAAAAA1" targets={TARGETS} />);
      await open();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      unmount();

      render(<ShareLessonInChat lessonId="les_AAAAAAAAAAA1" targets={TARGETS} canOpenToChannel />);
      await open();
      expect(screen.getByRole("checkbox", { name: /even without the course/i })).not.toBeChecked();
      await userEvent.click(screen.getByRole("button", { name: "Share" }));
      expect(share).toHaveBeenLastCalledWith("chn_AAAAAAAAAAA1", "les_AAAAAAAAAAA1", "", false);
    });

    it("sends the choice when an admin makes it", async () => {
      share.mockResolvedValue({ ok: true, id: "msg_AAAAAAAAAAA1" });
      render(<ShareLessonInChat lessonId="les_AAAAAAAAAAA1" targets={TARGETS} canOpenToChannel />);

      await open();
      await userEvent.click(screen.getByRole("checkbox", { name: /even without the course/i }));
      await userEvent.click(screen.getByRole("button", { name: "Share" }));

      expect(share).toHaveBeenCalledWith("chn_AAAAAAAAAAA1", "les_AAAAAAAAAAA1", "", true);
    });
  });
});
