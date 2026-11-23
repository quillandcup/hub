import { isProfilePubliclyServable, publicName, publishableLink, publishablePhotoUrl, type SetHandleOutcome } from "@/lib/writer-profile";
import { fetchRowWindow } from "@/lib/supabase/paginate";
import type { Db, Row, Update } from "./db";
import type { InMemoryDataset } from "./in-memory";
import { must } from "./query";

/** A member's own page settings: everything they can see and change, never anything about another member. */
export interface WriterProfileSettings {
  handle: string;
  isPublic: boolean;
  /** One of their pen names (`member_name_aliases` id) shown instead of the display name; null shows the display name. */
  publicNameAliasId: string | null;
  /** The member picked the name on their account as the name shown (never with a pen name; false is the display name). */
  useAccountName: boolean;
  /** The separate bio written for the page, or null when the page uses the member's own bio (if its level is the globe). */
  bio: string | null;
  publishedAt: string | null;
}

/**
 * What a visitor may see of a page, and nothing else: no member id, no email, no legal name, no status. Built by the
 * repository from the page's own switches, so a field that is off never leaves it.
 */
export interface PublicWriterProfile {
  handle: string;
  /** The display name, or the pen name the member allowed (never the legal name). */
  name: string;
  /** Their photo, only when its level is the globe and it may be published. */
  photoUrl: string | null;
  /** The separate public bio when there is one; otherwise the member's own bio, only when its level is the globe. */
  bio: string | null;
  /** Social links whose level is the globe (https only); each null when it is not shown. */
  links: { instagram: string | null; facebook: string | null; x: string | null };
  /** When the page first went public. */
  publishedAt: string | null;
  updatedAt: string;
}

/** What a visitor's address leads to: the page, a redirect from a handle the member gave up, or nothing. */
export type PublicLookup =
  | { kind: "page"; profile: PublicWriterProfile; ownerId: string }
  | { kind: "redirect"; handle: string; ownerId: string }
  | { kind: "none" };

/** Whether a member can have a handle: free, already theirs, in use, or held for someone who just gave it up. */
export type HandleAvailability = "available" | "yours" | "taken" | "reserved";

/** The settings a member changes on their page (the handle has its own method). */
export interface WriterProfileChanges {
  isPublic?: boolean;
  publicNameAliasId?: string | null;
  /** Choosing the account name clears the pen name, and choosing a pen name (or giving `false`) clears the account name. */
  useAccountName?: boolean;
  bio?: string | null;
}

/** Thrown by `update` when the name chosen is not one of the member's own public pen names. */
export class PublicNameNotAllowedError extends Error {
  constructor() {
    super("That name is not one of your pen names marked for your page.");
    this.name = "PublicNameNotAllowedError";
  }
}

/**
 * Writer profiles (docs/product/WRITER_PROFILES.md). A member reads and changes their own page through their own
 * (row-level security) repositories; the handle is written only by `setHandle`, and everything a visitor reads
 * (`publicByHandle`, `publicHandles`) must run with the service role (`getServiceRepos()`), because visitors have no
 * grants on the tables: the repository returns only what is meant to be public.
 *
 * Methods throw `new Error(<database message>)` on a database error; a lookup that finds nothing returns null or "none".
 */
