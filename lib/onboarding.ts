/**
 * The "Getting started" tour: an ordered list of steps that walks a new member page to page,
 * spotlighting the control to use on each one. Shown by components/onboarding/OnboardingGuide,
 * for every member; state is loaded by lib/onboarding.server.ts.
 *
 * A step is done when the member's data shows it (`signals`), or when they marked it by hand
 * (confirmed or skipped it; stored in member_onboarding.marked_steps). Much of what an account
 * starts with comes over from Kajabi (name, bio, socials), so steps about that data ask the member
 * to check it rather than counting it as done.
 *
 * A step can have several stops on its page, spotlit one after another and each confirmed on its
 * own (marked as `<step>.<stop>`, e.g. `identity.basics`); the step is done once every stop is.
 *
 * Newcomers (joined in the last 90 days, lib/newcomer.ts) get one more step, "intro": introduce
 * yourself in the Slack intro channel, done once they've posted there. It happens in Slack, so it
 * has an external link instead of a spotlight. Their "prickles" step is also stricter: it asks for
 * a prickle on the calendar until they've attended one. Reminders for both: lib/member-reminders.ts.
 *
 * Everyone is also walked through syncing their calendar app (the "calendar" step), done once a
 * calendar app has fetched their feed, or when they confirm it.
 *
 * A new member with a Big Sister (while the match is on their dashboard) gets a step to say hello to
 * her. There's no data to tell it's done, so they confirm it.
 *
 * Hosts get two more steps (most members never host, so nobody else sees them): their hosting
 * schedule on My Prickles → Hosting, and, once they've hosted recently enough to have prickle
 * types listed in Settings → Hosting, the vibe they run each type with.
 */

