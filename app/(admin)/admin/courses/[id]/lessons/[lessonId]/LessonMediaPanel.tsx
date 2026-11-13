"use client";

import { useState } from "react";
import LessonPlayer, { type PlaybackTokens } from "@/components/courses/LessonPlayer";
import VideoActions from "./VideoActions";
import LessonVideoControls from "./LessonVideoControls";
import type { CaptionTrack } from "./LessonCaptions";

/** The lesson's video with its Video actions menu, which needs to know where the player is. */
export default function LessonMediaPanel({
  title,
  playbackId,
  tokens,
  posterUrl,
  lessonId,
  statsHref,
  lessonUrl,
  thumbnailLink,
  thumbnailLinkBlocked,
  chatShare = false,
  frameThumbnail = null,
  captions = [],
}: {
  title: string;
  playbackId: string;
  tokens: PlaybackTokens;
  posterUrl: string | null;
  /** The Hub lesson: lets a tab left open past the links' hour fetch fresh ones. Absent when the lesson isn't in the Hub yet. */
  lessonId?: string | null;
  statsHref: string | null;
  lessonUrl: string | null;
  thumbnailLink: { url: string; imageUrl: string; title: string } | null;
  thumbnailLinkBlocked: string;
  /** Offer the "open to everyone" link in the Video actions menu. */
  chatShare?: boolean;
  /** For a Hub-owned lesson: the course and lesson the current frame can become the thumbnail of. */
  frameThumbnail?: { courseId: string; lessonId: string } | null;
  /** The video's caption tracks (a Hub-owned lesson, where the actions menu manages them). */
  captions?: CaptionTrack[];
}) {
  const [seconds, setSeconds] = useState(0);
  return (
    <div>
      {/* No watch tracking: this is an admin looking at the lesson, not a viewing. */}
      <LessonPlayer title={title} playbackId={playbackId} tokens={tokens} posterUrl={posterUrl} lessonId={lessonId ?? undefined} onTime={setSeconds} />
      <div className="mt-3">
        {frameThumbnail ? (
          <LessonVideoControls
            courseId={frameThumbnail.courseId}
            lessonId={frameThumbnail.lessonId}
            status="ready"
            captions={captions}
            seconds={seconds}
            frameThumbnail
            actions={{ statsHref, lessonUrl, thumbnailLink, thumbnailLinkBlocked, chatShare }}
          />
        ) : (
          <VideoActions statsHref={statsHref} lessonUrl={lessonUrl} seconds={seconds} thumbnailLink={thumbnailLink} thumbnailLinkBlocked={thumbnailLinkBlocked} chatShare={chatShare} />
        )}
      </div>
    </div>
  );
}
