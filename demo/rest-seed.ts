/**
 * Demo content for the changelog screenshots that need more than the base community: the Events feature (switched
 * on, with invented events and pictures), and a calendar description that keeps its formatting. Everything is
 * fictional and replaced on every run, so `pnpm demo:seed` can run again.
 *
 * The events come in the way production makes them: Bronze calendar items tagged `#event` (docs/CALENDAR_EVENTS.md),
 * which the app's own calendar processing turns into prickles and events. Only what the calendar has no place for
 * (kind, sign-up, picture) is set afterwards.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import type { Db } from "@/lib/data/db";
import { SupabaseMediaRepository } from "@/lib/data/media";
import { storeImage } from "@/lib/media/library";
import { ORG_TIMEZONE } from "@/lib/config";
import { INSTAGRAM_BASE_URL, INSTAGRAM_CUSTOM_FIELD_HANDLE, toSocialUrl } from "@/lib/kajabi/profile-fields";
import { FACEBOOK_BASE_URL, X_BASE_URL } from "@/lib/social-links";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";

type Admin = SupabaseClient;

export interface DemoEventSpec {
  key: string;
  summary: string;
  /** Days from today (org timezone) and the local start time; `days` makes an all-day item that many days long. */
  dayOffset: number;
  startLocal: string;
  minutes?: number;
  days?: number;
  /** HTML, as Google Calendar stores a description. `#event` is added when `tagged` is set. */
  description: string;
  location: string | null;
  tagged: boolean;
  /** What the app has no place for on the calendar: set on the event after processing. */
  eventType?: "virtual_retreat" | "workshop" | "book_launch" | "educational" | "session";
  registration?: "none" | "signup" | "application";
  colors?: [string, string];
}

/** The formatted description of the demo's showcase item: bold, italic, a link, a list and a dividing line. */
export const FORMATTED_DESCRIPTION =
  "<b>Bring a scene that is stuck.</b><br><br>We will spend the hour on <i>one</i> problem at a time:<ul><li>Read your stuck scene aloud (two minutes each)</li><li>Say what you <b>want</b> to happen next</li><li>Write it, together, in silence</li></ul>Not sure what to bring? See <a href=\"https://example.com/stuck-scene-prompts\">our list of prompts</a>.<br>---<br>Free for every Hedgie. Cameras are optional.";

