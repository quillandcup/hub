import type { ReactNode } from "react";
import ChatText, { type ChatTextContext } from "@/components/chat/ChatText";
import type { BlockImage, BlocksUnfurl, BlockText, CardUnfurl, LinkButton, ShareUnfurl, Unfurl, UnfurlBlock } from "@/lib/chat/unfurls";

/**
 * What Slack gave a message besides its text, drawn as cards: link previews and app cards (legacy attachments) and an
 * app's Block Kit blocks (lib/chat/unfurls.ts parses and sanitizes; nothing here trusts the payload further).
 * Every link opens in a new tab with `noopener noreferrer`; pictures load without sending a referrer.
 */

/**
 * Where other kinds of unfurl plug in. A shared message (`kind: "share"`, a quoted message) is drawn by
 * components/chat/SharedMessageCard.tsx: set `UNFURL_RENDERERS.share` to its renderer. Until then a share draws nothing.
 */
export const UNFURL_RENDERERS: { share?: (unfurl: ShareUnfurl, props: { ctx: ChatTextContext; permalink: string | null }) => ReactNode } = {};

const LINK = "text-plum-600 dark:text-plum-400 hover:underline";
const MUTED = "text-xs text-slate-600 dark:text-slate-400";

function A({ href, children, className = LINK }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-track="chat-unfurl-link" className={className}>
      {children}
    </a>
  );
}

function Picture({ image, className }: { image: BlockImage; className: string }) {
  // Slack's own picture addresses, on other people's servers: no referrer, and the page doesn't wait for them.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={image.url} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" className={className} />;
}

function Mrkdwn({ text, ctx }: { text: string; ctx: ChatTextContext }) {
  return (
    <div className="text-sm">
      <ChatText body={text} ctx={ctx} />
    </div>
  );
}

function Rich({ text, ctx }: { text: BlockText; ctx: ChatTextContext }) {
  return text.mrkdwn ? <Mrkdwn text={text.text} ctx={ctx} /> : <p className="whitespace-pre-wrap break-words text-sm">{text.text}</p>;
}

function Button({ button }: { button: LinkButton }) {
  return (
    <A
      href={button.url}
      className="inline-flex items-center rounded border border-slate-300 dark:border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      {button.label}
    </A>
  );
}

// ---- legacy attachment ---------------------------------------------------------------------------------------------

