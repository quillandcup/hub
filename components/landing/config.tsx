import type { ComponentConfig, Config } from "@puckeditor/core";
import type { ReactNode } from "react";
import { safeHref } from "@/lib/landing/data";
import {
  Button,
  CardGrid,
  CountdownBlock,
  CtaBanner,
  Divider,
  Faq,
  Heading,
  Hero,
  Image,
  LinkList,
  List,
  OptInFormBlock,
  RichText,
  Section,
  Spacer,
  Split,
  Stats,
  Steps,
  Testimonials,
  Video,
} from "./blocks";
import { pageImage } from "./theme";

/**
 * The block set and the page frame, with no editor-only parts: the public page renders `data` through this (on the
 * server), and the editor builds its own config from it by adding each block's fields (editor-config.tsx). A new
 * block is: a component in blocks.tsx, an entry here with its default props, and its fields in editor-config.tsx.
 * See docs/LANDING_PAGES.md, "Adding a block".
 */

// Puck types each component's props from its config; our blocks are plain components, so they are registered loosely.
const block = <P,>(config: { label: string; defaultProps: P; render: (props: P) => ReactNode }) => config as unknown as ComponentConfig;

export type RootProps = {
  showHeader?: boolean;
  logoAssetId?: string;
  logoAlt?: string;
  logoHref?: string;
  navLinks?: { label: string; href: string }[];
  showFooter?: boolean;
  footerText?: string;
  footerLinks?: { label: string; href: string }[];
};

const LINK_ROW = "px-2 py-1 text-sm underline-offset-4 hover:underline";

/** The frame around every page: an optional header (logo and links), the blocks, an optional footer. Where `@container` lives, so blocks respond to the room they have. */
export function PageFrame({ children, ...root }: RootProps & { children?: ReactNode }) {
  const logo = pageImage(root.logoAssetId, "event_card");
  const nav = (root.navLinks ?? []).filter((l) => l.label && safeHref(l.href));
  const footerLinks = (root.footerLinks ?? []).filter((l) => l.label && safeHref(l.href));
  return (
    <div className="@container min-h-screen bg-background text-slate-900">
      {root.showHeader && (logo || nav.length > 0) && (
        <header className="bg-white">
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
    </div>
  );
}

const rootConfig = {
  defaultProps: { showHeader: false, showFooter: false, navLinks: [], footerLinks: [], footerText: "" },
  render: PageFrame,
};

export const BLOCK_DEFAULTS = {
  Section: { background: "none", overlay: "none", width: "wide", padding: "medium", align: "left", card: false, fadeIn: false },
  RichText: { html: "<p>Write something here.</p>", align: "left" },
  Heading: { text: "A heading", level: "h2", align: "center" },
  Button: { label: "Join us", href: "", look: "solid", color: "plum", shape: "pill", align: "center", full: false },
  Image: { alt: "", decorative: false, size: "medium", rounded: true, align: "center" },
  Split: { alt: "", decorative: false, imageSide: "left", html: "<h2>A heading</h2><p>Tell the story next to the picture.</p>" },
  List: { items: [{ text: "First thing", icon: "✓" }, { text: "Second thing", icon: "✓" }], align: "left" },
  Testimonials: { items: [{ quote: "What a difference this made.", name: "A member", detail: "Member since 2024" }] },
  Faq: { items: [{ question: "A question?", answer: "The answer." }] },
  Countdown: { targetAt: "", heading: "Starts in", whenExpired: "message", expiredMessage: "It has started." },
  CardGrid: { columns: "3", items: [{ alt: "", title: "A title", price: "$20", buttonLabel: "Buy now", href: "" }] },
  LinkList: { items: [{ label: "A link", href: "" }], look: "solid", color: "plum" },
  Divider: { look: "short" },
  Spacer: { size: "medium" },
  Video: { url: "", title: "" },
  Hero: { headline: "A headline that says what you offer", level: "h1", subhead: "One or two lines that say who it is for and why it helps.", primary: { label: "Join us", href: "" }, secondary: { label: "", href: "" }, alt: "", decorative: false, imageMode: "background", overlay: "dark", background: "plum", align: "center" },
  Steps: { heading: "How it works", items: [{ title: "Sign up", text: "Tell us a little about you." }, { title: "Join in", text: "Come to your first session." }, { title: "Keep going", text: "Write a little each day." }] },
  Stats: { items: [{ value: "1,000", label: "words written a day" }, { value: "24/7", label: "company" }, { value: "3", label: "sessions a week" }] },
  CtaBanner: { heading: "Ready to start?", text: "", label: "Join us", href: "", background: "plum", align: "center" },
  OptInForm: { kajabiFormId: "", instagramField: "none", buttonLabel: "Sign me up", reassurance: "No spam. Unsubscribe any time.", successMessage: "Thank you! Please check your email.", href: "", look: "solid", color: "plum", shape: "pill" },
} as const;

export const BLOCK_LABELS: Record<keyof typeof BLOCK_DEFAULTS, string> = {
  Section: "Section",
  RichText: "Text",
  Heading: "Heading",
  Button: "Button",
  Image: "Image",
  Split: "Image and text",
  List: "List",
  Testimonials: "Testimonials",
  Faq: "FAQ",
  Countdown: "Countdown",
  CardGrid: "Card grid",
  LinkList: "Link list",
  Divider: "Divider",
  Spacer: "Spacer",
  Video: "Video",
  OptInForm: "Sign-up form",
  Hero: "Hero",
  Steps: "Steps",
  Stats: "Stats",
  CtaBanner: "Call-to-action banner",
};

const RENDERERS: Record<keyof typeof BLOCK_DEFAULTS, (props: never) => ReactNode> = {
  Section: Section as never,
  RichText: RichText as never,
  Heading: Heading as never,
  Button: Button as never,
  Image: Image as never,
  Split: Split as never,
  List: List as never,
  Testimonials: Testimonials as never,
  Faq: Faq as never,
  Countdown: CountdownBlock as never,
  CardGrid: CardGrid as never,
  LinkList: LinkList as never,
  Divider: Divider as never,
  Spacer: Spacer as never,
  Video: Video as never,
  OptInForm: OptInFormBlock as never,
  Hero: Hero as never,
  Steps: Steps as never,
  Stats: Stats as never,
  CtaBanner: CtaBanner as never,
};

const SECTION_DEFAULTS = { ...BLOCK_DEFAULTS.Section, content: [] };

function components(): Config["components"] {
  const out: Config["components"] = {};
  for (const name of Object.keys(BLOCK_DEFAULTS) as (keyof typeof BLOCK_DEFAULTS)[]) {
    out[name] = block({
      label: BLOCK_LABELS[name],
      defaultProps: name === "Section" ? SECTION_DEFAULTS : { ...BLOCK_DEFAULTS[name] },
      render: RENDERERS[name] as (props: unknown) => ReactNode,
    });
  }
  return out;
}

/** What the public page renders with: blocks and frame, no fields. */
export const renderConfig = {
  components: components(),
  root: rootConfig as unknown as Config["root"],
  categories: {
    layout: { title: "Layout", components: ["Section", "Split", "CardGrid", "Divider", "Spacer"] },
    ready_made: { title: "Ready-made", components: ["Hero", "Steps", "Stats", "CtaBanner"] },
    content: { title: "Content", components: ["Heading", "RichText", "List", "Image", "Video", "Testimonials", "Faq", "Countdown"] },
    links: { title: "Links", components: ["Button", "LinkList", "OptInForm"] },
  },
} satisfies Config;
