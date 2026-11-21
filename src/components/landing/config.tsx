import type { ComponentConfig, Config } from "@puckeditor/core";
import type { ComponentType, ReactNode } from "react";
import { safeHref } from "@/lib/landing/data";
import { installedPageBlocks, type InstalledBlockDefaults } from "@/modules";
import { createPageBlockRegistry, type PageBlockDefinition, type PageBlockRegistry } from "./block-registry";
import { CORE_DEFAULTS, coreBlocks } from "./core-blocks";
import { EMPTY_SITE_TEMPLATE, type SiteTemplate } from "@/lib/landing/site-template";
import { resolveStyle, styleClasses } from "@/lib/landing/style";
import { DesignToolsOverlay } from "./design-tools";
import { SiteFooterView, SiteHeaderView } from "./site-frame";
import { pageImage, spanClasses } from "./theme";

/**
 * The page frame and the config of the block set, with no editor-only parts: the public page renders `data` through this (on the
 * server), and the editor builds its own config from it by adding each block's fields (editor-config.tsx). The blocks come from the
 * registry (block-registry.ts): a new block is a component, an entry in `core-blocks.ts` (or in a module's contribution) and its fields.
 * See docs/product/LANDING_PAGES.md, "Adding a block", and docs/architecture/PAGE_BLOCKS.md.
 */

// Puck types each component's props from its config; our blocks are plain components, so they are registered loosely.
const block = <P,>(config: { label: string; defaultProps: P; render: (props: P) => ReactNode; inline?: boolean; fields?: Record<string, { type: string }> }) => config as unknown as ComponentConfig;

export type RootProps = {
  showHeader?: boolean;
  logoAssetId?: string;
  logoAlt?: string;
  logoHref?: string;
  navLinks?: { label: string; href: string }[];
  showFooter?: boolean;
  footerText?: string;
  footerLinks?: { label: string; href: string }[];
  /** This page's own style tokens (docs/product/LANDING_PAGES.md, "Settings"); absent means the page follows the site's. */
  styleOverride?: unknown;
  /** This page's own favicon (a media asset id; an empty string means none); absent means the page follows the site's. Read by the page's head, not drawn. */
  faviconOverrideAssetId?: string;
};

const LINK_ROW = "px-2 py-1 text-sm underline-offset-4 hover:underline";

/**
 * How a page is framed. A landing page draws its own header and footer from its root fields. A website page draws the site
 * template's instead (docs/product/LANDING_PAGES.md, "Site template"): `site` is the published copy on the public page and the draft
 * in the editor, where `editing` shows each region with a note that it is shared and a link to where it is edited.
 */
export type FrameContext = { pageType: "website" | "landing"; site: SiteTemplate | null; editing?: boolean };
export const DESIGN_HREF = "/admin/pages/design";

/** A fixed region of the editor's canvas that belongs to the whole site: not draggable, not selectable, with where to change it. */
function SiteRegion({ name, empty, children }: { name: "header" | "footer"; empty: boolean; children: ReactNode }) {
  return (
    <div data-site-region={name} className="border-y border-dashed border-accent">
      <div className="pointer-events-none">{empty ? <p className="px-4 py-3 text-center text-sm text-ink-muted">The site {name} is off or empty.</p> : children}</div>
      <p className="bg-tile px-4 py-1 text-center text-xs text-ink-muted">
        Shared by every website page.{" "}
        <a href={DESIGN_HREF} target="_blank" rel="noopener" className="font-medium text-accent-ink underline">
          Edit the {name} in Design
        </a>
      </p>
    </div>
  );
}

