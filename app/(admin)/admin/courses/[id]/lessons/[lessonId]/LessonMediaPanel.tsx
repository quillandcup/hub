"use client";

import { useState } from "react";
import LessonPlayer, { type PlaybackTokens } from "@/components/courses/LessonPlayer";
import VideoActions from "./VideoActions";
import FrameThumbnailButton from "./FrameThumbnailButton";

/** The lesson's video with its Video actions menu, which needs to know where the player is. */
export default function LessonMediaPanel({
  title,
  playbackId,
  tokens,
  posterUrl,
  statsHref,
  lessonUrl,
  thumbnailLink,
  thumbnailLinkBlocked,
  frameThumbnail = null,
}: {
  title: string;
  playbackId: string;
  tokens: PlaybackTokens;
  posterUrl: string | null;
  statsHref: string | null;
  lessonUrl: string | null;
  thumbnailLink: { url: string; imageUrl: string; title: string } | null;
  thumbnailLinkBlocked: string;
  /** For a Hub-owned lesson: the course and lesson the current frame can become the thumbnail of. */
  frameThumbnail?: { courseId: string; lessonId: string } | null;
}) {
  const [seconds, setSeconds] = useState(0);
  return (
    <div>
      {/* No watch tracking: this is an admin looking at the lesson, not a viewing. */}
      <LessonPlayer title={title} playbackId={playbackId} tokens={tokens} posterUrl={posterUrl} onTime={setSeconds} />
      <div className="mt-3">
        <VideoActions statsHref={statsHref} lessonUrl={lessonUrl} seconds={seconds} thumbnailLink={thumbnailLink} thumbnailLinkBlocked={thumbnailLinkBlocked} />
      </div>
      {frameThumbnail && <FrameThumbnailButton courseId={frameThumbnail.courseId} lessonId={frameThumbnail.lessonId} seconds={seconds} />}
    </div>
  );
}
