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
}));

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
  notifyStaffNewBook: vi.fn().mockResolvedValue(undefined),
}));

import { getMyBooks, getMyPenNameOptions, addBook, updateBook, deleteBook, type BookInput } from "@/app/(member)/bookshelf/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";
import { notifyStaffNewBook } from "@/lib/slack";
import { getPenNameOptions } from "@/lib/book-pen-name";
import { releaseReplacedCover, resolveBookCover } from "@/lib/book-cover-assets";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const IDENTITY = {
  memberId: "member-1",
  memberName: "Member One",
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
  purchaseUrl: "https://example.com/buy",
  format: "print",
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
      purchase_url: "https://example.com/buy",
      published_date: "2026-03-15",
      price: 17.99,
      genres: ["Fantasy"],
      format: "ebook",
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
        purchaseUrl: "https://example.com/buy",
        publishedDate: "2026-03-15",
        price: 17.99,
        genres: ["Fantasy"],
        format: "ebook",
        penName: null,
        projectId: "project-1",
        coverAsset: null,
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
    [{ purchaseUrl: "" }, "Where to buy it is required"],
    [{ purchaseUrl: "javascript:alert(1)" }, "Enter a valid link (starting with https://) for where to buy it"],
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
        purchase_url: "https://example.com/buy",
        published_date: "2026-03-15",
        price: null,
        genres: [],
        format: "print",
        pen_name: null,
      }),
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
    expect(notifyStaffNewBook).toHaveBeenCalledWith({
      title: "My Book",
      memberId: "member-1",
      memberName: "Member One",
      purchaseUrl: "https://example.com/buy",
    });
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
    expect(notifyStaffNewBook).not.toHaveBeenCalled();
  });

  it("doesn't fail when the staff Slack notification does", async () => {
    vi.mocked(notifyStaffNewBook).mockRejectedValueOnce(new Error("slack down"));
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
    expect(book("book-1")).toMatchObject({ title: "My Book", purchase_url: "https://example.com/buy" });
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
