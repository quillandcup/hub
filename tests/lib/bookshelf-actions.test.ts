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

import { getMyBooks, addBook, updateBook, deleteBook, type BookInput } from "@/app/(member)/bookshelf/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { revalidatePath } from "next/cache";

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

function makeSupabaseMock({
  selectResult = { data: [], error: null } as any,
  writeError = undefined as string | undefined,
  updateSingleResult = { data: { id: "book-1" }, error: null } as any,
  deleteSingleResult = { data: { id: "book-1" }, error: null } as any,
} = {}) {
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      order: vi.fn().mockResolvedValue(selectResult),
    })),
  }));

  const insert = vi.fn().mockResolvedValue(writeError ? { error: { message: writeError } } : { error: null });

  const updateSingle = vi
    .fn()
    .mockResolvedValue(writeError ? { data: null, error: { message: writeError } } : updateSingleResult);
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({ single: updateSingle })),
    })),
  }));

  const deleteSingle = vi
    .fn()
    .mockResolvedValue(writeError ? { data: null, error: { message: writeError } } : deleteSingleResult);
  const del = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({ single: deleteSingle })),
    })),
  }));

  const from = vi.fn((table: string) => {
    if (table !== "member_books") throw new Error(`Unexpected table in test: ${table}`);
    return { select, insert, update, delete: del };
  });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-user-1" } } }) },
    from,
    __select: select,
    __insert: insert,
    __update: update,
    __delete: del,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getMyBooks", () => {
  it("returns an empty list when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    mock.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } });
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
      },
    ]);
  });
});

describe("addBook", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    mock.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } });
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
      purchase_url: "https://example.com/buy",
      published_date: "2026-03-15",
      price: null,
      genre: null,
      format: "print",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
    expect(revalidatePath).toHaveBeenCalledWith("/members/member-1");
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
  });
});

describe("updateBook", () => {
  it("rejects when there is no authenticated user", async () => {
    const mock = makeSupabaseMock();
    mock.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } });
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
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
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
    mock.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } });
    vi.mocked(createClient).mockResolvedValue(mock as any);

    const result = await deleteBook("book-1");
    expect(result).toEqual({ error: "Not authenticated" });
    expect(mock.__delete).not.toHaveBeenCalled();
  });

  it("reports 'Book not found' when RLS scopes away the row (not owned)", async () => {
    const mock = makeSupabaseMock({ deleteSingleResult: { data: null, error: null } });
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await deleteBook("someone-elses-book");
    expect(result).toEqual({ error: "Book not found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes the row and revalidates on success", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as any);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    const result = await deleteBook("book-1");
    expect(result).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/bookshelf");
    expect(revalidatePath).toHaveBeenCalledWith("/projects");
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
