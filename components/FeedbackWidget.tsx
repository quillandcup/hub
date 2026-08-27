"use client";

import { useCallback, useState } from "react";

type FeedbackType = "bug" | "data" | "idea";
type ScreenshotStatus = "idle" | "capturing" | "captured" | "failed";
type SubmitStatus = "idle" | "submitting" | "sent" | "error";

const TYPES: { value: FeedbackType; label: string; icon: string }[] = [
  { value: "bug", label: "This is wrong", icon: "🐛" },
  { value: "data", label: "Data issue", icon: "📊" },
  { value: "idea", label: "I have an idea", icon: "💡" },
];

export default function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("bug");
  const [message, setMessage] = useState("");
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null);
  const [screenshotStatus, setScreenshotStatus] = useState<ScreenshotStatus>("idle");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");

  // Captures only the current viewport (not the full scrollable page), so it
  // matches what the person is actually looking at when they click the
  // widget. `filter` excludes the widget's own DOM subtree via the
  // data-feedback-widget marker on the root, so the button/popover never
  // shows up in its own screenshot.
  const captureScreenshot = useCallback(async () => {
    setScreenshotStatus("capturing");
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(document.body, {
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: 1,
        cacheBust: true,
        style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
        filter: (node) =>
          !(node instanceof HTMLElement && node.dataset.feedbackWidget !== undefined),
      });
      setScreenshotBlob(blob);
      setScreenshotStatus(blob ? "captured" : "failed");
    } catch (err) {
      console.error("Feedback screenshot capture failed:", err);
      setScreenshotBlob(null);
      setScreenshotStatus("failed");
    }
  }, []);

  function open() {
    setIsOpen(true);
    setSubmitStatus("idle");
    void captureScreenshot();
  }

  async function submit() {
    const trimmed = message.trim();
    if (!trimmed) return;
    setSubmitStatus("submitting");

    const formData = new FormData();
    formData.set("message", trimmed);
    formData.set("feedback_type", feedbackType);
    formData.set("page_url", window.location.href);
    formData.set("user_agent", navigator.userAgent);
    if (screenshotBlob) formData.set("screenshot", screenshotBlob, "screenshot.png");

    try {
      const res = await fetch("/api/feedback", { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Feedback submission failed with status ${res.status}`);
      setSubmitStatus("sent");
      setMessage("");
      // Popover stays open so another idea/bug can be sent right away —
      // grab a fresh screenshot since the page may have changed since open.
      void captureScreenshot();
    } catch (err) {
      console.error("Feedback submit failed:", err);
      setSubmitStatus("error");
    }
  }

  return (
    <div data-feedback-widget className="fixed bottom-5 right-5 z-50">
      {isOpen && (
        <div className="absolute bottom-16 right-0 w-80 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Send feedback
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-3">
            <div className="flex gap-1">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setFeedbackType(t.value)}
                  className={`flex-1 text-xs px-2 py-1.5 rounded-md border text-center transition-colors ${
                    feedbackType === t.value
                      ? "bg-blue-50 dark:bg-blue-900/20 border-blue-400 text-blue-700 dark:text-blue-300"
                      : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}
                >
                  <div>{t.icon}</div>
                  <div>{t.label}</div>
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's going on?"
              rows={4}
              className="w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="text-xs text-slate-500 dark:text-slate-400" role="status">
              {screenshotStatus === "capturing" && "Capturing screenshot…"}
              {screenshotStatus === "captured" && "📸 Screenshot captured — we'll attach it"}
              {screenshotStatus === "failed" && "Couldn't capture a screenshot — sending without one"}
            </div>

            {submitStatus === "sent" && (
              <div className="text-xs text-green-600 dark:text-green-400">✓ Sent — thank you!</div>
            )}
            {submitStatus === "error" && (
              <div className="text-xs text-red-600 dark:text-red-400">
                Something went wrong — try again?
              </div>
            )}

            <button
              onClick={submit}
              disabled={!message.trim() || submitStatus === "submitting"}
              className="w-full text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md py-2 transition-colors"
            >
              {submitStatus === "submitting" ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        aria-label="Send feedback"
        className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center text-xl transition-colors"
      >
        💬
      </button>
    </div>
  );
}
