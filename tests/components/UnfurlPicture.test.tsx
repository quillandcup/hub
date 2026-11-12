// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import UnfurlPicture from "@/components/chat/UnfurlPicture";
import MessageUnfurls from "@/components/chat/MessageUnfurls";
import type { Unfurl } from "@/lib/chat/unfurls";

const SRC = "/api/chat/unfurl-image?m=msg_AAAAAAAAAAA1&k=0123456789abcdef";

describe("UnfurlPicture", () => {
  it("holds space with a placeholder while the picture loads, then fades it in without fetching twice", () => {
    const { container } = render(<UnfurlPicture src={SRC} alt="" className="max-h-72 rounded" reserve />);
    expect(screen.getByTestId("unfurl-picture-placeholder")).toBeInTheDocument();
    const img = container.querySelector("img")!;
    expect(img).toHaveClass("opacity-0");

    fireEvent.load(img);

    expect(screen.queryByTestId("unfurl-picture-placeholder")).toBeNull();
    // the same element, so the browser does not load it a second time
    expect(container.querySelector("img")).toBe(img);
    expect(img).toHaveClass("opacity-100", "max-h-72");
  });

  it("shows nothing at all when the picture fails, never a stand-in, and takes its link with it", () => {
    const { container } = render(<UnfurlPicture src={SRC} alt="" className="x" reserve link={{ href: "https://example.test/page" }} />);
    expect(container.querySelector("a")).not.toBeNull();

    fireEvent.error(container.querySelector("img")!);

    expect(container.innerHTML).toBe("");
  });

  it("has no placeholder when no space is asked for (a thumbnail already has its size)", () => {
    const { container } = render(<UnfurlPicture src={SRC} alt="" className="h-16 w-16" />);
    expect(screen.queryByTestId("unfurl-picture-placeholder")).toBeNull();
    expect(container.querySelector("img")).toHaveClass("h-16", "w-16");
  });

  it("notices a picture that finished before the page was interactive", () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const width = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    const { container } = render(<UnfurlPicture src={SRC} alt="" className="x" reserve />);
    expect(container.innerHTML).toBe(""); // it had failed already
    width.mockReturnValue(300);
    const again = render(<UnfurlPicture src={SRC} alt="" className="x" reserve />);
    expect(again.container.querySelector("img")).toHaveClass("opacity-100");
    complete.mockRestore();
    width.mockRestore();
  });

  it("keeps a reader who was at the bottom there when the picture makes the card grow", () => {
    const { container } = render(<div style={{ overflowY: "auto" }}><UnfurlPicture src={SRC} alt="" className="x" reserve /></div>);
    const scroller = container.firstElementChild as HTMLElement;
    const img = container.querySelector("img")!;
    Object.defineProperty(img, "offsetHeight", { value: 288 });
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    scroller.scrollTop = 400; // 100px from the end after growing by 128px: they were at the bottom before it

    fireEvent.load(img);

    expect(scroller.scrollTop).toBe(1000);
  });

  it("leaves a reader who scrolled up where they are", () => {
    const { container } = render(<div style={{ overflowY: "auto" }}><UnfurlPicture src={SRC} alt="" className="x" reserve /></div>);
    const scroller = container.firstElementChild as HTMLElement;
    const img = container.querySelector("img")!;
    Object.defineProperty(img, "offsetHeight", { value: 288 });
    Object.defineProperty(scroller, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    scroller.scrollTop = 100;

    fireEvent.load(img);

    expect(scroller.scrollTop).toBe(100);
  });
});

describe("a link preview card while its picture loads", () => {
  const card = (over = {}): Unfurl => ({
    kind: "card", color: null, authorName: null, authorLink: null, pretext: null, title: null, titleLink: "https://commons.example.test/pic", text: null, fields: [],
    imageUrl: SRC, thumbUrl: null, serviceName: "commons.example.test", fromUrl: "https://commons.example.test/pic", footer: null, hubPreview: true, ...over,
  });
  const ctx = { members: {}, channels: {}, slackUsers: {} } as never;

  it("reserves the picture's space instead of drawing a domain-only card that then grows, and drops the picture (not the card) when it fails", () => {
    const { container } = render(<MessageUnfurls unfurls={[card()]} ctx={ctx} permalink={null} />);
    expect(screen.getByTestId("unfurl-picture-placeholder")).toBeInTheDocument();
    expect(screen.getByText("commons.example.test")).toBeInTheDocument();

    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a[aria-label='Open picture']")).toBeNull();
    expect(screen.getByText("commons.example.test")).toBeInTheDocument();
  });
});
