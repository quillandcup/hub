import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseAliasRepository } from "@/lib/data/aliases";
import { SupabaseMemberStatusRepository } from "@/lib/data/member-status-overrides";
import { SupabaseWriterProfileRepository } from "@/lib/data/writer-profiles";
import { defineWriterProfileContract } from "@/tests/helpers/writer-profile-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `wprof${Date.now()}`;
let memberIds: [string, string];
let counter = 0;

const reset = async () => {
  // Pages and old handles go with their member; pen names are removed here (they belong to the members the run made).
  for (const table of ["writer_profiles", "writer_profile_handles", "member_name_aliases", "member_profile_overrides"] as const) {
    const { error } = await db.from(table).delete().in("member_id", memberIds);
    if (error) throw new Error(error.message);
  }
  const { error } = await db.from("members").update({ bio: null, instagram_url: null, facebook_url: null, twitter_url: null }).in("id", memberIds);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([
      { name: "Ada Legalname", email: `${RUN}-ada@example.com`, joined_at: "2026-01-01", status: "active", display_name: "Ada Example" },
      { name: "Grace Example", email: `${RUN}-grace@example.com`, joined_at: "2026-01-01", status: "active" },
    ])
    .select("id, email")
    .order("email");
  if (error) throw new Error(error.message);
  memberIds = [data![0].id, data![1].id];
});

afterAll(async () => {
  await reset();
  await db.from("members").delete().in("id", memberIds);
});

const must = <T>(result: { data: T; error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

defineWriterProfileContract("SupabaseWriterProfileRepository", () => ({
  profiles: () => new SupabaseWriterProfileRepository(db),
  aliases: () => new SupabaseAliasRepository(db),
  get members() {
    return memberIds;
  },
  unique: (label) => `${label}-${RUN}-${++counter}`,
  reset,
  setDisplayName: async (id, name) => {
    must(await db.from("members").update({ display_name: name }).eq("id", id));
  },
  setProfileFields: async (id, fields) => {
    const patch = {
      ...(fields.bio === undefined ? {} : { bio: fields.bio }),
      ...(fields.instagram === undefined ? {} : { instagram_url: fields.instagram }),
      ...(fields.facebook === undefined ? {} : { facebook_url: fields.facebook }),
      ...(fields.x === undefined ? {} : { twitter_url: fields.x }),
    };
    must(await db.from("members").update(patch).eq("id", id));
  },
  setLevel: async (id, item, level) => {
    await new SupabaseMemberStatusRepository(db).saveProfileVisibility(id, item, level, null);
  },
  setPhoto: async (id, url) => {
    must(await db.from("members").update({ photo_url: url }).eq("id", id));
  },
  addAlias: async (memberId, alias, source, options = {}) => {
    const row = must(await db.from("member_name_aliases").insert({ member_id: memberId, alias, source, active: options.active ?? true, is_public: options.isPublic ?? false }).select("id").single());
    return row!.id;
  },
  changeAlias: async (id, changes) => {
    must(await db.from("member_name_aliases").update({ ...(changes.isPublic === undefined ? {} : { is_public: changes.isPublic }), ...(changes.active === undefined ? {} : { active: changes.active }) }).eq("id", id));
  },
}));
