"use client";

import { useState, useTransition, type FormEvent } from "react";
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
import type { Milestone } from "@/lib/data/milestones";
import { useConfirm } from "@/components/ConfirmDialog";
import { addMilestone, answerMilestone, takeBackMilestone } from "./milestoneActions";

const INPUT = "w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm";
const PRIMARY = "px-4 py-2 bg-plum-600 text-white text-sm rounded-md hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed";
const SECONDARY = "px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50";
const NOTE = "mt-1 text-sm text-slate-600 dark:text-slate-400";

type FormResult = { success: true } | { error: string };
type FormInput = { achievedOn: string | null; storyBefore: string; storyAfter: string; consents: Consents; projectId: string | null };

/** A project the member can link a milestone to. */
export type MilestoneProject = { id: string; title: string };
/** A live book on the member's Bookshelf: the third milestone is derived from these. */
export type ShelfBookRef = { id: string; title: string };

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
 * changes a confirmed answer, or (with `projects`) adds a new milestone; `run` does the saving.
 */
function MilestoneForm({
  idPrefix,
  initial,
  projects,
  submitLabel,
  run,
  onDone,
  readOnly,
}: {
  idPrefix: string;
  initial: Milestone | null;
  projects?: MilestoneProject[];
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
  const [projectId, setProjectId] = useState("");
  // Every use starts unticked; a milestone already confirmed shows what the member chose.
  const [consents, setConsents] = useState<Consents>(initial?.status === "confirmed" ? consentsOf(initial) : NO_CONSENT);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await run({ achievedOn: date || null, storyBefore: before, storyAfter: after, consents, projectId: projectId || null });
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
      <div>
        <label htmlFor={`${idPrefix}-date`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          When did it happen? (optional)
        </label>
        <input id={`${idPrefix}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} sm:w-56`} />
      </div>
      {projects && projects.length > 0 && (
        <div>
          <label htmlFor={`${idPrefix}-project`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Which project was it? (optional)
          </label>
          <select id={`${idPrefix}-project`} value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${INPUT} sm:w-72`}>
            <option value="">Not linked to a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      )}
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

function MilestoneItem({ kind, milestone, projects, readOnly }: { kind: MilestoneKind; milestone: Milestone | undefined; projects: MilestoneProject[]; readOnly: boolean }) {
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

  const projectTitle = milestone?.projectId ? projects.find((p) => p.id === milestone.projectId)?.title : undefined;
  const chosen = milestone ? MILESTONE_CONSENTS.filter(({ key }) => consentsOf(milestone)[key]).map(({ label }) => label) : [];

  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 p-4" data-milestone={kind}>
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
          idPrefix={`ms-add-${kind}`}
          initial={null}
          projects={projects}
          submitLabel={MILESTONE_SELF_ADD[kind].confirmLabel}
          run={(i) => addMilestone({ kind, achievedOn: i.achievedOn, storyBefore: i.storyBefore, storyAfter: i.storyAfter, consents: i.consents, projectId: i.projectId })}
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
            Confirmed{milestone.achievedOn ? ` (${dayWords(milestone.achievedOn)})` : ""}
            {projectTitle ? `, for ${projectTitle}` : ""}.{" "}
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

/** The third milestone: nobody adds it, it is true when they have a book on the Bookshelf. */
function PublishedItem({ books }: { books: ShelfBookRef[] }) {
  return (
    <li className="rounded-md border border-slate-200 dark:border-slate-700 p-4" data-milestone="published">
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
        {PUBLISHED_CLAIM} <span className="text-slate-500 dark:text-slate-400">({PUBLISHED_TITLE})</span>
      </p>
      {books.length > 0 ? (
        <p className={NOTE}>
          Confirmed by your Bookshelf: {books.length === 1 ? books[0].title : `${books.length} books`}.{" "}
          <Link href="/bookshelf" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 underline underline-offset-2">
            See your Bookshelf
          </Link>
        </p>
      ) : (
        <p className={NOTE}>
          Not yet. This appears by itself when you have a published book on the Bookshelf.{" "}
          <Link href="/bookshelf" className="text-plum-600 hover:text-plum-700 dark:text-plum-400 underline underline-offset-2">
            Go to the Bookshelf
          </Link>
        </p>
      )}
    </li>
  );
}

/**
 * Settings > Profile: "Your milestones", always there. THE END and publish-ready are each a row the member can add
 * themselves, confirm (when staff suggested it) or take back; published comes from their Bookshelf and is read-only.
 * Nothing here is public: a milestone is only used where its box is ticked.
 */
export function MilestonesPanel({
  milestones,
  projects = [],
  books = [],
  readOnly = false,
}: {
  milestones: Milestone[];
  projects?: MilestoneProject[];
  books?: ShelfBookRef[];
  readOnly?: boolean;
}) {
  const waiting = milestones.some((m) => m.status === "proposed");
  return (
    <section aria-labelledby="your-milestones" className="border-t border-slate-200 dark:border-slate-700 pt-6 mt-6">
      <h2 id="your-milestones" className="text-lg font-medium text-slate-900 dark:text-slate-100">
        Your milestones
      </h2>
      <p className="mt-1 mb-4 text-sm text-slate-600 dark:text-slate-400">
        The steps on a writer&rsquo;s path: you wrote THE END, you made it publish-ready, you published. Only you can say you reached one, and nothing is
        shown to anyone until you choose where.
        {waiting && " We think you may have reached one already. Tell us if that’s right."}
        {readOnly && " (You are viewing as this member, so you can look but not change anything.)"}
      </p>
      <ul className="space-y-3">
        {MILESTONE_KINDS.map((kind) => (
          <MilestoneItem key={kind} kind={kind} milestone={milestones.find((m) => m.kind === kind)} projects={projects} readOnly={readOnly} />
        ))}
        <PublishedItem books={books} />
      </ul>
    </section>
  );
}
