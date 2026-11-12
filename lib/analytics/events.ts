/**
 * The tracking plan: every event the Hub records, and the only properties each may carry.
 *
 * Names are `object_action` in snake_case (`onair_join_clicked`); properties are snake_case too.
 * Nothing outside this list is stored: the receiver (app/api/track/events) drops unknown events
 * and unknown properties, and `track()` is typed from it, so a typo or an undeclared property is
 * a compile error. That is also the privacy filter. Properties can only be booleans, small
 * numbers, one of a fixed set of words, or short text, so a free-form value (a name, an email, a
 * message) has no way in unless someone declares a `text` property here, which review will see.
 *
 * To add an event: add it below, call `track("name", { ... })` where it happens. No migration.
 * Prefer a boolean, count or enum over `text`; use `text` only for labels the UI itself defines.
 */

import { OUTCOME_ACTIONS } from "@/lib/analytics/actions";
import { CARE_CHANNELS, CARE_ENDED_HOW, CARE_REASONS, MESSAGE_DIRECTIONS } from "@/lib/care-values";
import { SIGNIN_FAILURE_REASONS, SIGNIN_METHODS } from "@/lib/signin-method-client";

type Spec =
  | { kind: "bool"; optional?: boolean }
  | { kind: "int"; max: number; optional?: boolean }
  | { kind: "enum"; values: readonly string[]; optional?: boolean }
  | { kind: "text"; max: number; optional?: boolean };

const bool = (): Spec => ({ kind: "bool" });
const int = (max = 100_000): Spec => ({ kind: "int", max });
const oneOf = <const V extends readonly string[]>(...values: V): Spec & { kind: "enum"; values: V } => ({
  kind: "enum",
  values,
});
const text = (max: number): Spec => ({ kind: "text", max });
const optional = <S extends Spec>(spec: S): S & { optional: true } => ({ ...spec, optional: true });