export const DEMO_EVENTS: DemoEventSpec[] = [
  {
    key: "ev-retreat",
    summary: "Quill & Cup Winter Writing Retreat",
    dayOffset: 18,
    startLocal: "00:00",
    days: 3,
    description: "<b>Three days of writing together.</b><br>Morning prickles, afternoon workshops and a Sunday show-and-tell. Sign up to hold your place.",
    location: "https://zoom.example.com/j/0000000001",
    tagged: true,
    eventType: "virtual_retreat",
    registration: "signup",
    colors: ["#1f4e5f", "#e0b94f"],
  },
  {
    key: "ev-workshop",
    summary: "Cozy Mystery Workshop with Ada Example",
    dayOffset: 9,
    startLocal: "14:00",
    minutes: 120,
    description:
      "<b>Plot a cozy mystery in two hours.</b><ul><li>The body</li><li>The baker</li><li>The red herring</li></ul>Read <a href=\"https://example.com/cozy-mystery-reading-list\">the reading list</a> first, <i>if you like</i>.<br>---<br>Sign up so we know how many to expect.",
    location: "https://zoom.example.com/j/0000000002",
    tagged: true,
    eventType: "workshop",
    registration: "signup",
    colors: ["#5b3a6e", "#d98aa6"],
  },
  {
    key: "ev-launch",
    summary: "Book Launch: Salt and Sourdough",
    dayOffset: 24,
    startLocal: "19:00",
    minutes: 60,
    description: "Come and hear the first chapter, with cake in the chat.",
    location: "https://zoom.example.com/j/0000000003",
    tagged: true,
    eventType: "book_launch",
    registration: "none",
    colors: ["#7a2e3b", "#f0a868"],
  },
  {
    key: "ev-edu-outline",
    summary: "Quill & Cup [Craft] Prickle: Outlining Without Tears w/Rosa Demo",
    dayOffset: 6,
    startLocal: "13:00",
    minutes: 60,
    description: "A short talk and a hands-on outline of your next scene.",
    location: "https://zoom.example.com/j/0000000004",
    tagged: true,
    eventType: "educational",
    registration: "none",
    colors: ["#2d5a3d", "#9fd3a7"],
  },
  {
    key: "ev-edu-query",
    summary: "Quill & Cup [Publishing] Prickle: Your First Query Letter w/Julia Sample",
    dayOffset: 13,
    startLocal: "13:00",
    minutes: 60,
    description: "What goes in a query letter, and what stays out.",
    location: "https://zoom.example.com/j/0000000005",
    tagged: true,
    eventType: "educational",
    registration: "none",
    colors: ["#34495e", "#9fb4c7"],
  },
  {
    key: "ev-past-retreat",
    summary: "Quill & Cup Autumn Writing Retreat",
    dayOffset: -22,
    startLocal: "00:00",
    days: 3,
    description: "<b>Three days of writing together.</b><br>Thank you to everyone who came.",
    location: "https://zoom.example.com/j/0000000006",
    tagged: true,
    eventType: "virtual_retreat",
    registration: "signup",
    colors: ["#b5651d", "#f3d9a4"],
  },
  {
    key: "ev-past-workshop",
    summary: "Dialogue That Sounds Like People with Ada Example",
    dayOffset: -12,
    startLocal: "14:00",
    minutes: 90,
    description: "A workshop on dialogue tags, interruptions and silence.",
    location: "https://zoom.example.com/j/0000000007",
    tagged: true,
    eventType: "workshop",
    registration: "signup",
    colors: ["#34495e", "#d98aa6"],
  },
  {
    key: "ev-past-edu",
    summary: "Quill & Cup [Craft] Prickle: Plot Twists That Work w/Rosa Demo",
    dayOffset: -7,
    startLocal: "13:00",
    minutes: 60,
    description: "Setting up a twist so the reader says of course.",
    location: "https://zoom.example.com/j/0000000008",
    tagged: true,
    eventType: "educational",
    registration: "none",
    colors: ["#2d5a3d", "#e0b94f"],
  },
];

const EVENT_PREFIX = "demo-";

/** The Bronze calendar rows for the demo events, as the importer would have stored them. */
export function eventCalendarRows(now: Date, orgDate: (offset: number, now?: Date) => string) {
  return DEMO_EVENTS.map((e) => {
    const start = zonedTimeToUtc(orgDate(e.dayOffset, now), e.startLocal, ORG_TIMEZONE);
    const end = e.days ? zonedTimeToUtc(orgDate(e.dayOffset + e.days, now), "00:00", ORG_TIMEZONE) : new Date(start.getTime() + (e.minutes ?? 60) * 60_000);
    return {
      google_event_id: `${EVENT_PREFIX}${e.key}`,
      summary: e.summary,
      description: e.tagged ? `${e.description}<br><br>#event` : e.description,
      location: e.location,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      raw_data: { demo: true },
    };
  });
}

/** Gives the next upcoming Sprint Prickle a description with formatting (the changelog entry about descriptions). */
export function withFormattedDescription<T extends { summary: string | null; start_time: string; description?: string | null }>(rows: T[], now: Date): T[] {
  const next = rows
    .filter((r) => r.summary?.startsWith("Sprint Prickle") && new Date(r.start_time) > new Date(now.getTime() + 86_400_000))
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  if (next) next.description = FORMATTED_DESCRIPTION;
  return rows;
}

