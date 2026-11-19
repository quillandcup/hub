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

import { readFileSync } from "node:fs";
import { cleanup, render, screen, act } from "@testing-library/react";
import { AnnouncementStrip, ComingUp, FinishLineCards, FinisherCards, JourneyMap, OutcomeNumbers, PlanPhases, SchedulePanel, Timeline, WeekStrip } from "@/components/landing/homepage-blocks";
import { Button, CardGrid, CtaBanner, Divider, Faq, Heading, Hero, Image, LinkList, List, RichText, Section, Spacer, Split, Stats, Steps, Testimonials, Video } from "@/components/landing/blocks";
import { BLOCK_DEFAULTS, PageFrame } from "@/components/landing/config";
import { checkLandingPage } from "@/lib/landing/a11y";
import Countdown from "@/components/landing/Countdown";
import LandingRender from "@/components/landing/LandingRender";

afterEach(cleanup);

const sectionProps = { overlay: "none", width: "wide", align: "left", card: false, fadeIn: false } as const;

describe("PageFrame", () => {
  it("is the brand page, light or dark with the theme, and not the app's grey", () => {
    const { container } = render(<PageFrame>content</PageFrame>);
    const frame = container.firstElementChild!;
    expect(frame.className).toContain("bg-page");
    expect(frame.className).toContain("text-ink");
    expect(frame.className).not.toContain("bg-background");
  });

  it("keeps a white or cream band light in dark mode, and lets the page and dark bands follow the theme", () => {
    const light = render(<Section {...sectionProps} background="cream" content={() => <p>x</p>} />);
    expect(light.container.querySelector("section")!.className).toContain("landing-light");
    const page = render(<Section {...sectionProps} background="none" content={() => <p>x</p>} />);
    expect(page.container.querySelector("section")!.className).not.toContain("landing-light");
    expect(page.container.querySelector("section")!.className).toContain("text-ink");
    const plum = render(<Section {...sectionProps} background="plum" content={() => <p>x</p>} />);
    expect(plum.container.querySelector("section")!.className).not.toContain("landing-light");
  });
});

