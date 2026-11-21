import type { PreviewBlock } from "@/lib/chat/link-preview-blocks";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { inChunks, must } from "./query";

/**
 * The preview cards of the links in Hub-written chat messages (`chat_link_previews`; docs/product/SLACK_BRIDGED_CHAT.md, "Link previews").
 * Reads run as the caller, so row-level security shows a preview only where the message's text is readable (a restricted
 * conversation or a deleted message show nothing). The cards an author removed from a message (`chat_hidden_unfurls`) are on this repository too. Writes need the service role: the server fetches
 * the page after the message is sent, never the reader. Throws on a database error.
 */

export type LinkPreviewKind = "link" | "image";
export type LinkPreviewStatus = "ok" | "failed" | "blocked";

/** What the server learned about one link, before it is stored. Texts are plain and already capped (src/lib/chat/link-preview-html.ts). */
export interface LinkPreviewDraft {
  url: string;
  /** Which of the message's links this is, from 0; only the first three are previewed. */
  position: number;
  finalUrl: string | null;
  kind: LinkPreviewKind;
  status: LinkPreviewStatus;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

/** A preview that can be drawn. */
export interface LinkPreview extends LinkPreviewDraft {
  messageId: string;
  fetchedAt: string;
}

export interface ChatLinkPreviewRepository {
  /** The previews that can be drawn (fetched fine, not removed by the author) of each message, in the order the links were written. A message with none is absent. */
  forMessages(messageIds: string[]): Promise<Map<string, LinkPreview[]>>;
  /** Every address of the message that was ever looked at, failed, blocked or removed ones included: those are not asked for again. Service role. */
  looked(messageId: string): Promise<Set<string>>;
  /** Stores what was learned (one row per message and address; an address already stored is overwritten, an author's removal is kept). Service role. */
  save(messageId: string, drafts: LinkPreviewDraft[]): Promise<void>;
  /** Forgets the addresses of the message that are not in `keep` (the edit took the link out). Service role. */
  forget(messageId: string, keep: string[]): Promise<void>;
  /**
   * The keys of the cards the author removed from each message (`chat_hidden_unfurls`; see `unfurlKey` in src/lib/chat/link-previews.ts), as the caller
   * sees them: whoever can read a message reads its removals. A message with none is absent.
   */
  hiddenKeys(messageIds: string[]): Promise<Map<string, Set<string>>>;
  /**
   * The author removes a card from their message (a Hub preview or one of Slack's). Once per card: removing it again is not an error. With the
   * author's own client, row-level security lets only the author write it (anyone else's call throws); the service role may for anyone.
   */
  hide(messageId: string, key: string): Promise<void>;
  /**
   * The member's own blocked sites, paths and links (`chat_preview_blocks`; src/lib/chat/link-preview-blocks.ts), oldest first. Read as the member
   * (row-level security shows only their own) or, for the server building previews for a message, with the service role.
   */
  blocksOf(memberId: string): Promise<PreviewBlock[]>;
  /** Saves a rule for the member. Once per rule: adding it again is not an error. With the member's own client, row-level security refuses anyone else's. */
  block(memberId: string, block: PreviewBlock): Promise<void>;
  /** Lifts a rule. Nothing to lift is not an error. */
  unblock(memberId: string, block: PreviewBlock): Promise<void>;
}

const COLUMNS = "message_id, position, url, final_url, kind, status, title, description, site_name, image_url, fetched_at";

type PreviewRow = {
  message_id: string;
  position: number;
  url: string;
  final_url: string | null;
  kind: string;
  status: string;
  title: string | null;
  description: string | null;
  site_name: string | null;
  image_url: string | null;
  fetched_at: string;
};

function toPreview(r: PreviewRow): LinkPreview {
  return {
    messageId: r.message_id,
    position: r.position,
    url: r.url,
    finalUrl: r.final_url,
    kind: r.kind === "image" ? "image" : "link",
    status: r.status === "failed" || r.status === "blocked" ? r.status : "ok",
    title: r.title,
    description: r.description,
    siteName: r.site_name,
    imageUrl: r.image_url,
    fetchedAt: r.fetched_at,
  };
}

const byOrder = (a: LinkPreview, b: LinkPreview) => a.position - b.position || (a.fetchedAt < b.fetchedAt ? -1 : a.fetchedAt > b.fetchedAt ? 1 : 0);

function grouped(rows: LinkPreview[]): Map<string, LinkPreview[]> {
  const out = new Map<string, LinkPreview[]>();
  for (const p of [...rows].sort(byOrder)) out.set(p.messageId, [...(out.get(p.messageId) ?? []), p]);
  return out;
}

type BlockRow = { scope: string; host: string; path_prefix: string; url: string };

const toBlock = (r: BlockRow): PreviewBlock => ({
  scope: r.scope === "path" || r.scope === "link" ? r.scope : "site",
  host: r.host,
  pathPrefix: r.path_prefix || null,
  url: r.url || null,
});

/** The columns that name a rule; the empty string, not null, is "none" so one unique constraint holds. */
const blockColumns = (block: PreviewBlock) => ({ scope: block.scope, host: block.host, path_prefix: block.pathPrefix ?? "", url: block.url ?? "" });

export class SupabaseChatLinkPreviewRepository implements ChatLinkPreviewRepository {
  constructor(private readonly db: Db) {}

