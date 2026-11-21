"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MediaPicker from "@/components/media/MediaPicker";
import { setLessonThumbnail } from "../../../outline-actions";

/**
 * The thumbnail of a Hub-owned lesson: an image from the media library, chosen or uploaded right there (the one
 * image control the Hub uses elsewhere). It is shown whole, as it is, so there is no crop to adjust. A lesson that came
 * from Kajabi may still show Kajabi's own picture until another is chosen (`currentSrc`).
 */
export default function LessonThumbnailField({ courseId, lessonId, assetId, currentSrc }: { courseId: string; lessonId: string; assetId: string | null; currentSrc: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(assetId);
  // The page is refreshed after a choice, and then says what the lesson has: follow it.
  useEffect(() => setValue(assetId), [assetId]);
  return (
    <div>
      {!value && currentSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentSrc} alt="" className="mb-2 w-full rounded border border-slate-200 dark:border-slate-700" />
      )}
      <MediaPicker
        value={value}
        surface="lesson_thumbnail"
        noun="thumbnail"
        alt="The lesson's thumbnail"
        adjustable={false}
        onChange={async (id) => {
          try {
            const result = await setLessonThumbnail(courseId, lessonId, id);
            if (result.error) return result.error;
          } catch {
            return "Something went wrong. Refresh the page and try again.";
          }
          setValue(id);
          router.refresh();
        }}
      />
    </div>
  );
}
