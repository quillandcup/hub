// @vitest-environment jsdom
/** The site template drawn as a header and footer, and the frame that puts it around a website page (docs/product/LANDING_PAGES.md, "Site template"). */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PageFrame, DESIGN_HREF } from "@/components/landing/config";
import { SiteFooterView, SiteHeaderView } from "@/components/landing/site-frame";
import { EMPTY_SITE_TEMPLATE, SOCIAL_NETWORKS, normalizeSiteTemplate } from "@/lib/landing/site-template";

const full = normalizeSiteTemplate({
  header: {
    show: true,
    align: "spread",
    mobileMenu: "fold",
    items: [
      { id: "l", type: "logo", logoAssetId: "mda_AAAAAAAAAAA1", alt: "Quill & Cup", href: "/" },
      { id: "m", type: "menu", links: [{ label: "Schedule", href: "/schedule" }, { label: "Bad", href: "javascript:x" }] },
      { id: "c", type: "cta", label: "Join us", href: "/join", look: "solid" },
      { id: "s", type: "signin", label: "Sign in", look: "link" },
      { id: "o", type: "social", links: [{ network: "instagram", href: "https://example.test/ig" }, { network: "x", href: "" }] },
    ],
  },
  footer: { show: true, text: "Fern Quills", links: [{ label: "Privacy", href: "/privacy" }], social: [{ network: "youtube", href: "https://example.test/yt" }] },
});