  async forMessages(messageIds: string[]) {
    const rows = await inChunks(messageIds, 100, async (part) =>
      must(await this.db.from("chat_link_previews").select(COLUMNS).in("message_id", part).eq("status", "ok")) ?? [],
    );
    return grouped(rows.map(toPreview));
  }

  async looked(messageId: string) {
    const rows = must(await this.db.from("chat_link_previews").select("url").eq("message_id", messageId)) ?? [];
    return new Set(rows.map((r) => r.url));
  }

  async save(messageId: string, drafts: LinkPreviewDraft[]) {
    if (drafts.length === 0) return;
    must(
      await this.db.from("chat_link_previews").upsert(
        drafts.map((d) => ({
          message_id: messageId,
          position: d.position,
          url: d.url,
          final_url: d.finalUrl,
          kind: d.kind,
          status: d.status,
          title: d.title,
          description: d.description,
          site_name: d.siteName,
          image_url: d.imageUrl,
          fetched_at: new Date().toISOString(),
        })),
        { onConflict: "message_id,url" },
      ),
    );
  }

  async forget(messageId: string, keep: string[]) {
    const gone = [...(await this.looked(messageId))].filter((u) => !keep.includes(u));
    for (const url of gone) must(await this.db.from("chat_link_previews").delete().eq("message_id", messageId).eq("url", url));
  }

  async hiddenKeys(messageIds: string[]) {
    const rows = await inChunks(messageIds, 100, async (part) => must(await this.db.from("chat_hidden_unfurls").select("message_id, key").in("message_id", part)) ?? []);
    const out = new Map<string, Set<string>>();
    for (const r of rows) out.set(r.message_id, (out.get(r.message_id) ?? new Set()).add(r.key));
    return out;
  }

  async hide(messageId: string, key: string) {
    must(await this.db.from("chat_hidden_unfurls").upsert({ message_id: messageId, key }, { onConflict: "message_id,key", ignoreDuplicates: true }));
  }

  async blocksOf(memberId: string) {
    const rows = must(await this.db.from("chat_preview_blocks").select("scope, host, path_prefix, url").eq("member_id", memberId).order("created_at").order("id")) ?? [];
    return rows.map(toBlock);
  }

  async block(memberId: string, block: PreviewBlock) {
    must(await this.db.from("chat_preview_blocks").upsert({ member_id: memberId, ...blockColumns(block) }, { onConflict: "member_id,scope,host,path_prefix,url", ignoreDuplicates: true }));
  }

