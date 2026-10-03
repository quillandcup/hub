"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { isOnStepPage, type OnboardingState, type OnboardingStepView } from "@/lib/onboarding";
import {
  completeOnboarding,
  dismissOnboarding,
  getMyOnboardingState,
  markOnboardingStep,
} from "@/app/actions/onboarding";
import OnboardingSpotlight from "./OnboardingSpotlight";

/** How often to re-check progress while on a step's page, so finishing it (saving a bio, adding
 * a goal) moves the tour on without a page change. */
const SPOTLIGHT_POLL_MS = 10_000;

/** Below Tailwind's `md`, where the sidebar becomes a drawer. */
const SMALL_SCREEN_QUERY = "(max-width: 767px)";
const subscribeSmallScreen = (onChange: () => void) => {
  const query = window.matchMedia?.(SMALL_SCREEN_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};
const isSmallScreenNow = () => window.matchMedia?.(SMALL_SCREEN_QUERY).matches ?? false;

/**
 * The "Getting started" tour: a checklist card in the corner of every member page, and on the
 * page of the current step, a spotlight on the control to use there. See lib/onboarding.ts.
 * Rendered by the member layout behind the `onboarding` flag, never during sudo.
 */
export default function OnboardingGuide({ initialState }: { initialState: OnboardingState }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  const [state, setState] = useState(initialState);
  // The member's own open/closed choice for the checklist on this page; null = the default.
  const [expandedChoice, setExpandedChoice] = useState<{ page: string; expanded: boolean } | null>(null);
  const isSmallScreen = useSyncExternalStore(subscribeSmallScreen, isSmallScreenNow, () => false);
  // Spotlight closed with "Hide" for this page; shows again on the next visit.
  const [hiddenOn, setHiddenOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // A restart from the user menu re-renders the layout with a new initial state.
  const [prevInitial, setPrevInitial] = useState(initialState);
  if (initialState !== prevInitial) {
    setPrevInitial(initialState);
    setState(initialState);
  }

  const refresh = useCallback(async () => {
    const next = await getMyOnboardingState();
    if (next) setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getMyOnboardingState().then((next) => {
      if (next && !cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, search]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const current: OnboardingStepView | null = state.steps.find((s) => s.id === state.currentStepId) ?? null;
  const pageKey = `${pathname}?${search}`;
  const onStepPage = !!current && isOnStepPage(current, pathname, search);
  const showSpotlight = onStepPage && hiddenOn !== pageKey;
  // Folded to its header while a spotlight is up (the callout carries the step) and on phones,
  // where the open list covers half the screen. Opening or closing it holds until the next page.
  const expanded =
    expandedChoice?.page === pageKey ? expandedChoice.expanded : !showSpotlight && !isSmallScreen;
  const toggleExpanded = () => setExpandedChoice({ page: pageKey, expanded: !expanded });

  // Keep checking while on the step's page, spotlight or not (it hides once the control is used).
  useEffect(() => {
    if (!onStepPage) return;
    const id = window.setInterval(() => void refresh(), SPOTLIGHT_POLL_MS);
    return () => window.clearInterval(id);
  }, [onStepPage, refresh]);

  const hideSpotlight = useCallback(() => setHiddenOn(pageKey), [pageKey]);

  const run = (action: () => Promise<{ success: true } | { error: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) setError(result.error);
      else await refresh();
    });
  };

  if (!state.active) return null;

  const doneCount = state.steps.filter((s) => s.done).length;
  const total = state.steps.length;

  return (
    <>
      {showSpotlight && current && (
        <OnboardingSpotlight
          step={current}
          stepNumber={state.steps.indexOf(current) + 1}
          totalSteps={total}
          pending={isPending}
          onConfirm={current.confirmLabel ? () => run(() => markOnboardingStep(current.markKey)) : undefined}
          onSkip={() => run(() => markOnboardingStep(current.markKey))}
          onHide={hideSpotlight}
        />
      )}

      <section
        aria-label="Getting started"
        className="fixed bottom-20 right-5 z-40 w-[min(20rem,calc(100vw-2.5rem))] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
      >
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <span aria-hidden="true">🦔</span>
            Getting started
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {doneCount} of {total} done {expanded ? "▾" : "▴"}
          </span>
        </button>

        <div className="h-1 bg-slate-100 dark:bg-slate-800" aria-hidden="true">
          <div className="h-1 bg-plum-600 transition-all" style={{ width: `${(doneCount / total) * 100}%` }} />
        </div>

        {expanded && (
          <div className="px-4 py-3 space-y-3">
            {state.completed ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  You&apos;re all set! You can find the tour again in your menu at the top right.
                </p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(completeOnboarding)}
                  className="w-full px-3 py-2 bg-plum-600 hover:bg-plum-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium"
                >
                  Finish
                </button>
              </div>
            ) : (
              <ol className="space-y-2">
                {state.steps.map((step) => {
                  const isCurrent = step.id === state.currentStepId;
                  return (
                    <li key={step.id} className="flex gap-2">
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                          step.done
                            ? "bg-plum-600 text-white"
                            : isCurrent
                              ? "border-2 border-plum-600"
                              : "border border-slate-300 dark:border-slate-600"
                        }`}
                      >
                        {step.done ? "✓" : ""}
                      </span>
                      <div className="min-w-0">
                        <p
                          className={`text-sm ${
                            step.done
                              ? "text-slate-400 dark:text-slate-500 line-through"
                              : "font-medium text-slate-900 dark:text-slate-100"
                          }`}
                        >
                          {step.title}
                          <span className="sr-only">{step.done ? " (done)" : ""}</span>
                        </p>
                        {isCurrent && (
                          <>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{step.summary}</p>
                            {!isOnStepPage(step, pathname, search) || hiddenOn === pageKey ? (
                              <Link
                                href={step.href}
                                onClick={() => setHiddenOn(null)}
                                className="inline-block mt-2 px-3 py-1.5 bg-plum-600 hover:bg-plum-700 text-white rounded-md text-xs font-medium"
                              >
                                Show me →
                              </Link>
                            ) : null}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {error && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            {!state.completed && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(dismissOnboarding)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
              >
                Close the tour
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
