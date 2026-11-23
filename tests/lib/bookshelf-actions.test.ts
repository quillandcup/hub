import { describe, it, expect, vi, beforeEach } from "vitest";

// These actions scope every read/write to effectiveIdentity.memberId (never a client-passed id).
// updateBook/deleteBook rely on RLS (member_id match OR is_admin()) to scope the row -- these tests
// verify the app-level "not found" handling around that, and that sudo correctly redirects writes to
// the sudo'd member. The bookshelf is the in-memory twin (tests/lib/data/books-in-memory.test.ts
// holds the contract it shares with the real table).

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const recorded = vi.hoisted(() => [] as Array<{ action: string; outcome: unknown }>);
vi.mock("@/lib/analytics/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/server")>();
  return {
    ...actual,
    withAction: async (action: string, run: () => Promise<unknown>, classify: (r: unknown) => unknown = actual.actionOutcome) => {
      const result = await run();
      recorded.push({ action, outcome: classify(result) });
      return result;
    },
  };
});

const store = vi.hoisted(() => ({ repos: undefined as unknown as import("@/lib/data/repos").Repos }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: () => store.repos };
});

vi.mock("@/lib/book-pen-name", () => ({
  getPenNameOptions: vi.fn(),
  // Same contract as the real one, without the member and alias lookups (tests/lib/book-pen-name.test.ts).
  resolvePenName: vi.fn(async (_db: unknown, _memberId: string, penName?: string | null) =>
    penName === "Not Mine" ? { error: "Pick one of your own names" } : { penName: penName?.trim() || null },
  ),
}));

// The real helpers, except where a test needs a library cover: they are tested against the in-memory library in
// tests/lib/book-cover-assets.test.ts.
vi.mock("@/lib/book-cover-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/book-cover-assets")>();
  return { ...actual, resolveBookCover: vi.fn(actual.resolveBookCover), releaseReplacedCover: vi.fn(actual.releaseReplacedCover) };
});

vi.mock("@/lib/slack", () => ({
  celebrateNewBook: vi.fn().mockResolvedValue(undefined),
}));

import { getMyBooks, getMyPenNameOptions, addBook, updateBook, deleteBook, setBookVisibility, type BookInput } from "@/app/(member)/bookshelf/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath, revalidateTag } from "next/cache";
import { celebrateNewBook } from "@/lib/slack";
import { getPenNameOptions } from "@/lib/book-pen-name";
import { releaseReplacedCover, resolveBookCover } from "@/lib/book-cover-assets";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const IDENTITY = {
  memberId: "member-1",
  memberName: "Member One",
  memberDisplayName: "Ada Display",
  memberEmail: "m1@example.com",
  isSudo: false,
};

const SUDO_IDENTITY = {
  memberId: "sudo-target-member",
  memberName: "Sudo Target",
  memberEmail: "target@example.com",
  isSudo: true,
};

const VALID_INPUT: BookInput = {
  title: "  My Book  ",
  publishedDate: "2026-03-15",
  description: "  A tale.  ",
  coverUrl: "https://example.com/cover.jpg",
  editions: [{ format: "print", purchaseUrl: "https://example.com/buy", price: null }],
};

const LIBRARY_COVER = "/api/media/media_AAAAAAAAAAA1/book_cover_shelf";

let data: InMemoryDataset;
let supabase: { auth: { getClaims: ReturnType<typeof vi.fn> } };

/** Puts a book on the shelf and returns its id. */
const shelve = (extra: Partial<InMemoryDataset["memberBooks"][number]> = {}) => {
  const id = extra.id ?? "book-1";
  data.memberBooks.push({ id, member_id: "member-1", title: "Existing", published_date: "2026-01-01", cover_asset_id: null, ...extra });
  return id;
};
const book = (id: string) => data.memberBooks.find((b) => b.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  data = new InMemoryDataset({
    members: [
      { id: "member-1", name: "Member One" },
      { id: "sudo-target-member", name: "Sudo Target" },
      { id: "member-2", name: "Member Two" },
    ],
  });
  store.repos = createInMemoryRepos(data);
  supabase = { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) } };
  vi.mocked(createClient).mockResolvedValue(supabase as never);
  vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
});

const signedOut = () => {
  supabase.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
};

