import Link from "next/link";
import type { ReactNode } from "react";
import { parseSlackText, type Block, type Inline } from "@/lib/chat/render";
import { unicodeEmoji, type CustomEmoji } from "@/lib/chat/emoji";

export interface ChatTextContext {
  /** Slack user id -> display name, for <@U123> mentions. */
  userNames: Record<string, string>;
  /** Slack user id -> Hub member id, so a mention of a matched person links to their profile. */
  userMembers: Record<string, string>;
  /** Slack channel id -> Hub chat channel id, for <#C123> links to channels we mirror. */
  channelIds: Record<string, string>;
  /** Slack channel id -> channel name; the text's own label is often just "channel". */
  channelNames: Record<string, string>;
  /** Custom emoji used on the page, by shortcode (see customEmojiFor). */
  customEmoji: Record<string, CustomEmoji>;
}

/** A Slack emoji: the workspace's custom image, else the Unicode emoji, else the :shortcode: as typed. */
export function Emoji({ name, custom }: { name: string; custom: Record<string, CustomEmoji> }) {
  const key = name.toLowerCase().replace(/::skin-tone-\d$/, "");
  const c = custom[key];
  if (c && "url" in c) {
    // eslint-disable-next-line @next/next/no-img-element -- small remote Slack emoji images; no sizing to optimise
    return <img src={c.url} alt={`:${key}:`} title={`:${key}:`} className="inline-block h-[1.25em] w-[1.25em] align-text-bottom" />;
  }
  const text = c?.text ?? unicodeEmoji(key);
  return <span title={`:${key}:`}>{text ?? `:${name}:`}</span>;
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
      case "code":
        return (
          <code key={i} className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[0.9em]">
            {n.v}
          </code>
        );
      case "link":
        return (
          <a
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
          <Link key={i} href={`/members/${memberId}`} className={`${CHIP_CLASS} ${LINK_CLASS} no-underline hover:underline`}>
            {label}
          </Link>
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
          <Link key={i} href={`/chat/${hubId}`} className={`${CHIP_CLASS} ${LINK_CLASS} no-underline hover:underline`}>
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
        <pre key={i} className="my-1 overflow-x-auto rounded bg-slate-100 dark:bg-slate-800 p-2 text-sm">
          <code>{block.v}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={i} className="my-1 border-l-4 border-slate-300 dark:border-slate-600 pl-3 text-slate-600 dark:text-slate-400">
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
    const items: { c: Inline[]; key: number }[] = [];
    for (; i < blocks.length && blocks[i].t === "bullet"; i++) items.push({ c: (blocks[i] as { c: Inline[] }).c, key: i });
    i--;
    out.push(
      <ul key={items[0].key} className="mt-1 ml-1 space-y-0.5">
        {items.map((it) => (
          <li key={it.key} className="flex gap-2">
            <span aria-hidden="true">•</span>
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
  return <div className="break-words">{renderBlocks(parseSlackText(body), ctx)}</div>;
}
