"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type FilterCounts = {
  all: number;
  active: number;
  at_risk: number;
  highly_engaged: number;
  on_hiatus: number;
  lead: number;
  cancelled: number;
  unregistered: number;
};

export default function MemberFilters({
  currentFilter,
  counts,
}: {
  currentFilter: string;
  counts: FilterCounts;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filters: { value: keyof FilterCounts; label: string }[] = [
    { value: "all", label: "All Members" },
    { value: "active", label: "Active Only" },
    { value: "at_risk", label: "At Risk" },
    { value: "highly_engaged", label: "Highly Engaged" },
    { value: "on_hiatus", label: "On Hiatus" },
    { value: "lead", label: "Leads" },
    { value: "cancelled", label: "Cancelled" },
    { value: "unregistered", label: "Active, Unregistered" },
  ];

  const handleFilterChange = (filter: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("filter", filter);
    router.push(`/admin/members?${params.toString()}`);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("search", value);
      } else {
        params.delete("search");
      }
      router.push(`/admin/members?${params.toString()}`);
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <button
          key={filter.value}
          onClick={() => handleFilterChange(filter.value)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            currentFilter === filter.value
              ? "bg-blue-600 text-white"
              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
          }`}
        >
          {filter.label} <span className="opacity-70">({counts[filter.value]})</span>
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500">
        <span className="text-sm leading-none select-none">🔍</span>
        <input
          type="search"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by name or email..."
          className="text-sm bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none w-56"
        />
      </div>
    </div>
  );
}