describe("getMyBooks", () => {
  it("returns an empty list when there is no authenticated user", async () => {
    signedOut();
    shelve();
    expect(await getMyBooks()).toEqual([]);
  });

  it("returns an empty list when there is no member record", async () => {
    shelve();
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await getMyBooks()).toEqual([]);
  });

  it("maps rows from snake_case columns to the camelCase MyBookRow shape, for this member's live books only", async () => {
    shelve({
      id: "book-1",
      title: "My Book",
      description: "A tale.",
      cover_url: "https://example.com/cover.jpg",
      published_date: "2026-03-15",
      editions: [
        { format: "ebook", purchase_url: "https://example.com/ebook", price: 4.99 },
        { format: "print", purchase_url: "https://example.com/buy", price: 17.99 },
      ],
      genres: ["Fantasy"],
      project_id: "project-1",
    });
    shelve({ id: "book-gone", deleted_at: "2026-04-01T00:00:00Z" }); // a book the member deleted stays in the table but never comes back here
    shelve({ id: "book-theirs", member_id: "member-2" });

    expect(await getMyBooks()).toEqual([
      {
        id: "book-1",
        title: "My Book",
        description: "A tale.",
        coverUrl: "https://example.com/cover.jpg",
        publishedDate: "2026-03-15",
        editions: [
          { format: "print", purchaseUrl: "https://example.com/buy", price: 17.99 },
          { format: "ebook", purchaseUrl: "https://example.com/ebook", price: 4.99 },
        ],
        genres: ["Fantasy"],
        penName: null,
        projectId: "project-1",
        coverAsset: null,
        visibility: "public",
        webAuthor: null,
      },
    ]);
  });

  it("carries the library image behind a cover, with its size, for the Amazon download", async () => {
    const asset = await store.repos.media.add({ storage_path: "originals/c.png", mime_type: "image/png", width: 1600, height: 2560, bytes: 1, sha256: "abc", title: "Cover" });
    shelve({ cover_url: LIBRARY_COVER, cover_asset_id: asset.id });
    expect((await getMyBooks())[0].coverAsset).toEqual({ id: asset.id, width: 1600, height: 2560 });
  });
});

describe("addBook", () => {
  it("rejects when there is no authenticated user", async () => {
    signedOut();
    expect(await addBook(VALID_INPUT)).toEqual({ error: "Not authenticated" });
    expect(data.memberBooks).toEqual([]);
  });

  it("rejects when there is no member record", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await addBook(VALID_INPUT)).toEqual({ error: "No member record" });
  });

  it.each([
    [{ title: "   " }, "Title is required"],
    [{ publishedDate: "" }, "Publication date is required"],
    [{ coverUrl: "" }, "Cover image is required"],
    [{ editions: [] }, "Add at least one way to buy it, print or ebook"],
    [{ editions: [{ format: "print" as const, purchaseUrl: "" }] }, "Where to buy the print edition is required"],
    [{ editions: [{ format: "ebook" as const, purchaseUrl: "javascript:alert(1)" }] }, "Enter a valid link (starting with https://) for where to buy the ebook edition"],
    [{ editions: [{ format: "print" as const, purchaseUrl: "https://example.com/a" }, { format: "print" as const, purchaseUrl: "https://example.com/b" }] }, "Only one print edition per book"],
    [{ editions: [{ format: "print" as const, purchaseUrl: "https://example.com/a", price: -1 }] }, "The print price must be zero or more"],
  ])("rejects an invalid input %j before touching the database", async (change, message) => {
    expect(await addBook({ ...VALID_INPUT, ...change })).toEqual({ error: message });
    expect(data.memberBooks).toEqual([]);
  });

  it("scopes the insert to the acting member and trims text", async () => {
    expect(await addBook(VALID_INPUT)).toEqual({ success: true });
    expect(data.memberBooks).toEqual([
      expect.objectContaining({
        member_id: "member-1",
        title: "My Book",
        description: "A tale.",
        cover_url: "https://example.com/cover.jpg",
        cover_asset_id: null,
        editions: [{ format: "print", purchase_url: "https://example.com/buy", price: null }],
        published_date: "2026-03-15",
        genres: [],
        pen_name: null,
      }),
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
    expect(celebrateNewBook).toHaveBeenCalledWith({
      title: "My Book",
      memberId: "member-1",
      memberName: "Ada Display",
      purchaseUrl: "https://example.com/buy",
    });
  });

  it("saves a print and an ebook edition on one book, each with its own link and price", async () => {
    const input: BookInput = {
      ...VALID_INPUT,
      editions: [
        { format: "ebook", purchaseUrl: "  https://example.com/ebook  ", price: 4.99 },
        { format: "print", purchaseUrl: "https://example.com/buy", price: 17.99 },
      ],
    };
    expect(await addBook(input)).toEqual({ success: true });
    expect(data.memberBooks).toHaveLength(1);
    expect((await getMyBooks())[0].editions).toEqual([
      { format: "print", purchaseUrl: "https://example.com/buy", price: 17.99 },
      { format: "ebook", purchaseUrl: "https://example.com/ebook", price: 4.99 },
    ]);
  });

  it("scopes the insert to the sudo'd member, not the real admin, while sudo'd", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(SUDO_IDENTITY);
    await addBook(VALID_INPUT);
    expect(data.memberBooks).toEqual([expect.objectContaining({ member_id: "sudo-target-member" })]);
  });

  it("surfaces an insert error", async () => {
    vi.spyOn(store.repos.books, "add").mockRejectedValueOnce(new Error("boom"));
    expect(await addBook(VALID_INPUT)).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(celebrateNewBook).not.toHaveBeenCalled();
  });

  it("doesn't fail when the staff Slack notification does", async () => {
    vi.mocked(celebrateNewBook).mockRejectedValueOnce(new Error("slack down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await addBook(VALID_INPUT)).toEqual({ success: true });
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("New book Slack notification failed:", expect.any(Error)));
    log.mockRestore();
  });
});

