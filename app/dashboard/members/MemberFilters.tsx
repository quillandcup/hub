"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function MemberFilters({ currentFilter }: { currentFilter: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const filters = [
    { value: "all", label: "All Members" },
    { value: "active", label: "Active Only" },
    { value: "at_risk", label: "At Risk" },
    { value: "highly_engaged", label: "Highly Engaged" },
    { value: "on_hiatus", label: "On Hiatus" },
  ];

  const handleFilterChange = (filter: string) => {
    const params = new URLSearchParams(searchParams);
    if (filter === "all") {
      params.delete("filter");
    } else {
      params.set("filter", filter);
    }
    router.push(`/dashboard/members?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap gap-2">
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
          {filter.label}
        </button>
      ))}
    </div>
  );
}
