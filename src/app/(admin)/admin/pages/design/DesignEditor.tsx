"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import LifecycleButton from "@/components/LifecycleButton";
import MediaPicker from "@/components/media/MediaPicker";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip";
import { FaviconField, StyleFields } from "@/components/landing/style-fields";
import { SOCIAL_LOOK_OPTIONS } from "@/components/landing/social-networks";
import { SiteFooterView, SiteHeaderView } from "@/components/landing/site-frame";
import PlaceholderTextField from "@/components/landing/PlaceholderTextField";
import { FOOTER_TEXT_PLACEHOLDERS } from "@/lib/landing/placeholders";
import {
  HEADER_ALIGNMENTS,
  HEADER_ITEM_TYPES,
  ITEM_SHOWS,
  MOBILE_MENUS,
  SITE_ITEMS_MAX,
  SITE_LINKS_MAX,
  SOCIAL_NETWORKS,
  newHeaderItem,
  type HeaderItem,
  type HeaderItemType,
  type SiteLink,
  type SiteSocialLink,
  type SiteSocialLook,
  type SiteTemplate,
} from "@/lib/landing/site-template";
import type { SiteVersionSummary } from "@/lib/landing/site-versions";
import { styleClasses } from "@/lib/landing/style";
import { publishSiteTemplate, resetSiteDraft, restoreSiteVersion, saveSiteDraft } from "./actions";

const INPUT = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const BUTTON = "rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100`;
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700`;
const SMALL = "rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800";
const SAVE_DELAY_MS = 800;

type SaveState = "saved" | "unsaved" | "saving" | "error";

const SHOW_LABELS = { both: "On every size", desktop: "Only when there is room (wide)", mobile: "Only when it is narrow" } as const;
const ALIGN_LABELS = { spread: "Logo at the start, the rest at the far end", start: "Everything at the start", center: "Everything centred" } as const;
const MOBILE_LABELS = { fold: "Fold the menu into a Menu button", wrap: "Show the links, wrapping onto more lines" } as const;

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-ink-muted">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function LinkRows({ links, onChange, noun }: { links: SiteLink[]; onChange: (next: SiteLink[]) => void; noun: string }) {
  const set = (i: number, patch: Partial<SiteLink>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className="min-w-32 flex-1 text-xs font-medium">
            Label
            <input value={l.label} onChange={(e) => set(i, { label: e.target.value })} className={INPUT} />
          </label>
          <label className="min-w-40 flex-1 text-xs font-medium">
            Link (https://, or a path on this site)
            <input value={l.href} onChange={(e) => set(i, { href: e.target.value })} className={INPUT} />
          </label>
          <button type="button" className={SMALL} onClick={() => onChange(links.filter((_, j) => j !== i))} aria-label={`Remove ${noun} ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className={SMALL} disabled={links.length >= SITE_LINKS_MAX} onClick={() => onChange([...links, { label: "", href: "" }])}>
        Add a {noun}
      </button>
    </div>
  );
}

