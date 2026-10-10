"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FEATURE_PREVIEWS, type FeatureKey } from "@/lib/features";

/** Admin-only: switch feature previews on or off for the signed-in admin. */
export function PreviewsPanel({ enabledFeatures }: { enabledFeatures: FeatureKey[] }) {
  const router = useRouter();
  const [localEnabled, setLocalEnabled] = useState<Set<FeatureKey>>(new Set(enabledFeatures));
  const [loading, setLoading] = useState<FeatureKey | null>(null);

  async function toggleFeature(key: FeatureKey, enabled: boolean) {
    setLoading(key);
    const next = new Set(localEnabled);
    if (enabled) next.add(key);
    else next.delete(key);
    setLocalEnabled(next);

    await fetch("/api/feature-previews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature: key, enabled }),
    });

    setLoading(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">Feature Previews</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Try features that are still in development. These only change what you see.
        </p>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg">
        {FEATURE_PREVIEWS.map((feature) => {
          const isEnabled = localEnabled.has(feature.key);
          return (
            <li key={feature.key} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{feature.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{feature.description}</p>
              </div>
              <button
                role="switch"
                aria-checked={isEnabled}
                aria-label={feature.name}
                disabled={loading === feature.key}
                onClick={() => toggleFeature(feature.key, !isEnabled)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-plum-500 focus:ring-offset-2 ${
                  isEnabled ? "bg-plum-600" : "bg-slate-300 dark:bg-slate-600"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    isEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
