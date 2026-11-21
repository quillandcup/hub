import type { ReactNode } from "react";
import { safeHref } from "@/lib/landing/data";
import { SIGN_IN_HREF, SOCIAL_NETWORKS, type HeaderItem, type ItemShow, type SiteFooter, type SiteHeader, type SiteSocialLink } from "@/lib/landing/site-template";
import { buttonClasses } from "./blocks";
import { pageImage } from "./theme";

/**
 * The shared header and footer of the website pages (docs/product/LANDING_PAGES.md, "Site template"), drawn from the site template.
 * Server-safe: no state and no script (the folding menu is a native `details`), so the public page stays static markup.
 * Everything responds to the room the page has (the `split` container size, set by `PageFrame`'s `@container`), never to the
 * viewport, so the editor's phone preview shows what a phone shows.
 */

const LINK = "px-2 py-1 text-sm underline-offset-4 hover:underline";
const LIST = "flex flex-wrap items-center gap-1";

/** Which sizes an item is on: a wide header only (`desktop`), a narrow one only (`mobile`), or both. Hidden items take no room. */
const SHOW: Record<ItemShow, string> = { both: "", desktop: "hidden @split:block", mobile: "@split:hidden" };

const networkLabel = (value: string) => SOCIAL_NETWORKS.find((n) => n.value === value)?.label ?? value;

function SocialLinks({ links, label }: { links: SiteSocialLink[]; label: string }) {
  const shown = links.filter((l) => safeHref(l.href));
  if (shown.length === 0) return null;
  return (
    <ul className={LIST} aria-label={label}>
      {shown.map((l, i) => (
        <li key={i}>
          <a href={safeHref(l.href)} className={LINK} rel="noopener">
            {networkLabel(l.network)}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Menu({ links, fold }: { links: { label: string; href: string }[]; fold: boolean }) {
  const shown = links.filter((l) => l.label && safeHref(l.href));
  if (shown.length === 0) return null;
  const list = (
    <ul className={fold ? "flex flex-wrap items-center gap-1" : LIST}>
      {shown.map((l, i) => (
        <li key={i}>
          <a href={safeHref(l.href)} className={LINK}>
            {l.label}
          </a>
        </li>
      ))}
    </ul>
  );
  if (!fold) return <nav aria-label="Site">{list}</nav>;
  return (
    <nav aria-label="Site">
      <div className="hidden @split:block">{list}</div>
      <details className="@split:hidden">
        <summary className="cursor-pointer list-none rounded px-2 py-1 text-sm font-medium hover:underline">Menu</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {shown.map((l, i) => (
            <li key={i}>
              <a href={safeHref(l.href)} className={`${LINK} block`}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}

function Item({ item, fold }: { item: HeaderItem; fold: boolean }): ReactNode {
  switch (item.type) {
    case "logo": {
      const src = pageImage(item.logoAssetId, "event_card");
      if (!src) return null;
      return (
        <a href={safeHref(item.href) || "/"} className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route */}
          <img src={src} alt={item.alt} className="h-12 w-auto" />
        </a>
      );
    }
    case "menu":
      return <Menu links={item.links} fold={fold} />;
    case "cta": {
      const href = safeHref(item.href);
      if (!item.label || !href) return null;
      return (
        <a href={href} className={`${buttonClasses(item.look, "plum", "pill", false)} !px-4 !py-2 !text-sm`}>
          {item.label}
        </a>
      );
    }
    case "social":
      return <SocialLinks links={item.links} label="Social links" />;
    case "signin":
      if (!item.label) return null;
      return item.look === "link" ? (
        <a href={SIGN_IN_HREF} className={LINK}>
          {item.label}
        </a>
      ) : (
        <a href={SIGN_IN_HREF} className={`${buttonClasses(item.look, "plum", "pill", false)} !px-4 !py-2 !text-sm`}>
          {item.label}
        </a>
      );
  }
}

const ALIGN = { spread: "justify-between", start: "justify-start", center: "justify-center" } as const;

/** The site header: its blocks in order, the logos first on the start side and the rest at the far end (`spread`), together at the start, or centred. Null when it is off or holds nothing a visitor would see. */
export function SiteHeaderView({ header }: { header: SiteHeader }) {
  if (!header.show || header.items.length === 0) return null;
  const fold = header.mobileMenu === "fold";
  const cell = (item: HeaderItem) => (
    <div key={item.id} className={`${SHOW[item.show]} flex items-center`}>
      <Item item={item} fold={fold} />
    </div>
  );
  const logos = header.items.filter((i) => i.type === "logo");
  const rest = header.items.filter((i) => i.type !== "logo");
  return (
    <header className="bg-card">
      <div className={`mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 ${ALIGN[header.align]}`}>
        {header.align === "spread" ? (
          <>
            <div className="flex items-center gap-3">{logos.map(cell)}</div>
            <div className="flex flex-wrap items-center gap-3">{rest.map(cell)}</div>
          </>
        ) : (
          header.items.map(cell)
        )}
      </div>
    </header>
  );
}

/** The site footer: social links, links and a line of text, centred. Null when it is off or empty. */
export function SiteFooterView({ footer }: { footer: SiteFooter }) {
  const links = footer.links.filter((l) => l.label && safeHref(l.href));
  const hasSocial = footer.social.some((l) => safeHref(l.href));
  if (!footer.show || (!footer.text && links.length === 0 && !hasSocial)) return null;
  return (
    <footer className="bg-cup px-4 py-6 text-center text-sm text-white">
      {links.length > 0 && (
        <ul className="mb-2 flex flex-wrap justify-center gap-1">
          {links.map((l, i) => (
            <li key={i}>
              <a href={safeHref(l.href)} className={LINK}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      {hasSocial && (
        <div className="mb-2 flex justify-center">
          <SocialLinks links={footer.social} label="Social links" />
        </div>
      )}
      {footer.text && <p>{footer.text}</p>}
    </footer>
  );
}
