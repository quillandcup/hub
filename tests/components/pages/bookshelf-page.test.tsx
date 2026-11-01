// @vitest-environment jsdom
/**
 * The Hedgie Book Shelf page (app/(member)/bookshelf/page.tsx): every live book, newest first, under
 * the name it is published as -- the pen name, else the author's display name, else a legal name, else
 * "A Hedgie" when the author's member record is gone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

const store = vi.hoisted(() => ({ repos: undefined as unknown as import("@/lib/data/repos").Repos }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...actual, createRepos: () => store.repos };
});

vi.mock("@/app/(member)/bookshelf/BookshelfClient", () => ({
  default: ({ shelf }: { shelf: { id: string; memberName: string; title: string; memberId: string }[] }) => (
    <ul>
      {shelf.map((b) => (
        <li key={b.id} data-testid="book">
          {b.title} by {b.memberName}
        </li>
      ))}
    </ul>
  ),
}));

import BookshelfPage from "@/app/(member)/bookshelf/page";

beforeEach(() => {
  resetServerPageMocks();
});

describe("BookshelfPage", () => {
  it("lists live books newest first under the name each is published as", async () => {
    const data = new InMemoryDataset({
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E." },
        { id: "mbr_AAAAAAAAAAA2", name: "Bo Example" },
      ],
      memberBooks: [
        { id: "book_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", title: "Oldest", published_date: "2025-01-01", cover_asset_id: null },
        { id: "book_AAAAAAAAAAA2", member_id: "mbr_AAAAAAAAAAA1", title: "Penned", published_date: "2026-02-01", cover_asset_id: null, pen_name: "A. Example" },
        { id: "book_AAAAAAAAAAA3", member_id: "mbr_AAAAAAAAAAA2", title: "Legal", published_date: "2026-03-01", cover_asset_id: null },
        { id: "book_AAAAAAAAAAA4", member_id: "mbr_ZZZZZZZZZZZZ", title: "Orphan", published_date: "2026-04-01", cover_asset_id: null },
        { id: "book_AAAAAAAAAAA5", member_id: "mbr_AAAAAAAAAAA1", title: "Deleted", published_date: "2026-05-01", cover_asset_id: null, deleted_at: "2026-05-02T00:00:00Z" },
      ],
    });
    store.repos = createInMemoryRepos(data);

    await renderServerPage(BookshelfPage, {});

    expect(screen.getAllByTestId("book").map((li) => li.textContent)).toEqual([
      "Orphan by A Hedgie",
      "Legal by Bo Example",
      "Penned by A. Example",
      "Oldest by Ada E.",
    ]);
  });
});
