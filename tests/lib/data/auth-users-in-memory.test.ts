import { describe, expect, it } from "vitest";
import { InMemoryAuthUserRepository } from "@/lib/data/auth-users";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { defineAuthUserContract } from "@/tests/helpers/auth-user-contract";

let n = 0;

defineAuthUserContract("InMemoryAuthUserRepository", () => {
  const data = new InMemoryDataset();
  return { repo: () => new InMemoryAuthUserRepository(data), email: (label) => `${label}-${++n}@example.com` };
});

describe("InMemoryAuthUserRepository", () => {
  it("starts from the accounts the dataset is given, without sharing their objects", async () => {
    const seed = { id: "u1", email: "ada@example.test", confirmed: true, createdAt: "2026-01-01T00:00:00Z", bannedUntil: null, lastSignInAt: null, appMetadata: { a: 1 } };
    const data = new InMemoryDataset({ authUsers: [seed] });
    const repo = new InMemoryAuthUserRepository(data);
    await repo.mergeAppMetadata("u1", { b: 2 });
    expect(seed.appMetadata).toEqual({ a: 1 });
    expect((await repo.byId("u1"))!.appMetadata).toEqual({ a: 1, b: 2 });
  });

  const fake = useFakeClock(() => Date.parse("2026-11-03T12:00:00Z"));

  it("measures a ban from the clock, and refuses a duration it cannot read", async () => {
    const repo = new InMemoryAuthUserRepository(new InMemoryDataset());
    const user = await repo.create({ email: "ban@example.test", banDuration: "24h" });
    expect(user.bannedUntil).toBe("2026-11-04T12:00:00.000Z");
    fake.clock.advance(1000);
    await expect(repo.setBan(user.id, "1d" as never)).rejects.toThrow("Unsupported ban duration");
  });
});
