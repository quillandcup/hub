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

  /** A course lesson was marked complete or cleared (app/(member)/courses/LessonCompletion.tsx): by the member's button, or automatically when the player reached the watched mark. */
  lesson_completion_changed: { completed: bool(), via: oneOf("button", "watched") },

  /** Files were added to the chat composer (components/chat/Composer.tsx): `via` is how, `count` how many. */
  chat_files_attached: { via: oneOf("picker", "paste", "drop"), count: int() },

  /** A member cancelled the upload of a message's files while sending (components/chat/Composer.tsx): `count` files were attached. */
  chat_upload_cancelled: { count: int() },

  /** A reaction was chosen in the full emoji picker (components/chat/EmojiPicker.tsx): `via` is its Frequently used row, browsing a category, or search; `custom` whether it was a workspace emoji. */
  chat_reaction_picked: { via: oneOf("recent", "browse", "search"), custom: bool() },

  /**
   * A member's profile-at-a-glance opened from their name (components/member/MemberHoverCard.tsx):
   * `surface` is the page it was on, `has_message` whether the card offered a Message button.
   */
  member_hover_card_opened: { surface: oneOf("chat", "streaks", "big_sisters"), has_message: bool() },

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

  // On air light (components/LiveRoomIndicator.tsx). `live` is whether anyone was at the table.
  onair_popover_opened: { live: bool(), room_size: int() },
  /** "Join on Zoom" when live; "Start a PUP on Zoom" when off air. */
  onair_join_clicked: { live: bool(), room_size: int() },
  onair_prickle_clicked: { room_size: int() },
  onair_member_clicked: { room_size: int() },

  /** A help article (help/<slug>.md) was opened. `slug` is the file name, chosen by us, never typed by a member. */
  help_article_viewed: { slug: text(60) },
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
