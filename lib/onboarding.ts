/**
 * The "Getting started" tour: an ordered list of steps that walks a new member page to page,
 * spotlighting the control to use on each one. Shown by components/onboarding/OnboardingGuide,
 * behind the `onboarding` feature flag; state is loaded by lib/onboarding.server.ts.
 *
 * A step is done when the member's data shows it (`signals`), or when they marked it by hand
 * (confirmed or skipped it; stored in member_onboarding.marked_steps). Identity has no data
 * signal: the names are usually already on file from Kajabi, so the step asks them to check.
 *
 * Hosts get two more steps (most members never host, so nobody else sees them): their hosting
 * schedule on My Prickles → Hosting, and, once they've hosted recently enough to have prickle
 * types listed in Settings → Hosting, the vibe they run each type with.
 */

export const ONBOARDING_STEP_IDS = ["identity", "profile", "writing", "prickles", "hosting", "host-vibe"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/** Accounts younger than this get the tour on their own; older ones start it from the user menu. */
export const ONBOARDING_AUTO_START_DAYS = 30;

/** What the member's own data says, gathered once per page load. */
export interface OnboardingSignals {
  hasProfile: boolean;
  /** Most recent unarchived project, so the writing step can point at its "Add a goal" button. */
  latestProjectId: string | null;
  hasGoal: boolean;
  /** An active prickle commitment, or a prickle added to their calendar feed. */
  hasPricklePlan: boolean;
  /** Has hosted a prickle, or has a hosting schedule (requested or admin-assigned) on file. */
  isHost: boolean;
  /** A hosting schedule row for this month or next, so their slots are on file. */
  hasHostingSchedule: boolean;
  /** Hosted within PICKER_HISTORY_MONTHS, which is when Settings → Hosting lists their prickle types. */
  hostedRecently: boolean;
  /** Saved a vibe for at least one prickle type they host. */
  hasHostVibe: boolean;
}

export interface OnboardingStepView {
  id: OnboardingStepId;
  title: string;
  /** One line for the checklist. */
  summary: string;
  /** Page the step happens on (pathname + optional query). */
  href: string;
  /** `data-tour` value of the element to spotlight on that page. */
  target: string;
  /** Text on the spotlight's callout. */
  hint: string;
  /** Label for the callout's "this is done" button, for steps the member confirms by hand. */
  confirmLabel?: string;
  done: boolean;
}

export interface OnboardingState {
  steps: OnboardingStepView[];
  /** First step not done, or null when every step is done. */
  currentStepId: OnboardingStepId | null;
  /** Whether the guide shows at all (not dismissed, and auto-started or started by hand). */
  active: boolean;
  completed: boolean;
}

export interface OnboardingRecord {
  marked_steps: string[];
  dismissed_at: string | null;
  completed_at: string | null;
}

export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && (ONBOARDING_STEP_IDS as readonly string[]).includes(value);
}

function stepViews(signals: OnboardingSignals, marked: Set<string>): OnboardingStepView[] {
  const { latestProjectId } = signals;
  const steps: OnboardingStepView[] = [
    {
      id: "identity",
      title: "Check your names",
      summary: "Add any pen name or Zoom/Slack name, so your prickles count toward you.",
      href: "/settings?tab=identity",
      target: "identity-names",
      hint: "We match Zoom and Slack to you by name. If you ever join as something other than your real name, like a pen name or a nickname, add it here.",
      confirmLabel: "My names look right",
      done: marked.has("identity"),
    },
    {
      id: "profile",
      title: "Introduce yourself",
      summary: "Write a short bio and what people can ask you about.",
      href: "/settings?tab=profile",
      target: "profile-bio",
      hint: "Other members see this on your profile and in the directory. A sentence or two about what you write is plenty.",
      done: signals.hasProfile || marked.has("profile"),
    },
    {
      id: "writing",
      title: "Set a writing goal",
      summary: "Add a project and give it a goal to work toward.",
      href: latestProjectId ? `/projects/${latestProjectId}` : "/projects",
      target: latestProjectId ? "add-goal" : "new-project",
      hint: latestProjectId
        ? "Give this project a goal, like a word count or a habit such as writing three days a week. Star it to see it on your dashboard."
        : "Start with whatever you're working on now. Next you'll give it a goal.",
      done: signals.hasGoal || marked.has("writing"),
    },
    {
      id: "prickles",
      title: "Join a prickle",
      summary: "Find a prickle that fits your week and commit to it.",
      href: "/my-prickles?tab=find",
      target: "find-prickle",
      hint: "Answer a few questions to find prickles that fit your schedule, then commit to one. You can add it to your own calendar from there too.",
      done: signals.hasPricklePlan || marked.has("prickles"),
    },
  ];
  if (!signals.isHost) return steps;

  steps.push({
    id: "hosting",
    title: "Set up your hosting",
    summary: "Check the slots you'll host this month and next.",
    href: "/my-prickles?tab=hosting",
    target: "hosting-schedule",
    hint: "These are the prickles you host. Request a slot for a month you'd like to host, or change one that's moved. An admin confirms requests.",
    done: signals.hasHostingSchedule || marked.has("hosting"),
  });
  if (signals.hostedRecently) {
    steps.push({
      id: "host-vibe",
      title: "Set your hosting vibe",
      summary: "Say how you run each prickle you host: focused, balanced or chatty.",
      href: "/settings?tab=hosting",
      target: "host-vibe",
      hint: "The Prickle Picker uses this to match members with prickles that suit them. Add a note about how you run it if you like.",
      // Each type shows "balanced" until saved, so a host happy with that has nothing to save.
      confirmLabel: "My vibe looks right",
      done: signals.hasHostVibe || marked.has("host-vibe"),
    });
  }
  return steps;
}

export function buildOnboardingState(
  signals: OnboardingSignals,
  record: OnboardingRecord | null,
  accountCreatedAt: Date | null,
  now: Date
): OnboardingState {
  const steps = stepViews(signals, new Set(record?.marked_steps ?? []));
  const current = steps.find((s) => !s.done) ?? null;
  const completed = current === null;

  const isNewAccount =
    accountCreatedAt !== null &&
    now.getTime() - accountCreatedAt.getTime() < ONBOARDING_AUTO_START_DAYS * 24 * 60 * 60 * 1000;
  // A row means the member has touched the tour (started it from the menu, or marked a step);
  // without one, only a new account gets it. A finished tour stays closed even if a step later
  // reads as undone (say they delete their only goal); they can restart it from the menu. When
  // every step is done but completed_at isn't set yet, the guide stays up to say "all set".
  const started = record !== null || isNewAccount;
  const active = started && !record?.dismissed_at && !record?.completed_at;

  return { steps, currentStepId: current?.id ?? null, active, completed };
}

/**
 * Whether `pathname` + `search` is the page a step happens on. Matches the path exactly, and any
 * query params the step's href names (e.g. `?tab=identity`), ignoring other params.
 */
export function isOnStepPage(step: Pick<OnboardingStepView, "href">, pathname: string, search: string): boolean {
  const [stepPath, stepQuery = ""] = step.href.split("?");
  if (pathname !== stepPath) return false;
  const want = new URLSearchParams(stepQuery);
  const have = new URLSearchParams(search);
  for (const [key, value] of want) {
    if (have.get(key) !== value) return false;
  }
  return true;
}
