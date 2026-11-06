/**
 * Demo content that belongs to members, not to the calendar: the demo member's writing goals and a past project,
 * published books with generated covers (kept in the media library the way the book form keeps them), profile links,
 * alternate names, and the newcomer persona's Getting started tour. All invented; every step replaces what it wrote
 * on a previous run, so `pnpm demo:seed` can run again.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/data/db";
import { SupabaseMediaRepository } from "@/lib/data/media";
import { bookCoverUrlFor } from "@/lib/bookCover";
import { storeImage } from "@/lib/media/library";
import { storedEditions, type BookEdition } from "@/lib/book-editions";
import { coverPng } from "./covers";
import { orgDate } from "./seed";

type Admin = SupabaseClient;

interface DemoBook {
  owner: string;
  title: string;
  description: string;
  genres: string[];
  publishedDaysAgo: number;
  colors: [string, string];
  editions: BookEdition[];
  penName?: string;
}

const DEMO_BOOKS: DemoBook[] = [
  {
    owner: "maya.example@example.com",
    title: "Salt and Sourdough",
    description: "A small-town baker, a stolen starter and a very polite blackmailer. A cozy mystery with a recipe at the end of every chapter.",
    genres: ["Cozy Mystery", "Women's Fiction"],
    publishedDaysAgo: 120,
    colors: ["#5b3a6e", "#d98aa6"],
    editions: [
      { format: "print", purchase_url: "https://books.example.com/salt-and-sourdough/print", price: 14.99 },
      { format: "ebook", purchase_url: "https://books.example.com/salt-and-sourdough/ebook", price: 4.99 },
    ],
  },
  {
    owner: "maya.example@example.com",
    title: "Kettle Songs",
    description: "Twelve very short stories, each written in one prickle.",
    genres: ["Short Stories"],
    publishedDaysAgo: 40,
    colors: ["#1f4e5f", "#7fb8a4"],
    editions: [{ format: "ebook", purchase_url: "https://books.example.com/kettle-songs/ebook", price: 2.99 }],
  },
  {
    owner: "hazel.hosting@example.com",
    title: "The Cartographer's Hedgehog",
    description: "A middle-grade fantasy about a map that redraws itself and the hedgehog who follows it.",
    genres: ["Fantasy", "Middle Grade"],
    publishedDaysAgo: 300,
    colors: ["#2d5a3d", "#e0b94f"],
    editions: [
      { format: "print", purchase_url: "https://books.example.com/cartographers-hedgehog/print", price: 12.5 },
      { format: "ebook", purchase_url: "https://books.example.com/cartographers-hedgehog/ebook", price: 3.99 },
    ],
  },
  {
    owner: "julia.sample@example.com",
    title: "Small Weather",
    description: "Sonnets about rain, mostly.",
    genres: ["Poetry"],
    publishedDaysAgo: 200,
    colors: ["#34495e", "#9fb4c7"],
    editions: [{ format: "print", purchase_url: "https://books.example.com/small-weather/print", price: 9 }],
  },
  {
    owner: "willa.placeholder@example.com",
    title: "A Dragon in the Tea Shop",
    description: "Cozy fantasy with strong tea and a very large dragon.",
    genres: ["Fantasy", "Romance"],
    publishedDaysAgo: 80,
    colors: ["#7a2e3b", "#f0a868"],
    editions: [{ format: "ebook", purchase_url: "https://books.example.com/dragon-tea-shop/ebook", price: 5.99 }],
  },
];

/** Alternate names: who they are known by in Zoom or Slack, so member search finds them by it. */
export const DEMO_ALIASES = [
  { email: "willa.placeholder@example.com", alias: "Willow P.", source: "slack" },
  { email: "julia.sample@example.com", alias: "Jules Sample", source: "zoom" },
  { email: "rosa.demo@example.com", alias: "Rosie D.", source: "zoom" },
];

/** The newcomer persona's tour: the first two Identity stops are checked, the Zoom name and Slack steps are open. */
export const NEWCOMER_MARKED_STEPS = ["identity.basics", "identity.display-name"];

async function memberIds(admin: Admin, emails: string[]): Promise<Map<string, string>> {
  const { data, error } = await admin.from("members").select("id, email").in("email", emails);
  if (error) throw new Error(`members: ${error.message}`);
  return new Map((data ?? []).map((m) => [m.email as string, m.id as string]));
}

