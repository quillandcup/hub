/**
 * Reading lesson comments off Kajabi's member lesson pages (docs/COURSES.md, "Lesson comments"): the part of
 * `courses:content --comments` that needs no browser or database. `extractCommentsInPage` runs inside the page
 * and returns plain data; `parseComments` turns that into Bronze rows; `parsePostsList` reads the lesson links
 * from the admin's posts list.
 *
 * Nothing here logs or returns text for display: comments hold members' names and words. Relative imports only
 * (the script that calls this runs outside Next).
 */

import { createHash } from "node:crypto";
import { parseKajabiInstant } from "./progress-capture";

/** Where a comment's key came from. "hash" means the page gave no usable id. */
export type KeySource = "reply-link" | "reply-container" | "data-comment" | "hash";

export interface RawKeyCandidate {
  source: Exclude<KeySource, "hash">;
  /** The query parameter's name for a reply link; empty otherwise. */
  name: string;
  value: string;
}

/** One `div.comment` as read in the page (replies included), in document order. */
export interface RawComment {
  index: number;
  /** The index of the comment this one is nested in, null for a top-level comment. */
  parentIndex: number | null;
  name: string;
  datetime: string | null;
  /** Text with `\n` for line breaks and paragraph ends; whitespace not yet collapsed. */
  body: string;
  idCandidates: RawKeyCandidate[];
}

export interface PageComments {
  comments: RawComment[];
  /** The total the page shows next to its Comments heading ("Comments 52"), null when it shows none. */
  total: number | null;
}

/**
 * Runs IN THE PAGE (passed to `page.evaluate`): it must stay self-contained, with no imports and no names from
 * outside. tsx adds a `__name` helper to nested functions that the page lacks; the script defines it with an init
 * script (see `describeDomShape` in probe.ts). Only reads: it never clicks, types or submits anything. Text comes
 * from text nodes only, so markup in a body is never kept.
 */
export function extractCommentsInPage(): PageComments {
  const own = (c: Element, selector: string): Element | null =>
    Array.from(c.querySelectorAll(selector)).find((e) => e.closest("div.comment") === c) ?? null;

  const blocks = new Set(["P", "DIV", "LI", "BLOCKQUOTE", "UL", "OL"]);
  const textOf = (node: Node, out: string[]): void => {
    if (node.nodeType === 3) {
      out.push((node as Text).data);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName;
    if (tag === "BR") {
      out.push("\n");
      return;
    }
    const block = blocks.has(tag);
    if (block) out.push("\n");
    for (const child of Array.from(node.childNodes)) textOf(child, out);
    if (block) out.push("\n");
  };

  const elements = Array.from(document.querySelectorAll("div.comment"));
  const comments: RawComment[] = elements.map((el, index) => {
    const parentEl = el.parentElement ? el.parentElement.closest("div.comment") : null;
    const idCandidates: RawKeyCandidate[] = [];

    const reply = own(el, "a.comment__reply");
    const href = reply ? reply.getAttribute("href") : null;
    if (href) {
      try {
        for (const [name, value] of new URL(href, "https://page.invalid").searchParams) {
          if (/^\d+$/.test(value)) idCandidates.push({ source: "reply-link", name, value });
        }
      } catch {
        // an address that does not parse carries no id
      }
    }
    const container = own(el, "div[data-comment-reply]");
    const containerId = container ? container.getAttribute("id") : null;
    const fromContainer = containerId ? /(\d+)$/.exec(containerId) : null;
    if (fromContainer) idCandidates.push({ source: "reply-container", name: "", value: fromContainer[1] });
    const attr = el.getAttribute("data-comment");
    if (attr && /^\d+$/.test(attr.trim())) idCandidates.push({ source: "data-comment", name: "", value: attr.trim() });

    const nameEl = own(el, "p.comment__name");
    const timeEl = own(el, "p.comment__date time") ?? own(el, "time");
    const bodyEl = own(el, "div.comment__body");
    const body: string[] = [];
    if (bodyEl) textOf(bodyEl, body);
    return {
      index,
      parentIndex: parentEl ? elements.indexOf(parentEl) : null,
      name: nameEl ? (nameEl.textContent ?? "") : "",
      datetime: timeEl ? timeEl.getAttribute("datetime") : null,
      body: body.join(""),
      idCandidates,
    };
  });

  // The page's own total, when it prints one: a short heading-like element reading "Comments 52", "52 Comments" or "Comments (52)".
  let total: number | null = null;
  for (const el of Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [class*='comments'], [class*='Comments']"))) {
    if (el.closest("div.comment")) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 30) continue;
    const m = /^comments?\s*\(?(\d+)\)?$/i.exec(text) ?? /^(\d+)\s+comments?$/i.exec(text);
    if (m) {
      total = Number(m[1]);
      break;
    }
  }
  return { comments, total };
}

