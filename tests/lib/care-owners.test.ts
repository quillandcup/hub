import { describe, expect, it } from "vitest";
import { isCareOwner, loadCareOwners, ownerName, type CareOwner } from "@/lib/care-owners";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const [ADMIN, MANAGER, PLAIN, NO_MEMBER] = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

function repos() {
  return createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Zed Example", displayName: "Aardvark Z.", email: "zed@example.test", userId: ADMIN },
        { id: "mbr_AAAAAAAAAAA2", name: "Cam Example", email: "cam@example.test", userId: MANAGER },
      ],
      userProfiles: [
        { id: ADMIN, email: "zed@example.test", role: "admin" },
        { id: MANAGER, email: "cam@example.test", role: "community_manager" },
        { id: PLAIN, email: "plain@example.test", role: "member" },
        { id: NO_MEMBER, email: "nomember@example.test", role: "admin" },
      ],
    })
  );
}

describe("loadCareOwners", () => {
  it("lists admins and the community manager by the name they are known by, never an email, and leaves out members", async () => {
    const owners = await loadCareOwners(repos(), repos());

    expect(owners).toEqual([
      { id: NO_MEMBER, name: "A staff member", role: "admin" }, // no member record: a neutral name, by name order
      { id: ADMIN, name: "Aardvark Z.", role: "admin" },
      { id: MANAGER, name: "Cam Example", role: "community_manager" },
    ]);
    expect(JSON.stringify(owners)).not.toContain("example.test");
  });
});

describe("isCareOwner", () => {
  it("is true for an admin and the community manager, false for a member or someone with no profile", async () => {
    const r = repos();
    expect(await isCareOwner(r, ADMIN)).toBe(true);
    expect(await isCareOwner(r, MANAGER)).toBe(true);
    expect(await isCareOwner(r, PLAIN)).toBe(false);
    expect(await isCareOwner(r, "55555555-5555-4555-8555-555555555555")).toBe(false);
  });
});

describe("ownerName", () => {
  const owners: CareOwner[] = [{ id: ADMIN, name: "Aardvark Z.", role: "admin" }];

  it("names the owner, says Unassigned for none, and stays neutral for someone no longer on the team", () => {
    expect(ownerName(ADMIN, owners)).toBe("Aardvark Z.");
    expect(ownerName(null, owners)).toBe("Unassigned");
    expect(ownerName(MANAGER, owners)).toBe("A staff member");
  });
});
