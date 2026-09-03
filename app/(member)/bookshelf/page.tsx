import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import BookshelfClient, { type ShelfBook } from "./BookshelfClient";

export const metadata: Metadata = {
  title: "Hedgie Bookshelf",
};

export default async function BookshelfPage() {
  const supabase = await createClient();

  const { data: books } = await supabase
    .from("member_books")
    .select(
      "id, member_id, title, description, cover_url, purchase_url, published_date, price, genre, format, members(name)"
    )
    .order("published_date", { ascending: false });

  const shelf: ShelfBook[] = (books ?? []).map((row: any) => ({
    id: row.id,
    memberId: row.member_id,
    memberName: row.members?.name ?? "A Hedgie",
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    purchaseUrl: row.purchase_url,
    publishedDate: row.published_date,
    price: row.price,
    genre: row.genre,
    format: row.format,
  }));

  return <BookshelfClient shelf={shelf} />;
}
