"use client";

import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MAX_STORY_LENGTH,
  MILESTONE_CELEBRATION,
  MILESTONE_CLAIMS,
  MILESTONE_DEFAULT_VISIBILITY,
  MILESTONE_KINDS,
  MILESTONE_LABELS,
  MILESTONE_LEVEL_LINES,
  MILESTONE_SELF_ADD,
  MILESTONE_SOURCE_NOTES,
  PUBLISHED_ROW_HEADING,
  SHARE_STORY_DEFAULT,
  SHARE_STORY_LABEL,
  SHARE_STORY_TIP,
  describeMilestoneLevel,
  hasSomethingToShare,
  milestonePhotoLine,
  publishedPhotoLine,
  milestoneDateWords,
  milestoneLevels,
  milestoneRowHeading,
  type MilestoneDatePrecision,
  milestoneWebNote,
  type MilestoneKind,
} from "@/lib/finishers";
import type { Visibility } from "@/lib/writing-visibility";
import VisibilityControl from "@/components/writing/VisibilityControl";
import { InfoTip } from "@/components/InfoTip";
import MilestonePhoto from "@/components/writing/MilestonePhoto";
import { summarizeWorks, MAX_WORK_TITLE_LENGTH, type Work } from "@/lib/finishers-works";
import type { Milestone } from "@/lib/data/milestones";
import { useConfirm } from "@/components/ConfirmDialog";
import { addMilestone, answerMilestone, setMilestoneShare, setMilestoneVisibility, takeBackMilestone } from "@/app/(member)/settings/milestoneActions";

const INPUT = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const PRIMARY = "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";
const SECONDARY = "px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50";
const NOTE = "mt-1 text-sm text-slate-600 dark:text-slate-400";

export type FormResult = { success: true } | { error: string };
export type FormInput = { achievedOn: string | null; achievedPrecision: MilestoneDatePrecision; storyBefore: string; storyAfter: string; shareStory: boolean; visibility: Visibility };

const ALL_LEVELS: readonly Visibility[] = ["private", "community", "public"];

/** What the member's writer profile is, as far as the globe's note needs to know (as `WebPageState` for profile items). */
export type MilestoneWebState = { available: boolean; on: boolean };

/**
 * The share tick: "Share my story to inspire other writers", with what it means and an info tip for the marketing uses. It is
 * only shown beside a story that is written, never a condition of saving, and unticking is a plain choice with no warning.
 */
function ShareStoryTick({ id, checked, onChange, disabled }: { id: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
        <label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {SHARE_STORY_LABEL}
        </label>
        <InfoTip label="What sharing my story means">{SHARE_STORY_TIP}</InfoTip>
      </div>
    </div>
  );
}

type DateChoice = MilestoneDatePrecision | "none";
const DATE_CHOICES: { value: DateChoice; label: string }[] = [
  { value: "day", label: "A day" },
  { value: "month", label: "Month and year" },
  { value: "year", label: "Year only" },
  { value: "none", label: "I don't remember" },
];

/** What the date field holds for a stored date: the whole day, "YYYY-MM" for a month, "YYYY" for a year. */
function dateInputValue(achievedOn: string, precision: MilestoneDatePrecision): string {
  return precision === "year" ? achievedOn.slice(0, 4) : precision === "month" ? achievedOn.slice(0, 7) : achievedOn;
}

/**
 * The answer form: an optional date, a before and an after story, and, once a story is written, the share tick (unticked until
 * the member ticks it). It confirms a proposal, changes a confirmed answer, or adds a new milestone for a work; `run` does the
 * saving. `lead` is extra fields above the form.
 */
