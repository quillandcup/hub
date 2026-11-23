/**
 * The root host's sitemap (src/app/sitemap.ts, src/lib/landing/sitemap.ts): the published landing pages by their bare address, never
 * a draft, taken-down, deleted or template page, and every page when there are more than the 1000 rows one request returns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_URL, SITE_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { SupabaseLandingPageRepository } from "@/lib/data/landing-pages";
import type { Db } from "@/lib/data/db";
import { createInMemoryRepos } from "@/lib/data/repos";
import { landingSitemapEntries, landingSitemapUrl } from "@/lib/landing/sitemap";

const state = { host: new URL(SITE_URL).host, repos: createInMemoryRepos(new InMemoryDataset()) };
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: state.host }) }));
vi.mock("@/lib/data/server", () => ({ getServiceRepos: () => state.repos }));

import sitemap from "@/app/sitemap";

async function publish(slug: string, extra: { kind?: "page" | "template"; publish?: boolean } = {}) {
  const page = await state.repos.landingPages.create({ title: slug, slug, createdBy: null, kind: extra.kind });
  if (extra.publish !== false) await state.repos.landingPages.publish(page.id);
  return page;
}

beforeEach(() => {
  state.host = new URL(SITE_URL).host;
  state.repos = createInMemoryRepos(new InMemoryDataset());
});

describe("the root host's sitemap", () => {
  it("lists each published page at its bare address, and `home` as the front page", async () => {
    await publish("ada-example-challenge");
    await publish("home");
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toEqual([`${SITE_URL}/ada-example-challenge`, `${SITE_URL}/`]);
    expect(entries.every((e) => typeof e.lastModified === "string")).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("/p/");
  });

  it("leaves out a draft, a taken-down page, a deleted page and a template", async () => {
    await publish("live");
    await publish("a-draft", { publish: false });
    const down = await publish("taken-down");
    await state.repos.landingPages.unpublish(down.id, null);
    const gone = await publish("deleted");
    await state.repos.landingPages.remove(gone.id, null);
    await publish("a-template", { kind: "template" });
    expect((await sitemap()).map((e) => e.url)).toEqual([`${SITE_URL}/live`]);
  });

  it("is empty on the app host, which has no public pages of its own", async () => {
    await publish("live");
    state.host = new URL(APP_URL).host;
    expect(await sitemap()).toEqual([]);
  });

  it("is empty with no page published, which is a valid sitemap", async () => {
    expect(await sitemap()).toEqual([]);
    expect(await landingSitemapEntries(state.repos)).toEqual([]);
  });

  it("is named on the root host", () => {
    expect(landingSitemapUrl(SITE_URL)).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe("publishedAddresses past 1000 rows", () => {
  /** A fake of the query builder: `total` published rows, answered a `.range(from, to)` window at a time, with the filters recorded. */
  function fakeDb(total: number) {
    const calls: { filters: unknown[][]; range: [number, number] }[] = [];
    const rows = Array.from({ length: total }, (_, i) => ({ slug: `page-${String(i).padStart(5, "0")}`, published_at: "2027-03-01T00:00:00Z", updated_at: "2027-03-02T00:00:00Z" }));
    const from = () => {
      const filters: unknown[][] = [];
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "eq", "is", "not", "order"]) {
        chain[name] = (...args: unknown[]) => (filters.push([name, ...args]), chain);
      }
      chain.range = async (a: number, b: number) => {
        calls.push({ filters, range: [a, b] });
        return { data: rows.slice(a, b + 1), error: null };
      };
      return chain;
    };
    return { db: { from } as unknown as Db, calls };
  }

  it("pages through every row, 1000 at a time, and asks only for published, live pages", async () => {
    const { db, calls } = fakeDb(2500);
    const addresses = await new SupabaseLandingPageRepository(db).publishedAddresses();
    expect(addresses).toHaveLength(2500);
    expect(addresses[0]).toEqual({ slug: "page-00000", updatedAt: "2027-03-01T00:00:00Z" });
    expect(addresses[2499].slug).toBe("page-02499");
    expect(calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(calls[0].filters).toEqual(
      expect.arrayContaining([["eq", "kind", "page"], ["eq", "status", "published"], ["is", "deleted_at", null], ["not", "published_data", "is", null]]),
    );
  });

  it("reads once and returns nothing for no pages", async () => {
    const { db, calls } = fakeDb(0);
    expect(await new SupabaseLandingPageRepository(db).publishedAddresses()).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("serves more than 1000 pages in the sitemap file", async () => {
    const data = new InMemoryDataset();
    const now = "2027-03-01T00:00:00Z";
    data.landingPages = Array.from({ length: 1005 }, (_, i) => ({
      id: `lpg_${String(i).padStart(12, "0")}`,
      slug: `page-${String(i).padStart(5, "0")}`,
      title: "x",
      kind: "page",
      page_type: "landing",
      status: "published",
      draft_data: { content: [], root: {} },
      published_data: { content: [], root: {} },
      seo_title: null,
      seo_description: null,
      social_image_asset_id: null,
      first_published_at: now,
      published_at: now,
      restored_from_version_id: null,
      restored_at: null,
      import_key: null,
      imported_at: null,
      starter_applied_at: null,
      created_by: null,
      updated_by: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }));
    const entries = await landingSitemapEntries(createInMemoryRepos(data));
    expect(entries).toHaveLength(1005);
    expect(entries[1004].url).toBe(`${SITE_URL}/page-01004`);
  });
});
