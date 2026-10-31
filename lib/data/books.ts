import { randomInt } from "node:crypto";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { PageQuery } from "./query";
import type { Db, Insert, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";

/** A book on a member's bookshelf (`member_books`). A deleted one keeps its row, with `deleted_at` set. */
// `book_member` in the generated row is the author function, not a column.
export type BookRow = Omit<Row<"member_books">, "book_member">;
export type NewBook = Insert<"member_books">;
export type BookPatch = Update<"member_books">;

/** What the bookshelf page shows for a book: the book, and its author's names (null when the member is gone). */
export type ShelfBook = Pick<BookRow, "id" | "member_id" | "title" | "description" | "cover_url" | "purchase_url" | "published_date" | "price" | "genre" | "format" | "pen_name"> & {
  author: { name: string; display_name: string | null } | null;
};

/** What a member's profile shows for each book. */
export type ProfileBook = Pick<BookRow, "id" | "title" | "cover_url" | "purchase_url" | "published_date">;

/** One of a member's own books with the library image behind its cover. */
export type MyBook = Pick<BookRow, "id" | "title" | "description" | "cover_url" | "purchase_url" | "published_date" | "price" | "genre" | "format" | "project_id" | "pen_name"> & {
  cover_asset: { id: string; width: number; height: number } | null;
};

export type BookSearch = {
  /** Every word must be in the title or the description (case-insensitive). */
  words: string[];
  /** Only books by these members; null = anyone. Keep it short (a few dozen ids). */
  authorIds: string[] | null;
  /** Published on or after this date (a day, YYYY-MM-DD) / before this date. */
  after?: string;
  before?: string;
  limit: number;
  offset: number;
};

export type BookHit = Pick<BookRow, "id" | "title" | "description" | "cover_url" | "published_date" | "pen_name"> & { author: { id: string; name: string } | null };

/** A book whose cover is still a link, not a library image. */
export type BookWithLegacyCover = Pick<BookRow, "id" | "member_id" | "title" | "cover_url">;

/** Thrown by {@link BookRepository.add} when the book's project already has a live book. */
export class BookExistsError extends Error {
  constructor(message = "This project already has a book") {
    super(message);
    this.name = "BookExistsError";
  }
}

/** A search word with the characters that mean something to LIKE or to a PostgREST filter neutralized. */
const searchWord = (word: string) => word.replace(/[\\%_,()"]/g, " ").trim();

const SEARCH_FIELDS = ["title", "description"] as const;

/** Newest published first, the id as tie-break so pages never repeat or skip a row. */
const newestFirst = (a: { published_date: string; id: string }, b: { published_date: string; id: string }) =>
  a.published_date !== b.published_date ? (a.published_date < b.published_date ? 1 : -1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

/**
 * Members' bookshelves (`member_books`). Local data: the table is the source of truth, not reprocessed.
 * A book is soft deleted (`deleted_at`) and then never read back, except by `previousCoverAssetId`
 * and the cover move. Every method throws on a database error. The signed-in member's client runs
 * under RLS (own rows, or an admin's during sudo; other members see live books only).
 */
export interface BookRepository {
  /** Every live book with its author, newest published first. Paginated. */
  shelf(): Promise<ShelfBook[]>;
  /** A member's live books, newest published first. */
  ofMember(memberId: string): Promise<ProfileBook[]>;
  /** A member's live books with the library image behind each cover, newest published first. */
  mine(memberId: string): Promise<MyBook[]>;
  /** Adds a book and returns its id. Throws {@link BookExistsError} when its project already has a live book. */
  add(book: NewBook): Promise<string>;
  /** Changes a live book. False when there is no such live book (or it is not the caller's). */
  update(id: string, patch: BookPatch): Promise<boolean>;
  /** Soft deletes a live book. False when there is no such live book (or it is not the caller's). */
  remove(id: string): Promise<boolean>;
  /** The library image a book's cover is now, or null (no such book, or an older cover). Deleted books included. */
  coverAssetIdOf(id: string): Promise<string | null>;
  /** How many live books a member has. */
  countLive(memberId: string): Promise<number>;
  /** Live books per member (a member with none is left out). Paginated. */
  liveCountsByMember(): Promise<Map<string, number>>;
  /** Live books matching the words, by author and publish date, newest published first. */
  search(query: BookSearch): Promise<BookHit[]>;
  /** Books (deleted ones included) whose cover is not a library image yet, by id. Paginated. */
  withoutCoverAsset(): Promise<BookWithLegacyCover[]>;
  /** Points a book at a library image, only if its cover is still `currentUrl` and no image yet. False when it changed meanwhile. */
  adoptCover(id: string, currentUrl: string, cover: { url: string; assetId: string }): Promise<boolean>;
}


export class SupabaseBookRepository implements BookRepository {
  constructor(private readonly db: Db) {}

  async shelf() {
    type Raw = Omit<ShelfBook, "author"> & { author: ShelfBook["author"] | ShelfBook["author"][] };
    const rows = await fetchAllRows<Raw>(
      (from, to) =>
        this.db
          .from("member_books")
          .select("id, member_id, title, description, cover_url, purchase_url, published_date, price, genre, format, pen_name, author:book_member(name, display_name)")
          .is("deleted_at", null)
          .order("published_date", { ascending: false })
          .order("id")
          .range(from, to) as unknown as PageQuery<Raw>
    );
    return rows.map((row) => ({ ...row, author: one(row.author) }));
  }

  async ofMember(memberId: string) {
    const { data, error } = await this.db
      .from("member_books")
      .select("id, title, cover_url, purchase_url, published_date")
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .order("published_date", { ascending: false })
      .order("id");
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async mine(memberId: string) {
    const { data, error } = await this.db
      .from("member_books")
      .select("id, title, description, cover_url, purchase_url, published_date, price, genre, format, project_id, pen_name, cover_asset:media_assets(id, width, height)")
      .eq("member_id", memberId)
      .is("deleted_at", null)
      .order("published_date", { ascending: false })
      .order("id");
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as (Omit<MyBook, "cover_asset"> & { cover_asset: MyBook["cover_asset"] | MyBook["cover_asset"][] })[]).map((row) => ({ ...row, cover_asset: one(row.cover_asset) }));
  }

  async add(book: NewBook) {
    const { data, error } = await this.db.from("member_books").insert(book).select("id").single();
    if (error) {
      if (error.code === "23505") throw new BookExistsError(error.message);
      throw new Error(error.message);
    }
    return data.id;
  }

  async update(id: string, patch: BookPatch) {
    const { data, error } = await this.db.from("member_books").update(patch).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  }

  async remove(id: string) {
    return this.update(id, { deleted_at: new Date().toISOString() });
  }

  async coverAssetIdOf(id: string) {
    const { data, error } = await this.db.from("member_books").select("cover_asset_id").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.cover_asset_id ?? null;
  }

  async countLive(memberId: string) {
    const { count, error } = await this.db.from("member_books").select("id", { count: "exact", head: true }).eq("member_id", memberId).is("deleted_at", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async liveCountsByMember() {
    const rows = await fetchAllRows<{ member_id: string }>(
      (from, to) => this.db.from("member_books").select("member_id").is("deleted_at", null).order("id").range(from, to) as unknown as PageQuery<{ member_id: string }>
    );
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.member_id, (counts.get(row.member_id) ?? 0) + 1);
    return counts;
  }

  async search(q: BookSearch) {
    if (q.authorIds && q.authorIds.length === 0) return [];
    let query = this.db.from("member_books").select("id, title, description, cover_url, published_date, pen_name, author:book_member(id, name)");
    for (const word of q.words) {
      query = query.or(SEARCH_FIELDS.map((f) => `${f}.ilike."%${searchWord(word)}%"`).join(","));
    }
    query = query.is("deleted_at", null);
    if (q.authorIds) query = query.in("member_id", q.authorIds);
    if (q.after) query = query.gte("published_date", q.after.slice(0, 10));
    if (q.before) query = query.lt("published_date", q.before.slice(0, 10));
    const { data, error } = await query.order("published_date", { ascending: false }).order("id").range(q.offset, q.offset + q.limit - 1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as (Omit<BookHit, "author"> & { author: BookHit["author"] | BookHit["author"][] })[]).map((row) => ({ ...row, author: one(row.author) }));
  }

  async withoutCoverAsset() {
    return fetchAllRows<BookWithLegacyCover>(
      (from, to) => this.db.from("member_books").select("id, member_id, title, cover_url").is("cover_asset_id", null).order("id").range(from, to) as unknown as PageQuery<BookWithLegacyCover>
    );
  }

  async adoptCover(id: string, currentUrl: string, cover: { url: string; assetId: string }) {
    const { data, error } = await this.db
      .from("member_books")
      .update({ cover_url: cover.url, cover_asset_id: cover.assetId })
      .eq("id", id)
      .eq("cover_url", currentUrl)
      .is("cover_asset_id", null)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const newBookId = () => `book_${Array.from({ length: 12 }, () => BASE58[randomInt(BASE58.length)]).join("")}`;

/** A book as a test or seed profile writes it: the columns the library and bookshelf joins need, the rest defaulted. */
export type BookSeed = Pick<BookRow, "id" | "member_id" | "title" | "published_date" | "cover_asset_id"> & Partial<BookRow>;

/** Fills in the columns a seed leaves out. */
export function bookRow(seed: BookSeed): BookRow {
  return {
    description: null,
    cover_url: "",
    purchase_url: "",
    price: null,
    genre: null,
    format: "print",
    project_id: null,
    pen_name: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...(Object.fromEntries(Object.entries(seed).filter(([, v]) => v !== undefined)) as BookSeed),
  };
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryBookRepository implements BookRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live() {
    return this.data.memberBooks.map((b) => bookRow(b)).filter((b) => b.deleted_at === null);
  }

  private author(memberId: string) {
    return this.data.members.find((m) => m.id === memberId) ?? null;
  }

  async shelf() {
    return this.live()
      .sort(newestFirst)
      .map((b) => {
        const m = this.author(b.member_id);
        return {
          id: b.id,
          member_id: b.member_id,
          title: b.title,
          description: b.description,
          cover_url: b.cover_url,
          purchase_url: b.purchase_url,
          published_date: b.published_date,
          price: b.price,
          genre: b.genre,
          format: b.format,
          pen_name: b.pen_name,
          author: m ? { name: m.name, display_name: m.displayName ?? null } : null,
        };
      });
  }

  async ofMember(memberId: string) {
    return this.live()
      .filter((b) => b.member_id === memberId)
      .sort(newestFirst)
      .map(({ id, title, cover_url, purchase_url, published_date }) => ({ id, title, cover_url, purchase_url, published_date }));
  }

  async mine(memberId: string) {
    return this.live()
      .filter((b) => b.member_id === memberId)
      .sort(newestFirst)
      .map((b) => {
        const asset = this.data.mediaAssets.find((a) => a.id === b.cover_asset_id);
        return {
          id: b.id,
          title: b.title,
          description: b.description,
          cover_url: b.cover_url,
          purchase_url: b.purchase_url,
          published_date: b.published_date,
          price: b.price,
          genre: b.genre,
          format: b.format,
          project_id: b.project_id,
          pen_name: b.pen_name,
          cover_asset: asset ? { id: asset.id, width: asset.width, height: asset.height } : null,
        };
      });
  }

  async add(book: NewBook) {
    if (!this.author(book.member_id)) throw new Error("violates foreign key constraint on member_id");
    if (book.format !== undefined && book.format !== "print" && book.format !== "ebook") throw new Error("violates check constraint member_books_format_check");
    if (book.project_id && this.live().some((b) => b.project_id === book.project_id)) throw new BookExistsError();
    const row = bookRow({ ...book, id: book.id ?? newBookId(), cover_asset_id: book.cover_asset_id ?? null, created_at: new Date().toISOString() } as BookSeed);
    this.data.memberBooks.push(row);
    return row.id;
  }

  async update(id: string, patch: BookPatch) {
    const index = this.data.memberBooks.findIndex((b) => b.id === id && (b.deleted_at ?? null) === null);
    if (index < 0) return false;
    this.data.memberBooks[index] = bookRow({ ...bookRow(this.data.memberBooks[index]), ...patch } as BookSeed);
    return true;
  }

  async remove(id: string) {
    return this.update(id, { deleted_at: new Date().toISOString() });
  }

  async coverAssetIdOf(id: string) {
    return this.data.memberBooks.find((b) => b.id === id)?.cover_asset_id ?? null;
  }

  async countLive(memberId: string) {
    return this.live().filter((b) => b.member_id === memberId).length;
  }

  async liveCountsByMember() {
    const counts = new Map<string, number>();
    for (const b of this.live()) counts.set(b.member_id, (counts.get(b.member_id) ?? 0) + 1);
    return counts;
  }

  async search(q: BookSearch) {
    if (q.authorIds && q.authorIds.length === 0) return [];
    const words = q.words.map((w) => searchWord(w).toLowerCase());
    const day = (d: string) => d.slice(0, 10);
    return this.live()
      .filter((b) => {
        if (q.authorIds && !q.authorIds.includes(b.member_id)) return false;
        if (q.after && b.published_date < day(q.after)) return false;
        if (q.before && b.published_date >= day(q.before)) return false;
        return words.every((w) => SEARCH_FIELDS.some((f) => (b[f] ?? "").toLowerCase().includes(w)));
      })
      .sort(newestFirst)
      .slice(q.offset, q.offset + q.limit)
      .map((b) => {
        const m = this.author(b.member_id);
        return { id: b.id, title: b.title, description: b.description, cover_url: b.cover_url, published_date: b.published_date, pen_name: b.pen_name, author: m ? { id: m.id, name: m.name } : null };
      });
  }

  async withoutCoverAsset() {
    return this.data.memberBooks
      .filter((b) => b.cover_asset_id === null)
      .map((b) => bookRow(b))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(({ id, member_id, title, cover_url }) => ({ id, member_id, title, cover_url }));
  }

  async adoptCover(id: string, currentUrl: string, cover: { url: string; assetId: string }) {
    const index = this.data.memberBooks.findIndex((b) => b.id === id && b.cover_asset_id === null && bookRow(b).cover_url === currentUrl);
    if (index < 0) return false;
    this.data.memberBooks[index] = { ...this.data.memberBooks[index], cover_url: cover.url, cover_asset_id: cover.assetId };
    return true;
  }
}

