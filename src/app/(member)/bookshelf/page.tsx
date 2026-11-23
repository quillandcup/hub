import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createRepos } from "@/lib/data/repos";
import BookshelfClient, { type ShelfBook } from "./BookshelfClient";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Hedgie Book Shelf",
};

export default async function BookshelfPage() {
  const supabase = await createClient();

  // The member being acted as (sudo included): their own private books are on their shelf, nobody else's.
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const identity = await getEffectiveIdentity(user);
  if (!identity) redirect("/admin");

  const books = await createRepos(supabase).books.shelf(identity.memberId);

  const shelf: ShelfBook[] = books.map((row) => ({
    id: row.id,
    memberId: row.member_id,
    memberName: row.pen_name || (row.author ? getMemberDisplayName(row.author) : "A Hedgie"),
    title: row.title,
    description: row.description,
    coverUrl: row.cover_url,
    publishedDate: row.published_date,
    editions: row.editions.map((e) => ({ format: e.format, purchaseUrl: e.purchase_url, price: e.price })),
    genres: row.genres,
  }));

  return <BookshelfClient shelf={shelf} />;
}
