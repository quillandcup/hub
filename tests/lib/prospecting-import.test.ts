import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { importPastedProspects } from "@/lib/prospecting/import";

describe("importPastedProspects", () => {
  it("scores new handles, skips people already in the Hub, and does not add the same handle twice", async () => {
    const data = new InMemoryDataset({
      members: [{ id: "mbr_AAAAAAAAAAA1", name: "Member One", instagramUrl: "https://www.instagram.com/member.one/" }, { id: "mbr_AAAAAAAAAAA2", name: "No Insta" }],
    });
    const repos = createInMemoryRepos(data);
    const text = ["@new.writer aspiring novelist working on my first book #amwriting", "@member.one hello", "oops this is prose", "@other_writer"].join("\n");

    const first = await importPastedProspects(repos, text, null);
    expect(first).toEqual({ added: 2, alreadyProspects: 0, alreadyMembers: 1, unreadable: ["oops this is prose"] });

    const listed = await repos.prospects.list();
    expect(listed.map((p) => p.handle)).toEqual(["new.writer", "other_writer"]);
    expect(listed[0].fitScore).toBeGreaterThan(40);
    expect(listed[0].source).toBe("paste");

    const second = await importPastedProspects(repos, "@new.writer", null);
    expect(second).toMatchObject({ added: 0, alreadyProspects: 1 });
  });
});
