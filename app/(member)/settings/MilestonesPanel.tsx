"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MAX_STORY_LENGTH,
  MILESTONE_CLAIMS,
  MILESTONE_CONSENTS,
  MILESTONE_KINDS,
  MILESTONE_LABELS,
  MILESTONE_SELF_ADD,
  MILESTONE_SOURCE_NOTES,
  MILESTONE_TITLES,
  NO_CONSENT,
  PUBLISHED_CLAIM,
  PUBLISHED_TITLE,
  type ConsentKey,
  type Consents,
  type MilestoneKind,
} from "@/lib/finishers";
import { buildWorks, isFeaturedWork, summarizeTitles, MAX_WORK_TITLE_LENGTH, type CardBook, type CardProject, type Work } from "@/lib/finishers-works";
import type { Milestone } from "@/lib/data/milestones";
import { useConfirm } from "@/components/ConfirmDialog";
import { addMilestone, answerMilestone, takeBackMilestone } from "./milestoneActions";

const INPUT = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const PRIMARY = "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";
const SECONDARY = "px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50";
const NOTE = "mt-1 text-sm text-slate-600 dark:text-slate-400";

type FormResult = { success: true } | { error: string };
type FormInput = { achievedOn: string | null; storyBefore: string; storyAfter: string; consents: Consents };


const consentsOf = (m: Milestone): Consents => ({
  consent_profile: m.consentProfile,
  consent_homepage: m.consentHomepage,
  consent_testimonial: m.consentTestimonial,
});

