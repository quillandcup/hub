/**
 * Watch statistics for one video, from its watch segments (`video_watch_segments`: one row per
 * continuous stretch a member watched). Pure, so it is tested without a database.
 *
 * Times are media seconds (positions in the video), not wall-clock: a stretch of 60s at 2x took 30
 * real seconds but covers 60s of video.
 */

export interface WatchSegment {
  memberId: string;
  /** The player session (one page view of the lesson) the stretch belongs to: a "play" is a session with at least one stretch. */
  sessionId: string;
  start: number;
  end: number;
  rate: number;
  /** The captions language label, or null when captions were off. */
  captions: string | null;
  /** Was the tab on screen. */
  visible: boolean;
}

/** One slice of the video in the engagement graph. */
export interface HeatBucket {
  /** Seconds into the video where the slice starts and ends. */
  start: number;
  end: number;
  /** How many times this slice was played in all: a viewer who watched it twice counts twice (Wistia's engagement graph). */
  plays: number;
  /** How many different members watched it at least half through. `plays - viewers` is the rewatching. */
  viewers: number;
  /** How many plays (player sessions) watched it at least half through. Over the video's plays, this is the moment's engagement. */
  sessions: number;
}

export interface VideoWatchStats {
  durationSeconds: number;
  /** Members who watched any of it. */
  viewers: number;
  /** Plays: player sessions with at least one stretch. A member who came back on another day counts again. */
  plays: number;
  /** Kajabi's engagement: total watch time / (total plays x video length). Rewatching within a play adds to it. */
  engagementRate: number;
  /** All video time played, rewatches included. */
  watchedSeconds: number;
  /** Video time played counting each stretch of the video once per member. */
  uniqueWatchedSeconds: number;
  /** Mean over viewers of how much of the video they covered (0 to 1). */
  averageWatchedFraction: number;
  /** Viewers who covered at least `WATCHED_MARK` of the video. */
  watchedMarkViewers: number;
  buckets: HeatBucket[];
  /** Video time by playback speed, most-used first. */
  speeds: { rate: number; seconds: number }[];
  /** Share of played time with captions on (0 to 1). */
  captionsShare: number;
  /** Share of played time with the tab out of view (0 to 1): playing in the background. */
  backgroundShare: number;
}

/** A viewer counts as having watched the video once they covered this much of it (Kajabi's "about 90%"). */
export const WATCHED_MARK = 0.9;
export const MAX_BUCKETS = 100;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

type Interval = [number, number];

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

const overlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

/** How many seconds of each slice the (already merged) intervals cover. */
function coverageByBucket(merged: Interval[], span: number, bucketCount: number): number[] {
  const covered = new Array<number>(bucketCount).fill(0);
  for (const [a, b] of merged) {
    const first = Math.min(bucketCount - 1, Math.floor(a / span));
    const last = Math.min(bucketCount - 1, Math.floor((b - 1e-9) / span));
    for (let i = first; i <= last; i++) covered[i] += overlap(a, b, i * span, (i + 1) * span);
  }
  return covered;
}

/**
 * `durationSeconds` is the video's length when known; otherwise the furthest point anyone reached
 * stands in for it. Stretches are clipped to the video, so a position past the end (a stale length)
 * can't make a bucket count more than was there.
 */
