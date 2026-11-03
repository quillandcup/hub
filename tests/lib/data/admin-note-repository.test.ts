import { InMemoryAdminNoteRepository } from "@/lib/data/admin-notes";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { defineAdminNoteContract } from "@/tests/helpers/admin-note-contract";

const members: [string, string] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"];

defineAdminNoteContract("InMemoryAdminNoteRepository", () => {
  const data = new InMemoryDataset({
    members: members.map((id, i) => ({ id, name: `Member ${i} Example`, email: `note-${i}@example.test` })),
  });
  return {
    repo: () => new InMemoryAdminNoteRepository(data),
    members,
    userId: "00000000-0000-4000-8000-000000000001",
    editAs: (userId) => new InMemoryAdminNoteRepository(data, userId),
    missingMemberId: "mbr_ZZZZZZZZZZZ9",
    clear: async () => {
      data.adminNotes = [];
    },
  };
});
