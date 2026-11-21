"use client";

import type { ReactNode } from "react";
import { createUsePuck, type Data } from "@puckeditor/core";
import AppIcon from "@/components/Icon";
import { setDesignTools, useDesignTools, type DesignTools } from "@/components/landing/design-tools";
import { FaviconField, StyleFields } from "@/components/landing/style-fields";
import { useShortcutsPanel } from "@/components/shortcuts/ShortcutsProvider";
import { DESIGN_HREF } from "@/components/landing/config";
import type { SiteTemplate } from "@/lib/landing/site-template";
import { FONT_FAMILIES, PAGE_BACKGROUNDS, PRIMARY_COLORS, normalizeStyleOverride, resolveFaviconAssetId, resolveStyle, type StyleKey, type StyleTokens } from "@/lib/landing/style";

const usePuck = createUsePuck();

/** What a page stores of its own settings, in its root. A key that is absent follows the site. */
export type PageSettingsRoot = { styleOverride?: Partial<StyleTokens>; faviconOverrideAssetId?: string };

const SECTION = "space-y-3 border-b border-slate-200 p-3 dark:border-slate-700";
const HEADING = "text-sm font-semibold";
const NOTE = "text-xs text-slate-600 dark:text-slate-400";
const LINK = "font-medium text-plum-700 underline dark:text-plum-300";

const label = (list: readonly { value: string; label: string }[], value: string) => list.find((o) => o.value === value)?.label ?? value;

function Toggle({ label: text, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm font-medium">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      {text}
    </label>
  );
}

function DesignLink({ children }: { children: ReactNode }) {
  return (
    <a href={DESIGN_HREF} target="_blank" rel="noopener" className={LINK}>
      {children}
    </a>
  );
}

/**
 * The editor's Settings panel (docs/product/LANDING_PAGES.md, "Settings"). Presentational, so it is tested without Puck.
 *
 * - A **website page** takes its favicon and style from the site, edited once in Design: the panel only says what they are, with a link.
 * - A **landing page** follows the site by default ("Use site settings"). Turning that off for a group gives the page its own
 *   favicon or style, kept in the page's root; turning it back on drops the override, and the page follows the site again.
 * - **Design tools** (guides, grid) are for the canvas only and kept per browser. **Keyboard shortcuts** opens the app's `?` panel.
 */
