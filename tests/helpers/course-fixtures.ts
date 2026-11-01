import type { Row } from "@/lib/data/db";

/**
 * Rows of the course tables as tests and seed profiles write them: the columns a test cares about,
 * every other column defaulted (the database's defaults), so a fixture reads as the scenario.
 */
const STAMP = "2097-01-01T00:00:00.000Z";

export const courseRow = (over: Partial<Row<"courses">> & Pick<Row<"courses">, "id" | "slug" | "title">): Row<"courses"> => ({
  access_duration: null,
  created_at: STAMP,
  description: null,
  hero_asset_id: null,
  hero_source: null,
  hero_url: null,
  is_draft: false,
  kind: "evergreen",
  launch_at: null,
  program_id: null,
  // What the database's trigger makes of the draft flag, so a seeded course means the same in both implementations.
  publishing_option: over.is_draft ? "draft" : "published",
  source: "hub",
  source_key: null,
  thumbnail_asset_id: null,
  thumbnail_source: null,
  thumbnail_url: null,
  updated_at: STAMP,
  ...over,
});

export const moduleRow = (over: Partial<Row<"course_modules">> & Pick<Row<"course_modules">, "id" | "course_id" | "title">): Row<"course_modules"> => ({
  created_at: STAMP,
  parent_id: null,
  position: 1,
  poster_asset_id: null,
  poster_source: null,
  poster_url: null,
  // Its own setting, as the state it is given implies (a hidden one is a draft), so a seeded row means the same in both implementations.
  publishing_option: over.state === "hidden" ? "draft" : over.state === "coming_soon" ? "locked" : "published",
  source: "hub",
  source_key: null,
  state: "open",
  updated_at: STAMP,
  ...over,
});

export const lessonRow = (over: Partial<Row<"course_lessons">> & Pick<Row<"course_lessons">, "id" | "course_id" | "title">): Row<"course_lessons"> => ({
  body_html: null,
  created_at: STAMP,
  duration_seconds: null,
  excerpt: null,
  module_id: null,
  position: 1,
  // Its own setting, as the state it is given implies (as for a module).
  publishing_option: over.state === "hidden" ? "draft" : over.state === "coming_soon" ? "locked" : "published",
  source: "hub",
  source_key: null,
  state: "open",
  thumbnail_asset_id: null,
  thumbnail_source: null,
  thumbnail_url: null,
  updated_at: STAMP,
  video_id: null,
  ...over,
});

export const fileRow = (over: Partial<Row<"course_lesson_files">> & Pick<Row<"course_lesson_files">, "id" | "lesson_id" | "filename">): Row<"course_lesson_files"> => ({
  content_hash: null,
  content_type: "application/pdf",
  created_at: STAMP,
  position: 0,
  size_bytes: 1024,
  source_key: `src-${over.id}`,
  storage_path: `course/${over.lesson_id}/${over.id}.pdf`,
  ...over,
});

export const videoRow = (over: Partial<Row<"videos">> & Pick<Row<"videos">, "id">): Row<"videos"> => ({
  created_at: STAMP,
  duration_seconds: null,
  has_burned_in_captions: false,
  mux_asset_id: null,
  mux_playback_id: null,
  quality: "plus",
  source_fingerprint: null,
  source_key: `media-${over.id}`,
  source_kind: "kajabi",
  source_sha256: null,
  status: "preparing",
  updated_at: STAMP,
  ...over,
});

export const progressRow = (over: Partial<Row<"lesson_progress">> & Pick<Row<"lesson_progress">, "member_id" | "lesson_id">): Row<"lesson_progress"> => ({
  completed_at: null,
  created_at: STAMP,
  imported_from: null,
  last_position_seconds: 0,
  updated_at: STAMP,
  ...over,
});

export const accessRow = (over: Partial<Row<"course_access">> & Pick<Row<"course_access">, "member_id" | "course_id">): Row<"course_access"> => ({
  ends_at: null,
  origin: "purchase",
  starts_at: "2090-01-01T00:00:00.000Z",
  ...over,
});

export const grantRow = (over: Partial<Row<"course_access_grants">> & Pick<Row<"course_access_grants">, "id" | "member_id" | "course_id">): Row<"course_access_grants"> => ({
  created_at: STAMP,
  created_by: null,
  ends_at: null,
  reason: null,
  starts_at: "2090-01-01T00:00:00.000Z",
  ...over,
});

export const segmentRow = (over: Partial<Row<"video_watch_segments">> & Pick<Row<"video_watch_segments">, "id" | "member_id" | "video_id">): Row<"video_watch_segments"> => ({
  captions_language: null,
  client_segment_id: null,
  device: null,
  end_seconds: 10,
  kind: "watched",
  playback_rate: 1,
  session_id: "session-1",
  start_seconds: 0,
  started_at: STAMP,
  user_agent: null,
  visible: true,
  ...over,
});
