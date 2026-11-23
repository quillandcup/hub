// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SocialIcons, SocialLink } from "@/components/landing/blocks";
import { ITEM_LIMITS } from "@/components/landing/item-limits";
import { SOCIAL_NETWORKS, socialNetworkOf } from "@/components/landing/social-networks";
import { checkLandingPage } from "@/lib/landing/a11y";
import { normalizeLandingData } from "@/lib/landing/data";
import { pruneToKnownBlocks } from "@/lib/landing/json-transfer";
import { LANDING_SCHEMA_VERSION } from "@/lib/landing/migrations";
import { itemsSlot } from "./landing-items-slot";

const link = (network: string, url = `https://${network}.example.com/me`) => ({ network, url });

describe("the Social icons block", () => {
  it("draws every network as a link named for it, with its picture hidden from screen readers", () => {
    const networks = Object.keys(SOCIAL_NETWORKS);
    const { container } = render(<SocialIcons align="center" size="medium" items={itemsSlot(SocialLink, networks.map((n) => link(n, n === "email" ? "mailto:hello@example.com" : undefined)))} />);
    for (const label of Object.values(SOCIAL_NETWORKS)) expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    expect(container.querySelectorAll("a svg")).toHaveLength(networks.length);
    expect([...container.querySelectorAll("svg")].every((s) => s.getAttribute("aria-hidden") === "true")).toBe(true);
    // Every network draws something of its own.
    expect(new Set([...container.querySelectorAll("a svg")].map((s) => s.innerHTML)).size).toBe(networks.length);
  });

  it("opens another site in a new tab with rel set, and a mailto in the same tab", () => {
    render(<SocialIcons align="left" size="small" items={itemsSlot(SocialLink, [link("instagram"), link("email", "mailto:hello@example.com")])} />);
    const site = screen.getByRole("link", { name: "Instagram" });
    expect(site).toHaveAttribute("target", "_blank");
    expect(site.getAttribute("rel")).toBe("noopener noreferrer");
    const mail = screen.getByRole("link", { name: "Email" });
    expect(mail).toHaveAttribute("href", "mailto:hello@example.com");
    expect(mail).not.toHaveAttribute("target");
  });

  it("follows the alignment and size, and takes its colour from the section's text colour", () => {
    const { container } = render(<SocialIcons align="right" size="large" items={itemsSlot(SocialLink, [link("youtube")])} />);
    const list = container.querySelector("ul")!;
    expect(list.className).toContain("justify-end");
    expect(list.className).toContain("[&_.lp-social]:h-12");
    const a = screen.getByRole("link", { name: "YouTube" });
    expect(a.className).toContain("border-current");
    expect(container.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|@\[|(?:^|[\s"])(?:sm|md|lg|xl):/i);
  });

  it("falls back to medium and centred for values it does not know, and to a Website mark for an unknown network", () => {
    const { container } = render(<SocialIcons align={"diagonal" as never} size={"huge" as never} items={itemsSlot(SocialLink, [link("myspace")])} />);
    expect(container.querySelector("ul")!.className).toContain("justify-center");
    expect(container.querySelector("ul")!.className).toContain("[&_.lp-social]:h-10");
    expect(screen.getByRole("link", { name: "Website" })).toBeInTheDocument();
    expect(socialNetworkOf("toString")).toBe("website");
    expect(socialNetworkOf(undefined)).toBe("website");
  });

  it("goes through safeHref: an unsafe address draws nothing for a visitor, and a disabled icon while editing", () => {
    const visitor = render(<SocialLink network="instagram" url="javascript:alert(1)" />);
    expect(visitor.container.innerHTML).toBe("");
    visitor.unmount();
    render(<SocialLink network="instagram" url="javascript:alert(1)" editing />);
    expect(screen.getByRole("img", { name: "Instagram (no link yet)" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("holds eight links at most on the public page (the ninth is hidden), not while editing", () => {
    expect(ITEM_LIMITS.SocialIcons).toBe(8);
    const nine = Array.from({ length: 9 }, () => link("website"));
    expect(render(<SocialIcons align="center" size="medium" items={itemsSlot(SocialLink, nine)} />).container.querySelector("ul")!.className).toContain("[&>:nth-child(n+9)]:hidden");
    expect(render(<SocialIcons editing align="center" size="medium" items={itemsSlot(SocialLink, nine)} />).container.querySelector("ul")!.className).not.toContain("nth-child");
  });
});

describe("the publish check for Social icons", () => {
  const title = { type: "Heading", props: { id: "h", text: "Page", level: "h1", align: "center" } };
  const issues = (...links: { network: string; url: string }[]) =>
    checkLandingPage({ content: [title, { type: "SocialIcons", props: { id: "s", align: "center", size: "medium", items: links.map((l, i) => ({ type: "SocialLink", props: { id: `l${i}`, ...l } })) } }], root: { props: {} }, schemaVersion: LANDING_SCHEMA_VERSION }).filter((i) => i.block === "Social icons");

  it("is clean for working links", () => {
    expect(issues(link("instagram"), link("email", "mailto:hello@example.com"))).toEqual([]);
  });

  it("makes an address that can't be used an error that names the network, such as a bare email address", () => {
    expect(issues(link("email", "hello@example.com")).map((i) => [i.severity, i.message])).toEqual([["error", "The Email link has an address that can't be used. Use https://, or mailto: for an email address."]]);
    expect(issues(link("x", "javascript:alert(1)"))[0].severity).toBe("error");
  });

  it("warns that a block with no links shows nothing, and that a ninth link is hidden", () => {
    expect(issues().some((i) => /no links/.test(i.message))).toBe(true);
    expect(issues(link("instagram", ""), link("youtube", "")).some((i) => /no links/.test(i.message))).toBe(true);
    expect(issues(...Array.from({ length: 9 }, () => link("website"))).some((i) => /shows 8 links at most/.test(i.message))).toBe(true);
  });
});

describe("a Social icons block in an exported file", () => {
  it("keeps its alignment, size and links through the import pruning", () => {
    const block = { type: "SocialIcons", props: { id: "s", align: "left", size: "small", items: [{ type: "SocialLink", props: { id: "l", network: "tiktok", url: "https://tiktok.example.com/me" } }] } };
    const { data, leftOut, droppedProps } = pruneToKnownBlocks(normalizeLandingData({ content: [block], root: {}, schemaVersion: LANDING_SCHEMA_VERSION }));
    expect(leftOut).toEqual([]);
    expect(droppedProps).toBe(0);
    expect(data.content[0]).toEqual(block);
  });
});