export const ONBOARDING_STEP_IDS = ["identity", "profile", "slack", "intro", "writing", "prickles", "calendar", "big-sister", "hosting", "host-vibe"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

/** What the member's own data says, gathered once per page load. */
export interface OnboardingSignals {
  /** Saved a bio or socials in the Hub, or added "Ask me about" topics: not just Kajabi's copy. */
  hasHubProfile: boolean;
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
  /** Joined within the newcomer window (lib/newcomer.ts). */
  isNewcomer: boolean;
  /** Deep link to the Slack intro channel; null when the workspace has no such channel (no intro step then). */
  introUrl: string | null;
  /** Has posted a top-level message in the intro channel. */
  hasIntroduced: boolean;
  /** Has attended at least one prickle. */
  hasAttendedPrickle: boolean;
  /** Has a prickle on their calendar from now on (hosting, a commitment, or added by hand). */
  hasUpcomingPrickle: boolean;
  /** A calendar app has fetched their feed link at least once (calendar_feed_tokens.first_fetched_at). */
  hasCalendarSynced: boolean;
  /** Their Big Sister's name while the match is current (lib/my-mentorship.ts), else null. */
  bigSisterName?: string | null;
  /** Whether the member can connect Slack in Settings (the panel is shown); absent/null means no step. */
  slackConnect?: { connected: boolean } | null;
}

export interface OnboardingStepView {
  id: OnboardingStepId;
  title: string;
  /** One line for the checklist. */
  summary: string;
  /** Page the step happens on (pathname + optional query). */
  href: string;
  /** `data-tour` value of the element to spotlight on that page (the current stop's, if it has stops). */
  target: string;
  /** Heading on the spotlight's callout. */
  calloutTitle: string;
  /** Text on the spotlight's callout. */
  hint: string;
  /** A step that happens outside the Hub (Slack): where it opens, in a new tab. It has no spotlight. */
  externalHref?: string;
  /** Label for the callout's "this is done" button, for steps the member confirms by hand. */
  confirmLabel?: string;
  /** What confirming or skipping marks: the step id, or `<step>.<stop>` for the current stop. */
  markKey: string;
  /** Position of the current stop, for a step with several. */
  stop?: { number: number; count: number };
  /** Every spot the step points at, in order, for walking a finished step again from the checklist. */
  revisitStops: OnboardingRevisitStop[];
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
  /** Every step and stop key the member has been through or was shown when they finished; null for none. */
  acknowledged_steps?: string[] | null;
}

export interface OnboardingRevisitStop {
  target: string;
  calloutTitle: string;
  hint: string;
}

interface OnboardingStop {
  id: string;
  target: string;
  title: string;
  hint: string;
  confirmLabel: string;
}

/** Checked one at a time on Settings → Identity, top to bottom. */
const IDENTITY_STOPS: OnboardingStop[] = [
  {
    id: "basics",
    target: "identity-basics",
    title: "Your Real Name",
    hint: "This is your Real Name, the one on your account and records. Is it right? Other members may see a different name, which you choose next.",
    confirmLabel: "Looks right",
  },
  {
    id: "display-name",
    target: "identity-display-name",
    title: "Your Display Name",
    hint: "This is the name other members see everywhere, and it can differ from your Real Name. Pick your Real Name, a pen name, or write your own.",
    confirmLabel: "My display name looks right",
  },
  {
    id: "names",
    target: "identity-names",
    title: "Pen names and Zoom/Slack names",
    hint: "We match Zoom and Slack to you by name. If you ever join as something other than your Real Name, like a pen name or a nickname, add it here.",
    confirmLabel: "My names look right",
  },
  {
    id: "emails",
    target: "identity-emails",
    title: "Other email addresses",
    hint: "Used another email with us, like an old Kajabi or Slack one? Add it here so it all counts as you.",
    confirmLabel: "My emails look right",
  },
  {
    id: "birthday",
    target: "identity-birthday",
    title: "Your birthday",
    hint: "Add your birthday, just the month and day, so we can celebrate you!",
    confirmLabel: "Skip",
  },
];

/** Every step id and stop key: what completing the tour records as seen, so later additions stand out. */
export function allOnboardingKeys(): string[] {
  return [...ONBOARDING_STEP_IDS, ...IDENTITY_STOPS.map((stop) => `identity.${stop.id}`)];
}

/**
 * Step ids that were added after a finished tour: the step, or one of its stops, isn't in the
 * snapshot taken at completion. Empty unless the tour was completed (not dismissed) with a snapshot.
 */
export function unseenStepIds(record: OnboardingRecord | null): OnboardingStepId[] {
  if (!record?.completed_at || record.dismissed_at || !record.acknowledged_steps) return [];
  const seen = new Set(record.acknowledged_steps);
  return ONBOARDING_STEP_IDS.filter((id) => {
    const keys = id === "identity" ? [id, ...IDENTITY_STOPS.map((s) => `identity.${s.id}`)] : [id];
    return keys.some((key) => !seen.has(key));
  });
}

export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return typeof value === "string" && (ONBOARDING_STEP_IDS as readonly string[]).includes(value);
}

/** A step id, or `<step>.<stop>` for one of a step's stops: what member_onboarding.marked_steps holds. */
export function isOnboardingMarkKey(value: unknown): value is string {
  if (isOnboardingStepId(value)) return true;
  return typeof value === "string" && IDENTITY_STOPS.some((stop) => value === `identity.${stop.id}`);
}

/** A step's view fields for its first unconfirmed stop (or its last, once all are confirmed). */
function stopFields(stepId: OnboardingStepId, stops: OnboardingStop[], marked: Set<string>) {
  const firstOpen = stops.findIndex((stop) => !marked.has(`${stepId}.${stop.id}`));
  const index = firstOpen === -1 ? stops.length - 1 : firstOpen;
  const stop = stops[index];
  return {
    target: stop.target,
    calloutTitle: stop.title,
    hint: stop.hint,
    confirmLabel: stop.confirmLabel,
    markKey: `${stepId}.${stop.id}`,
    stop: { number: index + 1, count: stops.length },
    done: firstOpen === -1,
  };
}

type StepWithoutRevisit = Omit<OnboardingStepView, "revisitStops">;

