"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Loading"
      className="ml-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-plum-600 align-[-2px] dark:border-slate-600 dark:border-t-plum-300"
    />
  );
}

/** A Link that shows a small spinner after its label while the navigation is in flight (the results page is rendered on the server and can take a few seconds). */
export default function PendingLink({ children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <Pending />
    </Link>
  );
}