describe("the site header", () => {
  it("draws every block: logo, menu, button, sign-in and social links, with only safe links", () => {
    render(<>{SiteHeaderView({ header: full.header })}</>);
    expect(screen.getByRole("img", { name: "Quill & Cup" })).toBeInTheDocument();
    const nav = screen.getAllByRole("navigation", { name: "Site" })[0];
    expect(within(nav).getAllByRole("link", { name: "Schedule" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Bad" })).toBeNull();
    expect(screen.getByRole("link", { name: "Join us" })).toHaveAttribute("href", "/join");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", "https://example.test/ig");
    expect(screen.getByRole("link", { name: "Instagram" }).querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("link", { name: "Instagram" }).textContent).toBe("");
    expect(screen.queryByRole("link", { name: "X" })).toBeNull();
  });

  it("swaps in the dark-mode logo with the theme, and shows one logo when there is none", () => {
    const withDark = normalizeSiteTemplate({ header: { show: true, items: [{ id: "l", type: "logo", logoAssetId: "mda_AAAAAAAAAAA1", darkLogoAssetId: "mda_AAAAAAAAAAA2", alt: "Quill & Cup", href: "/" }] } });
    const { container, unmount } = render(<>{SiteHeaderView({ header: withDark.header })}</>);
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("src")).toBe("/api/media/mda_AAAAAAAAAAA1/logo");
    expect(imgs[0].className).toContain("dark:hidden");
    expect(imgs[1].getAttribute("src")).toBe("/api/media/mda_AAAAAAAAAAA2/logo");
    expect(imgs[1].className).toContain("hidden dark:block");
    unmount();
    const { container: plain } = render(<>{SiteHeaderView({ header: full.header })}</>);
    expect(plain.querySelectorAll("img")).toHaveLength(1);
  });

  it("shows the logo whole: the logo preset, its height fixed, never a crop frame", () => {
    render(<>{SiteHeaderView({ header: full.header })}</>);
    const img = screen.getByRole("img", { name: "Quill & Cup" });
    expect(img.getAttribute("src")).toBe("/api/media/mda_AAAAAAAAAAA1/logo");
    expect(img).toHaveAttribute("height", "48");
    expect(img.className).toContain("h-12");
    expect(img.className).toContain("w-auto");
    expect(img.className).not.toMatch(/aspect-|object-cover/);
  });

  it("gives every link the same box, so the sign-in link lines up with the menu links", () => {
    render(<>{SiteHeaderView({ header: full.header })}</>);
    const signIn = screen.getByRole("link", { name: "Sign in" });
    const menuLink = within(screen.getAllByRole("navigation", { name: "Site" })[0]).getAllByRole("link", { name: "Schedule" })[0];
    expect(signIn.className).toContain("block");
    expect(signIn.className).toBe(menuLink.className);
  });

  it("folds the menu into a Menu disclosure on a narrow page, and wraps the links when asked to", () => {
    const { container, rerender } = render(<>{SiteHeaderView({ header: full.header })}</>);
    expect(screen.getByText("Menu")).toBeInTheDocument();
    expect(container.querySelector("details")?.className).toContain("@split:hidden");
    rerender(<>{SiteHeaderView({ header: { ...full.header, mobileMenu: "wrap" } })}</>);
    expect(screen.queryByText("Menu")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
  });

  it("names the sizes a block is on with the named container size, never a viewport breakpoint", () => {
    const header = { ...full.header, items: full.header.items.map((i) => (i.id === "c" ? { ...i, show: "desktop" as const } : i.id === "s" ? { ...i, show: "mobile" as const } : i)) };
    const { container } = render(<>{SiteHeaderView({ header })}</>);
    expect(screen.getByRole("link", { name: "Join us" }).parentElement?.className).toContain("hidden @split:block");
    expect(screen.getByRole("link", { name: "Sign in" }).parentElement?.className).toContain("@split:hidden");
    expect(container.innerHTML).not.toMatch(/\b(sm|md|lg|xl):/);
  });

  it("draws nothing when it is off or has nothing in it", () => {
    expect(SiteHeaderView({ header: { ...full.header, show: false } })).toBeNull();
    expect(SiteHeaderView({ header: EMPTY_SITE_TEMPLATE.header })).toBeNull();
  });

  it("puts the logos at the start and the rest at the end, or everything in order", () => {
    const { container, rerender } = render(<>{SiteHeaderView({ header: full.header })}</>);
    expect(container.querySelectorAll("header > div > div")).toHaveLength(2);
    rerender(<>{SiteHeaderView({ header: { ...full.header, align: "center" } })}</>);
    expect(container.querySelector("header > div")?.className).toContain("justify-center");
  });
});

describe("the site footer", () => {
  it("draws links, social links and the text", () => {
    render(<>{SiteFooterView({ footer: full.footer })}</>);
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "YouTube" })).toBeInTheDocument();
    expect(screen.getByText("Fern Quills")).toBeInTheDocument();
  });

  it("draws every social network as an icon link named for it, not as text", () => {
    const networks = SOCIAL_NETWORKS.map((n) => n.value);
    const footer = normalizeSiteTemplate({ footer: { show: true, text: "", links: [], social: networks.map((network) => ({ network, href: `https://example.test/${network}` })) } }).footer;
    const { container } = render(<>{SiteFooterView({ footer })}</>);
    const list = screen.getByRole("list", { name: "Social links" });
    for (const n of SOCIAL_NETWORKS) {
      const link = within(list).getByRole("link", { name: n.label });
      expect(link).toHaveAttribute("href", `https://example.test/${n.value}`);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.textContent).toBe("");
      expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(link.className).toContain("focus-visible:ring-2");
    }
    expect(new Set([...container.querySelectorAll("a svg")].map((s) => s.innerHTML)).size).toBe(networks.length);
    expect(list.className).toContain("flex-wrap");
    expect(list.className).toContain("justify-center");
    expect(container.querySelector("footer")!.className).toContain("text-white");
  });

  it("skips a social link with no usable address", () => {
    const footer = normalizeSiteTemplate({ footer: { show: true, text: "x", links: [], social: [{ network: "substack", href: "" }, { network: "pinterest", href: "javascript:x" }] } }).footer;
    render(<>{SiteFooterView({ footer })}</>);
    expect(screen.queryByRole("list", { name: "Social links" })).toBeNull();
  });

  it("draws nothing when it is off or empty", () => {
    expect(SiteFooterView({ footer: { ...full.footer, show: false } })).toBeNull();
    expect(SiteFooterView({ footer: EMPTY_SITE_TEMPLATE.footer })).toBeNull();
  });
});