/** The frame around every page: an optional header (logo and links), the blocks, an optional footer. Where `@container` lives, so blocks respond to the room they have. */
export function PageFrame({ children, frame, ...root }: RootProps & { children?: ReactNode; frame?: FrameContext }) {
  const logo = pageImage(root.logoAssetId, "event_card");
  const nav = (root.navLinks ?? []).filter((l) => l.label && safeHref(l.href));
  const footerLinks = (root.footerLinks ?? []).filter((l) => l.label && safeHref(l.href));
  // The page's look: the site's style tokens, then this page's own where it has them (src/lib/landing/style.ts). The same for the editor's canvas and a visitor.
  const frameClasses = `@container relative min-h-screen bg-page text-ink ${styleClasses(resolveStyle(frame?.site?.style, root.styleOverride))}`;
  const tools = frame?.editing ? <DesignToolsOverlay /> : null;
  if (frame?.pageType === "website") {
    const site = frame.site ?? EMPTY_SITE_TEMPLATE;
    const header = SiteHeaderView({ header: site.header });
    const footer = SiteFooterView({ footer: site.footer });
    return (
      <div data-lp-frame className={frameClasses}>
        {frame.editing ? (
          <SiteRegion name="header" empty={header === null}>
            {header}
          </SiteRegion>
        ) : (
          header
        )}
        <main>{children}</main>
        {frame.editing ? (
          <SiteRegion name="footer" empty={footer === null}>
            {footer}
          </SiteRegion>
        ) : (
          footer
        )}
        {tools}
      </div>
    );
  }
  return (
    // The page colour (`page`: the brand canvas, or slate in dark mode), light or dark with the theme (the app's dark mode, or the visitor's system setting); never `bg-background`, which is the app's grey.
    // Light bands (`landing-light`) stay light in dark mode.
    <div data-lp-frame className={frameClasses}>
      {root.showHeader && (logo || nav.length > 0) && (
        <header className="bg-card">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-4 py-4 @pair:flex-row @pair:justify-between">
            {logo && (
              <a href={safeHref(root.logoHref) || "/"} className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route */}
                <img src={logo} alt={root.logoAlt || ""} className="h-12 w-auto" />
              </a>
            )}
            {nav.length > 0 && (
              <nav aria-label="Page">
                <ul className="flex flex-wrap justify-center gap-1">
                  {nav.map((l, i) => (
                    <li key={i}>
                      <a href={safeHref(l.href)} className={LINK_ROW}>
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
        </header>
      )}
      <main>{children}</main>
      {root.showFooter && (root.footerText || footerLinks.length > 0) && (
        <footer className="bg-cup px-4 py-6 text-center text-sm text-white">
          {footerLinks.length > 0 && (
            <ul className="mb-2 flex flex-wrap justify-center gap-1">
              {footerLinks.map((l, i) => (
                <li key={i}>
                  <a href={safeHref(l.href)} className={LINK_ROW}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {root.footerText && <p>{root.footerText}</p>}
        </footer>
      )}
      {tools}
    </div>
  );
}

const rootDefaults = { showHeader: false, showFooter: false, navLinks: [], footerLinks: [], footerText: "" };
const rootConfig = { defaultProps: rootDefaults, render: PageFrame };

/** The page's root, framed for its kind of page. Make it once per render (or memoize it): a new component each time remounts the page. */
export function rootConfigFor(frame: FrameContext): Config["root"] {
  return { defaultProps: rootDefaults, render: (props: RootProps & { children?: ReactNode }) => PageFrame({ ...props, frame }) } as unknown as Config["root"];
}

/**
 * Every block the builder offers, from the pages code's own (`core-blocks.ts`) and the installed modules' (`src/modules/index.ts`, the
 * composition root). The editor's config and the public renderer are both built from it, and so are the tables the rest of the
 * pages code reads (`BLOCK_DEFAULTS`, `SLOTS`, `SLOT_ALLOW`, ...).
 */
export const pageBlocks: PageBlockRegistry = createPageBlockRegistry([coreBlocks, ...installedPageBlocks]);

/** The default props of every registered block, typed for the blocks the pages code and the installed modules know at build time. */
export const BLOCK_DEFAULTS = pageBlocks.defaults as unknown as typeof CORE_DEFAULTS & InstalledBlockDefaults;
export const BLOCK_LABELS = pageBlocks.labels as Record<keyof typeof BLOCK_DEFAULTS, string>;

type BlockName = keyof typeof BLOCK_DEFAULTS;

/**
 * The blocks that hold a list of items as a slot of child blocks, with the type each slot takes. The items are blocks of
 * their own (a Finisher card, a week's day), so they drag on the canvas and are edited by clicking them (docs/product/LANDING_PAGES.md,
 * "Blocks with items"). The editor limits the slot to these types (`allow`) and keeps them out of Sections and Columns
 * (`disallow`); the JSON import drops anything else. Derived from the blocks' `slots` in the registry.
 */
export const SLOT_ALLOW = pageBlocks.slotAllow as Partial<Record<BlockName, Record<string, BlockName[]>>>;

/** The item block types: they are in the palette under "Parts of a block" and only make sense inside their parent. */
export const ITEM_BLOCKS = pageBlocks.itemBlocks as BlockName[];

/** The blocks that hold other blocks, and the names of their slots. Everything that walks a page finds nested blocks by their shape, so a new container only needs `slots` in its definition and the editor's fields. */
export const SLOTS = pageBlocks.slots as Partial<Record<BlockName, string[]>>;

type BoxProps = { puck?: { dragRef?: ((el: Element | null) => void) | null; isEditing?: boolean }; span?: unknown; spanMobile?: unknown } & Record<string, unknown>;

/**
 * Every block is drawn inside one box that carries its width on the Section's 12-column grid (`span`, `spanMobile`;
 * src/lib/landing/layout.ts). The box is the grid item on the public page and in the editor alike: the config marks blocks
 * `inline`, so Puck puts no wrapper of its own around them and takes its drag handle from this box (`puck.dragRef`).
 * Outside a Section there is no grid and the classes do nothing.
 */
function boxed(definition: PageBlockDefinition) {
  const Block = definition.render as unknown as ComponentType<Record<string, unknown>>;
  const holdsSlots = Boolean(definition.slots);
  return function BlockBox({ puck, span, spanMobile, ...props }: BoxProps) {
    return (
      <div ref={puck?.dragRef ?? undefined} className={`min-w-0 ${spanClasses(span, spanMobile)}`}>
        <Block {...props} {...(holdsSlots ? { editing: Boolean(puck?.isEditing) } : {})} />
      </div>
    );
  };
}

/**
 * An item block (a Finisher card, a week's day) is its own root element, a list item of its parent's slot, and has no width
 * box: it is not on a Section's grid, its parent lays it out. It takes the drag handle itself (`dragRef`), and is told
 * whether the page is being edited, so an empty one stays visible there and draws nothing on the public page.
 */
function itemBoxed(definition: PageBlockDefinition) {
  const Item = definition.render as unknown as ComponentType<Record<string, unknown>>;
  return function ItemBox({ puck, ...props }: BoxProps) {
    return <Item {...props} dragRef={puck?.dragRef ?? undefined} editing={Boolean(puck?.isEditing)} />;
  };
}

/** The component config of every block in the registry. */
function components(registry: PageBlockRegistry): Config["components"] {
  const out: Config["components"] = {};
  for (const definition of registry.blocks) {
    const slots = Object.keys(definition.slots ?? {});
    out[definition.type] = block({
      label: definition.label,
      // A slot starts empty unless the block's defaults give it items (a freshly added Steps block starts with three steps).
      defaultProps: { ...Object.fromEntries(slots.map((slot) => [slot, []])), ...definition.defaults },
      render: (registry.itemBlocks.includes(definition.type) ? itemBoxed(definition) : boxed(definition)) as (props: unknown) => ReactNode,
      inline: true,
      // A slot must be declared for Puck's Render to turn a container's stored blocks into the component it renders (the editor config declares it too).
      ...(slots.length > 0 ? { fields: Object.fromEntries(slots.map((slot) => [slot, { type: "slot" }])) } : {}),
    });
  }
  return out;
}

/**
 * What the public page renders with: the blocks of `registry` and the page frame, no fields. Built from a registry so a composition
 * without a module (the tests build one) is the same code path as the installed one.
 */
export function buildRenderConfig(registry: PageBlockRegistry): Config & { categories: NonNullable<Config["categories"]> } {
  return {
    components: components(registry),
    root: rootConfig as unknown as Config["root"],
    categories: Object.fromEntries(Object.entries(registry.categories).map(([key, group]) => [key, { title: group.title, components: group.components }])),
  };
}

/** What the public page renders with: blocks and frame, no fields. */
export const renderConfig = buildRenderConfig(pageBlocks);

/** The render config for a page framed as `frame` says (a website page's shared header and footer, or a landing page's own). */
export function renderConfigFor(frame: FrameContext, config: Config = renderConfig): Config {
  return { ...config, root: rootConfigFor(frame) };
}