/** How the social marks look (the Social icons block's `look`): the networks' own colours on a light badge, or their black or white version. */
function SocialLookField({ value, onChange }: { value: SiteSocialLook; onChange: (next: SiteSocialLook) => void }) {
  return (
    <Field label="Marks">
      <select value={value} onChange={(e) => onChange(e.target.value as SiteSocialLook)} className={INPUT}>
        {SOCIAL_LOOK_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function SocialRows({ links, onChange }: { links: SiteSocialLink[]; onChange: (next: SiteSocialLink[]) => void }) {
  const set = (i: number, patch: Partial<SiteSocialLink>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium">
            Network
            <select value={l.network} onChange={(e) => set(i, { network: e.target.value as SiteSocialLink["network"] })} className={INPUT}>
              {SOCIAL_NETWORKS.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-40 flex-1 text-xs font-medium">
            Link to your profile
            <input value={l.href} onChange={(e) => set(i, { href: e.target.value })} className={INPUT} />
          </label>
          <button type="button" className={SMALL} onClick={() => onChange(links.filter((_, j) => j !== i))} aria-label={`Remove social link ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className={SMALL} disabled={links.length >= SITE_LINKS_MAX} onClick={() => onChange([...links, { network: "instagram", href: "" }])}>
        Add a social link
      </button>
    </div>
  );
}

function ItemFields({ item, onChange }: { item: HeaderItem; onChange: (next: HeaderItem) => void }) {
  switch (item.type) {
    case "logo":
      return (
        <div className="space-y-3">
          <div className="text-sm font-medium">
            Logo
            <div className="mt-1">
              <MediaPicker value={item.logoAssetId || null} onChange={(id) => onChange({ ...item, logoAssetId: id ?? "" })} surface="landing_page" preview="event_card" noun="logo" />
            </div>
          </div>
          <div className="text-sm font-medium">
            Logo for dark mode (optional)
            <p className="text-xs font-normal text-slate-600 dark:text-slate-400">Light lettering for the dark header. Without one, the logo above is used in both.</p>
            <div className="mt-1">
              <MediaPicker value={item.darkLogoAssetId || null} onChange={(id) => onChange({ ...item, darkLogoAssetId: id ?? "" })} surface="landing_page" preview="event_card" noun="dark-mode logo" />
            </div>
          </div>
          <Field label="What the logo says (for people who can't see it)">
            <input value={item.alt} onChange={(e) => onChange({ ...item, alt: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Where the logo links to">
            <input value={item.href} onChange={(e) => onChange({ ...item, href: e.target.value })} className={INPUT} />
          </Field>
        </div>
      );
    case "menu":
      return <LinkRows links={item.links} onChange={(links) => onChange({ ...item, links })} noun="menu link" />;
    case "cta":
      return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
          <Field label="Button label">
            <input value={item.label} onChange={(e) => onChange({ ...item, label: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Link">
            <input value={item.href} onChange={(e) => onChange({ ...item, href: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Look">
            <select value={item.look} onChange={(e) => onChange({ ...item, look: e.target.value as "inherit" | "solid" | "outline" })} className={INPUT}>
              <option value="inherit">Same as the site&apos;s buttons</option>
              <option value="solid">Solid</option>
              <option value="outline">Outline</option>
            </select>
          </Field>
        </div>
      );
    case "social":
      return (
        <div className="space-y-3">
          <SocialRows links={item.links} onChange={(links) => onChange({ ...item, links })} />
          <SocialLookField value={item.look} onChange={(look) => onChange({ ...item, look })} />
        </div>
      );
    case "signin":
      return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
          <Field label="Label">
            <input value={item.label} onChange={(e) => onChange({ ...item, label: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Look">
            <select value={item.look} onChange={(e) => onChange({ ...item, look: e.target.value as "link" | "inherit" | "solid" | "outline" })} className={INPUT}>
              <option value="link">A plain link</option>
              <option value="inherit">Button, as the site&apos;s buttons</option>
              <option value="solid">Solid button</option>
              <option value="outline">Outline button</option>
            </select>
          </Field>
          <p className="text-xs text-slate-600 dark:text-slate-400 col-span-full">It goes to the member sign-in page. It doesn&apos;t show whether someone is already signed in.</p>
        </div>
      );
  }
}

/** The versions kept at each publish, newest first. Bringing one back asks first (the registry's confirmation) and only changes the draft. */
function SiteVersionList({ versions, disabled, onRestore }: { versions: SiteVersionSummary[]; disabled: boolean; onRestore: (id: string) => void }) {
  if (versions.length === 0) return <p className="text-sm">Each time you publish the site design, that version is kept here. Nothing has been published yet.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm">Bringing a version back puts it in your draft. It doesn&apos;t go live until you publish the site design.</p>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {versions.map((v, i) => (
          <li key={v.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              {i === 0 ? "Latest publish" : "Published"}
              <time dateTime={v.createdAt} className="block text-xs text-slate-600 dark:text-slate-400">
                By {v.by}, {new Date(v.createdAt).toLocaleString()}
              </time>
            </span>
            <LifecycleButton action="restore" noun="version" disabled={disabled} className={SECONDARY} onRun={() => onRestore(v.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The site-wide Design view: the header and footer every website page shares (docs/product/LANDING_PAGES.md, "Site template").
 * Edits autosave to a draft; nothing changes for a visitor until "Publish site design", which puts the draft on every
 * published website page at once. The preview below the form is the draft, laid out at the width of this panel.
 */
export default function DesignEditor({
  initial,
  publishedAt: initialPublishedAt,
  hasPublished,
  unpublished,
  versions: initialVersions = [],
}: {
  initial: SiteTemplate;
  publishedAt: string | null;
  hasPublished: boolean;
  unpublished: boolean;
  versions?: SiteVersionSummary[];
}) {
  const [site, setSite] = useState(initial);
  const [save, setSave] = useState<SaveState>("saved");
  const [publishedAt, setPublishedAt] = useState(initialPublishedAt);
  const [published, setPublished] = useState(hasPublished);
  const [dirty, setDirty] = useState(unpublished);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [versions, setVersions] = useState(initialVersions);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, start] = useTransition();
  const latest = useRef(site);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  async function flush(): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSave("saving");
    const result = await saveSiteDraft(latest.current);
    setSave(result.error ? "error" : "saved");
    return !result.error;
  }

  useEffect(() => {
    latest.current = site;
    if (first.current) {
      first.current = false;
      return;
    }
    setSave("unsaved");
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [site]);

  const setHeader = (patch: Partial<SiteTemplate["header"]>) => setSite((s) => ({ ...s, header: { ...s.header, ...patch } }));
  const setFooter = (patch: Partial<SiteTemplate["footer"]>) => setSite((s) => ({ ...s, footer: { ...s.footer, ...patch } }));
  const setItem = (i: number, next: HeaderItem) => setHeader({ items: site.header.items.map((it, j) => (j === i ? next : it)) });
  const move = (i: number, by: -1 | 1) => {
    const items = [...site.header.items];
    [items[i], items[i + by]] = [items[i + by], items[i]];
    setHeader({ items });
  };

  function publish() {
    setMessage(null);
    setIssues([]);
    start(async () => {
      const result = await publishSiteTemplate(latest.current);
      if (result.error) {
        setMessage(result.error);
        setIssues(result.issues ?? []);
        return;
      }
      setPublished(true);
      setDirty(false);
      setPublishedAt(result.publishedAt ?? null);
      if (result.versions) setVersions(result.versions);
      setSave("saved");
      setMessage("Published. Every published website page now shows this header, footer and style.");
    });
  }

  function reset() {
    setMessage(null);
    start(async () => {
      const result = await resetSiteDraft();
      if (result.error || !result.site) return setMessage(result.error ?? "Couldn't reset the draft.");
      first.current = true;
      setSite(result.site);
      setDirty(false);
      setSave("saved");
    });
  }

  /** Brings a version into the draft (never publishes). The editor takes the restored document, and says whether it still differs from what is live. */
  function restore(versionId: string) {
    setMessage(null);
    start(async () => {
      const result = await restoreSiteVersion(versionId);
      if (result.error || !result.site) return setMessage(result.error ?? "Couldn't bring that version back.");
      if (timer.current) clearTimeout(timer.current);
      first.current = true;
      setSite(result.site);
      setDirty(result.unpublished ?? true);
      setSave("saved");
      setHistoryOpen(false);
      setMessage("Brought back into your draft. Visitors see it only after you publish the site design.");
    });
  }

  const addable = HEADER_ITEM_TYPES.filter(() => site.header.items.length < SITE_ITEMS_MAX);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-4 shadow dark:bg-slate-900">
        <p className="max-w-2xl text-sm text-slate-700 dark:text-slate-300">
          The style, favicon, header and footer below are <strong>shared by every website page</strong>. Changes save to a draft as you type. Visitors see them only after you publish, and publishing changes every published website page at once.
          {publishedAt ? ` Last published ${new Date(publishedAt).toLocaleString()}.` : " Not published yet: website pages have no header, footer or site style on the public site."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-sm text-slate-600 dark:text-slate-400">
            {save === "saving" ? "Saving…" : save === "unsaved" ? "Unsaved changes" : save === "error" ? "Couldn't save. Trying again on your next change." : dirty ? "Draft saved, not published" : "Saved"}
          </span>
          <LifecycleButton action="history" noun="site design" onRun={() => setHistoryOpen(true)} className={SECONDARY} />
          {published && (
            <LifecycleButton action="reset" noun="site design" onRun={reset} disabled={pending || !dirty} className={SECONDARY} />
          )}
          <LifecycleButton action="publish" noun="site design" label="Publish site design" onRun={publish} disabled={pending} className={PRIMARY} />
        </div>
      </div>
      <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title="Version history" maxWidth="lg">
        <SiteVersionList versions={versions} disabled={pending} onRestore={restore} />
      </Modal>
      {message && (
        <div role="alert" className="rounded border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
          <p>{message}</p>
          {issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-700 dark:text-red-400">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section aria-labelledby="design-style" className="space-y-4 rounded-lg bg-white p-4 shadow dark:bg-slate-900">
        <h2 id="design-style" className="text-lg font-semibold">
          Style guide
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">Used by every website page, and by every landing page that doesn&apos;t have its own style.</p>
        <StyleFields value={site.style} onChange={(key, next) => setSite((s) => ({ ...s, style: { ...s.style, [key]: next } }))} />
      </section>

      <section aria-labelledby="design-favicon" className="space-y-4 rounded-lg bg-white p-4 shadow dark:bg-slate-900">
        <h2 id="design-favicon" className="text-lg font-semibold">
          Favicon
        </h2>
        <FaviconField value={site.favicon.assetId} onChange={(assetId) => setSite((s) => ({ ...s, favicon: { assetId } }))} />
      </section>

      <section aria-labelledby="design-header" className="space-y-4 rounded-lg bg-white p-4 shadow dark:bg-slate-900">
        <h2 id="design-header" className="text-lg font-semibold">
          Header
        </h2>
        <Toggle label="Show a header on website pages" checked={site.header.show} onChange={(show) => setHeader({ show })} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
          <Field label="Layout">
            <select value={site.header.align} onChange={(e) => setHeader({ align: e.target.value as SiteTemplate["header"]["align"] })} className={INPUT}>
              {HEADER_ALIGNMENTS.map((a) => (
                <option key={a} value={a}>
                  {ALIGN_LABELS[a]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="When the page is narrow, such as on a phone">
            <select value={site.header.mobileMenu} onChange={(e) => setHeader({ mobileMenu: e.target.value as SiteTemplate["header"]["mobileMenu"] })} className={INPUT}>
              {MOBILE_MENUS.map((m) => (
                <option key={m} value={m}>
                  {MOBILE_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ol className="space-y-3">
          {site.header.items.map((item, i) => (
            <li key={item.id} className="rounded border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{HEADER_ITEM_TYPES.find((t) => t.value === item.type)?.label}</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-medium">
                    <span className="sr-only">Shown on which sizes: {item.type}</span>
                    <select value={item.show} onChange={(e) => setItem(i, { ...item, show: e.target.value as HeaderItem["show"] })} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
                      {ITEM_SHOWS.map((s) => (
                        <option key={s} value={s}>
                          {SHOW_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className={SMALL} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${item.type} up`}>
                    Up
                  </button>
                  <button type="button" className={SMALL} disabled={i === site.header.items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${item.type} down`}>
                    Down
                  </button>
                  <button type="button" className={SMALL} onClick={() => setHeader({ items: site.header.items.filter((_, j) => j !== i) })} aria-label={`Remove ${item.type}`}>
                    Remove
                  </button>
                </div>
              </div>
              <ItemFields item={item} onChange={(next) => setItem(i, next)} />
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Add to the header">
          {addable.map((t) => (
            <Tooltip key={t.value} content={t.hint}>
              <button type="button" className={SECONDARY} onClick={() => setHeader({ items: [...site.header.items, newHeaderItem(t.value as HeaderItemType)] })}>
                Add {t.label.toLowerCase()}
              </button>
            </Tooltip>
          ))}
        </div>
      </section>

      <section aria-labelledby="design-footer" className="space-y-4 rounded-lg bg-white p-4 shadow dark:bg-slate-900">
        <h2 id="design-footer" className="text-lg font-semibold">
          Footer
        </h2>
        <Toggle label="Show a footer on website pages" checked={site.footer.show} onChange={(show) => setFooter({ show })} />
        <div className="block text-sm font-medium">
          Text (for example, a copyright line)
          <PlaceholderTextField label="Text (for example, a copyright line)" value={site.footer.text} onChange={(text) => setFooter({ text })} placeholders={FOOTER_TEXT_PLACEHOLDERS} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Links</h3>
          <LinkRows links={site.footer.links} onChange={(links) => setFooter({ links })} noun="footer link" />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Social links</h3>
          <SocialRows links={site.footer.social} onChange={(social) => setFooter({ social })} />
          <div className="mt-3">
            <SocialLookField value={site.footer.socialLook} onChange={(socialLook) => setFooter({ socialLook })} />
          </div>
        </div>
      </section>

      <section aria-labelledby="design-preview" className="space-y-2">
        <h2 id="design-preview" className="text-lg font-semibold">
          Preview of the draft
        </h2>
        <div className={`@container overflow-hidden rounded-lg border border-slate-200 bg-page text-ink dark:border-slate-700 ${styleClasses(site.style)}`}>
          {SiteHeaderView({ header: site.header }) ?? <p className="px-4 py-3 text-sm text-ink-muted">No header: it is off or has nothing to show.</p>}
          <div className="px-4 py-10 text-center text-sm text-ink-muted">The page&apos;s own content goes here.</div>
          {SiteFooterView({ footer: site.footer }) ?? <p className="px-4 py-3 text-sm text-ink-muted">No footer: it is off or has nothing to show.</p>}
        </div>
      </section>
    </div>
  );
}