/** Goals for the demo member's projects: one achieved, one ended, one active, and a hibernating project for "Past". */
export async function seedWritingGoals(admin: Admin, memberId: string, now: Date) {
  const lighthouse = await admin.from("writing_projects").select("id").eq("member_id", memberId).eq("external_id", "demo-lighthouse").single();
  if (lighthouse.error) throw new Error(`writing_projects: ${lighthouse.error.message}`);
  const goals = [
    { external_id: "demo-goal-first-10k", title: "First 10,000 words", description: "Get the opening act down, even if it is messy.", target_amount: 10000, start_date: orgDate(-30, now), end_date: orgDate(10, now) },
    { external_id: "demo-goal-act-one", title: "Finish act one", description: "Twenty thousand words by the end of last month's push.", target_amount: 20000, start_date: orgDate(-30, now), end_date: orgDate(-2, now) },
    { external_id: "demo-goal-forty-k", title: "Reach 40,000 words", description: "A full first draft by the new year.", target_amount: 40000, start_date: orgDate(-30, now), end_date: orgDate(45, now) },
  ].map((g) => ({ ...g, member_id: memberId, project_id: lighthouse.data.id, goal_type: "target", measure: "words", show_on_profile: true }));
  const { error } = await admin.from("writing_goals").insert(goals);
  if (error) throw new Error(`writing_goals: ${error.message}`);
}

/** Books with generated covers, registered in the media library as their owners' own images. */
export async function seedBooks(admin: Admin, now: Date) {
  const ids = await memberIds(admin, [...new Set(DEMO_BOOKS.map((b) => b.owner))]);
  const media = new SupabaseMediaRepository(admin as unknown as Db);
  for (const book of DEMO_BOOKS) {
    const memberId = ids.get(book.owner);
    if (!memberId) continue;
    const { data: author } = await admin.from("members").select("name").eq("id", memberId).single();
    const png = await coverPng({ title: book.title, author: author?.name ?? "", colors: book.colors });
    const stored = await storeImage(media, admin.storage, { bytes: png, title: `${book.title} cover`, ownerMemberId: memberId, tags: ["demo", "cover"] });
    if (!stored.ok) throw new Error(`cover for ${book.title}: ${stored.error}`);
    const { error } = await admin.from("member_books").insert({
      member_id: memberId,
      title: book.title,
      description: book.description,
      genres: book.genres,
      pen_name: book.penName ?? null,
      published_date: orgDate(-book.publishedDaysAgo, now),
      cover_url: bookCoverUrlFor(stored.asset.id),
      cover_asset_id: stored.asset.id,
      editions: storedEditions(book.editions),
    });
    if (error) throw new Error(`member_books ${book.title}: ${error.message}`);
  }
}

export async function seedAliases(admin: Admin) {
  const ids = await memberIds(admin, DEMO_ALIASES.map((a) => a.email));
  const rows = DEMO_ALIASES.flatMap((a) => (ids.has(a.email) ? [{ member_id: ids.get(a.email)!, alias: a.alias, source: a.source, active: true }] : []));
  const { error } = await admin.from("member_name_aliases").insert(rows);
  if (error) throw new Error(`member_name_aliases: ${error.message}`);
}

/** Social links on the demo member's profile; a Kajabi id so Settings offers the Instagram field. */
export async function seedProfileLinks(admin: Admin, email: string) {
  const { error } = await admin
    .from("members")
    .update({
      kajabi_id: "demo-kajabi-maya",
      instagram_url: "https://www.instagram.com/maya.writes.example",
      facebook_url: "https://www.facebook.com/maya.writes.example",
      twitter_url: "https://x.com/maya_writes_example",
    })
    .eq("email", email);
  if (error) throw new Error(`profile links: ${error.message}`);
}

/** An upcoming Sprint Prickle gets a guest speaker (set after calendar processing, which would otherwise overwrite it). */
export async function seedGuestSpeaker(admin: Admin, now: Date) {
  const { data: type, error: typeError } = await admin.from("prickle_types").select("id").eq("name", "Sprint Prickle").maybeSingle();
  if (typeError) throw new Error(`prickle_types: ${typeError.message}`);
  if (!type) return;
  const { data, error } = await admin
    .from("prickles")
    .select("id")
    .eq("type_id", type.id)
    .gt("start_time", now.toISOString())
    .order("start_time")
    .limit(1);
  if (error) throw new Error(`prickles: ${error.message}`);
  if (!data?.[0]) return;
  const { error: updateError } = await admin.from("prickles").update({ guest_speaker: "Tamsin Fictional" }).eq("id", data[0].id);
  if (updateError) throw new Error(`guest speaker: ${updateError.message}`);
}

/** The newcomer's tour in progress, and no Slack connection. */
export async function seedNewcomerTour(admin: Admin, email: string) {
  const ids = await memberIds(admin, [email]);
  const memberId = ids.get(email);
  if (!memberId) return;
  const { error } = await admin
    .from("member_onboarding")
    .upsert({ member_id: memberId, marked_steps: NEWCOMER_MARKED_STEPS, dismissed_at: null, completed_at: null }, { onConflict: "member_id" });
  if (error) throw new Error(`member_onboarding: ${error.message}`);
  const { error: slackError } = await admin.from("member_slack_connections").delete().eq("member_id", memberId);
  if (slackError) throw new Error(`member_slack_connections: ${slackError.message}`);
}