describe("updateBook", () => {
  it("rejects when there is no authenticated user", async () => {
    signedOut();
    shelve();
    expect(await updateBook("book-1", VALID_INPUT)).toEqual({ error: "Not authenticated" });
    expect(book("book-1")?.title).toBe("Existing");
  });

  it("rejects an invalid input before touching the database", async () => {
    shelve();
    expect(await updateBook("book-1", { ...VALID_INPUT, title: "" })).toEqual({ error: "Title is required" });
    expect(book("book-1")?.title).toBe("Existing");
  });

  it("reports 'Book not found' when the row isn't there for them (RLS scopes it away, or it was deleted)", async () => {
    shelve({ id: "gone", deleted_at: "2026-04-01T00:00:00Z" });
    expect(await updateBook("someone-elses-book", VALID_INPUT)).toEqual({ error: "Book not found" });
    expect(await updateBook("gone", VALID_INPUT)).toEqual({ error: "Book not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates the row and revalidates on success", async () => {
    shelve();
    expect(await updateBook("book-1", VALID_INPUT)).toEqual({ success: true });
    expect(book("book-1")).toMatchObject({ title: "My Book", editions: [{ format: "print", purchase_url: "https://example.com/buy", price: null }] });
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
  });

  it("surfaces an update error, and a failure to read the current cover", async () => {
    shelve();
    vi.spyOn(store.repos.books, "update").mockRejectedValueOnce(new Error("boom"));
    expect(await updateBook("book-1", VALID_INPUT)).toEqual({ error: "boom" });
    vi.spyOn(store.repos.books, "coverAssetIdOf").mockRejectedValueOnce(new Error("read failed"));
    expect(await updateBook("book-1", VALID_INPUT)).toEqual({ error: "read failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteBook", () => {
  it("rejects when there is no authenticated user", async () => {
    signedOut();
    shelve();
    expect(await deleteBook("book-1")).toEqual({ error: "Not authenticated" });
    expect(book("book-1")?.deleted_at ?? null).toBeNull();
  });

  it("reports 'Book not found' when the row isn't there for them (not owned, or already deleted)", async () => {
    shelve({ id: "gone", deleted_at: "2026-04-01T00:00:00Z" });
    expect(await deleteBook("someone-elses-book")).toEqual({ error: "Book not found" });
    expect(await deleteBook("gone")).toEqual({ error: "Book not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("soft-deletes the row (sets deleted_at, keeps it) and revalidates on success", async () => {
    shelve();
    expect(await deleteBook("book-1")).toEqual({ success: true });
    expect(book("book-1")?.deleted_at).toEqual(expect.any(String));
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
  });

  it("surfaces a delete error", async () => {
    shelve();
    vi.spyOn(store.repos.books, "remove").mockRejectedValueOnce(new Error("boom"));
    expect(await deleteBook("book-1")).toEqual({ error: "boom" });
  });
});

describe("pen names", () => {
  it("getMyBooks returns the pen name a book is published under", async () => {
    shelve({ pen_name: "A. E. Byron" });
    expect((await getMyBooks())[0].penName).toBe("A. E. Byron");
  });

  it("addBook stores the chosen pen name", async () => {
    expect(await addBook({ ...VALID_INPUT, penName: "A. E. Byron" })).toEqual({ success: true });
    expect(data.memberBooks).toEqual([expect.objectContaining({ pen_name: "A. E. Byron" })]);
  });

  it("addBook refuses a name that is not the member's own, without inserting", async () => {
    expect(await addBook({ ...VALID_INPUT, penName: "Not Mine" })).toEqual({ error: "Pick one of your own names" });
    expect(data.memberBooks).toEqual([]);
  });

  it("updateBook stores the pen name, and clears it when blank", async () => {
    shelve();
    await updateBook("book-1", { ...VALID_INPUT, penName: "A. E. Byron" });
    expect(book("book-1")?.pen_name).toBe("A. E. Byron");
    await updateBook("book-1", { ...VALID_INPUT, penName: "" });
    expect(book("book-1")?.pen_name).toBeNull();
  });

  it("updateBook refuses a name that is not the member's own", async () => {
    shelve();
    expect(await updateBook("book-1", { ...VALID_INPUT, penName: "Not Mine" })).toEqual({ error: "Pick one of your own names" });
    expect(book("book-1")?.title).toBe("Existing");
  });

  it("getMyPenNameOptions looks up the acting member's options, and is null when signed out", async () => {
    vi.mocked(getEffectiveIdentity).mockResolvedValue(SUDO_IDENTITY);
    vi.mocked(getPenNameOptions).mockResolvedValue({ defaultName: "Sudo Target", others: ["Pen"] });

    expect(await getMyPenNameOptions()).toEqual({ defaultName: "Sudo Target", others: ["Pen"] });
    expect(getPenNameOptions).toHaveBeenCalledWith(supabase, "sudo-target-member");

    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await getMyPenNameOptions()).toBeNull();
  });
});

describe("library covers", () => {
  it("addBook stores the cover's URL and its asset, as checked by resolveBookCover", async () => {
    vi.mocked(resolveBookCover).mockResolvedValueOnce({ url: LIBRARY_COVER, assetId: "media_AAAAAAAAAAA1" });

    expect(await addBook({ ...VALID_INPUT, coverUrl: LIBRARY_COVER })).toEqual({ success: true });
    expect(resolveBookCover).toHaveBeenCalledWith(expect.anything(), "member-1", LIBRARY_COVER);
    expect(data.memberBooks).toEqual([expect.objectContaining({ cover_url: LIBRARY_COVER, cover_asset_id: "media_AAAAAAAAAAA1" })]);
  });

  it("addBook refuses a cover that isn't the member's own, without inserting", async () => {
    vi.mocked(resolveBookCover).mockResolvedValueOnce({ error: "That cover isn't one of yours: upload it again" });

    expect(await addBook({ ...VALID_INPUT, coverUrl: LIBRARY_COVER })).toEqual({ error: "That cover isn't one of yours: upload it again" });
    expect(data.memberBooks).toEqual([]);
  });

  it("updateBook stores the new cover and releases the one it replaced", async () => {
    shelve({ cover_asset_id: "media_OLDOLDOLDOL1" });
    vi.mocked(resolveBookCover).mockResolvedValueOnce({ url: LIBRARY_COVER, assetId: "media_AAAAAAAAAAA1" });

    expect(await updateBook("book-1", { ...VALID_INPUT, coverUrl: LIBRARY_COVER })).toEqual({ success: true });
    expect(book("book-1")).toMatchObject({ cover_url: LIBRARY_COVER, cover_asset_id: "media_AAAAAAAAAAA1" });
    expect(releaseReplacedCover).toHaveBeenCalledWith(expect.anything(), "member-1", "media_OLDOLDOLDOL1", "media_AAAAAAAAAAA1");
  });

  it("updateBook switching to an ordinary link clears the asset and releases the old cover", async () => {
    shelve({ cover_asset_id: "media_OLDOLDOLDOL1" });

    await updateBook("book-1", VALID_INPUT);
    expect(book("book-1")).toMatchObject({ cover_url: "https://example.com/cover.jpg", cover_asset_id: null });
    expect(releaseReplacedCover).toHaveBeenCalledWith(expect.anything(), "member-1", "media_OLDOLDOLDOL1", null);
  });

  it("updateBook releases nothing when the update didn't happen", async () => {
    shelve({ id: "book-1", member_id: "member-2", cover_asset_id: "media_OLDOLDOLDOL1", deleted_at: "2026-04-01T00:00:00Z" });

    expect(await updateBook("book-1", VALID_INPUT)).toEqual({ error: "Book not found" });
    expect(releaseReplacedCover).not.toHaveBeenCalled();
  });
});

describe("setBookVisibility", () => {
  it("saves the level on the member's own book, revalidates what shows it, drops the public cache, and records the level", async () => {
    shelve();
    expect(await setBookVisibility("book-1", "private")).toEqual({ success: true });
    expect(book("book-1")?.visibility).toBe("private");
    expect(await setBookVisibility("book-1", "community")).toEqual({ success: true });
    expect(book("book-1")?.visibility).toBe("community");
    expect(await setBookVisibility("book-1", "public")).toEqual({ success: true });
    expect(book("book-1")?.visibility).toBe("public");
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
    expect(revalidateTag).toHaveBeenCalledWith("landing-live", { expire: 0 });
    expect(recorded).toEqual([
      { action: "book_visibility_set", outcome: { ok: true, detail: "private" } },
      { action: "book_visibility_set", outcome: { ok: true, detail: "community" } },
      { action: "book_visibility_set", outcome: { ok: true, detail: "public" } },
    ]);
  });

  it("changes nothing else about the book, and writes nothing when the level is already that one", async () => {
    shelve({ title: "Keep Me", description: "Words.", pen_name: "A. Pen" });
    const before = JSON.stringify(book("book-1"));
    expect(await setBookVisibility("book-1", "public")).toEqual({ success: true });
    expect(JSON.stringify(book("book-1"))).toBe(before);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    await setBookVisibility("book-1", "private");
    expect(book("book-1")).toMatchObject({ title: "Keep Me", description: "Words.", pen_name: "A. Pen", visibility: "private" });
  });

  it("refuses a level that is not private, community or public", async () => {
    shelve();
    expect(await setBookVisibility("book-1", "everyone")).toEqual({ error: "That choice is not available." });
    expect(await setBookVisibility("book-1", "")).toEqual({ error: "That choice is not available." });
    expect(book("book-1")?.visibility ?? "public").toBe("public");
    expect(recorded.at(-1)).toEqual({ action: "book_visibility_set", outcome: { ok: false, detail: undefined } });
  });

  it("refuses a book that is not the member's own, or is gone, or does not exist, and writes nothing", async () => {
    shelve({ id: "book-theirs", member_id: "member-2" });
    shelve({ id: "book-gone", deleted_at: "2026-04-01T00:00:00Z" });
    for (const id of ["book-theirs", "book-gone", "book-nope", ""]) {
      expect(await setBookVisibility(id, "private")).toEqual({ error: "Book not found" });
    }
    expect(book("book-theirs")?.visibility ?? "public").toBe("public");
    expect(book("book-gone")?.visibility ?? "public").toBe("public");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("is refused in sudo: staff acting as the member can look but not choose what the member shows the web", async () => {
    shelve({ member_id: "sudo-target-member" });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(SUDO_IDENTITY);
    expect(await setBookVisibility("book-1", "private")).toEqual({ error: "Only the member can change who sees their book." });
    expect(book("book-1")?.visibility ?? "public").toBe("public");
  });

  it("rejects when nobody is signed in or there is no member record", async () => {
    shelve();
    signedOut();
    expect(await setBookVisibility("book-1", "private")).toEqual({ error: "Not authenticated" });
    supabase.auth.getClaims = vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null });
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await setBookVisibility("book-1", "private")).toEqual({ error: "No member record" });
  });

  it("says it could not save, without the database's words, when the write fails", async () => {
    shelve();
    vi.spyOn(store.repos.books, "update").mockRejectedValue(new Error("connection reset by peer"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setBookVisibility("book-1", "private")).toEqual({ error: "We couldn't save that. Please try again in a moment." });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("reports a book removed between the read and the write as not found", async () => {
    shelve();
    vi.spyOn(store.repos.books, "update").mockResolvedValue(false);
    expect(await setBookVisibility("book-1", "private")).toEqual({ error: "Book not found" });
  });
});

describe("a book removed or edited reaches the public Bookshelf at once", () => {
  it("drops the cached public books after an edit, a removal and an addition", async () => {
    shelve();
    await updateBook("book-1", VALID_INPUT);
    await deleteBook("book-1");
    await addBook(VALID_INPUT);
    expect(vi.mocked(revalidateTag).mock.calls.filter(([tag]) => tag === "landing-live")).toHaveLength(3);
  });
});

describe("getMyBooks: the name a book has on the web", () => {
  it("is the book's pen name, else the member's display name, else null (never the account name)", async () => {
    data.members.find((m) => m.id === "member-1")!.displayName = "Ada Display";
    shelve({ id: "a", pen_name: "A. Pen" });
    shelve({ id: "b" });
    expect((await getMyBooks()).map((b) => [b.id, b.webAuthor]).sort()).toEqual([["a", "A. Pen"], ["b", "Ada Display"]]);
    data.members.find((m) => m.id === "member-1")!.displayName = null;
    expect((await getMyBooks()).map((b) => [b.id, b.webAuthor]).sort()).toEqual([["a", "A. Pen"], ["b", null]]);
  });
});
