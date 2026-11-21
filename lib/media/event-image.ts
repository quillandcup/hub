import type { MediaRepository } from "@/lib/data/media";
import { isId } from "@/lib/ids";

/**
 * The error to answer with when an event is given this `image_id`, or null when it's fine: `undefined` (not
 * mentioned) and `null` (no image) always are; anything else must be the id of a live asset in the library.
 */
export async function eventImageError(media: MediaRepository, imageId: unknown): Promise<string | null> {
  if (imageId === undefined || imageId === null) return null;
  if (!isId(imageId as string, "media")) return "image_id must be a media library id, or null";
  const asset = await media.byId(imageId as string).catch(() => null);
  return !asset || asset.deleted_at ? "That image isn't in the media library" : null;
}

/**
 * A signed-out visitor is served only assets marked public (docs/product/MEDIA_LIBRARY.md), and the public Coming up list shows an event's
 * cover only when it is (docs/product/LANDING_PAGES.md). So when an admin saves an event that is announced publicly and has a cover, the cover
 * is marked public, the way publishing a landing page marks its pictures. It is never turned back (the picture may be used elsewhere).
 * A failure here never fails the save: the list simply shows no picture until the image is marked public in the media library.
 */
export async function publishEventCover(media: MediaRepository, event: { announced_publicly?: boolean | null; image_id?: string | null } | null): Promise<boolean> {
  if (!event?.announced_publicly || !event.image_id) return false;
  try {
    const asset = await media.byId(event.image_id);
    if (!asset || asset.deleted_at) return false;
    if (!asset.is_public) await media.edit(asset.id, { is_public: true });
    return true;
  } catch (error) {
    console.error("event_cover_publish_failed", error instanceof Error ? error.name : "error");
    return false;
  }
}
