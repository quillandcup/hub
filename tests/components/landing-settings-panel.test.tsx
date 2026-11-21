// @vitest-environment jsdom
/** The editor's Settings panel: inherited for a website page, "Use site settings" with an override per group for a landing page. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { normalizeSiteTemplate } from "@/lib/landing/site-template";

vi.mock("@/components/media/MediaPicker", () => ({
  default: ({ onChange, noun }: { onChange: (id: string | null, asset?: { id: string; width: number; height: number }) => string | null | void; noun?: string }) => (
    <div>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("picked", { detail: onChange("mda_NEW", { id: "mda_NEW", width: 64, height: 64 }) }))}>
        pick a square {noun}
      </button>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("picked", { detail: onChange("mda_WIDE", { id: "mda_WIDE", width: 64, height: 32 }) }))}>
        pick a wide {noun}
      </button>
    </div>
  ),
}));
vi.mock("@puckeditor/core", () => ({ createUsePuck: () => () => undefined }));

import { SettingsView } from "@/app/(admin)/admin/pages/[slug]/SettingsPanel";
import { DESIGN_HREF } from "@/components/landing/config";

const site = normalizeSiteTemplate({ style: { pageBackground: "cream", primary: "teal" }, favicon: { assetId: "mda_SITE" } });
const base = { site, root: {}, onRoot: vi.fn(), tools: { guides: false, grid: false }, onTools: vi.fn(), shortcuts: { available: true, open: vi.fn() } };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Settings on a website page", () => {
  it("says what the page inherits from the site, with a link to change it once, and has nothing to override", () => {
    render(<SettingsView pageType="website" {...base} />);
    expect(screen.getByRole("heading", { name: "Inherited from the site" })).toBeInTheDocument();
    expect(screen.getByText(/Cream background, teal primary/)).toBeInTheDocument();
    expect(screen.getByText(/the site's favicon/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Design" })).toHaveAttribute("href", DESIGN_HREF);
    expect(screen.queryByLabelText("Use site settings")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("says there is no favicon when the site has none", () => {
    render(<SettingsView pageType="website" {...base} site={normalizeSiteTemplate({})} />);
    expect(screen.getByText(/none \(the app's icon\)/)).toBeInTheDocument();
  });
});

describe("Settings on a landing page", () => {
  it("follows the site by default, showing the site's values without letting them change", () => {
    render(<SettingsView pageType="landing" {...base} />);
    const toggles = screen.getAllByRole("checkbox", { name: "Use site settings" });
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) expect(toggle).toBeChecked();
    expect(screen.getByLabelText("Primary colour (buttons, accents and links)")).toHaveValue("teal");
    expect(screen.getByLabelText("Primary colour (buttons, accents and links)")).toBeDisabled();
    expect(screen.queryByText(/pick a square/)).toBeNull();
  });

  it("turning the style off starts an override from the site's values, and each change is the page's own", () => {
    const { rerender } = render(<SettingsView pageType="landing" {...base} />);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Use site settings" })[1]);
    expect(base.onRoot).toHaveBeenLastCalledWith({ styleOverride: expect.objectContaining({ pageBackground: "cream", primary: "teal" }) });
    rerender(<SettingsView pageType="landing" {...base} root={{ styleOverride: { pageBackground: "cream", primary: "teal" } as never }} />);
    const primary = screen.getByLabelText("Primary colour (buttons, accents and links)");
    expect(primary).not.toBeDisabled();
    fireEvent.change(primary, { target: { value: "brown" } });
    expect(base.onRoot).toHaveBeenLastCalledWith({ styleOverride: expect.objectContaining({ primary: "brown", pageBackground: "cream" }) });
  });

  it("shows the site's button style while following, and lets the page choose its own once the style is its own", () => {
    const outlined = normalizeSiteTemplate({ style: { buttonStyle: "outline" } });
    const { rerender } = render(<SettingsView pageType="landing" {...base} site={outlined} />);
    expect(screen.getByLabelText("Button style")).toHaveValue("outline");
    expect(screen.getByLabelText("Button style")).toBeDisabled();
    rerender(<SettingsView pageType="landing" {...base} site={outlined} root={{ styleOverride: { buttonStyle: "outline" } as never }} />);
    fireEvent.change(screen.getByLabelText("Button text colour (solid buttons)"), { target: { value: "dark" } });
    expect(base.onRoot).toHaveBeenLastCalledWith({ styleOverride: expect.objectContaining({ buttonText: "dark", buttonStyle: "outline" }) });
  });

  it("says on a website page that the site's buttons are solid or outline", () => {
    render(<SettingsView pageType="website" {...base} site={normalizeSiteTemplate({ style: { buttonStyle: "outline" } })} />);
    expect(screen.getByText(/outline buttons/)).toBeInTheDocument();
  });

  it("turning it back on drops the override and nothing else the page keeps", () => {
    render(<SettingsView pageType="landing" {...base} root={{ styleOverride: { primary: "brown" }, faviconOverrideAssetId: "mda_OWN" }} />);
    const [favicon, style] = screen.getAllByRole("checkbox", { name: "Use site settings" });
    expect(favicon).not.toBeChecked();
    expect(style).not.toBeChecked();
    fireEvent.click(style);
    expect(base.onRoot).toHaveBeenLastCalledWith({ faviconOverrideAssetId: "mda_OWN" });
    fireEvent.click(favicon);
    expect(base.onRoot).toHaveBeenLastCalledWith({ styleOverride: { primary: "brown" } });
  });

  it("turning the favicon off starts from the site's, and takes a square picture only", () => {
    const { rerender } = render(<SettingsView pageType="landing" {...base} />);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Use site settings" })[0]);
    expect(base.onRoot).toHaveBeenLastCalledWith({ faviconOverrideAssetId: "mda_SITE" });
    rerender(<SettingsView pageType="landing" {...base} root={{ faviconOverrideAssetId: "mda_SITE" }} />);
    fireEvent.click(screen.getByRole("button", { name: "pick a square favicon" }));
    expect(base.onRoot).toHaveBeenLastCalledWith({ faviconOverrideAssetId: "mda_NEW" });
    base.onRoot.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "pick a wide favicon" }));
    expect(base.onRoot).not.toHaveBeenCalled();
  });
});

describe("Settings on any page", () => {
  it("turns the design tools on and off, in the editor only", () => {
    render(<SettingsView pageType="website" {...base} />);
    fireEvent.click(screen.getByLabelText(/Show guides/));
    expect(base.onTools).toHaveBeenLastCalledWith({ guides: true });
    fireEvent.click(screen.getByLabelText(/Show grid/));
    expect(base.onTools).toHaveBeenLastCalledWith({ grid: true });
    expect(screen.getByText(/never show on the page/)).toBeInTheDocument();
  });

  it("opens the keyboard shortcuts panel, and says when there is no keyboard", () => {
    const { rerender } = render(<SettingsView pageType="landing" {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Show keyboard shortcuts" }));
    expect(base.shortcuts.open).toHaveBeenCalled();
    rerender(<SettingsView pageType="landing" {...base} shortcuts={{ available: false, open: vi.fn() }} />);
    expect(screen.getByRole("button", { name: "Show keyboard shortcuts" })).toBeDisabled();
    expect(screen.getByText("Shortcuts need a keyboard.")).toBeInTheDocument();
  });

  it("has no place for custom code", () => {
    render(<SettingsView pageType="landing" {...base} />);
    expect(screen.queryByText(/custom code/i)).toBeNull();
  });
});