function Card({ card, ctx }: { card: CardUnfurl; ctx: ChatTextContext }) {
  const site = card.serviceName ?? null;
  return (
    <div className="@container mt-1.5 max-w-2xl">
      {card.pretext && <Mrkdwn text={card.pretext} ctx={ctx} />}
      <div
        className="mt-1 flex gap-3 rounded-r border-l-4 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 py-2 pl-3 pr-3"
        style={card.color ? { borderLeftColor: card.color } : undefined}
        data-testid="unfurl-card"
      >
        <div className="min-w-0 flex-1 space-y-1">
          {(card.authorName || site) && (
            <p className={MUTED}>
              {card.authorName && (card.authorLink ? <A href={card.authorLink}>{card.authorName}</A> : card.authorName)}
              {card.authorName && site && " · "}
              {site && (card.fromUrl ? <A href={card.fromUrl} className="hover:underline">{site}</A> : site)}
            </p>
          )}
          {card.title && (
            <p className="break-words text-sm font-semibold">{card.titleLink ? <A href={card.titleLink}>{card.title}</A> : card.title}</p>
          )}
          {card.text && <Mrkdwn text={card.text} ctx={ctx} />}
          {card.fields.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 @pair:grid-cols-2">
              {card.fields.map((f, i) => (
                <div key={i} className={f.short ? "" : "@pair:col-span-2"}>
                  {f.title && <dt className="text-xs font-semibold">{f.title}</dt>}
                  {f.value && (
                    <dd>
                      <Mrkdwn text={f.value} ctx={ctx} />
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          )}
          {card.imageUrl && <Picture image={{ url: card.imageUrl, alt: card.title ?? "" }} className="mt-1 max-h-72 max-w-full rounded" />}
          {card.footer && <p className={MUTED}>{card.footer}</p>}
        </div>
        {card.thumbUrl && <Picture image={{ url: card.thumbUrl, alt: "" }} className="h-16 w-16 shrink-0 rounded object-cover" />}
      </div>
    </div>
  );
}

// ---- Block Kit -----------------------------------------------------------------------------------------------------

interface BlockProps {
  ctx: ChatTextContext;
  permalink: string | null;
}

type BlockRenderer<T extends UnfurlBlock = UnfurlBlock> = (block: T, props: BlockProps) => ReactNode;

/**
 * One renderer per block type, matching `BLOCK_PARSERS` in lib/chat/unfurls.ts. To draw another Block Kit type, parse it
 * there and add its renderer here; a type with none shows the "Open in Slack" fallback.
 */
export const BLOCK_RENDERERS: { [K in UnfurlBlock["type"]]: BlockRenderer<Extract<UnfurlBlock, { type: K }>> } = {
  header: (b) => <h4 className="break-words text-sm font-bold">{b.text}</h4>,
  section: (b, { ctx }) => (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        {b.text && <Rich text={b.text} ctx={ctx} />}
        {b.fields.length > 0 && (
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 @pair:grid-cols-2">
            {b.fields.map((f, i) => (
              <Rich key={i} text={f} ctx={ctx} />
            ))}
          </div>
        )}
        {b.button && <Button button={b.button} />}
      </div>
      {b.image && <Picture image={b.image} className="h-16 w-16 shrink-0 rounded object-cover" />}
    </div>
  ),
  context: (b, { ctx }) => (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${MUTED}`}>
      {b.items.map((item, i) =>
        item.kind === "image" ? (
          <Picture key={i} image={item.image} className="h-5 w-5 rounded" />
        ) : (
          <Rich key={i} text={item.text} ctx={ctx} />
        )
      )}
    </div>
  ),
  divider: () => <hr className="border-slate-200 dark:border-slate-700" />,
  image: (b) => (
    <figure>
      <Picture image={b.image} className="max-h-72 max-w-full rounded" />
      {b.title && <figcaption className={MUTED}>{b.title}</figcaption>}
    </figure>
  ),
  actions: (b) => (
    <div className="flex flex-wrap gap-2">
      {b.buttons.map((button, i) => (
        <Button key={i} button={button} />
      ))}
    </div>
  ),
  unsupported: (_b, { permalink }) =>
    permalink ? (
      <p className="text-xs">
        <A href={permalink}>Open in Slack</A> <span className="text-slate-600 dark:text-slate-400">to see the rest of this message.</span>
      </p>
    ) : (
      <p className={MUTED}>Part of this message can only be seen in Slack.</p>
    ),
};

function renderBlock(block: UnfurlBlock, key: number, props: BlockProps): ReactNode {
  const render = BLOCK_RENDERERS[block.type] as BlockRenderer | undefined;
  return <div key={key}>{render ? render(block, props) : BLOCK_RENDERERS.unsupported({ type: "unsupported", blockType: block.type }, props)}</div>;
}

function Blocks({ unfurl, ctx, permalink }: { unfurl: BlocksUnfurl } & BlockProps) {
  return (
    <div className="@container mt-1.5 max-w-2xl space-y-2 rounded border border-slate-200 dark:border-slate-700 p-3" data-testid="unfurl-blocks">
      {unfurl.blocks.map((b, i) => renderBlock(b, i, { ctx, permalink }))}
    </div>
  );
}

/** The cards under a message, after its text and files. */
export default function MessageUnfurls({ unfurls, ctx, permalink }: { unfurls: Unfurl[]; ctx: ChatTextContext; permalink: string | null }) {
  if (unfurls.length === 0) return null;
  return (
    <>
      {unfurls.map((u, i) => {
        switch (u.kind) {
          case "card":
            return <Card key={i} card={u} ctx={ctx} />;
          case "blocks":
            return <Blocks key={i} unfurl={u} ctx={ctx} permalink={permalink} />;
          case "share":
            return <div key={i}>{UNFURL_RENDERERS.share?.(u, { ctx, permalink })}</div>;
        }
      })}
    </>
  );
}
