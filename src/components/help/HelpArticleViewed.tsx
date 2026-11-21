"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/client";

/** Records that an article was opened, so the help can be improved where members actually go. Renders nothing. */
export default function HelpArticleViewed({ slug }: { slug: string }) {
  useEffect(() => {
    track("help_article_viewed", { slug });
  }, [slug]);
  return null;
}
