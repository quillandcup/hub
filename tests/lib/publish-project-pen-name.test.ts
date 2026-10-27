import { describe, it, expect, vi, beforeEach } from "vitest";

// publishProject stores the pen name the member picked, after checking it is theirs.
// The check itself is tested in tests/lib/book-pen-name.test.ts.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/slack", () => ({ notifyStaffNewBook: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/book-pen-name", () => ({
  getPenNameOptions: vi.fn(),
  resolvePenName: vi.fn(async (_db: unknown, _memberId: string, penName?: string | null) =>
    penName === "Not Mine" ? { error: "Pick one of your own names" } : { penName: penName?.trim() || null },
  ),
}));

import { publishProject } from "@/app/(member)/projects/actions";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity } from "@/lib/sudo";

const IDENTITY = { memberId: "member-1", memberName: "Member One", memberEmail: "m1@example.com", isSudo: false };
const BOOK = {
  title: "My Novel",
  publishedDate: "2026-03-15",
  coverUrl: "https://example.com/cover.jpg",
  purchaseUrl: "https://example.com/buy",
  format: "print" as const,
};

function makeSupabaseMock() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const projectSingle = vi.fn().mockResolvedValue({ data: { id: "project-1" }, error: null });
  const projectUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) }));
  const from = vi.fn((table: string) => {
    if (table === "member_books") return { insert };
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
    insert,
    projectUpdate,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishProject pen name", () => {
  it("stores the chosen pen name on the book", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await publishProject("project-1", { ...BOOK, penName: "A. E. Byron" })).toEqual({ success: true });
    expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({ project_id: "project-1", pen_name: "A. E. Byron" }));
  });

  it("stores null when no pen name is chosen", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    await publishProject("project-1", BOOK);
    expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({ pen_name: null }));
  });

  it("refuses a name that isn't the member's own, without publishing", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockResolvedValue(mock as never);
    vi.mocked(getEffectiveIdentity).mockResolvedValue(IDENTITY);

    expect(await publishProject("project-1", { ...BOOK, penName: "Not Mine" })).toEqual({ error: "Pick one of your own names" });
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.projectUpdate).not.toHaveBeenCalled();
  });
});