export interface WriterProfileRepository {
  /** The member's own page settings, or null when they have not chosen a handle yet. */
  ofMember(memberId: string): Promise<WriterProfileSettings | null>;
  /** Changes the member's own page; null when they have no page. Throws `PublicNameNotAllowedError`. */
  update(memberId: string, changes: WriterProfileChanges): Promise<WriterProfileSettings | null>;
  /** Whether this member can have the handle (service role: it looks across members). `now` is when the check is made. */
  handleAvailability(memberId: string, handle: string, now: Date): Promise<HandleAvailability>;
  /**
   * Claims the member's first handle or moves their page to a new one (service role). The old handle redirects to the new
   * one and is held for them for `reserveDays`. `now` is the moment the hold starts from.
   */
  setHandle(memberId: string, handle: string, options: { reserveDays: number; now: Date }): Promise<SetHandleOutcome>;
  /** What a visitor gets at this address (service role). A page that is off, deleted or not servable is "none", like one that never existed. */
  publicByHandle(handle: string): Promise<PublicLookup>;
  /** Whether this member's page is on and can be served to a visitor right now (service role): switched on, not deleted, the member not removed. */
  isOnForMember(memberId: string): Promise<boolean>;
  /** The member's page as a visitor would see it, switched on or not (service role; for the member's own preview). */
  previewOfMember(memberId: string): Promise<PublicWriterProfile | null>;
  /** How many pages are public (service role): the sitemap's size. */
  publicCount(): Promise<number>;
  /** One sitemap page of public pages' handles, in a stable order (service role). `page` starts at 0. `memberId` is the owner, for the server's flag check; it never goes into a sitemap. */
  publicHandles(page: number, pageSize: number): Promise<{ handle: string; updatedAt: string; memberId: string }[]>;
}

const SETTINGS_COLUMNS = "handle, is_public, public_name_alias_id, use_account_name, public_bio, published_at";

type SettingsRow = Pick<Row<"writer_profiles">, "handle" | "is_public" | "public_name_alias_id" | "use_account_name" | "public_bio" | "published_at">;

function toSettings(row: SettingsRow | null | undefined): WriterProfileSettings | null {
  return row
    ? {
        handle: row.handle,
        isPublic: row.is_public,
        publicNameAliasId: row.public_name_alias_id,
        useAccountName: row.use_account_name,
        bio: row.public_bio,
        publishedAt: row.published_at,
      }
    : null;
}

type PublicLevels = {
  bio_visibility: string;
  photo_visibility: string;
  instagram_visibility: string;
  facebook_visibility: string;
  twitter_visibility: string;
};

/** A page row with the member and the chosen pen name joined in: just what a public page is built from. */
type PublicRow = {
  handle: string;
  public_bio: string | null;
  published_at: string | null;
  updated_at: string;
  deleted_at: string | null;
  member_id: string;
  public_name_alias_id: string | null;
  use_account_name: boolean;
  member: {
    name: string;
    display_name: string | null;
    photo_url: string | null;
    status: string;
    bio: string | null;
    instagram_url: string | null;
    facebook_url: string | null;
    twitter_url: string | null;
    /** The member's level for each item (one row, or none when they never changed one: then everything is community). */
    levels: PublicLevels | PublicLevels[] | null;
  } | null;
  alias: { alias: string; is_public: boolean; active: boolean; source: string; member_id: string } | null;
};

const PUBLIC_COLUMNS =
  "handle, public_bio, published_at, updated_at, deleted_at, member_id, public_name_alias_id, use_account_name, member:members!writer_profiles_member_id_fkey(name, display_name, photo_url, status, bio, instagram_url, facebook_url, twitter_url, levels:member_profile_overrides(bio_visibility, photo_visibility, instagram_visibility, facebook_visibility, twitter_visibility)), alias:member_name_aliases!writer_profiles_public_name_alias_id_fkey(alias, is_public, active, source, member_id)";

/**
 * The one place a page's fields become public. A pen name is shown only when it is the member's own, still switched on
 * for the page, active and added by the member themselves; anything else falls back to the display name. Every other item
 * only when its level is the globe (`public`): the photo when its address may be published, a social link when it is https,
 * the member's own bio only when they have no separate public bio (a separate one is the member's choice for the page, so
 * it needs no level). Null when the member's page may not be served.
 */
