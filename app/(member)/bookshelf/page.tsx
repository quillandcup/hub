import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import BookshelfClient, { type ShelfBook } from "./BookshelfClient";
import { getMemberDisplayName } from "@/lib/member-display-name";

export const metadata: Metadata = {
  title: "Hedgie Book Shelf",
};

export default async function BookshelfPage() {
  const supabase = await createClient();

  const books = await createRepos(supabase).books.shelf();

  const shelf: ShelfBook[] = books.map((row) => ({
    id: row.id,
    memberId: row.member_id,
    memberName: row.pen_name || (row.author ? getMemberDisplayName(row.author) : "A Hedgie"),
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    purchaseUrl: row.purchase_url,
    publishedDate: row.published_date,
    price: row.price,
    genres: row.genres,
    format: row.format as ShelfBook["format"],
  }));

  return <BookshelfClient shelf={shelf} />;
}
