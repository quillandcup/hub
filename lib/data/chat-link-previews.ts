import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { inChunks, must } from "./query";

/**
 * The preview cards of the links in Hub-written chat messages (`chat_link_previews`; docs/SLACK_BRIDGED_CHAT.md, "Link previews").
 * Reads run as the caller, so row-level security shows a preview only where the message's text is readable (a restricted
 * conversation or a deleted message show nothing). The cards an author removed from a message (`chat_hidden_unfurls`) are on this repository too. Writes need the service role: the server fetches
 * the page after the message is sent, never the reader. Throws on a database error.
 */

export type LinkPreviewKind = "link" | "image";
export type LinkPreviewStatus = "ok" | "failed" | "blocked";

/** What the server learned about one link, before it is stored. Texts are plain and already capped (lib/chat/link-preview-html.ts). */
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
   * The keys of the cards the author removed from each message (`chat_hidden_unfurls`; see `unfurlKey` in lib/chat/link-previews.ts), as the caller
   * sees them: whoever can read a message reads its removals. A message with none is absent.
   */
  hiddenKeys(messageIds: string[]): Promise<Map<string, Set<string>>>;
  /**
   * The author removes a card from their message (a Hub preview or one of Slack's). Once per card: removing it again is not an error. With the
   * author's own client, row-level security lets only the author write it (anyone else's call throws); the service role may for anyone.
   */
  hide(messageId: string, key: string): Promise<void>;
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
}
