import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseBookRepository } from "@/lib/data/books";
import { SupabaseMediaRepository } from "@/lib/data/media";
import { defineBookContract, type BookContractMember } from "@/tests/helpers/book-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `bookrepo${Date.now()}`;
let counter = 0;
const memberIds: string[] = [];
const projectIds: string[] = [];

// Each test gets two members of its own, so a count or a list never sees another test's books. Their books go with them.
afterAll(async () => {
  if (memberIds.length) await db.from("member_books").delete().in("member_id", memberIds);
  if (projectIds.length) await db.from("writing_projects").delete().in("id", projectIds);
  await db.from("media_assets").delete().like("storage_path", `%${RUN}%`);
  if (memberIds.length) await db.from("members").delete().in("id", memberIds);
});

defineBookContract("SupabaseBookRepository", () => {
  let pair: [BookContractMember, BookContractMember] | undefined;
  const media = new SupabaseMediaRepository(db);
  return {
    repo: () => new SupabaseBookRepository(db),
    unique: (label) => `${RUN}-${label.replace(/[^A-Za-z0-9]/g, "")}-${++counter}`,
    members: async () => {
      if (!pair) {
        const tag = `${RUN}-${++counter}`;
        const { data, error } = await db
          .from("members")
          .insert([1, 2].map((i) => ({ name: `Book Author ${i} ${tag}`, display_name: i === 1 ? `Author ${tag}` : null, email: `${tag}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
          .select("id, name, display_name, email")
          .order("email");
        if (error) throw new Error(error.message);
        memberIds.push(...data!.map((m) => m.id));
        const [a, b] = data!.map((m) => ({ id: m.id, name: m.name, displayName: m.display_name }));
        pair = [a, b];
      }
      return pair;
    },
    coverAsset: async (width, height) => {
      const label = `${RUN}-cover-${++counter}`;
      return (await media.add({ storage_path: `originals/${label}.png`, mime_type: "image/png", width, height, bytes: 1234, sha256: label, title: label })).id;
    },
    project: async (memberId) => {
      const { data, error } = await db.from("writing_projects").insert({ member_id: memberId, title: `Project ${RUN}`, phase: "drafting" }).select("id").single();
      if (error) throw new Error(error.message);
      projectIds.push(data.id);
      return data.id;
    },
  };
});
