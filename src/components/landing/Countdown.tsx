"use client";

import { useEffect, useState } from "react";
import { describeTarget, timeLeft, type TimeLeft } from "@/lib/landing/countdown";

export type CountdownProps = {
  targetAt: string;
  heading?: string;
  /** What happens at zero: take the block away, show `expiredMessage`, or keep showing zeros. */
  whenExpired: "hide" | "message" | "zeros";
  expiredMessage?: string;
};

const UNITS: { key: keyof Omit<TimeLeft, "expired">; label: string }[] = [
  { key: "days", label: "days" },
  { key: "hours", label: "hours" },
  { key: "minutes", label: "minutes" },
  { key: "seconds", label: "seconds" },
];

/**
 * Counts down to an instant. The cells have a fixed size and show dashes until the browser has the time, so nothing
 * shifts when it starts (the server can't know the visitor's clock). The whole block is one labelled `timer` that
 * is not announced every second; a screen reader gets the target time in words.
 */
export default function Countdown({ targetAt, heading, whenExpired, expiredMessage }: CountdownProps) {
  const [left, setLeft] = useState<TimeLeft | null>(null);

  useEffect(() => {
    const tick = () => setLeft(timeLeft(targetAt, Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [targetAt]);

  const when = describeTarget(targetAt);
  if (!when) return null;
  if (left?.expired && whenExpired === "hide") return null;
  if (left?.expired && whenExpired === "message") {
    return (
      <p role="status" className="py-4 text-center text-lg font-medium">
        {expiredMessage || "This has started."}
      </p>
    );
  }

  return (
    <div role="timer" aria-live="off" aria-label={`${heading ? `${heading}: ` : ""}counting down to ${when}`} className="py-4 text-center">
      {heading && <p className="mb-3 font-display text-xl">{heading}</p>}
      <div className="flex justify-center gap-3">
        {UNITS.map(({ key, label }) => (
          <div key={key} className="w-16 rounded-lg border border-current px-1 py-2">
            <span className="block text-2xl font-semibold tabular-nums" aria-hidden="true">
              {left ? String(left[key]).padStart(2, "0") : "--"}
            </span>
            <span className="block text-xs uppercase tracking-wide opacity-80">{label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm opacity-80">{when}</p>
    </div>
  );
}