describe("PageFrame", () => {
  const own = { showHeader: true, navLinks: [{ label: "Own link", href: "/own" }], showFooter: true, footerText: "Own footer" };

  it("frames a website page with the site's header and footer, and ignores the page's own", () => {
    render(
      <PageFrame {...own} frame={{ pageType: "website", site: full }}>
        <p>Body</p>
      </PageFrame>,
    );
    expect(screen.getByRole("link", { name: "Join us" })).toBeInTheDocument();
    expect(screen.getByText("Fern Quills")).toBeInTheDocument();
    expect(screen.queryByText("Own link")).toBeNull();
    expect(screen.queryByText("Own footer")).toBeNull();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("is a column as tall as the screen with the page taking the slack, so a footer on a short page rests at the bottom with nothing under it", () => {
    const { container } = render(
      <PageFrame {...own} frame={{ pageType: "website", site: full }}>
        <p>Body</p>
      </PageFrame>,
    );
    const frame = container.querySelector("[data-lp-frame]")!;
    for (const cls of ["flex", "flex-col", "min-h-screen"]) expect(frame.className.split(" ")).toContain(cls);
    expect(container.querySelector("main")!.className).toContain("flex-1");
    expect(frame.lastElementChild!.tagName).toBe("FOOTER");
  });

  it("uses the logo preset for a landing page's own header logo too", () => {
    render(<PageFrame {...own} logoAssetId="mda_AAAAAAAAAAA1" logoAlt="Mark" frame={{ pageType: "landing", site: full }} />);
    expect(screen.getByRole("img", { name: "Mark" }).getAttribute("src")).toBe("/api/media/mda_AAAAAAAAAAA1/logo");
  });

  it("frames a website page with nothing before the site has been published", () => {
    const { container } = render(
      <PageFrame {...own} frame={{ pageType: "website", site: null }}>
        <p>Body</p>
      </PageFrame>,
    );
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
  });

  it("keeps a landing page's own header and footer, whatever the site says", () => {
    render(
      <PageFrame {...own} frame={{ pageType: "landing", site: full }}>
        <p>Body</p>
      </PageFrame>,
    );
    expect(screen.getByText("Own footer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Own link" })).toBeInTheDocument();
    expect(screen.queryByText("Fern Quills")).toBeNull();
  });

  it("shows the regions in the editor, fixed, inert and marked as shared, with where to change them", () => {
    const { container } = render(
      <PageFrame frame={{ pageType: "website", site: full, editing: true }}>
        <p>Body</p>
      </PageFrame>,
    );
    const regions = container.querySelectorAll("[data-site-region]");
    expect([...regions].map((r) => r.getAttribute("data-site-region"))).toEqual(["header", "footer"]);
    for (const region of regions) {
      expect(region.textContent).toContain("Shared by every website page.");
      expect(region.querySelector(".pointer-events-none")).not.toBeNull();
      expect(region.querySelector("[draggable]")).toBeNull();
    }
    expect(screen.getByRole("link", { name: "Edit the header in Design" })).toHaveAttribute("href", DESIGN_HREF);
    expect(screen.getByRole("link", { name: "Edit the footer in Design" })).toHaveAttribute("href", DESIGN_HREF);
  });

  it("says so in the editor when the site header and footer are off", () => {
    render(
      <PageFrame frame={{ pageType: "website", site: EMPTY_SITE_TEMPLATE, editing: true }}>
        <p>Body</p>
      </PageFrame>,
    );
    expect(screen.getByText("The site header is off or empty.")).toBeInTheDocument();
    expect(screen.getByText("The site footer is off or empty.")).toBeInTheDocument();
  });
});

describe("footer year tokens", () => {
  it("draws {year} and {year:2019} as the current year and a range, and leaves unknown tokens", () => {
    const footer = normalizeSiteTemplate({ footer: { show: true, text: "© {year:2019} Fern Quills, {year}, {unknown}" } }).footer;
    render(<>{SiteFooterView({ footer })}</>);
    expect(screen.getByRole("contentinfo").textContent).toMatch(/^© 2019–\d{4} Fern Quills, \d{4}, \{unknown\}$/);
  });
});
