"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/lib/analytics/client";
import type { SearchSurface } from "@/lib/analytics/search";

/**
 * A link to a search result on a server-rendered results page. Opening it is recorded as
 * `search_result_clicked` with what the result is and where it was in the list (the palette records
 * the same event itself). Takes only plain values, so a server page can render it.
 */
export default function SearchHitLink({
  surface,
  kind,
  rank,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { surface: SearchSurface; kind: string; rank: number }) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        track("search_result_clicked", { surface, kind, rank, via: "click" });
        onClick?.(e);
      }}
    />
  );
}
