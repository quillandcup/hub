import Link from "next/link";
import type { ReactNode } from "react";
import { parseSlackText, type Block, type Inline } from "@/lib/chat/render";
import { slackEmojiToUnicode } from "@/lib/slack-emoji";

export interface ChatTextContext {
  /** Slack user id -> display name, for <@U123> mentions. */
  userNames: Record<string, string>;
  /** Slack channel id -> Hub chat channel id, for <#C123> links to channels we mirror. */
  channelIds: Record<string, string>;
}

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
            className="text-plum-600 dark:text-plum-400 hover:underline"
          >
            {n.label}
          </a>
        );
      case "user":
        return (
          <span key={i} className="rounded bg-plum-50 dark:bg-plum-900/20 px-1 text-plum-700 dark:text-plum-300">
            @{ctx.userNames[n.id] ?? "someone"}
          </span>
        );
      case "channel": {
        const hubId = ctx.channelIds[n.id];
        const label = `#${n.label ?? "channel"}`;
        return hubId ? (
          <Link key={i} href={`/chat/${hubId}`} className="text-plum-600 dark:text-plum-400 hover:underline">
            {label}
          </Link>
        ) : (
          <span key={i}>{label}</span>
        );
      }
      case "special":
        return (
          <span key={i} className="rounded bg-plum-50 dark:bg-plum-900/20 px-1 text-plum-700 dark:text-plum-300">
            {n.v}
          </span>
        );
      case "emoji":
        return <span key={i}>{slackEmojiToUnicode(n.name)}</span>;
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
      return <p key={i}>{renderInline(block.c, ctx)}</p>;
  }
}

/** A message body as rendered Slack text. */
export default function ChatText({ body, ctx }: { body: string; ctx: ChatTextContext }) {
  return <div className="break-words">{parseSlackText(body).map((b, i) => renderBlock(b, i, ctx))}</div>;
}
