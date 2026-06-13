"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FEATURE_PREVIEWS, type FeatureKey } from "@/lib/features";

interface FeaturePreviewsSectionProps {
  collapsed: boolean;
  enabledFeatures: FeatureKey[];
  availableFeatures: FeatureKey[];
}

export function FeaturePreviewsSection({
  collapsed,
  enabledFeatures,
  availableFeatures,
}: FeaturePreviewsSectionProps) {
  const router = useRouter();
  const [localEnabled, setLocalEnabled] = useState<Set<FeatureKey>>(
    new Set(enabledFeatures)
  );
  const [loading, setLoading] = useState<FeatureKey | null>(null);

  const features = FEATURE_PREVIEWS.filter((f) =>
    availableFeatures.includes(f.key)
  );

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

  if (collapsed) {
    return (
      <div
        className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex-shrink-0 flex justify-center"
        title="Feature Previews"
      >
        <span className="text-lg">🧪</span>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-3">
        Feature Previews
      </h3>
      <div className="space-y-1">
        {features.map((feature) => {
          const isEnabled = localEnabled.has(feature.key);
          const isLoading = loading === feature.key;
          return (
            <button
              key={feature.key}
              onClick={() => toggleFeature(feature.key, !isEnabled)}
              disabled={isLoading}
              title={feature.description}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <span className="text-sm w-4 text-center flex-shrink-0">
                {isEnabled ? "✓" : "○"}
              </span>
              <span className="text-sm">{feature.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
