import { describe, it, expect, vi, beforeEach } from "vitest";

// publishProject stores the pen name the member picked, after checking it is theirs.
// The check itself is tested in tests/lib/book-pen-name.test.ts.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/slack", () => ({ notifyStaffNewBook: vi.fn().mockResolvedValue(undefined) }));
// The bookshelf is the in-memory twin; the writing project lookups keep going through the mocked client below.
const shelf = vi.hoisted(() => ({ repo: undefined as unknown as import("@/lib/data/books").BookRepository }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: (db: never) => ({ ...actual.createRepos(db), books: shelf.repo }) };
});
vi.mock("@/lib/book-pen-name", () => ({
  getPenNameOptions: vi.fn(),
  resolvePenName: vi.fn(async (_db: unknown, _memberId: string, penName?: string | null) =>
    penName === "Not Mine" ? { error: "Pick one of your own names" } : { penName: penName?.trim() || null },
  ),
}));

import { publishProject } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryBookRepository } from "@/lib/data/books";

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const BOOK = {
  title: "My Novel",
  publishedDate: "2026-03-15",
  coverUrl: "https://example.com/cover.jpg",
  purchaseUrl: "https://example.com/buy",
  format: "print" as const,
};

let data: InMemoryDataset;

function makeSupabaseMock() {
  const projectSingle = vi.fn().mockResolvedValue({ data: { id: "project-1" }, error: null });
  const projectUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) }));
  const from = vi.fn((table: string) => {
    if (table === "writing_projects") {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: projectSingle })) })) })),
        update: projectUpdate,
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: "auth-user-1" } }, error: null }) },
    from,
    projectUpdate,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  data = new InMemoryDataset({ members: [{ id: "member-1", name: "Member One" }] });
  shelf.repo = new InMemoryBookRepository(data);
});

describe("publishProject pen name", () => {
  it("stores the chosen pen name on the book", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await publishProject("project-1", { ...BOOK, penName: "A. E. Byron" })).toEqual({ success: true });
    expect(data.memberBooks).toEqual([expect.objectContaining({ member_id: "member-1", project_id: "project-1", pen_name: "A. E. Byron", title: "My Novel" })]);
    expect(mock.projectUpdate).toHaveBeenCalled();
  });

  it("stores null when no pen name is chosen", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await publishProject("project-1", BOOK);
    expect(data.memberBooks).toEqual([expect.objectContaining({ pen_name: null })]);
  });

  it("refuses a name that isn't the member's own, without publishing", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await publishProject("project-1", { ...BOOK, penName: "Not Mine" })).toEqual({ error: "Pick one of your own names" });
    expect(data.memberBooks).toEqual([]);
    expect(mock.projectUpdate).not.toHaveBeenCalled();
  });

  it("says so when the project already has a book, and doesn't mark it published again", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await publishProject("project-1", BOOK)).toEqual({ success: true });
    mock.projectUpdate.mockClear();
    expect(await publishProject("project-1", BOOK)).toEqual({ error: "This project has already been published." });
    expect(data.memberBooks).toHaveLength(1);
    expect(mock.projectUpdate).not.toHaveBeenCalled();
  });

  it("hands back any other failure to add the book, and publishes nothing", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue({ ...IDENTITY, memberId: "member-gone" });
    vi.spyOn(shelf.repo, "add").mockRejectedValueOnce(new Error("boom"));

    expect(await publishProject("project-1", BOOK)).toEqual({ error: "boom" });
    expect(mock.projectUpdate).not.toHaveBeenCalled();
  });
});
