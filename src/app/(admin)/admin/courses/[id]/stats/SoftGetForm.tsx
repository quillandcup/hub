"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A GET form that stays in the page: Apply replaces the URL through the router instead of loading a
 * new document, which would close the stats modal. Without a script it is the plain form.
 */
export default function SoftGetForm({ action, className, children }: { action: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <form
      method="get"
      action={action}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const params = new URLSearchParams(Array.from(new FormData(e.currentTarget), ([key, value]) => [key, String(value)]));
        router.replace(`${action}?${params}`);
      }}
    >
      {children}
    </form>
  );
}
