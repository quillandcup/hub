"use client";

import { useState, type ReactNode } from "react";

type TabId = "upcoming" | "history" | "find" | "hosting";

export function MyPricklesTabs({
  initialTab,
  upcomingContent,
  historyContent,
  findContent,
  hostingContent,
}: {
  initialTab: TabId;
  upcomingContent: ReactNode;
  historyContent: ReactNode;
  findContent: ReactNode | null;
  hostingContent: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  const tabs: { id: TabId; label: string }[] = [
    { id: "upcoming", label: "Upcoming" },
    { id: "history", label: "Attendance History" },
    ...(findContent ? [{ id: "find" as const, label: "Find a Prickle" }] : []),
    { id: "hosting", label: "Hosting" },
  ];

  return (
    <div>
      <div className="border-b border-slate-200 dark:border-slate-800 mb-6">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "upcoming" && upcomingContent}
      {activeTab === "history" && historyContent}
      {activeTab === "find" && findContent}
      {activeTab === "hosting" && hostingContent}
    </div>
  );
}
