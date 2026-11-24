import Link from "next/link";

/** A quiz lesson's tabs, as paths (`.claude/rules/tabbed-pages.md`): Details at the lesson's own address, the others beside it. */
export const QUIZ_TAB_LABELS = { details: "Details", questions: "Questions", settings: "Settings", results: "Results" } as const;
export type QuizTab = keyof typeof QUIZ_TAB_LABELS;
export const QUIZ_TABS = Object.keys(QUIZ_TAB_LABELS) as QuizTab[];

export function quizTabPath(base: string, tab: QuizTab): string {
  return tab === "details" ? base : `${base}/${tab}`;
}

/** The links between a quiz lesson's pages; the current one is marked for assistive technology as well as by style. */
export default function QuizLessonTabs({ base, current }: { base: string; current: QuizTab }) {
  return (
    <nav aria-label="Quiz sections" className="mb-6 border-b border-slate-200 dark:border-slate-700">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {QUIZ_TABS.map((tab) => (
          <li key={tab}>
            <Link
              href={quizTabPath(base, tab)}
              aria-current={tab === current ? "page" : undefined}
              className={`block whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
                tab === current ? "border-plum-600 text-plum-700 dark:text-plum-300" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {QUIZ_TAB_LABELS[tab]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
