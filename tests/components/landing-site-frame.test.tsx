// @vitest-environment jsdom
/** The site template drawn as a header and footer, and the frame that puts it around a website page (docs/product/LANDING_PAGES.md, "Site template"). */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PageFrame, DESIGN_HREF } from "@/components/landing/config";
import { SiteFooterView, SiteHeaderView } from "@/components/landing/site-frame";
import { EMPTY_SITE_TEMPLATE, normalizeSiteTemplate } from "@/lib/landing/site-template";

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
    expect(screen.queryByRole("link", { name: "X" })).toBeNull();
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
