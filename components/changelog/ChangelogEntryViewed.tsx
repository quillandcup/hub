"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

/** Records that an entry was opened, so we can see which updates members read. Renders nothing. */
export default function ChangelogEntryViewed({ slug }: { slug: string }) {
  useEffect(() => {
    track("changelog_entry_viewed", { slug });
  }, [slug]);
  return null;
}
