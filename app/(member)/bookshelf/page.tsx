import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getMyBooks } from "./actions";
import BookshelfClient, { type ShelfBook } from "./BookshelfClient";
import { safeUrl } from "@/lib/url";

export const metadata: Metadata = {
  title: "Hedgie Bookshelf",
};

export default async function BookshelfPage() {
  const supabase = await createClient();

  const [{ data: books }, myBooks] = await Promise.all([
    supabase
      .from("member_books")
      .select(
        "id, member_id, title, description, cover_url, purchase_url, published_date, members(name)"
      )
      .order("published_date", { ascending: false }),
    getMyBooks(),
  ]);

  const shelf: ShelfBook[] = (books ?? []).map((row: any) => ({
    id: row.id,
    memberId: row.member_id,
    memberName: row.members?.name ?? "A Hedgie",
    title: row.title,
    description: row.description,
    coverUrl: safeUrl(row.cover_url),
    purchaseUrl: safeUrl(row.purchase_url),
    publishedDate: row.published_date,
  }));

  return <BookshelfClient shelf={shelf} initialMyBooks={myBooks} />;
}