/** Whitespace collapsed per line, blank lines reduced to one, no leading or trailing blanks. Newlines are kept. */
export function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ParsedComment {
  commentKey: string;
  parentCommentKey: string | null;
  authorName: string;
  postedAt: string | null;
  body: string;
}

export interface ParsedComments {
  comments: ParsedComment[];
  /** How the keys were found, in counts. */
  keySources: Record<KeySource, number>;
  /** Comments whose key repeated within the lesson and got a suffix. */
  duplicateKeys: number;
}

function pageId(candidates: RawKeyCandidate[]): { key: string; source: Exclude<KeySource, "hash"> } | null {
  const link = candidates.find((c) => c.source === "reply-link" && /(parent|comment)/i.test(c.name));
  if (link) return { key: link.value, source: "reply-link" };
  const container = candidates.find((c) => c.source === "reply-container");
  if (container) return { key: container.value, source: "reply-container" };
  const attr = candidates.find((c) => c.source === "data-comment");
  return attr ? { key: attr.value, source: "data-comment" } : null;
}

/**
 * Turns what the page returned into Bronze rows for one lesson. The key is the comment's Kajabi id when the page
 * carries one (in the reply link's query, then the reply container's id, then the `data-comment` value), else a
 * hash of lesson, author name, `datetime` and text. `datetime` is read as an instant (a bare date as noon in
 * `timeZone`); the body's whitespace is collapsed per line.
 */
export function parseComments(raw: readonly RawComment[], lessonKajabiId: string, timeZone: string): ParsedComments {
  const keySources: Record<KeySource, number> = { "reply-link": 0, "reply-container": 0, "data-comment": 0, hash: 0 };
  const used = new Map<string, number>();
  let duplicateKeys = 0;
  const keyByIndex = new Map<number, string>();
  const comments: ParsedComment[] = [];
  for (const c of raw) {
    const name = c.name.replace(/\s+/g, " ").trim();
    const body = normalizeBody(c.body);
    const found = pageId(c.idCandidates);
    let key: string;
    if (found) {
      key = found.key;
      keySources[found.source]++;
    } else {
      key = `h:${createHash("sha256").update([lessonKajabiId, name, c.datetime ?? "", body].join("\u0000")).digest("hex").slice(0, 32)}`;
      keySources.hash++;
    }
    const seen = (used.get(key) ?? 0) + 1;
    used.set(key, seen);
    if (seen > 1) {
      duplicateKeys++;
      key = `${key}~${seen}`;
    }
    keyByIndex.set(c.index, key);
    comments.push({
      commentKey: key,
      parentCommentKey: c.parentIndex === null ? null : (keyByIndex.get(c.parentIndex) ?? null),
      authorName: name,
      postedAt: parseKajabiInstant(c.datetime, timeZone),
      body,
    });
  }
  return { comments, keySources, duplicateKeys };
}

export interface PostLink {
  lessonKajabiId: string;
  url: string;
}

/**
 * The lessons and their "view comments" links from the admin's `GET /api/admin/products/{id}/posts` response
 * (`data[].attributes.urls.viewCommentsUrl`). `paged` is true when the response points at a next page, which this
 * capture does not follow. Posts without a link are counted, not listed.
 */
export function parsePostsList(json: unknown): { lessons: PostLink[]; withoutLink: number; paged: boolean } {
  const root = (json && typeof json === "object" ? json : {}) as { data?: unknown; links?: { next?: unknown }; meta?: { next_page?: unknown } };
  const data = Array.isArray(root.data) ? root.data : [];
  const lessons: PostLink[] = [];
  const seen = new Set<string>();
  let withoutLink = 0;
  for (const item of data) {
    const post = item as { id?: unknown; attributes?: { urls?: { viewCommentsUrl?: unknown } } };
    const id = typeof post.id === "number" ? String(post.id) : typeof post.id === "string" ? post.id : null;
    const url = post.attributes?.urls?.viewCommentsUrl;
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    if (typeof url !== "string" || url.trim() === "") {
      withoutLink++;
      continue;
    }
    lessons.push({ lessonKajabiId: id, url: url.trim() });
  }
  return { lessons, withoutLink, paged: Boolean(root.links?.next) || Boolean(root.meta?.next_page) };
}
