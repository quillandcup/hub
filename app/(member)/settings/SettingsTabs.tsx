"use client";

import { useState, type ReactNode } from "react";

type TabId = "account" | "identity" | "preferences" | "hosting";

export function SettingsTabs({
  accountContent,
  identityContent,
  preferencesContent,
  hostingContent,
}: {
  accountContent: ReactNode;
  identityContent: ReactNode;
  preferencesContent: ReactNode;
  hostingContent: ReactNode | null;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("account");

  const tabs: { id: TabId; label: string }[] = [
    { id: "account", label: "Account" },
    { id: "identity", label: "Identity" },
    { id: "preferences", label: "Preferences" },
    ...(hostingContent ? [{ id: "hosting" as const, label: "Hosting" }] : []),
  ];

  return (
    <div>
      <div className="border-b border-slate-200 dark:border-slate-800 mb-6">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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

      {activeTab === "account" && accountContent}
      {activeTab === "identity" && identityContent}
      {activeTab === "preferences" && preferencesContent}
      {activeTab === "hosting" && hostingContent}
    </div>
  );
}