/** A calendar date the member picked ("2026-05-01"), as words. It is a day, not an instant, so no zone is applied. */
function dayWords(value: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * The answer form: an optional date, a before and an after story, and one tick per use (all unticked). It confirms a proposal,
 * changes a confirmed answer, or adds a new milestone for a work; `run` does the saving. `lead` is extra fields above the form.
 */
function MilestoneForm({
  idPrefix,
  initial,
  lead,
  submitLabel,
  run,
  onDone,
  readOnly,
}: {
  idPrefix: string;
  initial: Milestone | null;
  lead?: ReactNode;
  submitLabel: string;
  run: (input: FormInput) => Promise<FormResult>;
  onDone: () => void;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(initial?.achievedOn ?? "");
  const [before, setBefore] = useState(initial?.storyBefore ?? "");
  const [after, setAfter] = useState(initial?.storyAfter ?? "");
  // Every use starts unticked; a milestone already confirmed shows what the member chose.
  const [consents, setConsents] = useState<Consents>(initial?.status === "confirmed" ? consentsOf(initial) : NO_CONSENT);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await run({ achievedOn: date || null, storyBefore: before, storyAfter: after, consents });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDone();
    });
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-4">
      {lead}
      <div>
        <label htmlFor={`${idPrefix}-date`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          When did it happen? (optional)
        </label>
        <input id={`${idPrefix}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} sm:w-56`} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-before`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          How did it feel before you got here? (optional)
        </label>
        <textarea id={`${idPrefix}-before`} rows={3} maxLength={MAX_STORY_LENGTH} value={before} onChange={(e) => setBefore(e.target.value)} className={INPUT} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-after`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          And how does it feel now? (optional)
        </label>
        <textarea id={`${idPrefix}-after`} rows={3} maxLength={MAX_STORY_LENGTH} value={after} onChange={(e) => setAfter(e.target.value)} className={INPUT} />
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">Where may we show this?</legend>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Nothing is shown anywhere yet. Your answer is saved, and it will only be used where you tick a box. You can change your mind here at any time.
        </p>
        <div className="mt-2 space-y-2">
          {MILESTONE_CONSENTS.map(({ key, label, hint }) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={consents[key as ConsentKey]}
                onChange={(e) => setConsents((c) => ({ ...c, [key]: e.target.checked }))}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-slate-600 dark:text-slate-400">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pending || readOnly} className={PRIMARY}>
          {pending ? "Saving..." : submitLabel}
        </button>
        <button type="button" onClick={onDone} disabled={pending} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RowHeading({ kind }: { kind: MilestoneKind }) {
  return (
    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
      {MILESTONE_CLAIMS[kind]} <span className="text-slate-500 dark:text-slate-400">({MILESTONE_TITLES[kind]}, {MILESTONE_LABELS[kind]})</span>
    </p>
  );
}

function MilestoneItem({ kind, milestone, work, readOnly }: { kind: MilestoneKind; milestone: Milestone | undefined; work: Work; readOnly: boolean }) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fail = (result: FormResult) => {
    if ("error" in result) setError(result.error);
    else router.refresh();
  };

  const decline = (m: Milestone) =>
    startTransition(async () => {
      setError(null);
      fail(await answerMilestone({ id: m.id, answer: "decline" }));
    });

  const takeBack = async (m: Milestone) => {
    const ok = await ask({
      title: `Take back ${MILESTONE_LABELS[kind]}?`,
      body: "It comes off your milestones, so it can't be shown anywhere. You can add it again whenever you like.",
      confirmLabel: "Take it back",
      tone: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      setError(null);
      fail(await takeBackMilestone(m.id));
    });
  };

  const chosen = milestone ? MILESTONE_CONSENTS.filter(({ key }) => consentsOf(milestone)[key]).map(({ label }) => label) : [];

  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 p-4" data-milestone={`${work.key || "none"}-${kind}`}>
      <RowHeading kind={kind} />

      {!milestone && !editing && (
        <>
          <p className={NOTE}>Not added yet. Only you can say you did.</p>
          <div className="mt-3">
            <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className={PRIMARY} data-track={`milestone-add-open-${kind}`}>
              {MILESTONE_SELF_ADD[kind].button}
            </button>
          </div>
        </>
      )}
      {!milestone && editing && (
        <MilestoneForm
          idPrefix={`ms-add-${work.key || "none"}-${kind}`}
          initial={null}
          submitLabel={MILESTONE_SELF_ADD[kind].confirmLabel}
          run={(i) => addMilestone({
              kind,
              projectId: work.projectId,
              bookId: work.bookId,
              title: work.projectId || work.bookId ? null : work.title,
              achievedOn: i.achievedOn,
              storyBefore: i.storyBefore,
              storyAfter: i.storyAfter,
              consents: i.consents,
            })}
          onDone={() => setEditing(false)}
          readOnly={readOnly}
        />
      )}

      {milestone?.status === "proposed" && !editing && (
        <>
          <p className={NOTE}>Waiting for you to confirm. {MILESTONE_SOURCE_NOTES[milestone.source]} Is this you?</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className={PRIMARY} data-track="milestone-confirm-open">
              Yes, this is me
            </button>
            <button type="button" onClick={() => decline(milestone)} disabled={pending || readOnly} className={SECONDARY} data-track="milestone-decline">
              Not me / not yet
            </button>
          </div>
        </>
      )}
      {milestone?.status === "confirmed" && !editing && (
        <>
          <p className={NOTE}>
            Confirmed{milestone.achievedOn ? ` (${dayWords(milestone.achievedOn)})` : ""}.{" "}
            {chosen.length > 0 ? `You said we may show it on: ${chosen.join(", ")}.` : "You haven't chosen anywhere to show it, so it stays private."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className={SECONDARY}>
              Change
            </button>
            {milestone.source === "member" ? (
              <button type="button" onClick={() => takeBack(milestone)} disabled={pending || readOnly} className={SECONDARY}>
                Take it back
              </button>
            ) : (
              <button type="button" onClick={() => decline(milestone)} disabled={pending || readOnly} className={SECONDARY}>
                Not me / not yet
              </button>
            )}
          </div>
        </>
      )}
      {milestone?.status === "declined" && !editing && (
        <>
          <p className={NOTE}>You said this isn&rsquo;t you, or not yet. We won&rsquo;t show it anywhere.</p>
          <div className="mt-3">
            <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className={SECONDARY}>
              Actually, it is me
            </button>
          </div>
        </>
      )}
      {milestone && editing && (
        <MilestoneForm
          idPrefix={`ms-${milestone.id}`}
          initial={milestone}
          submitLabel="Save"
          run={(i) => answerMilestone({ id: milestone.id, answer: "confirm", achievedOn: i.achievedOn, storyBefore: i.storyBefore, storyAfter: i.storyAfter, consents: i.consents })}
          onDone={() => setEditing(false)}
          readOnly={readOnly}
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {dialog}
    </li>
  );
}

/** The third milestone: nobody adds it, it is true when the work is a book on the Bookshelf. */
function PublishedItem() {
  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 p-4" data-milestone="published">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        {PUBLISHED_CLAIM} <span className="text-slate-500 dark:text-slate-400">({PUBLISHED_TITLE})</span>
      </p>
      <p className={NOTE}>
        Reached automatically from your Bookshelf.{" "}
        <Link href="/bookshelf" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 underline underline-offset-2">
          See your Bookshelf
        </Link>
      </p>
    </li>
  );
}

function WorkItem({ work, readOnly }: { work: Work; readOnly: boolean }) {
  return (
    <li className="space-y-2" data-work={work.key || "none"}>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{work.title ?? "Not linked to a work"}</h3>
      <ul className="space-y-3">
        {MILESTONE_KINDS.map((kind) => (
          <MilestoneItem key={kind} kind={kind} milestone={work.milestones[kind]} work={work} readOnly={readOnly} />
        ))}
        {work.published && <PublishedItem />}
      </ul>
    </li>
  );
}

/** "Add a work that is not listed here": a title, which milestone, and the same answer form. */
function UnlistedWork({ readOnly }: { readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MilestoneKind>("the_end");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={readOnly} className={SECONDARY} data-track="milestone-add-unlisted-open">
        Add a work that is not listed here
      </button>
    );
  }
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-4">
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">A work that is not listed here</p>
      <MilestoneForm
        idPrefix="ms-unlisted"
        initial={null}
        lead={
          <>
            <div>
              <label htmlFor="ms-unlisted-title" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                What is it called?
              </label>
              <input id="ms-unlisted-title" value={title} maxLength={MAX_WORK_TITLE_LENGTH} onChange={(e) => setTitle(e.target.value)} className={`${INPUT} sm:w-96`} />
            </div>
            <div>
              <label htmlFor="ms-unlisted-kind" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Which step did you reach?
              </label>
              <select id="ms-unlisted-kind" value={kind} onChange={(e) => setKind(e.target.value as MilestoneKind)} className={`${INPUT} sm:w-72`}>
                {MILESTONE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {MILESTONE_CLAIMS[k]}
                  </option>
                ))}
              </select>
            </div>
          </>
        }
        submitLabel="Add it"
        run={(i) => addMilestone({ kind, title, achievedOn: i.achievedOn, storyBefore: i.storyBefore, storyAfter: i.storyAfter, consents: i.consents })}
        onDone={() => setOpen(false)}
        readOnly={readOnly}
      />
    </div>
  );
}