export function SettingsView({
  pageType,
  site,
  root,
  onRoot,
  tools,
  onTools,
  shortcuts,
}: {
  pageType: "website" | "landing";
  site: SiteTemplate;
  root: PageSettingsRoot;
  onRoot: (next: PageSettingsRoot) => void;
  tools: DesignTools;
  onTools: (patch: Partial<DesignTools>) => void;
  shortcuts: { available: boolean; open: () => void };
}) {
  const siteStyle = resolveStyle(site.style);
  const style = resolveStyle(site.style, root.styleOverride);
  const ownStyle = normalizeStyleOverride(root.styleOverride) !== null;
  const ownFavicon = typeof root.faviconOverrideAssetId === "string";
  const siteFavicon = resolveFaviconAssetId(site.favicon.assetId, undefined);
  const withoutKey = (key: keyof PageSettingsRoot): PageSettingsRoot => {
    const next = { ...root };
    delete next[key];
    return next;
  };

  return (
    <div className="text-sm">
      {pageType === "website" ? (
        <section className={SECTION} aria-labelledby="settings-inherited">
          <h2 id="settings-inherited" className={HEADING}>
            Inherited from the site
          </h2>
          <p>
            <span className="font-medium">Favicon:</span> {siteFavicon ? "the site's favicon" : "none (the app's icon)"}
          </p>
          <p>
            <span className="font-medium">Style:</span> {label(PAGE_BACKGROUNDS, siteStyle.pageBackground)} background, {label(PRIMARY_COLORS, siteStyle.primary).toLowerCase()} primary, {siteStyle.buttonStyle} buttons, {label(FONT_FAMILIES, siteStyle.fontFamily).toLowerCase()} body font.
          </p>
          <p className={NOTE}>
            Shared by every website page. Change them once, in <DesignLink>Design</DesignLink>.
          </p>
        </section>
      ) : (
        <>
          <section className={SECTION} aria-labelledby="settings-favicon">
            <h2 id="settings-favicon" className={HEADING}>
              Favicon
            </h2>
            <Toggle
              label="Use site settings"
              checked={!ownFavicon}
              onChange={(follow) => onRoot(follow ? withoutKey("faviconOverrideAssetId") : { ...root, faviconOverrideAssetId: siteFavicon })}
            />
            {ownFavicon ? (
              <FaviconField value={root.faviconOverrideAssetId ?? ""} onChange={(assetId) => onRoot({ ...root, faviconOverrideAssetId: assetId })} />
            ) : (
              <p className={NOTE}>
                Follows the site: {siteFavicon ? "the site's favicon" : "none"}. Set it in <DesignLink>Design</DesignLink>.
              </p>
            )}
          </section>
          <section className={SECTION} aria-labelledby="settings-style">
            <h2 id="settings-style" className={HEADING}>
              Style guide
            </h2>
            <Toggle label="Use site settings" checked={!ownStyle} onChange={(follow) => onRoot(follow ? withoutKey("styleOverride") : { ...root, styleOverride: style })} />
            {ownStyle ? (
              <StyleFields value={style} onChange={(key: StyleKey, next) => onRoot({ ...root, styleOverride: { ...style, [key]: next } })} />
            ) : (
              <>
                <StyleFields value={style} onChange={() => {}} disabled />
                <p className={NOTE}>
                  Follows the site&apos;s style. Change it for every page in <DesignLink>Design</DesignLink>, or turn off &ldquo;Use site settings&rdquo; to style only this page.
                </p>
              </>
            )}
            <p className={NOTE}>This page&apos;s own header and footer keep their own fields, and take their look from the style above.</p>
          </section>
        </>
      )}
      <section className={SECTION} aria-labelledby="settings-tools">
        <h2 id="settings-tools" className={HEADING}>
          Design tools
        </h2>
        <Toggle label="Show guides (an outline around every block)" checked={tools.guides} onChange={(guides) => onTools({ guides })} />
        <Toggle label="Show grid (twelve columns)" checked={tools.grid} onChange={(grid) => onTools({ grid })} />
        <p className={NOTE}>Only in this editor, only in this browser. They never show on the page.</p>
      </section>
      <section className={SECTION} aria-labelledby="settings-hotkeys">
        <h2 id="settings-hotkeys" className={HEADING}>
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          disabled={!shortcuts.available}
          onClick={shortcuts.open}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          Show keyboard shortcuts
        </button>
        {!shortcuts.available && <p className={NOTE}>Shortcuts need a keyboard.</p>}
      </section>
    </div>
  );
}

/** The panel in the editor: the page's own settings are read from and written to its root, so they autosave with the page and are one undo step each. */
function SettingsPanel({ pageType, site }: { pageType: "website" | "landing"; site: SiteTemplate }) {
  const root = usePuck((s) => s.appState.data.root.props) as Record<string, unknown> | undefined;
  const dispatch = usePuck((s) => s.dispatch);
  const data = usePuck((s) => s.appState.data) as Data;
  const tools = useDesignTools();
  const shortcuts = useShortcutsPanel();
  const current: PageSettingsRoot = {
    ...(normalizeStyleOverride(root?.styleOverride) ? { styleOverride: normalizeStyleOverride(root?.styleOverride)! } : {}),
    ...(typeof root?.faviconOverrideAssetId === "string" ? { faviconOverrideAssetId: root.faviconOverrideAssetId } : {}),
  };
  function write(next: PageSettingsRoot) {
    const props: Record<string, unknown> = { ...(data.root.props ?? {}) };
    delete props.styleOverride;
    delete props.faviconOverrideAssetId;
    Object.assign(props, next);
    dispatch({ type: "replaceRoot", root: { ...data.root, props: props as never } });
  }
  return <SettingsView pageType={pageType} site={site} root={current} onRoot={write} tools={tools} onTools={setDesignTools} shortcuts={{ available: shortcuts.available, open: () => shortcuts.openPanel("editor_settings") }} />;
}

/** The editor's left-rail tab, beside Add and AI. In the rail like the others, so it never takes room from the canvas. */
export const settingsPlugin = (pageType: "website" | "landing", site: SiteTemplate) => ({
  name: "settings",
  label: "Settings",
  icon: <AppIcon name="details" />,
  render: () => <SettingsPanel pageType={pageType} site={site} />,
});
