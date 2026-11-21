"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

/** Records that a member opened a lesson, so the course funnel starts from the page and not only from the player. Renders nothing. */
export default function LessonViewed({ lessonId, hasVideo }: { lessonId: string; hasVideo: boolean }) {
  useEffect(() => {
    track("course_lesson_viewed", { has_video: hasVideo });
  }, [lessonId, hasVideo]);
  return null;
}