export const EVENTS = {
  /** A page the member landed on, by route template (`/prickles/[id]`), never the real path. */
  page_viewed: { route: text(120) },

  /**
   * A click on a button, link or form control, recorded automatically (lib/analytics/autocapture.ts)
   * so there is data for things nobody thought to name. `name` is the element's `data-track`
   * or `id`; `text` is its label (aria-label, a field's `<label>`, or its own text), left out for
   * a link to a record page, whose text is often a person's name; `target_route` is where an
   * internal link goes, as a route template.
   */
  element_clicked: {
    element: oneOf("button", "link", "input", "other"),
    route: text(120),
    name: optional(text(80)),
    text: optional(text(40)),
    target_route: optional(text(120)),
  },

  /**
   * A named control (one with `data-track="..."`) scrolled into view, once per visit
   * (lib/analytics/impressions.ts). The denominator for click-through: how many visits saw a
   * control against how many clicked it, which is what shows a control nobody uses. `route` is
   * the page it was first seen on.
   */
  element_seen: { name: text(80), route: text(120) },

  /** The Animations choice changed in Settings (system, allow or reduce); `device_reduces_motion` is the device's own reduce-motion setting at the time. */
  animations_setting_changed: { choice: oneOf("system", "allow", "reduce"), device_reduces_motion: bool() },

  /** A GIF attachment played or paused by hand while animations are off (a member who needs it still, choosing to watch one). */
  gif_play_toggled: { playing: bool() },

  // Search (components/search, app/(member)/chat/search). Never the query text: only its shape
  // (lib/analytics/search.ts) and what happened with the results.
  /** The header search palette opened: by its button, by Cmd/Ctrl+K, or by pressing "/". */
  search_opened: { via: oneOf("button", "shortcut_k", "shortcut_slash") },
  /**
   * A search ran and its results were shown (the palette reports once typing settles or the member
   * acts, not per keystroke). `kind` is the `in:` scope or "all", `operators` the operator names
   * used, `results` the hits shown and `chat_results` how many of them were chat messages.
   */
  search_ran: {
    surface: oneOf("palette", "page", "chat_page"),
    kind: text(20),
    operators: text(60),
    words: int(50),
    results: int(),
    chat_results: int(),
    chat_searched: bool(),
  },
  /** A search result was opened: `kind` is what it was (chat, members, pages...), `rank` its place in the list (1 = first). */
  search_result_clicked: {
    surface: oneOf("palette", "page", "chat_page"),
    kind: text(20),
    rank: int(1000),
    via: oneOf("click", "enter"),
  },
  /** A suggestion on the empty palette was opened: something needing attention, a recent place, or a recent search. */
  search_suggestion_clicked: {
    source: oneOf("needs_attention", "recent_place", "recent_search"),
    kind: text(20),
    rank: int(100),
    via: oneOf("click", "enter"),
  },
  /** A palette filter was changed (`option` is from a fixed list: a kind, a chip, a time range, an operator name). */
  search_filter_used: {
    filter: oneOf("kind", "quick_chip", "from_button", "time_range", "more_option", "date", "completion"),
    option: optional(text(40)),
  },

  /** A course lesson was marked complete or cleared (components/courses/LessonCompletion.tsx): by the member's button, or automatically when the player reached the watched mark. */
  lesson_completion_changed: { completed: bool(), via: oneOf("button", "watched") },

  /** A course lesson page was opened by a member (components/courses/LessonViewed.tsx): `has_video` tells a video lesson from a text one. */
  course_lesson_viewed: { has_video: bool() },

  /** The lesson's video started playing, once per page view (components/courses/LessonPlayer.tsx): `resumed` is whether it picked up from a saved position. */
  course_video_played: { resumed: bool() },

  /**
   * The lesson's video failed to play in the member's browser (components/courses/LessonPlayer.tsx), after the one retry
   * with a fresh link (course_video_token_refreshed) if that applied. `code` is the browser's media error (1 aborted, 2 network,
   * 3 decode, 4 source not supported; 0 unknown). The rest says what failed: `lesson_id` and `playback_id` (Mux's signed playback id,
   * useless without a token; the token itself is never recorded), `restricted` whether the token carried the referrer restriction,
   * `status` the HTTP status of the failed request (hls.js only), `detail` hls.js's error detail word (`manifestLoadError`).
   * Also alerts staff.
   */
  course_video_error: {
    code: int(10),
    lesson_id: optional(text(24)),
    playback_id: optional(text(60)),
    restricted: optional(bool()),
    status: optional(int(599)),
    detail: optional(text(40)),
  },

  /** A lesson's video hit a network error with a playback link that had probably expired, a fresh link was fetched and the video played (components/courses/LessonPlayer.tsx): `minutes_open` is how long the page had been open. No alert. */
  course_video_token_refreshed: { minutes_open: int(10_000) },

  /** Files were added to the chat composer (components/chat/Composer.tsx): `via` is how, `count` how many. */
  chat_files_attached: { via: oneOf("picker", "paste", "drop"), count: int() },

  /** Files were added to a message being edited (components/chat/MessageBody.tsx): `via` is how, `count` how many. */
  chat_files_added_to_edit: { via: oneOf("picker", "paste", "drop"), count: int() },

  /** A saved draft was put back in a chat message box when it opened (components/chat/Composer.tsx): `thread` whether it is a thread's reply box. */
  chat_draft_restored: { thread: bool() },

  /** A member cancelled the upload of a message's files while sending (components/chat/Composer.tsx): `count` files were attached. */
  chat_upload_cancelled: { count: int() },

  /** A reaction was chosen in the full emoji picker (components/chat/EmojiPicker.tsx): `via` is its Frequently used row, browsing a category, or search; `custom` whether it was a workspace emoji. */
  chat_reaction_picked: { via: oneOf("recent", "browse", "search"), custom: bool() },

  /** A format was applied in a message box (components/chat/MessageBox.tsx): which one, and from the toolbar or a keyboard shortcut. */
  chat_format_applied: {
    kind: oneOf("bold", "italic", "underline", "strike", "link", "code", "codeblock", "quote", "bullets", "numbers"),
    via: oneOf("toolbar", "shortcut", "typed", "paste"),
  },

  /** A list item was nested or un-nested with Tab or Shift+Tab in a message box (components/chat/MessageBox.tsx): `in` is a deeper level, `out` a shallower one. */
  chat_list_indented: { direction: oneOf("in", "out") },

  /** Files for a chat message could not be uploaded (components/chat/Composer.tsx, MessageBody.tsx): `stage` is asking for the upload links (`prepare`: the server refused, or the request failed) or sending the files to storage (`upload`); `count` how many files. Cancelling is `chat_upload_cancelled`, not this. */
  chat_upload_failed: { where: oneOf("message", "edit"), stage: oneOf("prepare", "upload"), count: int() },

  /**
   * A message was sent or an edit saved (components/chat/Composer.tsx, MessageBody.tsx): what it contains, as flags and counts, never
   * its text (lib/chat/message-features.ts). `where` is a new message, a thread reply or an edit; `files` the files sent or added and
   * `files_removed` those taken off in an edit; `list_depth` 0 for no list, 2 and up nested; `used_toolbar`, `used_shortcut`, `used_typed` (typed markers such as `*bold*`, `> `, `- `),
   * `used_paste` (formatted text pasted) and `used_tab` (Tab or Shift+Tab in a list) how formatting got in while writing it.
   */
  chat_message_composed: {
    where: oneOf("message", "reply", "edit"),
    files: int(),
    files_removed: int(),
    bold: bool(),
    italic: bool(),
    underline: bool(),
    strike: bool(),
    code: bool(),
    codeblock: bool(),
    quote: bool(),
    bullets: bool(),
    numbers: bool(),
    link: bool(),
    list_depth: int(10),
    lines: int(),
    mentions: int(),
    used_toolbar: bool(),
    used_shortcut: bool(),
    used_typed: bool(),
    used_paste: bool(),
    used_tab: bool(),
  },

  /** The author removed a preview card from their message with the X in its corner (components/chat/RemoveUnfurlButton.tsx): `source` is a preview the Hub made for a link or one of Slack's unfurls. Never the address. */
  chat_unfurl_removed: { source: oneOf("hub", "slack") },

  /** An emoji was picked from the `:name` suggestions in a message box (components/chat/MessageBox.tsx): `custom` whether it was a workspace emoji, `via` the keyboard or the pointer. */
  chat_emoji_suggestion_picked: { custom: bool(), via: oneOf("keyboard", "pointer") },

  /**
   * A member's profile-at-a-glance opened from their name (components/member/MemberHoverCard.tsx):
   * `surface` is the page it was on, `has_message` whether the card offered a Message button.
   */
  member_hover_card_opened: { surface: oneOf("chat", "streaks", "big_sisters"), has_message: bool() },

  // Hedgie Care (app/(admin)/admin/care): staff's reach-outs to members, one engagement per period. Never the member, the notes or the next step.
  /** A staff member started an engagement: its `reason` and `channel`, and whether the member wrote first. */
  care_engagement_started: { reason: oneOf(...CARE_REASONS), channel: oneOf(...CARE_CHANNELS), member_wrote_first: bool() },
  /** A staff member logged a message in an engagement: `direction` is who wrote it. */
  care_message_logged: { direction: oneOf(...MESSAGE_DIRECTIONS) },
  /** A staff member closed an engagement: `ended_how` is her read of how it went, `days_open` how many whole days it was open. */
  care_engagement_closed: { ended_how: oneOf(...CARE_ENDED_HOW), days_open: int(3650) },
  /** A staff member renewed an engagement into a new period: `days_open` is how long the one they renewed had run. */
  care_engagement_renewed: { days_open: int(3650) },
  /** A staff member chose to track one of their Slack DMs (or stopped): `dms_tracked` is how many they track now. Never whose DM it is. */
  care_dm_tracked: { dms_tracked: int(5000) },
  care_dm_untracked: { dms_tracked: int(5000) },

  /**
   * A server action finished (lib/analytics/server.ts: `withAction`): `action` is which one, `ok`
   * whether it worked, `detail` a short word when "worked" needs qualifying (a wheel spin that found
   * nobody). Recorded by the server, in the visit that made the request and only for visitors who
   * allow usage tracking; the browser can't send it.
   */
  action_completed: { action: oneOf(...OUTCOME_ACTIONS), ok: bool(), detail: optional(text(20)) },

  /**
   * The app sent a member a notification (`kind` is a notification kind, `channel` slack, email, push
   * or in_app). Recorded by the system as it sends, with no visit; the browser can't send it. With
   * `notification_opened` it gives each kind and channel an open rate.
   */
  notification_sent: { kind: text(40), channel: text(20) },
  /**
   * A member opened a notification: by clicking it in the Hub (in_app), or by arriving through a link
   * in one (the link carries its kind and channel; lib/notifications/attribution.ts reads and strips them).
   */
  notification_opened: { kind: text(40), channel: text(20) },

  /**
   * A member signed in, and how (lib/signin-method.ts: `email_link`, `email_code`, `slack_link`,
   * `slack_continue`, `slack_code`). Recorded by the browser on the first page after sign-in, if
   * tracking is allowed. Failed sign-ins are not events: they happen before there is a member (see
   * docs/ANALYTICS.md, "Sign-in").
   */
  signed_in: { method: oneOf(...SIGNIN_METHODS) },

  /**
   * Before this member signed in, they ran into `count` failed attempts of one kind
   * (lib/signin-method-client.ts SIGNIN_FAILURE_REASONS: a link opened in another browser, a refused
   * or expired link or code, a Slack link or code that didn't work). Carried in a cookie by the
   * browser and recorded by the first page after they get in, so it only exists for people who did
   * sign in; people who never got in are in the server logs (lib/signin-log.ts).
   */
  signin_failed: { reason: oneOf(...SIGNIN_FAILURE_REASONS), count: int(20) },

  // On air light (components/LiveRoomIndicator.tsx). `live` is whether anyone was at the table.
  onair_popover_opened: { live: bool(), room_size: int() },
  /** "Join on Zoom" when live; "Start a PUP on Zoom" when off air. */
  onair_join_clicked: { live: bool(), room_size: int() },
  onair_prickle_clicked: { room_size: int() },
  onair_member_clicked: { room_size: int() },

  /** A help article (help/<slug>.md) was opened. `slug` is the file name, chosen by us, never typed by a member. */
  help_article_viewed: { slug: text(60) },

  /** A changelog entry (lib/changelog/entries.ts) was opened. `slug` is chosen by us, never typed by a member. */
  changelog_entry_viewed: { slug: text(60) },

  // The media library picker (components/media/MediaPicker.tsx). `surface` is where it was opened,
  // named by us; a title, tag, file name or search text never goes in.
  media_picker_opened: { surface: oneOf("event_cover", "admin_library", "book_cover", "lesson_thumbnail") },
  /** An image was chosen: from the library (`searched` says a search was typed first) or by uploading it right there. */
  media_picked: { surface: oneOf("event_cover", "admin_library", "book_cover", "lesson_thumbnail"), from: oneOf("library", "upload", "event_photo"), searched: bool() },
  media_cleared: { surface: oneOf("event_cover", "admin_library", "book_cover", "lesson_thumbnail") },
  /** An upload finished or failed. `converted` is a HEIC photo turned into JPEG, `duplicate` a file the library already had, `large` one sent through the signed URL. */
  media_uploaded: { surface: oneOf("event_cover", "admin_library", "book_cover", "lesson_thumbnail"), ok: bool(), converted: bool(), duplicate: bool(), large: bool() },
  // The staff library (app/(admin)/admin/media). Which fields a save changed; never their values.
  media_edited: { title: bool(), alt: bool(), tags: bool(), focal: bool(), fit: bool(), is_public: bool() },
  /** A delete was attempted; `in_use` means it was refused because something still shows the image. */
  media_deleted: { ok: bool(), in_use: bool() },

  // Admin: managing events (app/(admin)/admin/events, the prickle page's "Events" card). `source` is where the
  // schedule comes from: a calendar item, or a Hub session for an event made in the Hub. Answers: do admins
  // edit events on the event page (the one place), and how often is one made by hand rather than from the calendar.
  /** An admin saved the event's details. */
  event_edited: { source: oneOf("calendar", "hub"), ok: bool() },
  /** An admin made an event: from the create form (`hub_form`) or by showing a calendar item in Events (`calendar_item`). */
  event_created: { from: oneOf("hub_form", "calendar_item"), ok: bool() },
  /** A download was started: the original file, the Amazon ebook cover, or a custom size. */
  media_downloaded: { kind: oneOf("original", "kdp_ebook", "custom") },
} satisfies Record<string, Record<string, Spec>>;

