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
