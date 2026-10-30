import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors tests/lib/hosting-actions.test.ts's approach: these actions scope
// every read/write to effectiveIdentity.memberId (never a client-passed id).
// updateBook/deleteBook rely on RLS (member_id match OR is_admin()) to scope
// the row -- these tests verify the app-level "not found" handling around
// that, and that sudo correctly redirects writes to the sudo'd member.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/sudo", () => ({
  getEffectiveIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

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

/** A query builder where each step returns the same builder and `terminal` resolves the result. */
function chain(terminal: "order" | "single", result: () => Promise<unknown>, calls: unknown[][]) {
  const q: Record<string, unknown> = {};
  for (const step of ["eq", "is", "select"]) {
    q[step] = vi.fn((...args: unknown[]) => {
      calls.push([step, ...args]);
      return q;
    });
  }
  q[terminal] = vi.fn(() => result());
  return q;
}

function makeSupabaseMock({
  selectResult = { data: [], error: null } as any,
  writeError = undefined as string | undefined,
  updateSingleResult = { data: { id: "book-1" }, error: null } as any,
  previousCoverAssetId = null as string | null,
} = {}) {
  /** Filters applied to the last select/update, e.g. ["is", "deleted_at", null]. */
  const selectCalls: unknown[][] = [];
  const updateCalls: unknown[][] = [];

  const select = vi.fn(() => {
    const q = chain("order", () => Promise.resolve(selectResult), selectCalls);
    // updateBook reads the cover the book has now, to release it if it is replaced.
    q.maybeSingle = vi.fn().mockResolvedValue({ data: { cover_asset_id: previousCoverAssetId }, error: null });
    return q;
  });

  const insert = vi.fn().mockResolvedValue(writeError ? { error: { message: writeError } } : { error: null });

  // Edits and deletes are both updates (a delete sets deleted_at).
  const update = vi.fn(() =>
    chain("single", () => Promise.resolve(writeError ? { data: null, error: { message: writeError } } : updateSingleResult), updateCalls),
  );

  const from = vi.fn((table: string) => {
    if (table !== "member_books") throw new Error(`Unexpected table in test: ${table}`);
    return { select, insert, update };
  });

  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
    from,
    __select: select,
    __insert: insert,
    __update: update,
    __selectCalls: selectCalls,
    __updateCalls: updateCalls,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMyBooks", () => {
  it("returns an empty list when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    mock.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await getMyBooks();
    expect(result).toEqual([]);
    expect(mock.__select).not.toHaveBeenCalled();
  });

  it("returns an empty list when there is no member record", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);

    const result = await getMyBooks();
    expect(result).toEqual([]);
  });

  it("maps rows from snake_case columns to the camelCase MyBookRow shape", async () => {
    const mock = makeSupabaseMock({
      selectResult: {
        data: [
          {
            id: "book-1",
            title: "My Book",
            description: "A tale.",
            cover_url: "https://example.com/cover.jpg",
            purchase_url: "https://example.com/buy",
            published_date: "2026-03-15",
            price: 17.99,
            genre: "Fantasy",
            format: "ebook",
            project_id: "project-1",
          },
        ],
        error: null,
      },
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await getMyBooks();
    // A book the member deleted stays in the table but never comes back here.
    expect(mock.__selectCalls).toContainEqual(["is", "deleted_at", null]);
    expect(result).toEqual([
      {
        id: "book-1",
        title: "My Book",
        description: "A tale.",
        coverUrl: "https://example.com/cover.jpg",
        purchaseUrl: "https://example.com/buy",
        publishedDate: "2026-03-15",
        price: 17.99,
        genre: "Fantasy",
        format: "ebook",
        projectId: "project-1",
        coverAsset: null,
      },
    ]);
  });

  it("carries the library image behind a cover, with its size, for the Amazon download", async () => {
    const mock = makeSupabaseMock({
      selectResult: {
        data: [{ id: "book-1", title: "T", description: null, cover_url: "/api/media/media_AAAAAAAAAAA1/book_cover_shelf", purchase_url: "https://example.com/b", published_date: "2026-03-15", price: null, genre: null, format: "print", project_id: null, pen_name: null, cover_asset: { id: "media_AAAAAAAAAAA1", width: 1600, height: 2560 } }],
        error: null,
      },
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect((await getMyBooks())[0].coverAsset).toEqual({ id: "media_AAAAAAAAAAA1", width: 1600, height: 2560 });
    expect(mock.__select).toHaveBeenCalledWith(expect.stringContaining("cover_asset:media_assets(id, width, height)"));
  });
});

describe("addBook", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    mock.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await addBook(VALID_INPUT);
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects a missing title before touching the database", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await addBook({ ...VALID_INPUT, title: "   " });
    expect(result).toEqual({ error: "Title is required" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects a missing publication date before touching the database", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await addBook({ ...VALID_INPUT, publishedDate: "" });
    expect(result).toEqual({ error: "Publication date is required" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects a missing cover image before touching the database", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await addBook({ ...VALID_INPUT, coverUrl: "" });
    expect(result).toEqual({ error: "Cover image is required" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects a missing purchase link before touching the database", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await addBook({ ...VALID_INPUT, purchaseUrl: "" });
    expect(result).toEqual({ error: "Where to buy it is required" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("rejects an unsafe purchase link before touching the database", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await addBook({ ...VALID_INPUT, purchaseUrl: "javascript:alert(1)" });
    expect(result).toEqual({ error: "Enter a valid link (starting with https://) for where to buy it" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("scopes the insert to the acting member and trims text", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await addBook(VALID_INPUT);
    expect(result).toEqual({ success: true });
    expect(mock.__insert).toHaveBeenCalledWith({
      member_id: "member-1",
      title: "My Book",
      description: "A tale.",
      cover_url: "https://example.com/cover.jpg",
      cover_asset_id: null,
      purchase_url: "https://example.com/buy",
      published_date: "2026-03-15",
      price: null,
      genre: null,
      format: "print",
      pen_name: null,
    });
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
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(SUDO_IDENTITY);

    await addBook(VALID_INPUT);
    expect(mock.__insert).toHaveBeenCalledWith(
      expect.objectContaining({ member_id: "sudo-target-member" })
    );
  });

  it("surfaces an insert error", async () => {
    const mock = makeSupabaseMock({ writeError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await addBook(VALID_INPUT);
    expect(result).toEqual({ error: "boom" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(notifyStaffNewBook).not.toHaveBeenCalled();
  });
});

describe("updateBook", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    mock.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await updateBook("book-1", VALID_INPUT);
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("rejects an invalid input before touching the database", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateBook("book-1", { ...VALID_INPUT, title: "" });
    expect(result).toEqual({ error: "Title is required" });
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("reports 'Book not found' when RLS scopes away the row (not owned)", async () => {
    const mock = makeSupabaseMock({ updateSingleResult: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateBook("someone-elses-book", VALID_INPUT);
    expect(result).toEqual({ error: "Book not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates the row and revalidates on success", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateBook("book-1", VALID_INPUT);
    expect(result).toEqual({ success: true });
    expect(mock.__update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "My Book", purchase_url: "https://example.com/buy" })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
  });

  it("surfaces an update error", async () => {
    const mock = makeSupabaseMock({ writeError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await updateBook("book-1", VALID_INPUT);
    expect(result).toEqual({ error: "boom" });
  });
});

describe("deleteBook", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    mock.auth.getClaims = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await deleteBook("book-1");
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("reports 'Book not found' when RLS scopes away the row (not owned)", async () => {
    const mock = makeSupabaseMock({ updateSingleResult: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await deleteBook("someone-elses-book");
    expect(result).toEqual({ error: "Book not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("soft-deletes the row (sets deleted_at, keeps it) and revalidates on success", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await deleteBook("book-1");
    expect(result).toEqual({ success: true });
    expect(mock.__update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(mock.__updateCalls).toContainEqual(["is", "deleted_at", null]);
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
  });

  it("surfaces a delete error", async () => {
    const mock = makeSupabaseMock({ writeError: "boom" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await deleteBook("book-1");
    expect(result).toEqual({ error: "boom" });
  });
});

describe("pen names", () => {
  it("getMyBooks returns the pen name a book is published under", async () => {
    const mock = makeSupabaseMock({
      selectResult: {
        data: [{ id: "book-1", title: "T", description: null, cover_url: "https://example.com/c.jpg", purchase_url: "https://example.com/b", published_date: "2026-03-15", price: null, genre: null, format: "print", project_id: null, pen_name: "A. E. Byron" }],
        error: null,
      },
    });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect((await getMyBooks())[0].penName).toBe("A. E. Byron");
  });

  it("addBook stores the chosen pen name", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await addBook({ ...VALID_INPUT, penName: "A. E. Byron" })).toEqual({ success: true });
    expect(mock.__insert).toHaveBeenCalledWith(expect.objectContaining({ pen_name: "A. E. Byron" }));
  });

  it("addBook refuses a name that is not the member's own, without inserting", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await addBook({ ...VALID_INPUT, penName: "Not Mine" })).toEqual({ error: "Pick one of your own names" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("updateBook stores the pen name, and clears it when blank", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await updateBook("book-1", { ...VALID_INPUT, penName: "A. E. Byron" });
    await updateBook("book-1", { ...VALID_INPUT, penName: "" });
    expect(mock.__update).toHaveBeenNthCalledWith(1, expect.objectContaining({ pen_name: "A. E. Byron" }));
    expect(mock.__update).toHaveBeenNthCalledWith(2, expect.objectContaining({ pen_name: null }));
  });

  it("updateBook refuses a name that is not the member's own", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await updateBook("book-1", { ...VALID_INPUT, penName: "Not Mine" })).toEqual({ error: "Pick one of your own names" });
    expect(mock.__update).not.toHaveBeenCalled();
  });

  it("getMyPenNameOptions looks up the acting member's options, and is null when signed out", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(SUDO_IDENTITY);
    vi.mocked(getPenNameOptions).mockResolvedValue({ defaultName: "Sudo Target", others: ["Pen"] });

    expect(await getMyPenNameOptions()).toEqual({ defaultName: "Sudo Target", others: ["Pen"] });
    expect(getPenNameOptions).toHaveBeenCalledWith(mock, "sudo-target-member");

    vi.mocked(getEffectiveIdentity).mockResolvedValue(null);
    expect(await getMyPenNameOptions()).toBeNull();
  });
});

describe("library covers", () => {
  const LIBRARY_COVER = "/api/media/media_AAAAAAAAAAA1/book_cover_shelf";

  it("addBook stores the cover's URL and its asset, as checked by resolveBookCover", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
    vi.mocked(resolveBookCover).mockResolvedValueOnce({ url: LIBRARY_COVER, assetId: "media_AAAAAAAAAAA1" });

    expect(await addBook({ ...VALID_INPUT, coverUrl: LIBRARY_COVER })).toEqual({ success: true });
    expect(resolveBookCover).toHaveBeenCalledWith(expect.anything(), "member-1", LIBRARY_COVER);
    expect(mock.__insert).toHaveBeenCalledWith(expect.objectContaining({ cover_url: LIBRARY_COVER, cover_asset_id: "media_AAAAAAAAAAA1" }));
  });

  it("addBook refuses a cover that isn't the member's own, without inserting", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
    vi.mocked(resolveBookCover).mockResolvedValueOnce({ error: "That cover isn't one of yours: upload it again" });

    expect(await addBook({ ...VALID_INPUT, coverUrl: LIBRARY_COVER })).toEqual({ error: "That cover isn't one of yours: upload it again" });
    expect(mock.__insert).not.toHaveBeenCalled();
  });

  it("updateBook stores the new cover and releases the one it replaced", async () => {
    const mock = makeSupabaseMock({ previousCoverAssetId: "media_OLDOLDOLDOL1" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);
    vi.mocked(resolveBookCover).mockResolvedValueOnce({ url: LIBRARY_COVER, assetId: "media_AAAAAAAAAAA1" });

    expect(await updateBook("book-1", { ...VALID_INPUT, coverUrl: LIBRARY_COVER })).toEqual({ success: true });
    expect(mock.__update).toHaveBeenCalledWith(expect.objectContaining({ cover_url: LIBRARY_COVER, cover_asset_id: "media_AAAAAAAAAAA1" }));
    expect(releaseReplacedCover).toHaveBeenCalledWith(expect.anything(), "member-1", "media_OLDOLDOLDOL1", "media_AAAAAAAAAAA1");
  });

  it("updateBook switching to an ordinary link clears the asset and releases the old cover", async () => {
    const mock = makeSupabaseMock({ previousCoverAssetId: "media_OLDOLDOLDOL1" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await updateBook("book-1", VALID_INPUT);
    expect(mock.__update).toHaveBeenCalledWith(expect.objectContaining({ cover_url: "https://example.com/cover.jpg", cover_asset_id: null }));
    expect(releaseReplacedCover).toHaveBeenCalledWith(expect.anything(), "member-1", "media_OLDOLDOLDOL1", null);
  });

  it("updateBook releases nothing when the update didn't happen", async () => {
    const mock = makeSupabaseMock({ updateSingleResult: { data: null, error: null }, previousCoverAssetId: "media_OLDOLDOLDOL1" });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await updateBook("someone-elses-book", VALID_INPUT)).toEqual({ error: "Book not found" });
    expect(releaseReplacedCover).not.toHaveBeenCalled();
  });
});