export function computeVideoWatchStats(segments: WatchSegment[], durationSeconds: number | null): VideoWatchStats {
  const furthest = segments.reduce((max, s) => Math.max(max, s.end), 0);
  const duration = durationSeconds && durationSeconds > 0 ? durationSeconds : furthest;
  const empty: VideoWatchStats = {
    durationSeconds: duration,
    viewers: 0,
    plays: 0,
    engagementRate: 0,
    watchedSeconds: 0,
    uniqueWatchedSeconds: 0,
    averageWatchedFraction: 0,
    watchedMarkViewers: 0,
    buckets: [],
    speeds: [],
    captionsShare: 0,
    backgroundShare: 0,
  };
  if (duration <= 0) return empty;

  const clipped = segments
    .map((s) => ({ ...s, start: Math.min(s.start, duration), end: Math.min(s.end, duration) }))
    .filter((s) => s.end > s.start);
  if (clipped.length === 0) return empty;

  const bucketCount = Math.max(1, Math.min(MAX_BUCKETS, Math.round(duration)));
  const span = duration / bucketCount;
  const plays = new Array<number>(bucketCount).fill(0);
  const viewersPerBucket = new Array<number>(bucketCount).fill(0);

  const byMember = new Map<string, typeof clipped>();
  for (const s of clipped) {
    const list = byMember.get(s.memberId);
    if (list) list.push(s);
    else byMember.set(s.memberId, [s]);
  }

  let uniqueWatchedSeconds = 0;
  let fractionSum = 0;
  let watchedMarkViewers = 0;
  for (const own of byMember.values()) {
    // Plays: every stretch adds its overlap with each bucket, so rewatching adds again.
    for (const s of own) {
      const first = Math.min(bucketCount - 1, Math.floor(s.start / span));
      const last = Math.min(bucketCount - 1, Math.floor((s.end - 1e-9) / span));
      for (let i = first; i <= last; i++) plays[i] += overlap(s.start, s.end, i * span, (i + 1) * span) / span;
    }
    // Viewers: the member's merged coverage, so a bucket counts once per member however often they watched it.
    const merged = mergeIntervals(own.map((s): Interval => [s.start, s.end]));
    const covered = merged.reduce((sum, [a, b]) => sum + (b - a), 0);
    uniqueWatchedSeconds += covered;
    fractionSum += covered / duration;
    if (covered >= WATCHED_MARK * duration) watchedMarkViewers++;
    // A bucket is "viewed" by the member when their merged coverage fills at least half of it.
    coverageByBucket(merged, span, bucketCount).forEach((c, i) => {
      if (c >= span / 2 - 1e-9) viewersPerBucket[i]++;
    });
  }

  // The same per play (player session): a play watched a slice when it covered at least half of it.
  const bySession = new Map<string, Interval[]>();
  for (const s of clipped) {
    const list = bySession.get(s.sessionId);
    if (list) list.push([s.start, s.end]);
    else bySession.set(s.sessionId, [[s.start, s.end]]);
  }
  const sessionsPerBucket = new Array<number>(bucketCount).fill(0);
  for (const intervals of bySession.values()) {
    coverageByBucket(mergeIntervals(intervals), span, bucketCount).forEach((c, i) => {
      if (c >= span / 2 - 1e-9) sessionsPerBucket[i]++;
    });
  }

  const watchedSeconds = clipped.reduce((sum, s) => sum + (s.end - s.start), 0);
  const bySpeed = new Map<number, number>();
  let captionsSeconds = 0;
  let backgroundSeconds = 0;
  for (const s of clipped) {
    const length = s.end - s.start;
    const rate = round(s.rate, 2);
    bySpeed.set(rate, (bySpeed.get(rate) ?? 0) + length);
    if (s.captions !== null) captionsSeconds += length;
    if (!s.visible) backgroundSeconds += length;
  }

  return {
    durationSeconds: duration,
    viewers: byMember.size,
    plays: bySession.size,
    engagementRate: watchedSeconds / (bySession.size * duration),
    watchedSeconds,
    uniqueWatchedSeconds,
    averageWatchedFraction: fractionSum / byMember.size,
    watchedMarkViewers,
    buckets: plays.map((p, i) => ({ start: i * span, end: (i + 1) * span, plays: round(p, 3), viewers: viewersPerBucket[i], sessions: sessionsPerBucket[i] })),
    speeds: [...bySpeed].map(([rate, seconds]) => ({ rate, seconds })).sort((a, b) => b.seconds - a.seconds),
    captionsShare: captionsSeconds / watchedSeconds,
    backgroundShare: backgroundSeconds / watchedSeconds,
  };
}

/** m:ss, or h:mm:ss from an hour up. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
