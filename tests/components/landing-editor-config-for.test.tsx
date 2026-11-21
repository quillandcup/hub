// @vitest-environment jsdom
/** The editor's config per kind of page: a landing page edits its own header and footer; a website page has the site's, fixed and edited in Design. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { editorConfig, editorConfigFor } from "@/components/landing/editor-config";
import { normalizeSiteTemplate } from "@/lib/landing/site-template";

const site = normalizeSiteTemplate({ header: { show: true, items: [{ id: "c", type: "cta", label: "Join us", href: "/join" }] }, footer: { show: true, text: "Fern Quills" } });

describe("editorConfigFor", () => {
  it("gives a landing page the config with its own header and footer fields", () => {
    const config = editorConfigFor({ pageType: "landing", site: null, editing: true });
    expect(Object.keys(config.root?.fields ?? {})).toEqual(expect.arrayContaining(["showHeader", "navLinks", "showFooter", "footerText", "footerLinks"]));
  });

  it("gives a website page no header or footer fields, and the site's regions around its blocks", () => {
    const config = editorConfigFor({ pageType: "website", site, editing: true });
    expect(config.root?.fields).toEqual({});
    expect(Object.keys(config.components)).toEqual(Object.keys(editorConfig.components));
    const Root = config.root!.render!;
    render(<Root id="root" puck={{ renderDropZone: () => null } as never}>{<p>Page blocks</p>}</Root>);
    expect(screen.getByText("Page blocks")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join us" })).toBeInTheDocument();
    expect(screen.getByText("Fern Quills")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-site-region]")).toHaveLength(2);
  });
});