/** A landscape picture for an event: a sky gradient, a sun and two hills. Deterministic, so the media library keeps one copy. */
export async function eventImagePng(colors: [string, string]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="880" cy="230" r="90" fill="#ffffff" fill-opacity="0.75"/>
<ellipse cx="320" cy="760" rx="620" ry="260" fill="#000000" fill-opacity="0.28"/>
<ellipse cx="900" cy="790" rx="640" ry="250" fill="#000000" fill-opacity="0.4"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Events switched on for everyone, as the admin does in the feature flags. */
export async function seedEventsFlag(admin: Admin) {
  const { error } = await admin.from("feature_flags").upsert({ feature_key: "events", enabled_globally: true }, { onConflict: "feature_key" });
  if (error) throw new Error(`feature_flags events: ${error.message}`);
}

/**
 * The demo member's Kajabi contact and customer. Settings, Profile reads the Instagram handle from the contact's
 * "Instagram Handle" custom field (`INSTAGRAM_CUSTOM_FIELD_HANDLE`) and Facebook, X and the bio from the customer's
 * profile, not from the member row, so they have to be there for the fields to fill in. The member row is set to the
 * same links, as member processing would, so Settings does not say "Syncing to your profile". Replaces its own rows on every run.
 */
export async function seedKajabiContact(admin: Admin, email: string, kajabiId: string, links: { instagram: string; facebook: string; x: string }) {
  const importedAt = new Date().toISOString();
  const { data: member, error: memberError } = await admin.from("members").select("bio").eq("email", email).single();
  if (memberError) throw new Error(`members: ${memberError.message}`);
  const { error } = await admin
    .schema("bronze")
    .from("kajabi_contacts")
    .upsert(
      { kajabi_contact_id: kajabiId, email, name: "Maya Example", data: { id: kajabiId, attributes: { email, [INSTAGRAM_CUSTOM_FIELD_HANDLE]: links.instagram } }, imported_at: importedAt },
      { onConflict: "kajabi_contact_id" },
    );
  if (error) throw new Error(`kajabi_contacts: ${error.message}`);
  const { error: customerError } = await admin
    .schema("bronze")
    .from("kajabi_customers")
    .upsert(
      {
        kajabi_customer_id: `${kajabiId}-customer`,
        email,
        name: "Maya Example",
        data: { id: `${kajabiId}-customer`, attributes: { email, public_bio: member.bio, socials: { facebook: links.facebook, twitter: links.x } } },
        updated_at_kajabi: importedAt,
        imported_at: importedAt,
      },
      { onConflict: "kajabi_customer_id" },
    );
  if (customerError) throw new Error(`kajabi_customers: ${customerError.message}`);
  const { error: linkError } = await admin
    .from("members")
    .update({
      instagram_url: toSocialUrl(INSTAGRAM_BASE_URL, links.instagram),
      facebook_url: toSocialUrl(FACEBOOK_BASE_URL, links.facebook),
      twitter_url: toSocialUrl(X_BASE_URL, links.x),
    })
    .eq("email", email);
  if (linkError) throw new Error(`members links: ${linkError.message}`);
}

/** After calendar processing: each demo event's kind, sign-up and picture (the calendar has no place for them). */
export async function seedEventDetails(admin: Admin) {
  const media = new SupabaseMediaRepository(admin as unknown as Db);
  for (const spec of DEMO_EVENTS) {
    const { data: item, error: itemError } = await admin.schema("bronze").from("calendar_events").select("id").eq("google_event_id", `${EVENT_PREFIX}${spec.key}`).maybeSingle();
    if (itemError) throw new Error(`calendar_events: ${itemError.message}`);
    if (!item) continue;
    const { data: prickle, error: prickleError } = await admin.from("prickles").select("id").eq("calendar_event_id", item.id).maybeSingle();
    if (prickleError) throw new Error(`prickles: ${prickleError.message}`);
    if (!prickle) continue;
    let imageId: string | null = null;
    if (spec.colors) {
      const stored = await storeImage(media, admin.storage, { bytes: await eventImagePng(spec.colors), title: `${spec.summary} picture`, tags: ["demo", "event"] });
      if (!stored.ok) throw new Error(`picture for ${spec.key}: ${stored.error}`);
      imageId = stored.asset.id;
    }
    const { error } = await admin
      .from("community_events")
      .update({ event_type: spec.eventType ?? "session", registration: spec.registration ?? "none", image_id: imageId })
      .eq("prickle_id", prickle.id);
    if (error) throw new Error(`community_events ${spec.key}: ${error.message}`);
  }
}
