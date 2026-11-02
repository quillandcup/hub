/**
 * Adds books from the Q&C storefront (the page at /hedgie-books) to their members' shelves, with each cover stored in
 * the media library first, so a book never holds a link to another site. Until that page is replaced, books that appear
 * there and not on the Bookshelf are added with this.
 *
 * Usage:
 *   pnpm books:import --spec <file> [--env <file>] [--apply]
 *
 * The spec is a JSON array kept outside the repo (it names members), one object per book:
 *   { "memberName": "...", "title": "...", "coverUrl": "https://...", "purchaseUrl": "https://...",
 *     "publishedDate": "YYYY-MM-DD", "price": 4.99, "format": "ebook" | "print" }
 * Every field is required (`import-storefront-books-spec.ts` lists what is wrong before anything runs). Take the cover, price and dates from the store's product data: the page's buy buttons read
 * it with a public storefront token that is in the page's HTML.
 *
 * Without --apply it checks each book (the member is found exactly once, it isn't already on their shelf, the cover
 * downloads) and writes nothing. A book already on the member's shelf by title is skipped, so it is safe to run again.
 * Writes use the service role, so the audit log records them as the system. The output has titles and ids, no names.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/data/database.types";
import { createRepos } from "../lib/data/repos";
import { storeImage } from "../lib/media/library";
import { bookCoverUrlFor } from "../lib/bookCover";
import { loadLayeredEnv } from "./load-layered-env";
import { parseBookSpec } from "./import-storefront-books-spec";

const USAGE = "Usage: pnpm books:import --spec <file> [--env <file>] [--apply]";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const specFile = arg("--spec");
  const envFile = arg("--env") ?? ".env.prod";
  const apply = process.argv.includes("--apply");
  if (!specFile) {
    console.error(USAGE);
    process.exit(1);
  }
  const parsed = parseBookSpec(JSON.parse(readFileSync(specFile, "utf8")));
  if (!parsed.ok) {
    console.error(`${specFile}:\n  ${parsed.errors.join("\n  ")}`);
    process.exit(1);
  }
  const specs = parsed.books;
  loadLayeredEnv(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`${envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
    process.exit(1);
  }
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const repos = createRepos(db);
  const members = await repos.members.list();
  console.log(`${apply ? "Adding" : "Checking (nothing will be written)"} ${specs.length} book(s) in ${new URL(url).host}`);

  for (const spec of specs) {
    const matches = members.filter((m) => m.name === spec.memberName);
    if (matches.length !== 1) {
      console.log(`  "${spec.title}": ${matches.length} members with that name, skipped`);
      continue;
    }
    const memberId = matches[0].id;
    const shelf = await repos.books.ofMember(memberId);
    const onShelf = shelf.find((b) => b.title === spec.title);
    if (onShelf) {
      console.log(`  "${spec.title}": already on the shelf (${onShelf.id}), skipped`);
      continue;
    }
    const response = await fetch(spec.coverUrl);
    if (!response.ok) {
      console.log(`  "${spec.title}": cover download failed (${response.status}), skipped`);
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!apply) {
      console.log(`  "${spec.title}": member found, cover downloaded (${bytes.byteLength} bytes), would add`);
      continue;
    }
    const stored = await storeImage(repos.media, db.storage, { bytes, title: spec.title, ownerMemberId: memberId });
    if (!stored.ok) {
      console.log(`  "${spec.title}": cover not stored: ${stored.error}`);
      continue;
    }
    const id = await repos.books.add({
      member_id: memberId,
      title: spec.title,
      cover_url: bookCoverUrlFor(stored.asset.id),
      cover_asset_id: stored.asset.id,
      purchase_url: spec.purchaseUrl,
      published_date: spec.publishedDate,
      price: spec.price,
      format: spec.format,
    });
    console.log(`  "${spec.title}": added ${id}, cover ${stored.asset.id} (${stored.asset.width} x ${stored.asset.height})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
