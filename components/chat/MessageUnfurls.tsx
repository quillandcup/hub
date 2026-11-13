import type { ReactNode } from "react";
import RemoveUnfurlButton from "@/components/chat/RemoveUnfurlButton";
import UnfurlPicture from "@/components/chat/UnfurlPicture";
import HubLinkCard from "@/components/chat/HubLinkCard";
import SharedMessageCard from "@/components/chat/SharedMessageCard";
import ChatText, { type ChatTextContext } from "@/components/chat/ChatText";
import type { BlockImage, BlocksUnfurl, BlockText, CardUnfurl, LinkButton, Unfurl, UnfurlBlock } from "@/lib/chat/unfurls";

/**
 * What Slack gave a message besides its text, drawn as cards: link previews and app cards (legacy attachments) and an
 * app's Block Kit blocks (lib/chat/unfurls.ts parses and sanitizes; nothing here trusts the payload further).
 * Every link opens in a new tab with `noopener noreferrer`; pictures load without sending a referrer.
 */

/** Who may remove a card from this message: set only for its author (and not while acting as someone else); the control is the X in the card's corner. */
export interface Removable {
  channelId: string;
  messageId: string;
}

const LINK = "text-plum-600 dark:text-plum-400 hover:underline";
const MUTED = "text-xs text-slate-600 dark:text-slate-400";

function A({ href, children, className = LINK, track = "chat-unfurl-link" }: { href: string; children: ReactNode; className?: string; track?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-track={track} className={className}>
      {children}
    </a>
  );
}

function Picture({ image, className, reserve = false }: { image: BlockImage; className: string; reserve?: boolean }) {
  // Pictures are on other people's servers: no referrer, the page doesn't wait for them, and one that fails shows nothing (UnfurlPicture).
  return <UnfurlPicture src={image.url} alt={image.alt} className={className} reserve={reserve} />;
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

function Card({ card, ctx, removable }: { card: CardUnfurl; ctx: ChatTextContext; removable?: Removable }) {
  const site = card.serviceName ?? null;
  // The previews the Hub made are told apart from Slack's in usage statistics, so we can see whether they are clicked.
  const track = card.hubPreview ? "chat-link-preview" : undefined;
  return (
    <div className="@container mt-1.5 max-w-2xl">
      {card.pretext && <Mrkdwn text={card.pretext} ctx={ctx} />}
      <div
        className="group relative mt-1 flex gap-3 rounded-r border-l-4 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 py-2 pl-3 pr-3"
        style={card.color ? { borderLeftColor: card.color } : undefined}
        data-testid="unfurl-card"
      >
        <div className="min-w-0 flex-1 space-y-1">
          {(card.authorName || site) && (
            <p className={MUTED}>
              {card.authorName && (card.authorLink ? <A href={card.authorLink} track={track}>{card.authorName}</A> : card.authorName)}
              {card.authorName && site && " · "}
              {site && (card.fromUrl ? <A href={card.fromUrl} className="hover:underline" track={track}>{site}</A> : site)}
            </p>
          )}
          {card.title && (
            <p className="break-words text-sm font-semibold">{card.titleLink ? <A href={card.titleLink} track={track}>{card.title}</A> : card.title}</p>
          )}
          {card.text && (card.hubPreview ? <p className="whitespace-pre-wrap break-words text-sm">{card.text}</p> : <Mrkdwn text={card.text} ctx={ctx} />)}
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
          {card.imageUrl &&
            (card.hubPreview && card.titleLink ? (
              // The picture of a preview the Hub made opens the page too; with a title beside it, the title is the link for keyboards and screen readers.
              <UnfurlPicture
                src={card.imageUrl}
                alt=""
                className="max-h-72 max-w-full rounded"
                reserve
                link={{ href: card.titleLink, props: card.title ? { tabIndex: -1, "aria-hidden": true } : { "aria-label": "Open picture" } }}
              />
            ) : (
              <div className="mt-1">
                <Picture image={{ url: card.imageUrl, alt: card.title ?? "" }} className="max-h-72 max-w-full rounded" reserve />
              </div>
            ))}
          {card.footer && <p className={MUTED}>{card.footer}</p>}
        </div>
        {card.thumbUrl && <Picture image={{ url: card.thumbUrl, alt: "" }} className="h-16 w-16 shrink-0 rounded object-cover" />}
        {removable && card.removeKey && <RemoveUnfurlButton channelId={removable.channelId} messageId={removable.messageId} removeKey={card.removeKey} source={card.hubPreview ? "hub" : "slack"} />}
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
export default function MessageUnfurls({ unfurls, ctx, permalink, removable, timeZone }: { unfurls: Unfurl[]; ctx: ChatTextContext; permalink: string | null; removable?: Removable; timeZone?: string }) {
  if (unfurls.length === 0) return null;
  return (
    <>
      {unfurls.map((u, i) => {
        switch (u.kind) {
          case "card":
            return <Card key={i} card={u} ctx={ctx} removable={removable} />;
          case "blocks":
            return <Blocks key={i} unfurl={u} ctx={ctx} permalink={permalink} />;
          case "hub":
            return <HubLinkCard key={i} unfurl={u} timeZone={timeZone} removable={removable} />;
          case "share":
            return u.shared && u.source ? <SharedMessageCard key={i} shared={u.shared} source={u.source} ctx={ctx} timeZone={timeZone} removable={removable && u.removeKey ? { ...removable, removeKey: u.removeKey } : undefined} /> : null;
        }
      })}
    </>
  );
}
