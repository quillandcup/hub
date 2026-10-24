import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryMemberRepository } from "@/lib/data/members";
import { defineMemberContract, type MemberSeedRecord } from "@/tests/helpers/member-contract";

const authUserIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"] as const;

defineMemberContract("InMemoryMemberRepository", () => {
  let data = new InMemoryDataset();
  const emails = new Map<string, string>();
  return {
    authUserIds,
    unusedUserId: "33333333-3333-4333-8333-333333333333",
    repo: () => new InMemoryMemberRepository(data),
    emailOf: (id) => emails.get(id)!,
    seed: async (members: MemberSeedRecord[]) => {
      const seeded = members.map((m, i) => {
        const id = `mbr_${String(i).padStart(12, "A")}`;
        emails.set(id, `member-${i}@example.test`);
        return {
          id,
          name: m.name,
          displayName: m.displayName ?? null,
          email: `member-${i}@example.test`,
          status: m.status ?? "active",
          userId: m.user === undefined ? null : authUserIds[m.user],
          staffRole: m.staffRole ?? null,
          kajabiId: m.kajabiId ?? null,
          stripeCustomerId: m.stripeCustomerId ?? null,
          bio: m.bio ?? null,
          instagramUrl: m.instagramUrl ?? null,
          birthdayMonth: m.birthday?.[0] ?? null,
          birthdayDay: m.birthday?.[1] ?? null,
          updatedAt: new Date().toISOString(),
          firstJoinedAt: m.firstJoinedAt ?? null,
          totalActiveMonths: m.totalActiveMonths ?? 0,
        };
      });
      data = new InMemoryDataset({ members: seeded });
      return seeded.map((m) => m.id);
    },
  };
});
