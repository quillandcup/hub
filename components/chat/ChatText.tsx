import EmojiImage from "@/components/EmojiImage";
import Link from "next/link";
import type { ReactNode } from "react";
import MemberHoverCard from "@/components/member/MemberHoverCard";
import { isEmojiOnly } from "@/lib/chat/emoji-only";
import { emojiNamesIn, listMarker, parseSlackText, type Block, type Inline } from "@/lib/chat/render";
import { unicodeEmoji, type CustomEmoji } from "@/lib/chat/emoji";
import { baseName, toneOf, tonedUnicode } from "@/lib/chat/skin-tone";

export interface ChatTextContext {
  /** Slack user id -> display name, for <@U123> mentions. */
  userNames: Record<string, string>;
  /** Slack user id -> Hub member id, so a mention of a matched person links to their profile. */
  userMembers: Record<string, string>;
  /** Slack user id -> Hub name, for the people named in notices; otherwise `userNames` is what a mention shows. */
  hubNames?: Record<string, string>;
  /** Slack channel id -> Hub chat channel id, for <#C123> links to channels we mirror. */
  channelIds: Record<string, string>;
  /** Slack channel id -> channel name; the text's own label is often just "channel". */
  channelNames: Record<string, string>;
  /** Custom emoji used on the page, by shortcode (see customEmojiFor). */
  customEmoji: Record<string, CustomEmoji>;
}

/** A Slack emoji: the workspace's custom image, else the Unicode emoji, else the :shortcode: as typed. */
export function Emoji({ name, custom }: { name: string; custom: Record<string, CustomEmoji> }) {
  const key = baseName(name);
  const tone = toneOf(name);
  const c = custom[key];
  if (c && "url" in c) {
    return <EmojiImage name={key} url={c.url} still={c.still} stored={c.stored} />;
  }
  const text = c?.text ?? unicodeEmoji(key);
  return <span title={`:${key}:`}>{text ? (tone && !c ? tonedUnicode(text, tone) : text) : `:${name}:`}</span>;
}

/** Links stand out from the text: a lighter plum on dark backgrounds, medium weight, underlined. */
const LINK_CLASS =
  "font-medium text-plum-700 dark:text-plum-300 underline decoration-plum-400/60 underline-offset-2 hover:decoration-current";
/** Mentions and channel links get Slack's tinted chip. */
const CHIP_CLASS = "rounded bg-plum-50 dark:bg-plum-900/30 px-1 text-plum-700 dark:text-plum-300";

function renderInline(nodes: Inline[], ctx: ChatTextContext): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "bold":
        return <strong key={i}>{renderInline(n.c, ctx)}</strong>;
      case "italic":
        return <em key={i}>{renderInline(n.c, ctx)}</em>;
      case "strike":
        return <s key={i}>{renderInline(n.c, ctx)}</s>;
      case "underline":
        return <u key={i}>{renderInline(n.c, ctx)}</u>;
      case "code":
        return (
          <code key={i} className="px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 font-mono text-[0.9em] text-red-700 dark:text-red-400">
            {n.v}
          </code>
        );
      case "link":
        return (
          <a data-track="chat-link"
            key={i}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            {n.label}
          </a>
        );
      case "user": {
        const label = `@${ctx.userNames[n.id] ?? "someone"}`;
        const memberId = ctx.userMembers[n.id];
        return memberId ? (
          <MemberHoverCard key={i} memberId={memberId} surface="chat">
            <Link href={`/members/${memberId}`} data-track="chat-mention" className={`${CHIP_CLASS} ${LINK_CLASS} no-underline hover:underline`}>
              {label}
            </Link>
          </MemberHoverCard>
        ) : (
          <span key={i} className={CHIP_CLASS}>
            {label}
          </span>
        );
      }
      case "channel": {
        const hubId = ctx.channelIds[n.id];
        const label = `#${ctx.channelNames[n.id] ?? n.label ?? "channel"}`;
        return hubId ? (
          <Link key={i} href={`/chat/${hubId}`} data-track="chat-channel-mention" className={`${CHIP_CLASS} ${LINK_CLASS} no-underline hover:underline`}>
            {label}
          </Link>
        ) : (
          <span key={i} className={CHIP_CLASS}>
            {label}
          </span>
        );
      }
      case "special":
        return (
          <span key={i} className="rounded bg-plum-50 dark:bg-plum-900/20 px-1 text-plum-700 dark:text-plum-300">
            {n.v}
          </span>
        );
      case "emoji":
        return <Emoji key={i} name={n.name} custom={ctx.customEmoji} />;
    }
  });
}

function renderBlock(block: Block, i: number, ctx: ChatTextContext): ReactNode {
  switch (block.t) {
    case "code":
      return (
        <pre key={i} className="my-1 overflow-x-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-2 font-mono text-sm">
          <code>{block.v}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={i} className="my-1 border-l-4 border-slate-500 pl-3 text-slate-600 dark:text-slate-400">
          {renderInline(block.c, ctx)}
        </blockquote>
      );
    case "line":
      return (
        <p key={i} className={block.gap ? "mt-3" : undefined}>
          {renderInline(block.c, ctx)}
        </p>
      );
    case "bullet":
      return null; // rendered in runs by renderBlocks
  }
}

/** Blocks in order, with each run of bullets as one list. */
function renderBlocks(blocks: Block[], ctx: ChatTextContext): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.t !== "bullet") {
      out.push(renderBlock(block, i, ctx));
      continue;
    }
    const items: { c: Inline[]; key: number; indent: number; n?: number }[] = [];
    for (; i < blocks.length && blocks[i].t === "bullet"; i++) {
      const item = blocks[i] as Extract<Block, { t: "bullet" }>;
      items.push({ c: item.c, key: i, indent: item.indent, n: item.n });
    }
    i--;
    out.push(
      <ul key={items[0].key} className="mt-1 ml-1 space-y-0.5">
        {items.map((it) => (
          <li key={it.key} className="flex gap-2" style={it.indent ? { paddingLeft: `${it.indent * 1.5}rem` } : undefined}>
            <span aria-hidden="true" className={it.n === undefined ? undefined : "min-w-[1.25em] text-right"}>
              {listMarker(it)}
            </span>
            <span>{renderInline(it.c, ctx)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return out;
}

/** A message body as rendered Slack text. */
export default function ChatText({ body, ctx }: { body: string; ctx: ChatTextContext }) {
  // A message of only emoji is drawn large, as in Slack; a shortcode the chat can't draw would show as big letters, so it doesn't count.
  const jumbo = isEmojiOnly(body, { shortcodes: true }) && emojiNamesIn(body).every((n) => n in ctx.customEmoji || unicodeEmoji(n));
  return <div className={jumbo ? "break-words text-[2rem] leading-tight" : "break-words"}>{renderBlocks(parseSlackText(body), ctx)}</div>;
}
