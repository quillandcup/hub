"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FEATURE_PREVIEWS, type FeatureKey } from "@/lib/features";

interface FeaturePreviewsModalProps {
  isOpen: boolean;
  onClose: () => void;
  enabledFeatures: FeatureKey[];
}

function EyeIcon({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
    </svg>
  );
}

export default function FeaturePreviewsModal({
  isOpen,
  onClose,
  enabledFeatures,
}: FeaturePreviewsModalProps) {
  const router = useRouter();
  const [localEnabled, setLocalEnabled] = useState<Set<FeatureKey>>(
    new Set(enabledFeatures)
  );
  const [loading, setLoading] = useState<FeatureKey | null>(null);
  const [selected, setSelected] = useState<FeatureKey>(FEATURE_PREVIEWS[0].key);

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

  if (!isOpen) return null;

  const selectedFeature = FEATURE_PREVIEWS.find((f) => f.key === selected)!;
  const isSelectedEnabled = localEnabled.has(selected);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Feature Previews
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex">
          {/* Left: feature list */}
          <div className="w-48 border-r border-slate-200 dark:border-slate-800">
            {FEATURE_PREVIEWS.map((feature) => {
              const isEnabled = localEnabled.has(feature.key);
              const isActive = selected === feature.key;
              return (
                <button
                  key={feature.key}
                  onClick={() => setSelected(feature.key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors ${
                    isActive
                      ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium border-l-2 border-blue-600"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 border-l-2 border-transparent"
                  }`}
                >
                  <span
                    className={
                      isEnabled
                        ? "text-green-600 dark:text-green-400"
                        : "text-slate-400 dark:text-slate-500"
                    }
                  >
                    <EyeIcon enabled={isEnabled} />
                  </span>
                  <span className="truncate">{feature.name}</span>
                </button>
              );
            })}
          </div>

          {/* Right: selected feature detail */}
          <div className="flex-1 px-6 py-5">
            <div className="flex items-center justify-between gap-4">
              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {selectedFeature.name}
              </h4>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm text-slate-500 dark:text-slate-400 w-6 text-right">
                  {isSelectedEnabled ? "On" : "Off"}
                </span>
                <button
                  role="switch"
                  aria-checked={isSelectedEnabled}
                  disabled={loading === selected}
                  onClick={() => toggleFeature(selected, !isSelectedEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    isSelectedEnabled
                      ? "bg-blue-600"
                      : "bg-slate-300 dark:bg-slate-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      isSelectedEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
