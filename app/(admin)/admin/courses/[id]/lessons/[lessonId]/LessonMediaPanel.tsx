"use client";

import { useState } from "react";
import LessonPlayer, { type PlaybackTokens } from "@/components/courses/LessonPlayer";
import VideoActions from "./VideoActions";

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
}: {
  title: string;
  playbackId: string;
  tokens: PlaybackTokens;
  posterUrl: string | null;
  statsHref: string | null;
  lessonUrl: string | null;
  thumbnailLink: { url: string; imageUrl: string; title: string } | null;
  thumbnailLinkBlocked: string;
}) {
  const [seconds, setSeconds] = useState(0);
  return (
    <div>
      {/* No watch tracking: this is an admin looking at the lesson, not a viewing. */}
      <LessonPlayer title={title} playbackId={playbackId} tokens={tokens} posterUrl={posterUrl} onTime={setSeconds} />
      <div className="mt-3">
        <VideoActions statsHref={statsHref} lessonUrl={lessonUrl} seconds={seconds} thumbnailLink={thumbnailLink} thumbnailLinkBlocked={thumbnailLinkBlocked} />
      </div>
    </div>
  );
}