/** All of a step's stops (identity's three), or just the one spot a single-stop step points at. */
function withRevisitStops(step: StepWithoutRevisit): OnboardingStepView {
  const revisitStops =
    step.id === "identity"
      ? IDENTITY_STOPS.map((stop) => ({ target: stop.target, calloutTitle: stop.title, hint: stop.hint }))
      : [{ target: step.target, calloutTitle: step.calloutTitle, hint: step.hint }];
  return { ...step, revisitStops };
}

/**
 * Everyone adds a prickle to their plans. A newcomer who hasn't attended one yet needs a prickle
 * coming up on their calendar, so a missed first prickle puts the step back until they pick another.
 */
function pricklesStep(signals: OnboardingSignals, marked: Set<string>): StepWithoutRevisit {
  const firstPrickle = signals.isNewcomer && !signals.hasAttendedPrickle;
  return {
    id: "prickles",
    title: firstPrickle ? "Schedule your first prickle" : "Join a prickle",
    summary: firstPrickle
      ? "Pick a prickle for your first writing session and add it to your calendar."
      : "Pick a prickle that fits your week and add it to your calendar.",
    href: "/my-prickles",
    target: "add-to-calendar",
    calloutTitle: firstPrickle ? "Schedule your first prickle" : "Join a prickle",
    hint: "Tap this calendar icon beside a prickle to add it, just that one or every week. Nothing fits? Find a Prickle suggests ones for your schedule.",
    markKey: "prickles",
    done: marked.has("prickles") || (signals.isNewcomer
      ? signals.hasAttendedPrickle || signals.hasUpcomingPrickle
      : signals.hasPricklePlan),
  };
}

