import type { ReactNode } from "react";
import AnnouncementBar from "@/components/announcements/AnnouncementBar";

/**
 * A notice for the page being viewed, in the same strip as the notification banners under the
 * header (plum, full width). For a state of the page ("you're previewing"), not an event: it isn't a
 * notification and isn't stored. Put it first in a page, outside the page's own padded container.
 */
export default function PageBanner({ children }: { children: ReactNode }) {
  return <AnnouncementBar tone="notice">{children}</AnnouncementBar>;
}
