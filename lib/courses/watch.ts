import { isId, isUuid } from "@/lib/ids";

/** One continuous stretch of a video a member watched, as the player reports it. */
export interface WatchSegmentInput {
  /** Made by the player when the stretch closes; a resent save carries the same id, so it is stored once. */
  id: string;
  start: number;
  end: number;
  rate: number;
  /** The captions language label, or null when captions were off. */
  captions: string | null;
  /** Was the tab on screen (separates watching from playing in the background). */
  visible: boolean;
}

export interface WatchBatch {
  lessonId: string;
  sessionId: string;
  segments: WatchSegmentInput[];
  /** Where the playhead was, for resume. Omitted when the player has nothing to say. */
  position: number | null;
  /** The player appeared for this session: records the "viewed" marker (once; a resend is ignored). */
  viewed: boolean;
}

export const MAX_SEGMENTS_PER_BATCH = 50;
const MAX_SECONDS = 60 * 60 * 24;
const MAX_RATE = 16;
const MAX_CAPTIONS_LABEL = 40;

/** A resume position closer than this to the start isn't worth resuming. */
export const RESUME_MIN_SECONDS = 10;
/** Past this fraction of the video the lesson counts as finished, so the next visit starts over. */
export const RESUME_MAX_FRACTION = 0.95;

const seconds = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_SECONDS;

function parseSegment(raw: unknown): WatchSegmentInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== "string" || !isUuid(s.id)) return null;
  if (!seconds(s.start) || !seconds(s.end) || s.end < s.start) return null;
  if (typeof s.rate !== "number" || !Number.isFinite(s.rate) || s.rate <= 0 || s.rate > MAX_RATE) return null;
  if (s.captions !== null && (typeof s.captions !== "string" || s.captions.length > MAX_CAPTIONS_LABEL)) return null;
  if (typeof s.visible !== "boolean") return null;
  return { id: s.id, start: s.start, end: s.end, rate: s.rate, captions: s.captions, visible: s.visible };
}

/** Checks a request body from the player; null when any part is malformed (nothing is partly accepted). */
export function parseWatchBatch(body: unknown): WatchBatch | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.lessonId !== "string" || !isId(b.lessonId, "les")) return null;
  if (typeof b.sessionId !== "string" || !isUuid(b.sessionId)) return null;
  if (!Array.isArray(b.segments) || b.segments.length > MAX_SEGMENTS_PER_BATCH) return null;
  const segments: WatchSegmentInput[] = [];
  for (const raw of b.segments) {
    const segment = parseSegment(raw);
    if (!segment) return null;
    segments.push(segment);
  }
  const position = b.position === undefined || b.position === null ? null : b.position;
  if (position !== null && !seconds(position)) return null;
  if (b.viewed !== undefined && typeof b.viewed !== "boolean") return null;
  return { lessonId: b.lessonId, sessionId: b.sessionId, segments, position, viewed: b.viewed === true };
}

/**
 * Where to start playing: the saved position, unless it is barely into the video or the member
 * watched it through (then they probably want it from the top). The duration isn't known on the
 * server, so the near-the-end rule runs in the player; this one only drops a trivial position.
 */
export function resumeSeconds(saved: number | null | undefined): number {
  return saved != null && saved >= RESUME_MIN_SECONDS ? saved : 0;
}

/** The longest start time a link may ask for (a day); anything longer is not a timestamp. */
const MAX_LINK_SECONDS = 24 * 60 * 60;

/**
 * Where a lesson opens: the second a shared link asks for (`?t=95`, from "Copy timestamp URL" in the
 * course builder) over the member's own saved position, which stays the default. Only a whole number
 * counts; a missing, negative, fractional or absurd value is ignored.
 */
export function startSeconds(linkParam: string | undefined, resume: number): number {
  if (linkParam === undefined || !/^\d{1,5}$/.test(linkParam)) return resume;
  const seconds = Number(linkParam);
  return seconds > 0 && seconds <= MAX_LINK_SECONDS ? seconds : resume;
}
