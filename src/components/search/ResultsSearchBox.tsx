"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import SearchSpinner from "@/components/search/SearchSpinner";

/**
 * The results page's own search box. Submitting navigates in a transition so the page can say
 * "Searching…" while the server renders the new results (the page stays in place until then, so
 * the route's loading.tsx never shows for a new query on the same page).
 */
export default function ResultsSearchBox({ basePath, initial, placeholder, maxLength }: { basePath: string; initial: string; placeholder: string; maxLength: number }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={basePath}
      method="get"
      className="mb-4"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        startTransition(() => router.push(q ? `${basePath}?q=${encodeURIComponent(q)}` : basePath));
      }}
    >
      <input
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        aria-label="Search"
        maxLength={maxLength}
      />
      {pending && <SearchSpinner className="mt-2" />}
    </form>
  );
}
