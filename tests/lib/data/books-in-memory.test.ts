import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryBookRepository } from "@/lib/data/books";
import { InMemoryMediaRepository } from "@/lib/data/media";
import { defineBookContract } from "@/tests/helpers/book-contract";

let n = 0;
defineBookContract("InMemoryBookRepository", () => {
  const members = [
    { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E." },
    { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", displayName: null },
  ] as const;
  const data = new InMemoryDataset({ members: members.map((m) => ({ ...m })) });
  const media = new InMemoryMediaRepository(data);
  return {
    repo: () => new InMemoryBookRepository(data),
    unique: (label) => `${label}-${++n}`,
    members: async () => [{ ...members[0] }, { ...members[1] }],
    coverAsset: async (width, height) => {
      const label = `cover-${++n}`;
      return (await media.add({ storage_path: `originals/${label}.png`, mime_type: "image/png", width, height, bytes: 1234, sha256: label, title: label })).id;
    },
    project: async () => `wprj_${String(++n).padStart(12, "A")}`,
  };
});
