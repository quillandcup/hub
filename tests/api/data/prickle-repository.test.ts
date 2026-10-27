import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabasePrickleRepository, type PrickleType } from "@/lib/data/prickles";
import { definePrickleContract, type PrickleSeed } from "@/tests/helpers/prickle-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let types: [PrickleType, PrickleType];
let hosts: [{ id: string; name: string }, { id: string; name: string }];
const created: string[] = [];

async function clearPrickles() {
  if (created.length === 0) return;
  const ids = created.splice(0);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db.from("prickles").delete().in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
}

beforeAll(async () => {
  const { data: members, error: memberError } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `Prickle Host ${i} ${RUN}`, email: `prickle-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, name");
  if (memberError) throw new Error(memberError.message);
  hosts = [members![0], members![1]];

  const { data: typeRows, error: typeError } = await db
    .from("prickle_types")
    .insert([
      { name: `Contract Sprint ${RUN}`, normalized_name: `contract-sprint-${RUN}`, purpose: "writing", requires_host: true, solo_task_friendly: false, listed_in_events: true },
      { name: `Contract Chat ${RUN}`, normalized_name: `contract-chat-${RUN}`, purpose: "social", requires_host: false, solo_task_friendly: true, listed_in_events: false },
    ])
    .select("id, name, normalized_name, description, default_host_id, purpose, requires_host, solo_task_friendly, listed_in_events, announced_publicly, guests_allowed");
  if (typeError) throw new Error(typeError.message);
  const asType = (r: NonNullable<typeof typeRows>[number]): PrickleType => ({
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    description: r.description,
    defaultHostId: r.default_host_id,
    purpose: r.purpose,
    requiresHost: r.requires_host ?? false,
    soloTaskFriendly: r.solo_task_friendly,
    listedInEvents: r.listed_in_events,
    announcedPublicly: r.announced_publicly,
    guestsAllowed: r.guests_allowed,
  });
  const byName = (n: string) => asType(typeRows!.find((r) => r.name === n)!);
  types = [byName(`Contract Sprint ${RUN}`), byName(`Contract Chat ${RUN}`)];
});

afterAll(async () => {
  await clearPrickles();
  await db.from("prickle_types").delete().in("id", types.map((t) => t.id));
  await db.from("members").delete().in("id", hosts.map((h) => h.id));
});

definePrickleContract("SupabasePrickleRepository", () => ({
  get types() {
    return types;
  },
  get hosts() {
    return hosts;
  },
  repo: () => new SupabasePrickleRepository(db),
  adopt: (ids: string[]) => {
    created.push(...ids);
  },
  seed: async (seeds: PrickleSeed[]) => {
    await clearPrickles();
    const rows = seeds.map((s) => ({
      title: s.title ?? null,
      description: s.description ?? null,
      guest_speaker: s.guestSpeaker ?? null,
      zoom_meeting_uuid: s.zoomMeetingUuid ?? null,
      ...(s.createdAt ? { created_at: s.createdAt } : {}),
      type_id: s.type === undefined ? null : types[s.type].id,
      host: s.host === undefined ? null : hosts[s.host].id,
      start_time: s.start,
      end_time: s.end ?? s.start,
      source: s.source ?? "calendar",
    }));
    const ids: string[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await db.from("prickles").insert(rows.slice(i, i + 500)).select("id");
      if (error) throw new Error(error.message);
      ids.push(...data!.map((r) => r.id));
    }
    created.push(...ids);
    return ids;
  },
}));