/**
 * Settings > Profile: "Your milestones", always there, per work (docs/product/FINISHERS.md). Each of the member's projects and
 * Bookshelf books has its own THE END and publish-ready rows, which they can add themselves, confirm (when staff suggested
 * it) or take back; a book also shows Published, which comes from the Bookshelf and is read-only. Works with a milestone, on
 * the Bookshelf or past the drafting stage come first; the rest wait under "Show all my projects". Nothing here is public: a
 * milestone is only used where its box is ticked.
 */
export function MilestonesPanel({
  milestones,
  projects = [],
  books = [],
  readOnly = false,
}: {
  milestones: Milestone[];
  projects?: CardProject[];
  books?: CardBook[];
  readOnly?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const works = buildWorks(projects, books, milestones);
  const featured = works.filter(isFeaturedWork);
  const rest = works.filter((w) => !isFeaturedWork(w));
  const waiting = milestones.some((m) => m.status === "proposed");
  const summary = summarizeTitles(works);
  return (
    <section aria-labelledby="your-milestones" className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6">
      <h2 id="your-milestones" className="text-lg font-medium text-slate-900 dark:text-slate-100">
        Your milestones
      </h2>
      <p className="mt-1 mb-2 text-sm text-slate-600 dark:text-slate-400">
        For each of your works, mark the steps you have reached: you wrote THE END, it is ready to publish, it is published. Only you can mark a step.
        Nothing is shown to anyone until you choose where.
        {waiting && " We think you may have reached one already. Tell us if that’s right."}
        {readOnly && " (You are viewing as this member, so you can look but not change anything.)"}
      </p>
      {summary && (
        <p className="mb-4 text-sm font-medium text-slate-900 dark:text-slate-100" data-testid="milestone-summary">
          {summary}
        </p>
      )}
      {works.length === 0 && <p className={`${NOTE} mb-4`}>You have no projects or books yet. Add a work below, or start a project and it will be listed here.</p>}
      <ul className="space-y-6">
        {featured.map((w) => (
          <WorkItem key={w.key || "none"} work={w} readOnly={readOnly} />
        ))}
        {showAll && rest.map((w) => <WorkItem key={w.key} work={w} readOnly={readOnly} />)}
      </ul>
      {rest.length > 0 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className={`${SECONDARY} mt-4`}>
          Show all my projects ({rest.length} more)
        </button>
      )}
      <div className="mt-6 space-y-3">
        <p className={NOTE}>
          A book on your Bookshelf counts as published automatically.{" "}
          <Link href="/bookshelf" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 underline underline-offset-2">
            Go to the Bookshelf
          </Link>
        </p>
        <UnlistedWork readOnly={readOnly} />
      </div>
    </section>
  );
}
