"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import { MILESTONE_CELEBRATION, type MilestoneKind } from "@/lib/finishers";
import { STAGE_PROMPT, type StageMilestonePrompt } from "@/lib/milestone-prompts";
import { MilestoneForm } from "@/components/writing/Milestones";
import { answerStageMilestone } from "../stageMilestoneActions";

const PRIMARY = "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";
const SECONDARY = "px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50";

/** Where each step is: waiting for an answer, filling in the form, said yes (saved), or said "not yet" (remembered). */
type Step = "asking" | "form" | "yes" | "not_yet";

function StepRow({
  projectId,
  kind,
  step,
  onStep,
  showName,
}: {
  projectId: string;
  kind: MilestoneKind;
  step: Step;
  onStep: (next: Step) => void;
  /** Name the step (two steps in one dialog); a single question already says it. */
  showName: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const notYet = () =>
    startTransition(async () => {
      setError(null);
      const result = await answerStageMilestone({ projectId, kind, answer: "not_yet" });
      if ("error" in result) setError(result.error);
      else onStep("not_yet");
    });

  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 p-4" data-stage-step={kind}>
      {showName && (
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {step === "yes" && <span aria-hidden="true">✓ </span>}
          {STAGE_PROMPT.step[kind]}
        </p>
      )}
      {step === "asking" && (
        <div className={`${showName ? "mt-3 " : ""}flex flex-wrap gap-3`}>
          <button type="button" onClick={() => onStep("form")} disabled={pending} className={PRIMARY} data-track={`stage-milestone-yes-${kind}`}>
            {STAGE_PROMPT.yes[kind]}
          </button>
          <button type="button" onClick={notYet} disabled={pending} className={SECONDARY} data-track={`stage-milestone-not-yet-${kind}`}>
            {STAGE_PROMPT.notYet}
          </button>
        </div>
      )}
      {step === "form" && (
        <MilestoneForm
          idPrefix={`stage-${projectId}-${kind}`}
          initial={null}
          submitLabel="Save it"
          run={(i) =>
            answerStageMilestone({ projectId, kind, answer: "yes", achievedOn: i.achievedOn, achievedPrecision: i.achievedPrecision, storyBefore: i.storyBefore, storyAfter: i.storyAfter, shareStory: i.shareStory, visibility: i.visibility })
          }
          onDone={(saved) => onStep(saved ? "yes" : "asking")}
          readOnly={false}
        />
      )}
      {step === "yes" && (
        <p role="status" className="mt-2 text-sm font-medium text-plum-700 dark:text-plum-300" data-testid="stage-celebration">
          <span aria-hidden="true">🎉 </span>
          {MILESTONE_CELEBRATION[kind]}
        </p>
      )}
      {step === "not_yet" && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{STAGE_PROMPT.notYetNote}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * The dialog after a project's status moved to a stage that means a milestone (docs/product/FINISHERS.md, "The project-stage
 * prompt"): once per project and kind, kindly, never a gate (the status has already saved). It reuses the milestone answer form
 * from Settings. A project that jumped straight to Publishing gets both questions together. Closing it any way ("Close for now",
 * Escape) says "not yet" to the questions still open, so we never ask twice. `onPublish` opens the existing Publish flow.
 */
export default function StageMilestoneDialog({ prompt, onClose, onPublish }: { prompt: StageMilestonePrompt; onClose: () => void; onPublish: () => void }) {
  const { projectId, projectTitle, kinds, offerPublish } = prompt;
  const [steps, setSteps] = useState<Partial<Record<MilestoneKind, Step>>>(() => Object.fromEntries(kinds.map((k) => [k, "asking" as Step])));
  const [, startTransition] = useTransition();
  const stepOf = (kind: MilestoneKind): Step => steps[kind] ?? "asking";
  const open = kinds.filter((k) => stepOf(k) === "asking" || stepOf(k) === "form");

  // Leaving with a question unanswered counts as "not yet": it is remembered, and the project's milestones are still there.
  const leave = (then: () => void) => {
    startTransition(async () => {
      await Promise.all(open.map((kind) => answerStageMilestone({ projectId, kind, answer: "not_yet" }).catch(() => null)));
      then();
    });
  };

  const title = kinds.length > 0 ? STAGE_PROMPT.intro : STAGE_PROMPT.publishTitle(projectTitle);
  const question = kinds.length === 0 ? null : kinds.length === 2 ? STAGE_PROMPT.both : STAGE_PROMPT.question(kinds[0], projectTitle);
  const allAnswered = open.length === 0;

  return (
    <Modal isOpen onClose={() => leave(onClose)} title={title} maxWidth="lg">
      <div className="space-y-4">
        {question && (
          <div>
            <p className="text-base font-medium text-slate-900 dark:text-slate-100">{question}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{STAGE_PROMPT.reassurance}</p>
          </div>
        )}
        {kinds.length > 0 && (
          <ul className="space-y-3">
            {kinds.map((kind) => (
              <StepRow
                key={kind}
                projectId={projectId}
                kind={kind}
                step={stepOf(kind)}
                onStep={(next) => setSteps((s) => ({ ...s, [kind]: next }))}
                showName={kinds.length > 1}
              />
            ))}
          </ul>
        )}
        {offerPublish && (
          <div className="rounded-md border border-slate-200 dark:border-slate-700 p-4">
            {kinds.length > 0 && <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{STAGE_PROMPT.publishTitle(projectTitle)}</p>}
            <p className={`${kinds.length > 0 ? "mt-1 " : ""}text-sm text-slate-600 dark:text-slate-400`}>{STAGE_PROMPT.publishQuestion}</p>
            <div className="mt-3">
              <button type="button" onClick={() => leave(onPublish)} className={SECONDARY} data-track="stage-milestone-publish">
                {STAGE_PROMPT.publishButton}
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/projects/${projectId}#milestones`}
            onClick={() => leave(onClose)}
            data-track="stage-milestone-see-milestones"
            className="text-sm text-plum-700 underline dark:text-plum-300"
          >
            See this project&rsquo;s milestones
          </Link>
          <button type="button" onClick={() => leave(onClose)} className={allAnswered ? PRIMARY : SECONDARY} data-track="stage-milestone-close">
            {allAnswered ? STAGE_PROMPT.done : STAGE_PROMPT.notNow}
          </button>
        </div>
      </div>
    </Modal>
  );
}