function toPublic(row: PublicRow): PublicWriterProfile | null {
  if (!row.member) return null;
  if (!isProfilePubliclyServable({ deletedAt: row.deleted_at, memberStatus: row.member.status })) return null;
  const alias = row.alias;
  const penName = alias && alias.is_public && alias.active && alias.source === "member" && alias.member_id === row.member_id ? alias.alias : null;
  const levels = Array.isArray(row.member.levels) ? (row.member.levels[0] ?? null) : row.member.levels;
  const isPublic = (level: string | undefined) => level === "public";
  const separateBio = row.public_bio?.trim() ? row.public_bio : null;
  return {
    handle: row.handle,
    name: publicName(row.member, penName, row.use_account_name),
    photoUrl: isPublic(levels?.photo_visibility) ? publishablePhotoUrl(row.member.photo_url) : null,
    bio: separateBio ?? (isPublic(levels?.bio_visibility) && row.member.bio?.trim() ? row.member.bio : null),
    links: {
      instagram: isPublic(levels?.instagram_visibility) ? publishableLink(row.member.instagram_url) : null,
      facebook: isPublic(levels?.facebook_visibility) ? publishableLink(row.member.facebook_url) : null,
      x: isPublic(levels?.twitter_visibility) ? publishableLink(row.member.twitter_url) : null,
    },
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

export class SupabaseWriterProfileRepository implements WriterProfileRepository {
  constructor(private readonly db: Db) {}

  async ofMember(memberId: string): Promise<WriterProfileSettings | null> {
    const row = must(await this.db.from("writer_profiles").select(SETTINGS_COLUMNS).eq("member_id", memberId).is("deleted_at", null).maybeSingle());
    return toSettings(row);
  }

  async update(memberId: string, changes: WriterProfileChanges): Promise<WriterProfileSettings | null> {
    const patch: Update<"writer_profiles"> = {};
    if (changes.isPublic !== undefined) patch.is_public = changes.isPublic;
    if (changes.publicNameAliasId !== undefined) patch.public_name_alias_id = changes.publicNameAliasId;
    if (changes.useAccountName !== undefined) patch.use_account_name = changes.useAccountName;
    // One choice at a time (the table's check): the pen name wins over a stale account-name flag, and the account name clears the pen name.
    if (changes.publicNameAliasId) patch.use_account_name = false;
    else if (changes.useAccountName) patch.public_name_alias_id = null;
    if (changes.bio !== undefined) patch.public_bio = changes.bio;
    if (Object.keys(patch).length === 0) return this.ofMember(memberId);
    const { data, error } = await this.db.from("writer_profiles").update(patch).eq("member_id", memberId).is("deleted_at", null).select(SETTINGS_COLUMNS).maybeSingle();
    if (error?.code === CHECK_VIOLATION) throw new PublicNameNotAllowedError();
    if (error) throw new Error(error.message);
    return toSettings(data);
  }

  async handleAvailability(memberId: string, handle: string, now: Date): Promise<HandleAvailability> {
    const [current, old] = await Promise.all([
      this.db.from("writer_profiles").select("member_id").eq("handle", handle).is("deleted_at", null).maybeSingle(),
      this.db.from("writer_profile_handles").select("member_id, reserved_until").eq("handle", handle).maybeSingle(),
    ]);
    const live = must(current);
    if (live) return live.member_id === memberId ? "yours" : "taken";
    const held = must(old);
    if (held && held.member_id !== memberId && new Date(held.reserved_until) > now) return "reserved";
    return "available";
  }

  async setHandle(memberId: string, handle: string, options: { reserveDays: number; now: Date }): Promise<SetHandleOutcome> {
    const { data, error } = await this.db.rpc("set_writer_handle", {
      p_member_id: memberId,
      p_handle: handle,
      p_reserve_days: options.reserveDays,
      p_now: options.now.toISOString(),
    });
    if (error?.code === UNIQUE_VIOLATION) return "taken";
    if (error) throw new Error(error.message);
    return data as SetHandleOutcome;
  }

  private async publicRow(column: "handle" | "member_id", value: string, onlyPublic: boolean): Promise<PublicRow | null> {
    let query = this.db.from("writer_profiles").select(PUBLIC_COLUMNS).eq(column, value).is("deleted_at", null);
    if (onlyPublic) query = query.eq("is_public", true);
    // The embedded member and pen name are single objects (many-to-one), which the generated types read as lists: typed by hand.
    return must(await query.maybeSingle().overrideTypes<PublicRow, { merge: false }>());
  }

  async publicByHandle(handle: string): Promise<PublicLookup> {
    const row = await this.publicRow("handle", handle, true);
    if (row) {
      const profile = toPublic(row);
      return profile ? { kind: "page", profile, ownerId: row.member_id } : { kind: "none" };
    }
    const old = must(await this.db.from("writer_profile_handles").select("member_id").eq("handle", handle).maybeSingle());
    if (!old) return { kind: "none" };
    const current = await this.publicRow("member_id", old.member_id, true);
    const profile = current ? toPublic(current) : null;
    return profile && current ? { kind: "redirect", handle: profile.handle, ownerId: current.member_id } : { kind: "none" };
  }

  async isOnForMember(memberId: string): Promise<boolean> {
    const row = await this.publicRow("member_id", memberId, true);
    return row !== null && toPublic(row) !== null;
  }

  async previewOfMember(memberId: string): Promise<PublicWriterProfile | null> {
    const row = await this.publicRow("member_id", memberId, false);
    return row ? toPublic(row) : null;
  }

  async publicCount(): Promise<number> {
    const { count, error } = await this.db.from("writer_profiles").select("id", { count: "exact", head: true }).eq("is_public", true).is("deleted_at", null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async publicHandles(page: number, pageSize: number): Promise<{ handle: string; updatedAt: string; memberId: string }[]> {
    // A file can hold more rows than one request returns (1000), so the window is read in batches of the unique `id`.
    const rows = await fetchRowWindow(page * pageSize, pageSize, (from, to) =>
      this.db
        .from("writer_profiles")
        .select("handle, updated_at, deleted_at, member_id, member:members!writer_profiles_member_id_fkey(status)")
        .eq("is_public", true)
        .is("deleted_at", null)
        .order("id")
        .range(from, to)
        // The embedded member is one object, which the generated types read as a list: typed by hand.
        .overrideTypes<{ handle: string; updated_at: string; deleted_at: string | null; member_id: string; member: { status: string } | null }[], { merge: false }>()
    );
    return rows
      .filter((r) => r.member && isProfilePubliclyServable({ deletedAt: r.deleted_at, memberStatus: r.member.status }))
      .map((r) => ({ handle: r.handle, updatedAt: r.updated_at, memberId: r.member_id }));
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** An id shaped like the database's `new_id(prefix)`: the prefix and 12 base58 characters. */
const newId = (prefix: string) => `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => BASE58[b % BASE58.length]).join("")}`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The in-memory twin: the same rules as the table and `set_writer_handle`, over the dataset's members, pen names and pages. */
export class InMemoryWriterProfileRepository implements WriterProfileRepository {
  constructor(private readonly data: InMemoryDataset) {}

  private live(): Row<"writer_profiles">[] {
    return this.data.writerProfiles.filter((p) => !p.deleted_at);
  }

  private ofMemberRow(memberId: string): Row<"writer_profiles"> | undefined {
    return this.live().find((p) => p.member_id === memberId);
  }

  async ofMember(memberId: string) {
    return toSettings(this.ofMemberRow(memberId));
  }

  async update(memberId: string, changes: WriterProfileChanges) {
    const row = this.ofMemberRow(memberId);
    if (!row) return null;
    if (changes.publicNameAliasId) {
      const alias = this.data.nameAliases.find((a) => a.id === changes.publicNameAliasId);
      if (!alias || alias.member_id !== memberId || !alias.isPublic || !alias.active || alias.source !== "member") throw new PublicNameNotAllowedError();
    }
    if (changes.isPublic !== undefined) row.is_public = changes.isPublic;
    if (changes.publicNameAliasId !== undefined) row.public_name_alias_id = changes.publicNameAliasId;
    if (changes.useAccountName !== undefined) row.use_account_name = changes.useAccountName;
    if (changes.publicNameAliasId) row.use_account_name = false;
    else if (changes.useAccountName) row.public_name_alias_id = null;
    if (changes.bio !== undefined) row.public_bio = changes.bio;
    const now = new Date().toISOString();
    if (row.is_public && !row.published_at) row.published_at = now;
    row.updated_at = now;
    return toSettings(row);
  }

  async handleAvailability(memberId: string, handle: string, now: Date): Promise<HandleAvailability> {
    const live = this.live().find((p) => p.handle === handle);
    if (live) return live.member_id === memberId ? "yours" : "taken";
    const held = this.data.writerProfileHandles.find((h) => h.handle === handle);
    if (held && held.member_id !== memberId && new Date(held.reserved_until) > now) return "reserved";
    return "available";
  }

  async setHandle(memberId: string, handle: string, options: { reserveDays: number; now: Date }): Promise<SetHandleOutcome> {
    const current = this.ofMemberRow(memberId);
    if (current?.handle === handle) return "unchanged";
    const availability = await this.handleAvailability(memberId, handle, options.now);
    if (availability === "taken") return "taken";
    if (availability === "reserved") return "reserved";
    // Taking back their own old handle, or one whose hold ran out, ends its redirect.
    this.data.writerProfileHandles = this.data.writerProfileHandles.filter((h) => h.handle !== handle);
    const at = options.now.toISOString();
    if (!current) {
      this.data.writerProfiles.push({
        id: newId("wpage"),
        member_id: memberId,
        handle,
        is_public: false,
        public_name_alias_id: null,
        use_account_name: false,
        public_bio: null,
        published_at: null,
        created_at: at,
        updated_at: at,
        deleted_at: null,
      });
      return "created";
    }
    const previous = current.handle;
    current.handle = handle;
    current.updated_at = at;
    this.data.writerProfileHandles.push({
      id: newId("whand"),
      handle: previous,
      member_id: memberId,
      released_at: at,
      reserved_until: new Date(options.now.getTime() + options.reserveDays * DAY_MS).toISOString(),
    });
    return "changed";
  }

  private toPublicRow(row: Row<"writer_profiles">): PublicRow {
    const member = this.data.members.find((m) => m.id === row.member_id);
    const alias = row.public_name_alias_id ? this.data.nameAliases.find((a) => a.id === row.public_name_alias_id) : undefined;
    return {
      handle: row.handle,
      public_bio: row.public_bio,
      published_at: row.published_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      member_id: row.member_id,
      public_name_alias_id: row.public_name_alias_id,
      use_account_name: row.use_account_name,
      member: member
        ? {
            name: member.name,
            display_name: member.displayName ?? null,
            photo_url: member.photoUrl ?? null,
            status: member.status ?? "active",
            bio: member.bio ?? null,
            instagram_url: member.instagramUrl ?? null,
            facebook_url: member.facebookUrl ?? null,
            twitter_url: member.twitterUrl ?? null,
            levels: this.data.memberProfileOverrides.find((o) => o.member_id === row.member_id) ?? null,
          }
        : null,
      alias: alias ? { alias: alias.alias, is_public: alias.isPublic ?? false, active: alias.active, source: alias.source, member_id: alias.member_id } : null,
    };
  }

  async publicByHandle(handle: string): Promise<PublicLookup> {
    const row = this.live().find((p) => p.handle === handle && p.is_public);
    if (row) {
      const profile = toPublic(this.toPublicRow(row));
      return profile ? { kind: "page", profile, ownerId: row.member_id } : { kind: "none" };
    }
    const old = this.data.writerProfileHandles.find((h) => h.handle === handle);
    const current = old ? this.live().find((p) => p.member_id === old.member_id && p.is_public) : undefined;
    const profile = current ? toPublic(this.toPublicRow(current)) : null;
    return profile && current ? { kind: "redirect", handle: profile.handle, ownerId: current.member_id } : { kind: "none" };
  }

  async isOnForMember(memberId: string) {
    const row = this.live().find((p) => p.member_id === memberId && p.is_public);
    return row !== undefined && toPublic(this.toPublicRow(row)) !== null;
  }

  async previewOfMember(memberId: string) {
    const row = this.ofMemberRow(memberId);
    return row ? toPublic(this.toPublicRow(row)) : null;
  }

  async publicCount() {
    return this.live().filter((p) => p.is_public).length;
  }

  async publicHandles(page: number, pageSize: number) {
    return this.live()
      .filter((p) => p.is_public)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(page * pageSize, page * pageSize + pageSize)
      .filter((p) => toPublic(this.toPublicRow(p)))
      .map((p) => ({ handle: p.handle, updatedAt: p.updated_at, memberId: p.member_id }));
  }
}
