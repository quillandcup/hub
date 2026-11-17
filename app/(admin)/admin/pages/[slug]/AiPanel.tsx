"use client";

import { useState, useTransition } from "react";
import { useGetPuck, type Data } from "@puckeditor/core";
import { Sparkles } from "lucide-react";
import { PROMPT_MAX } from "@/lib/landing/ai-limits";
import type { A11yIssue } from "@/lib/landing/a11y";
import { generateLandingBlocks, reviseLandingBlocks, type AiBlocksResult } from "../actions";

type Mode = "add" | "change";

type Props = {
  generate: (prompt: string) => Promise<AiBlocksResult>;
  /** Asks for the page as the description changes it; `content` is what the editor shows now. */
  revise: (prompt: string, content: unknown[]) => Promise<AiBlocksResult>;
  /** The page's blocks as they are now. */
  getContent: () => unknown[];
  /** Adds the blocks to the end of the page. */
  onAdd: (blocks: unknown[]) => void;
  /** Puts the revised blocks in place of the page's. */
  onReplace: (blocks: unknown[]) => void;
};

const COPY: Record<Mode, { label: string; placeholder: string; button: string; busy: string; note: string }> = {
  add: {
    label: "What should I add?",
    placeholder: "For example: a section that explains how the sprint works in three steps, then a short FAQ.",
    button: "Add to the page",
    busy: "Writing… this can take a minute",
    note: "Blocks go at the end of the page and you can undo them. Only what you type here is sent, not the page. Check every fact and link it wrote.",
  },
  change: {
    label: "What should change?",
    placeholder: "For example: make the intro shorter, turn the steps into a list, or make the buttons outline.",
    button: "Change the page",
    busy: "Working… this can take a minute",
    note: "The page's text and settings are sent along with your description, never its pictures or member data. Pictures and anything you didn't mention stay as they are, and you can undo the change. Check what it wrote.",
  },
};

/** The AI tab's panel: describe what to add, get blocks appended to the page. Presentational, so it can be tested without Puck. */
export function AiPanelView({ generate, revise, getContent, onAdd, onReplace }: Props) {
  const [mode, setMode] = useState<Mode>("add");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ count: number; notes: A11yIssue[]; summary?: string } | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    setDone(null);
    start(async () => {
      const result = mode === "add" ? await generate(prompt) : await revise(prompt, getContent());
      if (result.error || !result.blocks) return setError(result.error ?? "Couldn't build that. Try again.");
      if (mode === "add") onAdd(result.blocks);
      else onReplace(result.blocks);
      setDone({ count: result.blocks.length, notes: result.notes ?? [], summary: result.summary });
      setPrompt("");
    });
  }

  return (
    <div className="space-y-3 p-4 text-sm">
      <div role="group" aria-label="What the assistant does" className="flex gap-1 rounded bg-slate-100 p-1 dark:bg-slate-800">
        {(["add", "change"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
              setDone(null);
            }}
            className="flex-1 rounded px-2 py-1 text-sm font-medium aria-pressed:bg-white aria-pressed:text-plum-700 aria-pressed:shadow-sm dark:aria-pressed:bg-slate-950"
          >
            {m === "add" ? "Add" : "Change"}
          </button>
        ))}
      </div>
      <label className="block font-medium">
        {COPY[mode].label}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          maxLength={PROMPT_MAX}
          placeholder={COPY[mode].placeholder}
          className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>
      <button
        type="button"
        disabled={pending || !prompt.trim()}
        onClick={run}
        className="w-full rounded bg-plum-600 px-3 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
      >
        {pending ? COPY[mode].busy : COPY[mode].button}
      </button>
      <p className="text-xs text-slate-600 dark:text-slate-400">{COPY[mode].note}</p>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {done && (
        <div role="status" className="space-y-1">
          <p>
            {mode === "add" ? `Added ${done.count} ${done.count === 1 ? "block" : "blocks"} at the end of the page.` : "Changed the page. Undo brings the old version back."}
            {done.summary ? ` ${done.summary}` : ""}
          </p>
          {done.notes.length > 0 && (
            <div className="text-xs text-slate-600 dark:text-slate-400">
              <p>To check:</p>
              <ul className="list-disc pl-4">
                {[...new Set(done.notes.map((n) => n.message))].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AiPanel() {
  // The page as it is when the answer arrives, not when the button was clicked: edits made while waiting are kept.
  const getPuck = useGetPuck();
  const current = () => getPuck().appState.data;
  // One undo step each: Puck's history records a setData only when asked.
  const setContent = (content: unknown[]) => getPuck().dispatch({ type: "setData", data: { ...current(), content: content as Data["content"] }, recordHistory: true });
  return (
    <AiPanelView
      generate={generateLandingBlocks}
      revise={reviseLandingBlocks}
      getContent={() => current().content}
      onAdd={(blocks) => setContent([...current().content, ...blocks])}
      onReplace={setContent}
    />
  );
}

/** The editor's left-rail tab, beside Blocks and Outline. Ours, not Puck Cloud's. */
export const aiPlugin = { name: "ai", label: "AI", icon: <Sparkles />, render: () => <AiPanel /> };
