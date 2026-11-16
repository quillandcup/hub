// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";

// The full Puck bundle (what jsdom resolves; the server uses its lean `rsc` build) wants these browser APIs at import.
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { cleanup, render, screen, act } from "@testing-library/react";
import { Button, CardGrid, Divider, Faq, Heading, Image, LinkList, List, RichText, Section, Spacer, Split, Testimonials, Video } from "@/components/landing/blocks";
import Countdown from "@/components/landing/Countdown";
import LandingRender from "@/components/landing/LandingRender";

afterEach(cleanup);

describe("Section", () => {
  const Content = () => <p>inside</p>;

  it("puts the content in a band whose text colour is readable on the background", () => {
    const { container } = render(<Section background="plum" overlay="none" width="narrow" padding="large" align="center" card={false} fadeIn={false} content={Content} />);
    const band = container.querySelector("section")!;
    expect(band.className).toContain("bg-plum-700");
    expect(band.className).toContain("text-white");
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("uses a light text colour over a dark shaded picture and a card keeps dark text on white", () => {
    const { container } = render(<Section background="none" backgroundImageAssetId="media_AAAAAAAAAAA1" overlay="dark" width="wide" padding="medium" align="left" card fadeIn content={Content} />);
    const band = container.querySelector("section")!;
    expect(band.className).toContain("text-white");
    expect(band.className).toContain("landing-fade-in");
    expect(band.style.backgroundImage).toContain("/api/media/media_AAAAAAAAAAA1/");
    expect(screen.getByText("inside").parentElement!.className).toContain("bg-white");
  });
});

describe("text blocks", () => {
  it("renders the page title as the level asked for, and nothing for an empty heading", () => {
    render(<Heading text="Welcome" level="h1" align="center" />);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeInTheDocument();
    cleanup();
    const { container } = render(<Heading text="" level="h2" align="left" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders rich text", () => {
    render(<RichText html="<p>Hello <strong>world</strong></p>" align="left" />);
    expect(screen.getByText("world").tagName).toBe("STRONG");
  });
});

describe("Button and link list", () => {
  it("links to a safe address", () => {
    render(<Button label="Join" href="https://example.com/join" look="solid" color="plum" shape="pill" align="center" full={false} />);
    expect(screen.getByRole("link", { name: "Join" })).toHaveAttribute("href", "https://example.com/join");
  });

  it("never renders a script address as a link", () => {
    render(<Button label="Bad" href="javascript:alert(1)" look="solid" color="plum" shape="pill" align="center" full={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Bad")).toHaveAttribute("aria-disabled", "true");
  });

  it("lists only links that have a label and a safe address", () => {
    render(
      <LinkList
        look="outline"
        color="plum"
        items={[
          { label: "Shop", href: "https://example.com/shop" },
          { label: "Broken", href: "javascript:x" },
          { label: "", href: "https://example.com" },
        ]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});

describe("images", () => {
  it("describes the picture, or marks it as decoration with an empty description", () => {
    const { container } = render(<Image imageAssetId="media_AAAAAAAAAAA1" alt="A hedgehog" decorative={false} size="medium" rounded align="center" />);
    expect(screen.getByAltText("A hedgehog")).toHaveAttribute("src", expect.stringContaining("/api/media/media_AAAAAAAAAAA1/"));
    cleanup();
    const deco = render(<Image imageAssetId="media_AAAAAAAAAAA1" alt="ignored" decorative size="small" rounded={false} align="left" />);
    expect(deco.container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container).toBeDefined();
  });

  it("renders nothing without a picture", () => {
    const { container } = render(<Image alt="" decorative={false} size="full" rounded={false} align="center" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lays the picture and text side by side with container queries, not viewport breakpoints", () => {
    const { container } = render(<Split imageAssetId="media_AAAAAAAAAAA1" alt="x" decorative={false} imageSide="right" html="<p>Story</p>" />);
    expect(container.firstElementChild!.className).toContain("@split:grid-cols-2");
    expect(container.querySelector("img")!.className).toContain("@split:order-2");
    expect(container.innerHTML).not.toMatch(/\b(sm|md|lg|xl):(flex|grid)/);
  });
});

describe("lists of things", () => {
  it("shows list items with their marker", () => {
    render(<List items={[{ text: "One", icon: "🌱" }, { text: "Two", icon: "" }]} align="left" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("🌱")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("shows testimonials with who said them", () => {
    render(<Testimonials items={[{ quote: "Loved it", name: "Ada Example", detail: "Member since 2024" }]} />);
    expect(screen.getByText(/Loved it/)).toBeInTheDocument();
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
  });

  it("answers questions with native disclosure elements", () => {
    const { container } = render(<Faq items={[{ question: "Is it free?", answer: "Yes.\nReally." }]} />);
    expect(container.querySelector("details summary")).toHaveTextContent("Is it free?");
    expect(screen.getByText("Really.")).toBeInTheDocument();
  });

  it("shows cards in a grid whose columns follow the room, and hides a button with no link", () => {
    const { container } = render(
      <CardGrid
        columns="4"
        items={[
          { alt: "Cover", imageAssetId: "media_AAAAAAAAAAA1", title: "Book one", price: "$12", buttonLabel: "Buy now", href: "https://example.com/1" },
          { alt: "", title: "Book two", price: "$15", buttonLabel: "Buy now", href: "" },
        ]}
      />,
    );
    expect(container.querySelector("ul")!.className).toContain("@columns:grid-cols-4");
    expect(screen.getByRole("heading", { name: "Book one" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("renders dividers and spacers that assistive technology skips", () => {
    const { container } = render(
      <>
        <Divider look="short" />
        <Spacer size="large" />
      </>,
    );
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});

describe("Video", () => {
  it("plays an allowed host in a sandboxed frame with the address built from the id", () => {
    const { container } = render(<Video url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" title="Welcome video" />);
    const frame = container.querySelector("iframe")!;
    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(frame).toHaveAttribute("title", "Welcome video");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("shows nothing for a host that isn't allowed", () => {
    const { container } = render(<Video url="https://evil.example/embed/x" title="" />);
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("Countdown", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps its size with dashes until the browser has the time, then counts down", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    render(<Countdown targetAt="2027-01-02T01:02:03.000Z" heading="Doors open in" whenExpired="message" />);
    const timer = screen.getByRole("timer");
    expect(timer).toHaveAttribute("aria-label", expect.stringContaining("counting down to"));
    const cells = () => [...timer.querySelectorAll("span[aria-hidden='true']")].map((n) => n.textContent);
    expect(cells()).toEqual(["01", "01", "02", "03"]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cells()).toEqual(["01", "01", "02", "02"]);
  });

  it("shows the message, the zeros or nothing once the time has passed, as chosen", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2027-02-01T00:00:00Z"));
    const target = "2027-01-01T00:00:00.000Z";
    const message = render(<Countdown targetAt={target} whenExpired="message" expiredMessage="It began." />);
    expect(screen.getByRole("status")).toHaveTextContent("It began.");
    message.unmount();
    const hidden = render(<Countdown targetAt={target} whenExpired="hide" />);
    expect(hidden.container).toBeEmptyDOMElement();
    hidden.unmount();
    render(<Countdown targetAt={target} whenExpired="zeros" />);
    expect(screen.getAllByText("00")).toHaveLength(4);
  });
});

describe("LandingRender", () => {
  it("renders a stored document through the same blocks, cleaning it again first", () => {
    const data = {
      content: [
        { type: "Heading", props: { id: "a", text: "Hello", level: "h1", align: "center" } },
        { type: "RichText", props: { id: "b", html: "<p>Safe</p><script>window.hacked = 1</script>", align: "left" } },
        { type: "Button", props: { id: "c", label: "Go", href: "javascript:alert(1)", look: "solid", color: "plum", shape: "pill", align: "center", full: false } },
      ],
      root: { props: { showFooter: true, footerText: "Quill and cup" } },
    };
    const { container } = render(<LandingRender data={data} />);
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByRole("link", { name: "Go" })).toBeNull();
    expect(screen.getByText("Quill and cup")).toBeInTheDocument();
  });
});