function stepViews(signals: OnboardingSignals, marked: Set<string>): StepWithoutRevisit[] {
  const { latestProjectId } = signals;
  const steps: StepWithoutRevisit[] = [
    {
      id: "identity",
      title: "Check your details",
      summary: "Your name, email, and birthday.",
      href: "/settings/identity",
      ...stopFields("identity", IDENTITY_STOPS, marked),
    },
    {
      id: "profile",
      title: "Introduce yourself",
      summary: "Check your bio and add what people can ask you about.",
      href: "/settings/profile",
      target: "profile-bio",
      calloutTitle: "Introduce yourself",
      hint: "Other members see this on your profile and in the directory. If it came over from Kajabi, check it still sounds like you. A sentence or two about what you write is plenty.",
      // A bio carried over from Kajabi isn't one they've looked at here, so it doesn't count alone.
      confirmLabel: "My profile looks right",
      markKey: "profile",
      done: signals.hasHubProfile || marked.has("profile"),
    },
    ...(signals.slackConnect
      ? [
          {
        id: "slack" as const,
        title: "Connect Slack",
        summary: "Connect your Slack account.",
        href: "/settings",
        target: "slack-connect",
        calloutTitle: "Connect Slack",
        hint: "Connect once and Open Hedgie Hub in Slack signs you straight in, and chat posts as you.",
        confirmLabel: "I'll skip this",
        markKey: "slack",
        done: signals.slackConnect.connected || marked.has("slack"),
          },
        ]
      : []),
    ...(signals.isNewcomer && signals.introUrl
      ? [
          {
            id: "intro" as const,
            title: "Say hello in Slack",
            summary: "Post a few lines about what you write in #start-here, so other Hedgies can say hi.",
            href: signals.introUrl,
            externalHref: signals.introUrl,
            target: "",
            calloutTitle: "Say hello in Slack",
            hint: "A few lines about what you write and what you're working on is plenty.",
            // Nothing in our data shows a post from someone whose Slack account we couldn't match.
            confirmLabel: "I've introduced myself",
            markKey: "intro",
            done: signals.hasIntroduced || marked.has("intro"),
          },
        ]
      : []),
    {
      id: "writing",
      title: "Set a writing goal",
      summary: "Add a project and give it a goal to work toward.",
      href: latestProjectId ? `/projects/${latestProjectId}` : "/projects",
      target: latestProjectId ? "add-goal" : "new-project",
      // The spotlight is on "New project" until they have one, so the callout is about that.
      calloutTitle: latestProjectId ? "Set a writing goal" : "Add a project",
      hint: latestProjectId
        ? "Pick a Target (a total to reach, like 50,000 words, optionally by a date) or a Habit (a rhythm to keep, like writing three days a week). New goals are pinned to your dashboard."
        : "Start with whatever you're working on now. Next you'll give it a goal.",
      markKey: "writing",
      done: signals.hasGoal || marked.has("writing"),
    },
    pricklesStep(signals, marked),
    {
      id: "calendar",
      title: "Sync your calendar",
      summary: "Subscribe your calendar app so your prickles show up there too.",
      href: "/my-prickles/commitments",
      target: "calendar-sync",
      calloutTitle: "Sync your calendar",
      hint: "Subscribe in Google, Apple or Outlook and the prickles you add, commit to or host appear in your own calendar, reminders and all. Pick your calendar app below; there are steps if you get stuck. This ticks itself off once your calendar app picks it up.",
      // Done once a calendar app has fetched the feed. The button is for a feed we can't see
      // (they set it up some other way) or one that's slow to be fetched (Google can take hours).
      confirmLabel: "My calendar is set up",
      markKey: "calendar",
      done: signals.hasCalendarSynced || marked.has("calendar"),
    },
  ];
  if (signals.bigSisterName) {
    steps.push({
      id: "big-sister",
      title: "Say hi to your Big Sister",
      summary: `Say hello to ${signals.bigSisterName}, who's here to show you around.`,
      href: "/big-sisters",
      target: "big-sister-card",
      calloutTitle: "Meet your Big Sister",
      hint: "A Big Sister is a member who helps new members find their feet. Send a quick hello on Slack, or ask what a good first prickle would be.",
      confirmLabel: "I said hi",
      markKey: "big-sister",
      done: marked.has("big-sister"),
    });
  }
  if (!signals.isHost) return steps;

  steps.push({
    id: "hosting",
    title: "Set up your hosting",
    summary: "Check the slots you'll host this month and next.",
    href: "/my-prickles/hosting",
    target: "hosting-schedule",
    calloutTitle: "Set up your hosting",
    hint: "These are the prickles you host. Request a slot for a month you'd like to host, or change one that's moved. An admin confirms requests.",
    markKey: "hosting",
    done: signals.hasHostingSchedule || marked.has("hosting"),
  });
  if (signals.hostedRecently) {
    steps.push({
      id: "host-vibe",
      title: "Set your hosting vibe",
      summary: "Say how you run each prickle you host: focused, balanced or chatty.",
      href: "/settings/hosting",
      target: "host-vibe",
      calloutTitle: "Set your hosting vibe",
      hint: "The Prickle Picker uses this to match members with prickles that suit them. Add a note about how you run it if you like.",
      // Each type shows "balanced" until saved, so a host happy with that has nothing to save.
      confirmLabel: "My vibe looks right",
      markKey: "host-vibe",
      done: signals.hasHostVibe || marked.has("host-vibe"),
    });
  }
  return steps;
}

export function buildOnboardingState(signals: OnboardingSignals, record: OnboardingRecord | null): OnboardingState {
  const allSteps = stepViews(signals, new Set(record?.marked_steps ?? [])).map(withRevisitStops);
  // A finished tour reopens for steps added since, and shows only those.
  const unseen = new Set<string>(unseenStepIds(record));
  const reopened = unseen.size > 0 && allSteps.some((s) => unseen.has(s.id) && !s.done);
  const steps = reopened ? allSteps.filter((s) => unseen.has(s.id)) : allSteps;
  const current = steps.find((s) => !s.done) ?? null;
  const completed = current === null;

  // Everyone gets the tour until they dismiss or finish it: no row means they've never touched it,
  // however long ago their account was made (Kajabi members have years of history, but are new to
  // the Hub). A finished tour stays closed even if a step later reads as undone (say they delete
  // their only goal); they can restart it from the menu. When every step is done but completed_at
  // isn't set yet, the guide stays up to say "all set".
  const active = (!record?.dismissed_at && !record?.completed_at) || reopened;

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
