import { mrkdwnToDoc, type RichNode } from "@/lib/chat/rich-text";

/**
 * What a message being sent (or an edit being saved) contains, as yes/no flags and small counts, never its text:
 * which formatting is in it, how deep its lists go, how many lines and mentions it has. Read from the message's
 * mrkdwn (what the box hands its owners), so it sees everything that ended up in the message however it got there:
 * the toolbar, a shortcut, typed `*bold*` or `> `, Tab to nest a list, Shift+Enter, or pasted text. It is the measure
 * of how members use what Slack renders differently (underline, nested lists, quotes).
 */
export interface MessageFeatures {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  codeblock: boolean;
  quote: boolean;
  bullets: boolean;
  numbers: boolean;
  link: boolean;
  /** How many lists deep the deepest item is: 0 no list, 1 a plain list, 2 and up nested. */
  list_depth: number;
  /** Lines in the message. */
  lines: number;
  /** People and channels mentioned. */
  mentions: number;
}

const MENTION = /<[@#!][^>\s]*>/g;

export function messageFeatures(mrkdwn: string): MessageFeatures {
  const found: MessageFeatures = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    code: false,
    codeblock: false,
    quote: false,
    bullets: false,
    numbers: false,
    link: false,
    list_depth: 0,
    lines: mrkdwn.length === 0 ? 0 : mrkdwn.split("\n").length,
    mentions: mrkdwn.match(MENTION)?.length ?? 0,
  };

  const walk = (node: RichNode, depth: number) => {
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") found.bold = true;
      else if (mark.type === "italic") found.italic = true;
      else if (mark.type === "underline") found.underline = true;
      else if (mark.type === "strike") found.strike = true;
      else if (mark.type === "code") found.code = true;
      else if (mark.type === "link") found.link = true;
    }
    let next = depth;
    if (node.type === "blockquote") found.quote = true;
    else if (node.type === "codeBlock") found.codeblock = true;
    else if (node.type === "bulletList" || node.type === "orderedList") {
      if (node.type === "bulletList") found.bullets = true;
      else found.numbers = true;
      next = depth + 1;
      found.list_depth = Math.max(found.list_depth, next);
    }
    for (const child of node.content ?? []) walk(child, next);
  };
  walk(mrkdwnToDoc(mrkdwn), 0);
  return found;
}