export type EventName = keyof typeof EVENTS;

type ValueOf<S> = S extends { kind: "bool" }
  ? boolean
  : S extends { kind: "int" }
    ? number
    : S extends { kind: "enum"; values: readonly (infer V)[] }
      ? V
      : string;

type Props<N extends EventName> = {
  [K in keyof (typeof EVENTS)[N] as (typeof EVENTS)[N][K] extends { optional: true } ? never : K]: ValueOf<
    (typeof EVENTS)[N][K]
  >;
} & {
  [K in keyof (typeof EVENTS)[N] as (typeof EVENTS)[N][K] extends { optional: true } ? K : never]?: ValueOf<
    (typeof EVENTS)[N][K]
  >;
};

export type EventProps<N extends EventName> = Props<N>;

export function isEventName(name: unknown): name is EventName {
  return typeof name === "string" && Object.hasOwn(EVENTS, name);
}

export type PropertiesResult =
  | { ok: true; properties: Record<string, boolean | number | string> }
  | { ok: false; reason: string };

/**
 * Checks `raw` against an event's declared properties. Undeclared properties are dropped (not an
 * error: an older client may send one a newer plan removed); a missing required property, or one
 * of the wrong type, rejects the whole event.
 */
export function validateProperties(name: EventName, raw: unknown): PropertiesResult {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const properties: Record<string, boolean | number | string> = {};
  for (const [key, spec] of Object.entries(EVENTS[name]) as [string, Spec][]) {
    const value = input[key];
    if (value === undefined || value === null) {
      if (spec.optional) continue;
      return { ok: false, reason: `${name}.${key} is required` };
    }
    switch (spec.kind) {
      case "bool":
        if (typeof value !== "boolean") return { ok: false, reason: `${name}.${key} must be a boolean` };
        break;
      case "int":
        if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > spec.max) {
          return { ok: false, reason: `${name}.${key} must be an integer from 0 to ${spec.max}` };
        }
        break;
      case "enum":
        if (typeof value !== "string" || !spec.values.includes(value)) {
          return { ok: false, reason: `${name}.${key} must be one of ${spec.values.join(", ")}` };
        }
        break;
      case "text":
        if (typeof value !== "string" || value.length > spec.max) {
          return { ok: false, reason: `${name}.${key} must be text of at most ${spec.max} characters` };
        }
        break;
    }
    properties[key] = value as boolean | number | string;
  }
  return { ok: true, properties };
}

export interface PropertyDescription {
  name: string;
  kind: Spec["kind"];
  /** The allowed words, for an enum. */
  values?: readonly string[];
  optional: boolean;
}

export interface EventDescription {
  name: EventName;
  properties: PropertyDescription[];
}

/** The plan as plain data, for pickers that build themselves from it (the usage explorer). */
export function describeEvents(): EventDescription[] {
  return (Object.keys(EVENTS) as EventName[]).map((name) => ({
    name,
    properties: (Object.entries(EVENTS[name]) as [string, Spec][]).map(([property, spec]) => ({
      name: property,
      kind: spec.kind,
      ...(spec.kind === "enum" ? { values: spec.values } : {}),
      optional: spec.optional === true,
    })),
  }));
}

/** Events only the server or the system may record; the browser's batch endpoint refuses them. */
export const SERVER_ONLY_EVENTS: ReadonlySet<EventName> = new Set<EventName>(["action_completed", "notification_sent"]);
