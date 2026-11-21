import { describe, expect, it } from "vitest";
import { WRITER_PROFILES } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { sitemapIds, writerSitemapEntries } from "@/lib/writer-sitemap";

const AT = "2027-03-01T12:00:00Z";

/** `count` active members with an account, each with a public profile, and the flag on for everyone. */
function community(count: number, extra: { off?: number } = {}) {
  const ids = Array.from({ length: count }, (_, i) => String(i).padStart(5, "0"));
  const data = new InMemoryDataset({
    members: ids.map((n) => ({ id: `mbr_${n}`, name: `Member ${n}`, userId: `user-${n}` })),
    featureFlags: [{ feature_key: "writer_profiles", enabled_globally: true, created_at: AT, updated_at: AT }],
  });
  data.writerProfiles = ids.map((n, i) => ({
    id: `wpage_${n}`,
    member_id: `mbr_${n}`,
    handle: `member-${n}`,
    is_public: i >= (extra.off ?? 0),
    public_name_alias_id: null,
    use_account_name: false,
    public_bio: null,
    published_at: AT,
    created_at: AT,
    updated_at: AT,
    deleted_at: null,
  }));
  return createInMemoryRepos(data);
}

/** Every file of the sitemap, the way `app/w/sitemap.ts` serves them. */
async function allFiles(repos: ReturnType<typeof community>, pageSize: number) {
  const ids = sitemapIds(await repos.writerProfiles.publicCount(), pageSize);
  return Promise.all(ids.map((id) => writerSitemapEntries(repos, id, pageSize)));
}

describe("the writer profile sitemap", () => {
  it("holds up to the page size in one file, which the protocol allows (at most 50,000)", () => {
    expect(WRITER_PROFILES.sitemapPageSize).toBeGreaterThan(1000);
    expect(WRITER_PROFILES.sitemapPageSize).toBeLessThanOrEqual(50_000);
  });

  it.each([999, 1000, 1001, 2000, 2500])("lists every one of %i profiles exactly once across the files", async (count) => {
    const repos = community(count);
    const size = 1000;
    const files = await allFiles(repos, size);

    expect(files).toHaveLength(Math.ceil(count / size));
    files.forEach((file, i) => expect(file).toHaveLength(i < files.length - 1 ? size : count - size * i));
    const urls = files.flat().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(count);
  });

  it("fills a file past the 1000 rows one query returns, when the page size is larger", async () => {
    const repos = community(2500);

    const files = await allFiles(repos, 2000);

    expect(files.map((f) => f.length)).toEqual([2000, 500]);
    expect(new Set(files.flat().map((e) => e.url)).size).toBe(2500);
  });

  it("leaves out profiles that are off, and lists the rest in a file that holds the whole page size", async () => {
    const repos = community(1300, { off: 200 });

    const files = await allFiles(repos, 1200);

    expect(files.map((f) => f.length)).toEqual([1100]);
  });

  it("is one empty file when nothing is public", async () => {
    const files = await allFiles(community(3, { off: 3 }), 1000);
    expect(files).toEqual([[]]);
  });
});
