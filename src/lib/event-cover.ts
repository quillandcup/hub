import { mediaSrc } from "@/lib/media/url";
import type { PresetName } from "@/lib/media/presets";

/**
 * The picture for an event: the image picked from the media library if there is one, else the first
 * photo imported from Google Photos, else null (the card then shows the art for its kind).
 */
export function eventCoverUrl(
  event: { id: string; image_id?: string | null; cover_photo_id?: string | null },
  preset: PresetName = "event_card"
): string | null {
  if (event.image_id) return mediaSrc(event.image_id, preset);
  if (event.cover_photo_id) return `/api/events/${event.id}/photos/${event.cover_photo_id}`;
  return null;
}