export function MilestoneForm({
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
  /** Called when the form closes; `saved` is true when it closed because the answer was saved. */
  onDone: (saved: boolean) => void;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // How the date is given: a day, a month and year, a year, or not at all ("I don't remember"). A milestone that is already
  // confirmed without a date starts at "I don't remember"; a new one starts at the day, which the member may leave empty.
  const [when, setWhen] = useState<DateChoice>(initial?.achievedOn ? initial.achievedPrecision : initial?.status === "confirmed" ? "none" : "day");
  const [date, setDate] = useState(initial?.achievedOn ? dateInputValue(initial.achievedOn, initial.achievedPrecision) : "");
  const [before, setBefore] = useState(initial?.storyBefore ?? "");
  const [after, setAfter] = useState(initial?.storyAfter ?? "");
  // The share tick starts unticked (SHARE_STORY_DEFAULT); a milestone already confirmed shows what the member chose.
  const [share, setShare] = useState(initial?.status === "confirmed" ? initial.consentTestimonial : SHARE_STORY_DEFAULT);
  // Who sees it starts at the default (the globe) for a milestone not confirmed yet, so the choice is visible and one click away; a confirmed one shows its own.
  const [level, setLevel] = useState<Visibility>(initial?.status === "confirmed" ? initial.visibility : MILESTONE_DEFAULT_VISIBILITY);
  const written = before.trim() !== "" || after.trim() !== "" || Boolean(initial?.photo);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const dated = when !== "none" && date.trim() !== "";
      const result = await run({ achievedOn: dated ? date.trim() : null, achievedPrecision: dated ? (when as MilestoneDatePrecision) : "day", storyBefore: before, storyAfter: after, shareStory: share, visibility: level });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDone(true);
    });
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-4">
      {lead}
      <div data-testid="milestone-form-when">
        <label htmlFor={`${idPrefix}-when`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          When did it happen? (optional)
        </label>
        <div className="flex flex-wrap gap-2">
          <select
            id={`${idPrefix}-when`}
            value={when}
            onChange={(e) => {
              setWhen(e.target.value as DateChoice);
              setDate("");
            }}
            className={`${INPUT} sm:w-48`}
          >
            {DATE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {when === "day" && <input id={`${idPrefix}-date`} aria-label="The day" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} sm:w-48`} />}
          {when === "month" && <input id={`${idPrefix}-date`} aria-label="The month" type="month" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} sm:w-48`} />}
          {when === "year" && (
            <input
              id={`${idPrefix}-date`}
              aria-label="The year"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              placeholder="2026"
              value={date}
              onChange={(e) => setDate(e.target.value.replace(/\D/g, ""))}
              className={`${INPUT} sm:w-28`}
            />
          )}
        </div>
        {when === "none" && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">That&rsquo;s fine. The step will show with no date.</p>}
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
      <div data-testid="milestone-form-level">
        <p className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Who can see this milestone and your story?</p>
        <VisibilityControl
          visibility={level}
          onChange={setLevel}
          disabled={pending}
          noun="milestone"
          levels={ALL_LEVELS}
          describe={describeMilestoneLevel}
          withText
          className="text-sm text-slate-700 dark:text-slate-300"
        />
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-testid="milestone-form-level-line">
          {MILESTONE_LEVEL_LINES[level]}
        </p>
      </div>
      {written && <ShareStoryTick id={`${idPrefix}-share`} checked={share} onChange={setShare} disabled={pending} />}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" disabled={pending || readOnly} className={PRIMARY}>
          {pending ? "Saving..." : submitLabel}
        </button>
        <button type="button" onClick={() => onDone(false)} disabled={pending} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RowHeading({ kind }: { kind: MilestoneKind }) {
  return (
    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{milestoneRowHeading(kind)}</p>
  );
}

function MilestoneItem({ kind, milestone, work, readOnly, web }: { kind: MilestoneKind; milestone: Milestone | undefined; work: Work; readOnly: boolean; web: MilestoneWebState }) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The celebration after a milestone is first confirmed, shown before anything else on the row.
  const [celebrate, setCelebrate] = useState(false);
  // The level and the share tick show the member's click at once and go back if the save fails; the server's value takes over when it arrives.
  const [level, setLevel] = useState<Visibility | null>(null);
  const [shared, setShared] = useState<boolean | null>(null);
  useEffect(() => setLevel(null), [milestone?.visibility]);
  useEffect(() => setShared(null), [milestone?.consentTestimonial]);

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

  const changeLevel = (m: Milestone, next: Visibility) =>
    startTransition(async () => {
      setError(null);
      const before = level;
      setLevel(next);
      const result = await setMilestoneVisibility(m.id, next);
      if ("error" in result) {
        setLevel(before);
        setError(result.error);
      } else router.refresh();
    });

  const changeShare = (m: Milestone, next: boolean) =>
    startTransition(async () => {
      setError(null);
      const before = shared;
      setShared(next);
      const result = await setMilestoneShare(m.id, next);
      if ("error" in result) {
        setShared(before);
        setError(result.error);
      } else router.refresh();
    });

  const finishForm = (saved: boolean, wasConfirmed: boolean) => {
    setEditing(false);
    if (saved && !wasConfirmed) setCelebrate(true);
  };

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
              achievedPrecision: i.achievedPrecision,
              storyBefore: i.storyBefore,
              storyAfter: i.storyAfter,
              shareStory: i.shareStory,
              visibility: i.visibility,
            })}
          onDone={(saved) => finishForm(saved, false)}
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
          {celebrate && (
            <p role="status" className="mt-2 text-sm font-medium text-plum-700 dark:text-plum-300" data-testid="milestone-celebration">
              {MILESTONE_CELEBRATION[kind]}
            </p>
          )}
          <p className={NOTE}>Confirmed{milestone.achievedOn ? ` (${milestoneDateWords(milestone.achievedOn, milestone.achievedPrecision)})` : ""}.</p>
          <div className="mt-2">
            <VisibilityControl
              visibility={level ?? milestone.visibility}
              onChange={(next) => changeLevel(milestone, next)}
              disabled={pending || readOnly}
              noun="milestone"
              levels={milestoneLevels(web.available)}
              describe={describeMilestoneLevel}
              withText
              className="text-sm text-slate-700 dark:text-slate-300"
            />
            {milestoneWebNote(level ?? milestone.visibility, web) && (
              <p className="mt-1 max-w-md text-xs text-slate-600 dark:text-slate-400" data-testid="milestone-web-note">
                {milestoneWebNote(level ?? milestone.visibility, web)}
              </p>
            )}
          </div>
          <MilestonePhoto
            target="milestone"
            id={milestone.id}
            kind={kind}
            photo={milestone.photo}
            visibilityLine={milestonePhotoLine(level ?? milestone.visibility, web)}
            readOnly={readOnly}
            idPrefix={`ms-${milestone.id}`}
          />
          {hasSomethingToShare(milestone) && (
            <div className="mt-3">
              <ShareStoryTick id={`ms-${milestone.id}-share-now`} checked={shared ?? milestone.consentTestimonial} onChange={(next) => changeShare(milestone, next)} disabled={pending || readOnly} />
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className={SECONDARY}>
              Change
            </button>
            {milestone.source === "member" || milestone.source === "project_stage" ? (
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
          <p className={NOTE}>You said no, or not yet. It isn&rsquo;t shown anywhere.</p>
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
          run={(i) => answerMilestone({ id: milestone.id, answer: "confirm", achievedOn: i.achievedOn, achievedPrecision: i.achievedPrecision, storyBefore: i.storyBefore, storyAfter: i.storyAfter, shareStory: i.shareStory, visibility: i.visibility })}
          onDone={(saved) => finishForm(saved, milestone.status === "confirmed")}
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
function PublishedItem({ work, readOnly, web }: { work: Work; readOnly: boolean; web: MilestoneWebState }) {
  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 p-4" data-milestone="published">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{PUBLISHED_ROW_HEADING}</p>
      <p className={NOTE}>
        Reached automatically from your Bookshelf.{" "}
        <Link href="/bookshelf" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 underline underline-offset-2">
          See your Bookshelf
        </Link>
      </p>
      {work.bookId && (
        <MilestonePhoto target="book" id={work.bookId} kind="published" photo={work.bookPhoto ?? null} visibilityLine={publishedPhotoLine(web)} readOnly={readOnly} idPrefix={`book-${work.bookId}`} />
      )}
    </li>
  );
}

/** What the milestones are and who sees them, said once where a member meets them. */
export const MILESTONES_INTRO =
  "Mark the steps you have reached: you wrote THE END, it is ready to publish, it is published. Only you can mark a step. When you confirm a step, other members see it now and anyone on the internet sees it once your writer profile is on. Tap the icon on a step to change that: the globe is anyone on the internet, the house is other members, the lock is only you. A step staff suggested stays private until you confirm it.";

/** One work's steps: THE END and publish-ready (each added, confirmed or taken back by the member), and Published when it is a book on the Bookshelf. */
export function ProjectMilestones({ work, readOnly = false, web = { available: false, on: false } }: { work: Work; readOnly?: boolean; web?: MilestoneWebState }) {
  return (
    <ul className="space-y-3" data-work={work.key || "none"}>
      {MILESTONE_KINDS.map((kind) => (
        <MilestoneItem key={kind} kind={kind} milestone={work.milestones[kind]} work={work} readOnly={readOnly} web={web} />
      ))}
      {work.published && <PublishedItem work={work} readOnly={readOnly} web={web} />}
    </ul>
  );
}

/** How far a work has got, in a few words, for the closed milestones row on a project card. */
export function milestoneProgressWords(work: Work): string {
  const reached = MILESTONE_KINDS.filter((k) => work.milestones[k]?.status === "confirmed").length + (work.published ? 1 : 0);
  const waiting = MILESTONE_KINDS.filter((k) => work.milestones[k]?.status === "proposed").length;
  const parts = [`${reached} of ${MILESTONE_KINDS.length + 1} reached`];
  if (waiting > 0) parts.push(waiting === 1 ? "1 waiting for you to confirm" : `${waiting} waiting for you to confirm`);
  return parts.join(" · ");
}

/** On a project card: a closed "Milestones" row that opens to that project's steps. */
export function ProjectMilestonesToggle({ work, readOnly = false, web = { available: false, on: false } }: { work: Work; readOnly?: boolean; web?: MilestoneWebState }) {
  const [open, setOpen] = useState(false);
  const panelId = `milestones-${work.key}`;
  return (
    <div className="mt-4 border-t border-slate-200 dark:border-slate-800 pt-3" data-testid="project-milestones">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        data-track="projects-milestones-toggle"
        className="flex w-full flex-wrap items-center gap-x-2 text-left text-sm text-slate-700 dark:text-slate-300"
      >
        <span className="font-medium text-slate-900 dark:text-slate-100">Milestones</span>
        <span className="text-slate-600 dark:text-slate-400">{milestoneProgressWords(work)}</span>
        <span aria-hidden="true" className="ml-auto text-slate-500">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div id={panelId} className="mt-3">
          <ProjectMilestones work={work} readOnly={readOnly} web={web} />
        </div>
      )}
    </div>
  );
}

/** The one line that says where the member's works stand (`summarizeWorks`), shown at the top of My Writing's Projects tab. */
export function MilestoneSummary({ works, waiting }: { works: Work[]; waiting: boolean }) {
  const summary = summarizeWorks(works);
  // The anchor for "Your milestones" in search stays even when there is nothing to say yet.
  if (!summary && !waiting) return <div id="your-milestones" />;
  return (
    <div id="your-milestones" className="text-sm" data-testid="milestone-summary-block">
      {summary && (
        <p className="font-medium text-slate-900 dark:text-slate-100" data-testid="milestone-summary">
          {summary}
        </p>
      )}
      {waiting && <p className="text-slate-600 dark:text-slate-400">We think you may have reached a milestone already. Open a project&rsquo;s Milestones to tell us if that&rsquo;s right.</p>}
    </div>
  );
}

function WorkItem({ work, readOnly, web }: { work: Work; readOnly: boolean; web: MilestoneWebState }) {
  return (
    <li className="space-y-2" data-work={work.key || "none"}>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{work.title ?? "Not linked to a work"}</h3>
      <ProjectMilestones work={work} readOnly={readOnly} web={web} />
    </li>
  );
}


/** "Add a work that is not listed here": a title, which milestone, and the same answer form. */
function UnlistedWork({ readOnly }: { readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MilestoneKind>("the_end");
  // The celebration for the last one added here, shown where the form was.
  const [celebrated, setCelebrated] = useState<MilestoneKind | null>(null);
  if (!open) {
    return (
      <div className="space-y-3">
        {celebrated && (
          <p role="status" className="text-sm font-medium text-plum-700 dark:text-plum-300" data-testid="milestone-celebration">
            {MILESTONE_CELEBRATION[celebrated]}
          </p>
        )}
        <button type="button" onClick={() => { setCelebrated(null); setOpen(true); }} disabled={readOnly} className={SECONDARY} data-track="milestone-add-unlisted-open">
          Add a work that is not listed here
        </button>
      </div>
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
        run={(i) => addMilestone({ kind, title, achievedOn: i.achievedOn, achievedPrecision: i.achievedPrecision, storyBefore: i.storyBefore, storyAfter: i.storyAfter, shareStory: i.shareStory, visibility: i.visibility })}
        onDone={(saved) => {
          setOpen(false);
          if (saved) setCelebrated(kind);
        }}
        readOnly={readOnly}
      />
    </div>
  );
}


/**
 * My Writing, Projects tab: "Other works", the works that are not one of the member's projects: books on the Bookshelf with no
 * project, works they added by title ("A work that is not listed here"), and the works of projects put away. Each has its own
 * steps like a project does (docs/product/FINISHERS.md). Always shown: it is also where a work that is not listed is added.
 */
export function OtherWorks({ works, readOnly = false, web = { available: false, on: false } }: { works: Work[]; readOnly?: boolean; web?: MilestoneWebState }) {
  return (
    <section aria-labelledby="other-works" className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
      <h2 id="other-works" className="text-lg font-medium text-slate-900 dark:text-slate-100">
        Other works
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Books and writing that aren&rsquo;t one of your projects. A project&rsquo;s milestones are on the project itself.
        {readOnly && " (You are viewing as this member, so you can look but not change anything.)"}
      </p>
      {works.length > 0 && (
        <ul className="mt-4 space-y-6">
          {works.map((w) => (
            <WorkItem key={w.key || "none"} work={w} readOnly={readOnly} web={web} />
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3">
        <p className={NOTE}>
          A book on your Bookshelf counts as published automatically if it came out since you joined the community. Earlier books stay on your Bookshelf but are not counted here.{" "}
          <Link href="/bookshelf" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 underline underline-offset-2">
            Go to the Bookshelf
          </Link>
        </p>
        <UnlistedWork readOnly={readOnly} />
      </div>
    </section>
  );
}

/** The milestones section on a project's own page. */
export function ProjectMilestonesSection({ work, readOnly = false, web = { available: false, on: false } }: { work: Work; readOnly?: boolean; web?: MilestoneWebState }) {
  return (
    <section id="milestones" aria-labelledby="project-milestones-heading" className="mt-8 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5" data-testid="project-milestones-section">
      <h2 id="project-milestones-heading" className="text-lg font-medium text-slate-900 dark:text-slate-100">
        Milestones
      </h2>
      <p className="mt-1 mb-4 text-sm text-slate-600 dark:text-slate-400">
        {MILESTONES_INTRO}
        {readOnly && " (You are viewing as this member, so you can look but not change anything.)"}
      </p>
      <ProjectMilestones work={work} readOnly={readOnly} web={web} />
    </section>
  );
}