describe("Section", () => {
  const Content = () => <p>inside</p>;

  it("puts the content in a band whose text colour is readable on the background", () => {
    const { container } = render(<Section background="plum" overlay="none" width="narrow" align="center" card={false} fadeIn={false} content={Content} />);
    const band = container.querySelector("section")!;
    expect(band.className).toContain("bg-plum-700");
    expect(band.className).toContain("text-white");
    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("uses a light text colour over a dark shaded picture and a card keeps dark text on white", () => {
    const { container } = render(<Section background="none" backgroundImageAssetId="media_AAAAAAAAAAA1" overlay="dark" width="wide" align="left" card fadeIn content={Content} />);
    const band = container.querySelector("section")!;
    expect(band.className).toContain("text-white");
    expect(band.className).toContain("landing-fade-in");
    expect(band.style.backgroundImage).toContain("/api/media/media_AAAAAAAAAAA1/");
    expect(screen.getByText("inside").parentElement!.className).toContain("bg-card");
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
    const card = screen.getByText(/Loved it/).closest("figure")!;
    expect(card.className).toContain("bg-tile");
    expect(card.className).toContain("border-accent");
    expect(screen.getByText("Member since 2024").className).toContain("text-ink-muted");
  });

  it("answers questions with native disclosure elements", () => {
    const { container } = render(<Faq items={[{ question: "Is it free?", answer: "Yes.\nReally." }]} />);
    expect(container.querySelector("details summary")).toHaveTextContent("Is it free?");
    expect(screen.getByText("Really.")).toBeInTheDocument();
  });

  it("shows a card's icon (hidden from screen readers) and description", () => {
    const { container } = render(<CardGrid columns="3" items={[{ alt: "", icon: "🤝", title: "Community", description: "Kind company.", price: "", buttonLabel: "", href: "" }]} />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent("🤝");
    expect(screen.getByText("Kind company.")).toBeInTheDocument();
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
    expect(container.querySelector("li")!.className).toContain("bg-tile");
    expect(screen.getByText("$12").className).toContain("text-accent-ink");
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

const heroProps = {
  ...BLOCK_DEFAULTS.Hero,
  primary: { label: "Join us", href: "https://example.com/join" },
  secondary: { label: "See how it works", href: "/how" },
} as unknown as Parameters<typeof Hero>[0];

describe("Hero", () => {
  it("is the page title with both buttons as links, centred", () => {
    const { container } = render(<Hero {...heroProps} />);
    expect(screen.getByRole("heading", { level: 1, name: BLOCK_DEFAULTS.Hero.headline })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join us" })).toHaveAttribute("href", "https://example.com/join");
    expect(screen.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "/how");
    expect(container.querySelector("section")!.className).toContain("bg-plum-700");
    expect(container.querySelector("section")!.className).toContain("text-white");
  });

  it("can be a section heading instead, left aligned", () => {
    const { container } = render(<Hero {...heroProps} level="h2" align="left" />);
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(container.querySelector(".text-left")).not.toBeNull();
  });

  it("leaves out what is empty: no subhead, no second button, nothing at all when blank", () => {
    render(<Hero {...heroProps} subhead="" secondary={{ label: "", href: "" }} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByText(BLOCK_DEFAULTS.Hero.subhead)).toBeNull();
    cleanup();
    const blank = render(<Hero {...heroProps} headline="" subhead="" primary={{ label: "", href: "" }} secondary={{ label: "", href: "" }} />);
    expect(blank.container).toBeEmptyDOMElement();
  });

  it("drops an unsafe link and shows the button disabled", () => {
    render(<Hero {...heroProps} primary={{ label: "Bad", href: "javascript:alert(1)" }} secondary={{ label: "", href: "" }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Bad")).toHaveAttribute("aria-disabled", "true");
  });

  it("puts a picture behind the words with a shade, and the text colour follows the shade", () => {
    const { container } = render(<Hero {...heroProps} background="cream" imageAssetId="media_AAAAAAAAAAA1" overlay="light" />);
    const band = container.querySelector("section")!;
    expect(band.style.backgroundImage).toContain("/api/media/media_AAAAAAAAAAA1/");
    expect(band.className).toContain("text-ink");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[aria-hidden='true'].bg-white\\/70")).not.toBeNull();
    // Buttons flip with the shade: a light shade means dark-on-light buttons.
    expect(screen.getByRole("link", { name: "Join us" }).className).toContain("bg-plum-600");
  });

  it("shows a picture beside the words with its description, or as decoration, laid out by container query", () => {
    const { container } = render(<Hero {...heroProps} imageAssetId="media_AAAAAAAAAAA1" imageMode="side" alt="A hedgehog writing" />);
    expect(screen.getByAltText("A hedgehog writing")).toHaveAttribute("src", expect.stringContaining("/api/media/media_AAAAAAAAAAA1/"));
    expect(container.querySelector("section")!.style.backgroundImage).toBe("");
    expect(container.innerHTML).toContain("@split:grid-cols-2");
    expect(container.innerHTML).not.toMatch(/\b(sm|md|lg|xl):(flex|grid)/);
    cleanup();
    const deco = render(<Hero {...heroProps} imageAssetId="media_AAAAAAAAAAA1" imageMode="side" alt="ignored" decorative />);
    expect(deco.container.querySelector("img")).toHaveAttribute("alt", "");
  });
});

describe("Steps", () => {
  const items = [
    { title: "Sign up", text: "Say hello." },
    { title: "Join in", text: "" },
    { title: "", text: "No title, so skipped" },
  ];

  it("numbers the steps in an ordered list under the block's heading", () => {
    const { container } = render(<Steps heading="How it works" items={items} />);
    expect(screen.getByRole("heading", { level: 2, name: "How it works" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 3, name: "Join in" })).toBeInTheDocument();
    expect(container.querySelector("ol")!.className).toContain("@pair:grid-cols-2");
    expect(container.querySelector("li span[aria-hidden='true']")).toHaveTextContent("1");
    expect(screen.queryByText("No title, so skipped")).toBeNull();
  });

  it("makes the titles section headings when there is no heading of its own, and shows nothing without steps", () => {
    render(<Steps heading="" items={items} />);
    expect(screen.getByRole("heading", { level: 2, name: "Sign up" })).toBeInTheDocument();
    cleanup();
    const none = render(<Steps heading="Empty" items={[]} />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it("shows at most five steps, in more columns as the room grows", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ title: `Step ${i}`, text: "" }));
    const { container } = render(<Steps heading="" items={many} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(container.querySelector("ol")!.className).toContain("@columns:grid-cols-5");
  });
});

describe("Stats", () => {
  it("pairs each typed figure with its label", () => {
    const { container } = render(
      <Stats
        items={[
          { value: "1,000", label: "members" },
          { value: "24/7", label: "company" },
          { value: "", label: "no figure, skipped" },
        ]}
      />,
    );
    expect(container.querySelectorAll("dt")).toHaveLength(2);
    expect(screen.getByText("1,000").tagName).toBe("DD");
    expect(screen.getByText("members").tagName).toBe("DT");
    expect(container.querySelector("dl")!.className).toContain("@pair:grid-cols-2");
  });

  it("shows nothing without a figure and caps the strip at four", () => {
    const none = render(<Stats items={[{ value: "", label: "x" }]} />);
    expect(none.container).toBeEmptyDOMElement();
    none.unmount();
    const five = render(<Stats items={Array.from({ length: 6 }, (_, i) => ({ value: String(i), label: `L${i}` }))} />);
    expect(five.container.querySelectorAll("dd")).toHaveLength(4);
    expect(five.container.querySelector("dl")!.className).toContain("@columns:grid-cols-4");
  });
});

describe("CtaBanner", () => {
  const banner = { heading: "Ready?", text: "Come and write.", label: "Join us", href: "https://example.com/join", background: "brown", align: "center" } as const;

  it("is a heading, a line and one button on a theme colour with its readable text colour", () => {
    const { container } = render(<CtaBanner {...banner} />);
    const band = container.querySelector("section")!;
    expect(band.className).toContain("bg-brown-deep");
    expect(band.className).toContain("text-cream");
    expect(screen.getByRole("heading", { level: 2, name: "Ready?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join us" })).toHaveAttribute("href", "https://example.com/join");
    // On a dark band the button uses the light colour.
    expect(screen.getByRole("link").className).toContain("bg-cream");
  });

  it("uses dark text and a plum button on a light colour, and falls back to plum for the page colour", () => {
    const light = render(<CtaBanner {...banner} background="blush" align="left" />);
    expect(light.container.querySelector("section")!.className).toContain("text-ink");
    expect(light.container.querySelector("section")!.className).toContain("text-left");
    expect(screen.getByRole("link").className).toContain("bg-plum-600");
    light.unmount();
    const none = render(<CtaBanner {...banner} background="none" />);
    expect(none.container.querySelector("section")!.className).toContain("bg-plum-700");
  });

  it("leaves out empty parts, drops an unsafe link, and renders nothing when blank", () => {
    render(<CtaBanner {...banner} text="" href="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Join us")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("Come and write.")).toBeNull();
    cleanup();
    const blank = render(<CtaBanner {...banner} heading="" text="" label="" />);
    expect(blank.container).toBeEmptyDOMElement();
  });
});

describe("checks for the ready-made blocks", () => {
  const page = (...content: { type: string; props: Record<string, unknown> }[]) => ({ content: content.map((c, i) => ({ ...c, props: { id: `b${i}`, ...c.props } })), root: {} });
  const hero = (props: Record<string, unknown> = {}) => ({ type: "Hero", props: { ...heroProps, ...props } });
  const errors = (data: unknown) => checkLandingPage(data).filter((i) => i.severity === "error");

  it("counts the hero headline as the page title, so the page needs no other h1", () => {
    expect(checkLandingPage(page(hero()))).toEqual([]);
    expect(checkLandingPage(page(hero({ level: "h2" }))).map((i) => i.message)).toContain("The page needs one title: add a Heading set to Page title (h1).");
  });

  it("warns about a second h1 across a hero and a heading", () => {
    const issues = checkLandingPage(page(hero(), { type: "Heading", props: { text: "Another", level: "h1", align: "left" } }));
    expect(issues.map((i) => i.message)).toContain("There is more than one page title (h1). Use Section heading for the others.");
  });

  it("errors on a hero or banner button with no usable link, like a Button", () => {
    expect(errors(page(hero({ primary: { label: "Go", href: "javascript:x" } })))[0].message).toContain('The button "Go" has no link.');
    expect(errors(page(hero({ secondary: { label: "More", href: "" } })))).toHaveLength(1);
    const banner = errors(page(hero(), { type: "CtaBanner", props: { heading: "Ready?", label: "Join", href: "" } }));
    expect(banner).toHaveLength(1);
    expect(banner[0].block).toBe("Banner");
  });

  it("warns about vague button text", () => {
    const issues = checkLandingPage(page(hero({ primary: { label: "click here", href: "/x" } }), { type: "CtaBanner", props: { heading: "H", label: "here", href: "/x" } }));
    expect(issues.filter((i) => i.severity === "warning" && /doesn't say where it goes/.test(i.message))).toHaveLength(2);
  });

  it("errors on a picture beside the words with no description, unless it is decoration", () => {
    const side = { imageAssetId: "media_AAAAAAAAAAA1", imageMode: "side", alt: "" };
    expect(errors(page(hero(side)))[0].message).toContain("needs a description");
    expect(errors(page(hero({ ...side, decorative: true })))).toEqual([]);
    expect(errors(page(hero({ ...side, alt: "A hedgehog" })))).toEqual([]);
  });

  it("only warns about an unshaded picture behind the words", () => {
    const issues = checkLandingPage(page(hero({ imageAssetId: "media_AAAAAAAAAAA1", imageMode: "background", overlay: "none" })));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("warns about a section hidden on both sizes, and not about one hidden on a single size", () => {
    const section = (props: Record<string, unknown>) => ({ type: "Section", props: { ...props, content: [] } });
    const messages = (props: Record<string, unknown>) => checkLandingPage(page(hero(), section(props))).filter((i) => i.block === "Section");
    expect(messages({ hideOnDesktop: true, hideOnMobile: true })).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining("hidden on desktop and on mobile") })]);
    expect(messages({ hideOnDesktop: true, hideOnMobile: false })).toEqual([]);
    expect(messages({})).toEqual([]);
  });

  it("counts steps and banner headings in the level checks", () => {
    const steps = (heading: string) => ({ type: "Steps", props: { heading, items: [{ title: "One", text: "" }] } });
    expect(checkLandingPage(page(hero(), steps("How"), { type: "CtaBanner", props: { heading: "Join", label: "Go", href: "/go" } }))).toEqual([]);
    // Without its own heading the step titles are h2, so there is no skip either.
    expect(checkLandingPage(page(hero(), steps("")))).toEqual([]);
    // A banner heading is h2 and a heading set to h3 straight after a hero skips nothing, but h4 would.
    const skipped = checkLandingPage(page(hero(), { type: "Heading", props: { text: "Deep", level: "h3", align: "left" } }));
    expect(skipped.map((i) => i.message).join()).toContain("skips a level");
  });

  it("does not choke on a stored block with props missing", () => {
    expect(() => checkLandingPage(page({ type: "Hero", props: {} }, { type: "Steps", props: {} }, { type: "CtaBanner", props: {} }))).not.toThrow();
  });
});

// ---- Homepage blocks (components/landing/homepage-blocks.tsx) ---------------------------------------------------------

describe("AnnouncementStrip", () => {
  it("is dark text on gold with a link button, and a dot that is hidden from screen readers and pulses only when motion is allowed", () => {
    const { container } = render(<AnnouncementStrip text="Your next prickle starts soon" buttonLabel="Drop in" href="/login" tone="gold" />);
    const bar = container.firstElementChild!;
    expect(bar.className).toContain("bg-gold");
    expect(bar.className).toContain("text-gold-ink");
    expect(screen.getByRole("link", { name: "Drop in" })).toHaveAttribute("href", "/login");
    const dot = container.querySelector("[aria-hidden='true']")!;
    expect(dot.className).toContain("landing-pulse");
    // The animation exists only inside the no-preference media query.
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.landing-pulse \{\s*animation:/);
    expect(css.replace(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.landing-pulse[^}]*\}\s*\}/, "")).not.toMatch(/\.landing-pulse\s*\{[^}]*animation/);
  });

  it("shows the button disabled without a safe link, takes another tone, and hides when empty", () => {
    const { container } = render(<AnnouncementStrip text="News" buttonLabel="Go" href="javascript:x" tone="plum" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Go")).toHaveAttribute("aria-disabled", "true");
    expect(container.firstElementChild!.className).toContain("bg-plum-900");
    cleanup();
    expect(render(<AnnouncementStrip text="" buttonLabel="" href="" tone="gold" />).container).toBeEmptyDOMElement();
  });
});

describe("SchedulePanel", () => {
  const rows = [
    { time: "9:00 am", title: "Morning pages", status: "Live", state: "live" as const, host: "Hosted by Sarah" },
    { time: "10:00 am", title: "Focus hour", status: "In 42 min", state: "soon" as const, host: "" },
    { time: "", title: "", status: "skipped", state: "open" as const, host: "" },
  ];

  it("lists each session with its time, status chip and host line, and pulses only the live one", () => {
    const { container } = render(<SchedulePanel title="Writing right now" zoneLabel="Zone note" rows={rows} />);
    expect(screen.getByRole("region", { name: "Writing right now" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Live").className).toContain("bg-emerald-700");
    expect(screen.getByText("In 42 min").className).toContain("bg-gold");
    expect(screen.getByText("Hosted by Sarah")).toBeInTheDocument();
    expect(screen.getByText("Zone note")).toBeInTheDocument();
    expect(container.querySelectorAll(".landing-pulse")).toHaveLength(1);
    expect(container.firstElementChild!.className).toContain("landing-light");
  });

  it("shows nothing without a session", () => {
    expect(render(<SchedulePanel title="x" zoneLabel="" rows={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("OutcomeNumbers", () => {
  const items = [
    { value: "50+", label: "books published", note: "" },
    { value: "100s", label: "of Finishers", note: "" },
    { value: "128k", label: "words in the last 30 days", note: "live" },
    { value: "", label: "no figure, skipped", note: "" },
  ];

  it("sets every colour itself: a white band with a gold stripe, plum numbers and dark ink labels", () => {
    const { container } = render(<OutcomeNumbers items={items} />);
    const band = container.firstElementChild!;
    for (const cls of ["bg-white", "border-gold", "text-ink", "landing-light"]) expect(band.className).toContain(cls);
    expect(screen.getByText("50+").className).toContain("text-plum-900");
    expect(screen.getByText("50+").tagName).toBe("DD");
    expect(screen.getByText("books published").className).toContain("text-ink");
    expect(screen.getByText("books published").className).not.toContain("white");
    expect(screen.getByText("(live)")).toBeInTheDocument();
    expect(container.querySelectorAll("dd")).toHaveLength(3);
  });

  it("caps at four and hides when empty", () => {
    const five = render(<OutcomeNumbers items={Array.from({ length: 6 }, (_, i) => ({ value: String(i + 1), label: `L${i}`, note: "" }))} />);
    expect(five.container.querySelectorAll("dd")).toHaveLength(4);
    five.unmount();
    expect(render(<OutcomeNumbers items={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("FinisherCards", () => {
  const card = { alt: "", name: "Ada Example", kind: "memoir", dayOne: "an idea", theEnd: "61,000 words", linkLabel: "Read her story", href: "/ada" };

  it("shows a photo-first card with its alt text, lines and safe link, and a link under the cards", () => {
    const { container } = render(<FinisherCards items={[{ ...card, imageAssetId: "media_AAAAAAAAAAA1", alt: "Ada with her book" }]} more={{ label: "See every Finisher", href: "/finishers" }} />);
    expect(screen.getByAltText("Ada with her book")).toHaveAttribute("src", expect.stringContaining("/api/media/media_AAAAAAAAAAA1/"));
    expect(container.querySelector(".aspect-\\[3\\/4\\]")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Ada Example" })).toBeInTheDocument();
    expect(screen.getByText(/61,000 words/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read her story" })).toHaveAttribute("href", "/ada");
    expect(screen.getByRole("link", { name: "See every Finisher" })).toHaveAttribute("href", "/finishers");
    expect(container.querySelector("ul")!.className).toContain("@cards:grid-cols-3");
  });

  it("shows a placeholder without a picture, hides unsafe or missing links, and caps at six", () => {
    const { container } = render(<FinisherCards items={Array.from({ length: 8 }, (_, i) => ({ ...card, name: `Name ${i}`, href: "javascript:x" }))} more={{ label: "More", href: "" }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(6);
    expect(container.querySelector("li [aria-hidden='true']")).toHaveTextContent("📖");
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    expect(render(<FinisherCards items={[]} more={{ label: "", href: "" }} />).container).toBeEmptyDOMElement();
  });
});

describe("Timeline", () => {
  const items = [
    { when: "8:00 am", title: "Morning pages", text: "Maya joins." },
    { when: "Thursday", title: "Where's Maya?", text: "Someone checks on you." },
    { when: "", title: "", text: "skipped" },
  ];

  it("lists the moments with their time, an intro and a closing line, titles one level under a heading", () => {
    const { container } = render(<Timeline heading="A day" intro="Never alone." items={items} closing="The house notices." />);
    expect(screen.getByRole("heading", { level: 3, name: "A day" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Where's Maya?" })).toBeInTheDocument();
    expect(screen.getByText("Thursday")).toBeInTheDocument();
    expect(screen.getByText("Never alone.")).toBeInTheDocument();
    expect(screen.getByText("The house notices.")).toBeInTheDocument();
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelector("ol li [aria-hidden='true']")).not.toBeNull();
  });

  it("makes the titles h3 without a heading, and shows nothing when empty", () => {
    render(<Timeline heading="" intro="" items={items} closing="" />);
    expect(screen.getByRole("heading", { level: 3, name: "Morning pages" })).toBeInTheDocument();
    cleanup();
    expect(render(<Timeline heading="" intro="" items={[]} closing="" />).container).toBeEmptyDOMElement();
  });
});

describe("WeekStrip", () => {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((label) => ({ label, emoji: "👋", text: `${label} thing`, note: "5 min" }));

  it("shows day cards that stack to two columns on a narrow page and fill the row with room", () => {
    const { container } = render(<WeekStrip subtitle="Camera optional." items={days} />);
    expect(screen.getByText("Camera optional.")).toBeInTheDocument();
    expect(container.querySelectorAll("ol > li")).toHaveLength(5);
    const grid = container.querySelector("ol")!.className;
    expect(grid).toContain("grid-cols-2");
    expect(grid).toContain("@columns:grid-cols-5");
    expect(grid).not.toMatch(/\b(sm|md|lg|xl):/);
    expect(container.querySelector("li")!.className).toContain("bg-card");
    expect(container.querySelector("li [aria-hidden='true']")).toHaveTextContent("👋");
  });

  it("shows at most seven days and nothing when empty", () => {
    const many = render(<WeekStrip subtitle="" items={Array.from({ length: 9 }, (_, i) => ({ label: `D${i}`, emoji: "", text: "", note: "" }))} />);
    expect(many.container.querySelectorAll("li")).toHaveLength(7);
    many.unmount();
    expect(render(<WeekStrip subtitle="x" items={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("FinishLineCards and PlanPhases", () => {
  const lines = [
    { title: "THE END in a year", program: "The Ready Writer", text: "A steady plan.", durationLabel: "12 months", durationPercent: 100, buttonLabel: "See the plan", href: "/ready-writer" },
    { title: "THE END in six months", program: "The 180 Program (Accelerated)", text: "", durationLabel: "6 months", durationPercent: 50, buttonLabel: "See it", href: "" },
  ];

  it("shows gradient cards with white text, a bar filled to the percent and a button that is a link only with a safe address", () => {
    const { container } = render(<FinishLineCards items={lines} />);
    expect(screen.getByRole("heading", { level: 3, name: "THE END in six months" })).toBeInTheDocument();
    const cards = container.querySelectorAll("ul > li");
    expect(cards[0].className).toContain("bg-gradient-to-br");
    expect(cards[0].className).toContain("text-white");
    const fills = container.querySelectorAll<HTMLElement>("[aria-hidden='true'] > div");
    expect(fills[0].style.width).toBe("100%");
    expect(fills[1].style.width).toBe("50%");
    expect(screen.getByText("12 months")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the plan" })).toHaveAttribute("href", "/ready-writer");
    expect(screen.getByText("See it")).toHaveAttribute("aria-disabled", "true");
  });

  it("clamps the bar and hides when empty", () => {
    const { container } = render(<FinishLineCards items={[{ ...lines[0], durationPercent: 400 }, { ...lines[1], durationPercent: -3 }]} />);
    const fills = container.querySelectorAll<HTMLElement>("[aria-hidden='true'] > div");
    expect(fills[0].style.width).toBe("100%");
    expect(fills[1].style.width).toBe("0%");
    cleanup();
    expect(render(<FinishLineCards items={[]} />).container).toBeEmptyDOMElement();
  });

  it("shades the phases from light to deeper plum, each with its own dark text", () => {
    const { container } = render(
      <PlanPhases
        heading="The first 12 weeks"
        items={[
          { title: "Weeks 1-4", text: "Habit." },
          { title: "Weeks 5-8", text: "Pace." },
          { title: "Weeks 9-12", text: "Middle." },
          { title: "", text: "skipped" },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 3, name: "The first 12 weeks" })).toBeInTheDocument();
    const phases = [...container.querySelectorAll("ol > li")];
    expect(phases.map((p) => p.className.match(/bg-plum-\d+/)![0])).toEqual(["bg-plum-100", "bg-plum-200", "bg-plum-300"]);
    for (const p of phases) expect(p.className).toContain("text-plum-950");
    expect(container.querySelector("ol")!.className).toContain("@pair:grid-cols-3");
    cleanup();
    expect(render(<PlanPhases heading="x" items={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("JourneyMap and ComingUp", () => {
  const stages = [
    { name: "Idea", helps: "Membership", current: false },
    { name: "Revising", helps: "Self-Editing Academy", current: true },
    { name: "", helps: "skipped", current: false },
  ];
  const offer = { status: "waitlist" as const, statusLabel: "", title: "Self-Editing Academy", text: "[One-line description.]", buttonLabel: "See the Academy", href: "/academy" };
  const noOffer = { status: "open" as const, statusLabel: "", title: "", text: "", buttonLabel: "", href: "" };

  it("lays the stages out as a stepper that stacks on a narrow page, marks the current one and shows the offer with its compare link", () => {
    const { container } = render(<JourneyMap stages={stages} offer={offer} compare={{ label: "Compare all programs", href: "/compare" }} />);
    const steps = container.querySelectorAll("ol > li");
    expect(steps).toHaveLength(2);
    expect(container.querySelector("ol")!.className).toContain("flex-col");
    expect(container.querySelector("ol")!.className).toContain("@cards:flex-row");
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[1].className).toContain("text-white");
    expect(steps[0].className).toContain("text-ink");
    expect(screen.getByText("Waitlist").className).toContain("bg-gold");
    expect(screen.getByRole("heading", { level: 3, name: "Self-Editing Academy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the Academy" })).toHaveAttribute("href", "/academy");
    expect(screen.getByRole("link", { name: "Compare all programs" })).toHaveAttribute("href", "/compare");
  });

  it("takes its own status text, hides the offer when empty, and drops unsafe links", () => {
    render(<JourneyMap stages={stages} offer={{ ...offer, statusLabel: "Opens in spring", href: "javascript:x" }} compare={{ label: "Compare", href: "javascript:x" }} />);
    expect(screen.getByText("Opens in spring")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    const none = render(<JourneyMap stages={stages} offer={noOffer} compare={{ label: "Compare all", href: "/compare" }} />);
    expect(none.container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Compare all" })).toBeInTheDocument();
    cleanup();
    expect(render(<JourneyMap stages={[]} offer={noOffer} compare={{ label: "", href: "" }} />).container).toBeEmptyDOMElement();
  });

  it("shows up to four cards with kind, dates, availability, status and a link only when there is a safe address", () => {
    const item = { kind: "Retreat", title: "Cabin week", when: "June, by the lake", availability: "6 spots left", status: "open" as const, linkLabel: "Details", href: "/retreat" };
    const { container } = render(<ComingUp heading="Coming up" items={[item, { ...item, title: "Online week", kind: "Virtual retreat", status: "", href: "" }, ...Array.from({ length: 4 }, (_, i) => ({ ...item, title: `Extra ${i}` }))]} />);
    expect(screen.getByRole("heading", { level: 3, name: "Coming up" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Cabin week" })).toBeInTheDocument();
    expect(container.querySelectorAll("ul > li")).toHaveLength(4);
    expect(screen.getAllByText("6 spots left").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Virtual retreat")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Details" })).toHaveLength(3);
    cleanup();
    expect(render(<ComingUp heading="x" items={[]} />).container).toBeEmptyDOMElement();
  });
});

describe("checks for the homepage blocks", () => {
  const page = (...content: { type: string; props: Record<string, unknown> }[]) => ({
    content: [{ type: "Heading", props: { text: "Home", level: "h1", align: "center" } }, { type: "Heading", props: { text: "Section", level: "h2", align: "center" } }, ...content].map((c, i) => ({ ...c, props: { id: `b${i}`, ...c.props } })),
    root: {},
  });
  const messages = (data: unknown, severity: "error" | "warning" = "error") => checkLandingPage(data).filter((i) => i.severity === severity).map((i) => `${i.block}: ${i.message}`);

  it("errors on a Finisher photo with no description, and passes with one", () => {
    const withPhoto = (alt: string) => page({ type: "FinisherCards", props: { items: [{ imageAssetId: "media_AAAAAAAAAAA1", alt, name: "Ada", linkLabel: "", href: "" }], more: { label: "", href: "" } } });
    expect(messages(withPhoto(""))).toEqual(["Finisher cards: Finisher 1 has a photo with no description."]);
    expect(messages(withPhoto("Ada with her book"))).toEqual([]);
  });

  it("errors on a link, button or compare link that has words and no address, and warns about vague words", () => {
    const bad = page(
      { type: "AnnouncementStrip", props: { text: "News", buttonLabel: "Drop in", href: "" } },
      { type: "FinisherCards", props: { items: [{ alt: "", name: "Ada", linkLabel: "Read her story", href: "" }], more: { label: "See every Finisher", href: "" } } },
      { type: "FinishLineCards", props: { items: [{ title: "A year", buttonLabel: "See plan", href: "" }] } },
      { type: "JourneyMap", props: { stages: [], offer: { title: "Academy", buttonLabel: "See Academy", href: "" }, compare: { label: "Compare all programs", href: "" } } },
      { type: "ComingUp", props: { heading: "", items: [{ title: "Cabin", linkLabel: "Details", href: "" }] } },
    );
    const errors = messages(bad);
    expect(errors).toHaveLength(7);
    expect(errors.join("\n")).toContain("Announcement strip");
    expect(errors.join("\n")).toContain("Coming up");
    const vague = page({ type: "AnnouncementStrip", props: { text: "News", buttonLabel: "Learn more", href: "/x" } }, { type: "FinishLineCards", props: { items: [{ title: "A", buttonLabel: "click here", href: "/y" }] } });
    expect(messages(vague, "warning")).toHaveLength(2);
    expect(messages(vague)).toEqual([]);
  });

  it("counts the headings these blocks draw, so levels are checked and nothing skips", () => {
    const ok = page(
      { type: "FinisherCards", props: { items: [{ alt: "", name: "Ada" }], more: {} } },
      { type: "Timeline", props: { heading: "", items: [{ title: "Morning" }] } },
      { type: "FinishLineCards", props: { items: [{ title: "A year" }] } },
      { type: "PlanPhases", props: { heading: "First weeks", items: [] } },
      { type: "JourneyMap", props: { offer: { title: "Academy" }, compare: {} } },
      { type: "ComingUp", props: { heading: "Coming up", items: [{ title: "Cabin" }] } },
    );
    expect(checkLandingPage(ok)).toEqual([]);
    const jump = { content: [{ type: "Heading", props: { id: "a", text: "Home", level: "h1" } }, { type: "ComingUp", props: { id: "b", heading: "Coming up", items: [{ title: "A" }] } }], root: {} };
    expect(messages(jump, "warning").join()).toContain("skips a level");
  });

  it("does not choke on stored blocks with props missing", () => {
    const types = ["AnnouncementStrip", "SchedulePanel", "OutcomeNumbers", "FinisherCards", "Timeline", "WeekStrip", "FinishLineCards", "PlanPhases", "JourneyMap", "ComingUp"];
    expect(() => checkLandingPage(page(...types.map((type) => ({ type, props: {} }))))).not.toThrow();
  });

  it("renders every homepage block from its defaults, so a new block is never blank in the editor", () => {
    for (const name of ["AnnouncementStrip", "SchedulePanel", "OutcomeNumbers", "FinisherCards", "Timeline", "WeekStrip", "FinishLineCards", "PlanPhases", "JourneyMap", "ComingUp"] as const) {
      const { container, unmount } = render(<LandingRender data={{ content: [{ type: name, props: { id: "x", ...BLOCK_DEFAULTS[name] } }], root: {} }} />);
      expect(container.querySelector("main")!.innerHTML, name).not.toBe("");
      unmount();
    }
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