  async unblock(memberId: string, block: PreviewBlock) {
    const c = blockColumns(block);
    must(await this.db.from("chat_preview_blocks").delete().eq("member_id", memberId).eq("scope", c.scope).eq("host", c.host).eq("path_prefix", c.path_prefix).eq("url", c.url));
  }
}

/** In-memory twin over an `InMemoryDataset`. Row-level security is not modelled: it returns what the database would for a reader of the message. */
export class InMemoryChatLinkPreviewRepository implements ChatLinkPreviewRepository {
  constructor(private readonly data: InMemoryDataset) {}

  async forMessages(messageIds: string[]) {
    const wanted = new Set(messageIds);
    const live = new Set(this.data.chatMessages.filter((m) => !m.deleted_at).map((m) => m.id));
    return grouped(
      this.data.chatLinkPreviews
        .filter((r) => wanted.has(r.message_id) && live.has(r.message_id) && r.status === "ok")
        .map(toPreview),
    );
  }

  async looked(messageId: string) {
    return new Set(this.data.chatLinkPreviews.filter((r) => r.message_id === messageId).map((r) => r.url));
  }

  async save(messageId: string, drafts: LinkPreviewDraft[]) {
    for (const d of drafts) {
      const existing = this.data.chatLinkPreviews.find((r) => r.message_id === messageId && r.url === d.url);
      const fields = {
        position: d.position,
        final_url: d.finalUrl,
        kind: d.kind,
        status: d.status,
        title: d.title,
        description: d.description,
        site_name: d.siteName,
        image_url: d.imageUrl,
        fetched_at: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, fields);
      else this.data.chatLinkPreviews.push({ id: `lprv_${String(this.data.chatLinkPreviews.length + 1).padStart(12, "A")}`, message_id: messageId, url: d.url, ...fields });
    }
  }

  async forget(messageId: string, keep: string[]) {
    this.data.chatLinkPreviews = this.data.chatLinkPreviews.filter((r) => r.message_id !== messageId || keep.includes(r.url));
  }

  async hiddenKeys(messageIds: string[]) {
    const wanted = new Set(messageIds);
    const out = new Map<string, Set<string>>();
    for (const r of this.data.chatHiddenUnfurls) if (wanted.has(r.message_id)) out.set(r.message_id, (out.get(r.message_id) ?? new Set()).add(r.key));
    return out;
  }

  async hide(messageId: string, key: string) {
    if (this.data.chatHiddenUnfurls.some((r) => r.message_id === messageId && r.key === key)) return;
    this.data.chatHiddenUnfurls.push({ id: `hunf_${String(this.data.chatHiddenUnfurls.length + 1).padStart(12, "A")}`, message_id: messageId, key, created_at: new Date().toISOString() });
  }

  async blocksOf(memberId: string) {
    return this.data.chatPreviewBlocks.filter((r) => r.member_id === memberId).map(toBlock);
  }

  async block(memberId: string, block: PreviewBlock) {
    const c = blockColumns(block);
    if (this.data.chatPreviewBlocks.some((r) => sameRule(r, memberId, c))) return;
    this.data.chatPreviewBlocks.push({ id: `cpbk_${String(this.data.chatPreviewBlocks.length + 1).padStart(12, "A")}`, member_id: memberId, ...c, created_at: new Date().toISOString() });
  }

  async unblock(memberId: string, block: PreviewBlock) {
    const c = blockColumns(block);
    this.data.chatPreviewBlocks = this.data.chatPreviewBlocks.filter((r) => !sameRule(r, memberId, c));
  }
}

const sameRule = (r: BlockRow & { member_id: string }, memberId: string, c: BlockRow) =>
  r.member_id === memberId && r.scope === c.scope && r.host === c.host && r.path_prefix === c.path_prefix && r.url === c.url;
