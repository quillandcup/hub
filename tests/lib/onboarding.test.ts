import { describe, it, expect } from "vitest";
import {
  buildOnboardingState,
  isOnStepPage,
  type OnboardingRecord,
  type OnboardingSignals,
} from "@/lib/onboarding";

const NOW = new Date("2026-10-03T12:00:00Z");

const NOT_NEWCOMER = { isNewcomer: false, introUrl: null, hasIntroduced: false, hasAttendedPrickle: false, hasUpcomingPrickle: false };
const NOT_HOST = { isHost: false, hasHostingSchedule: false, hostedRecently: false, hasHostVibe: false, isNewcomer: false, introUrl: null, hasIntroduced: false, hasAttendedPrickle: false, hasUpcomingPrickle: false };
const IDENTITY_DONE = ["identity.basics", "identity.names", "identity.emails"];
const NOTHING: OnboardingSignals = { hasHubProfile: false, latestProjectId: null, hasGoal: false, hasPricklePlan: false, ...NOT_HOST };
const record = (r: Partial<OnboardingRecord> = {}): OnboardingRecord => ({
  marked_steps: [],
  dismissed_at: null,
  completed_at: null,
  ...r,
});

describe("buildOnboardingState", () => {
  it("lists the steps in order and starts at identity", () => {
    const state = buildOnboardingState(NOTHING, null);
    expect(state.steps.map((s) => s.id)).toEqual(["identity", "profile", "writing", "prickles"]);
    expect(state.currentStepId).toBe("identity");
    expect(state.completed).toBe(false);
  });

  it("starts on its own for anyone who has never touched it, whatever their account age", () => {
    expect(buildOnboardingState(NOTHING, null).active).toBe(true);
  });

  it("stays active once started from the menu or a step is marked (a row exists)", () => {
    expect(buildOnboardingState(NOTHING, record()).active).toBe(true);
  });

  it("stays closed once dismissed or completed", () => {
    expect(buildOnboardingState(NOTHING, record({ dismissed_at: NOW.toISOString() })).active).toBe(false);
    expect(buildOnboardingState(NOTHING, record({ completed_at: NOW.toISOString() })).active).toBe(false);
  });

  it("counts steps done from data or from a hand mark, and moves to the first undone one", () => {
    const state = buildOnboardingState(
      { ...NOTHING, hasHubProfile: true },
      record({ marked_steps: IDENTITY_DONE })
    );
    expect(state.steps.filter((s) => s.done).map((s) => s.id)).toEqual(["identity", "profile"]);
    expect(state.currentStepId).toBe("writing");
  });

  it("only a hand mark finishes identity: names on file don't show they were checked", () => {
    const state = buildOnboardingState({ ...NOTHING, hasHubProfile: true, hasGoal: true, hasPricklePlan: true, ...NOT_HOST }, null);
    expect(state.currentStepId).toBe("identity");
    expect(state.steps[0].confirmLabel).toBeTruthy();
  });

  it("walks identity's stops in order: name and birthday, pen names, then emails", () => {
    const identityWith = (marked: string[]) =>
      buildOnboardingState(NOTHING, record({ marked_steps: marked })).steps[0];

    expect(identityWith([])).toMatchObject({
      target: "identity-basics",
      markKey: "identity.basics",
      stop: { number: 1, count: 3 },
      done: false,
    });
    expect(identityWith(["identity.basics"])).toMatchObject({
      target: "identity-names",
      markKey: "identity.names",
      stop: { number: 2, count: 3 },
      done: false,
    });
    expect(identityWith(["identity.basics", "identity.names"])).toMatchObject({
      target: "identity-emails",
      markKey: "identity.emails",
      stop: { number: 3, count: 3 },
      done: false,
    });
    expect(identityWith(IDENTITY_DONE).done).toBe(true);
  });

  it("doesn't count a bio carried over from Kajabi: the profile step asks them to check it", () => {
    const profile = buildOnboardingState(NOTHING, null).steps.find((s) => s.id === "profile")!;
    expect(profile).toMatchObject({ done: false, confirmLabel: "My profile looks right", markKey: "profile" });

    const confirmed = buildOnboardingState(NOTHING, record({ marked_steps: ["profile"] }));
    expect(confirmed.steps.find((s) => s.id === "profile")!.done).toBe(true);
  });

  it("points the writing step at New project, then at the latest project's Add a goal", () => {
    const noProject = buildOnboardingState(NOTHING, null).steps.find((s) => s.id === "writing")!;
    expect(noProject).toMatchObject({ href: "/projects", target: "new-project" });

    const withProject = buildOnboardingState({ ...NOTHING, latestProjectId: "p1" }, null).steps.find(
      (s) => s.id === "writing"
    )!;
    expect(withProject).toMatchObject({ href: "/projects/p1", target: "add-goal", done: false });
  });

  it("is completed and still active (to say all set) when every step is done but not yet finished", () => {
    const state = buildOnboardingState(
      { hasHubProfile: true, latestProjectId: "p1", hasGoal: true, hasPricklePlan: true, ...NOT_HOST },
      record({ marked_steps: IDENTITY_DONE })
    );
    expect(state).toMatchObject({ completed: true, currentStepId: null, active: true });
  });
});

describe("hosting steps", () => {
  const ids = (signals: OnboardingSignals) => buildOnboardingState(signals, null).steps.map((s) => s.id);

  it("only hosts get them", () => {
    expect(ids(NOTHING)).not.toContain("hosting");
    expect(ids({ ...NOTHING, isHost: true })).toEqual(["identity", "profile", "writing", "prickles", "hosting"]);
  });

  it("adds the vibe step once they've hosted recently enough for Settings → Hosting to list their prickles", () => {
    expect(ids({ ...NOTHING, isHost: true, hostedRecently: true })).toEqual([
      "identity",
      "profile",
      "writing",
      "prickles",
      "hosting",
      "host-vibe",
    ]);
  });

  it("points at the hosting schedule, then the vibe panel, each done from its own data", () => {
    const host = { ...NOTHING, isHost: true, hostedRecently: true };
    const steps = buildOnboardingState(host, null).steps;
    expect(steps.find((s) => s.id === "hosting")).toMatchObject({
      href: "/my-prickles/hosting",
      target: "hosting-schedule",
      done: false,
    });
    expect(steps.find((s) => s.id === "host-vibe")).toMatchObject({
      href: "/settings/hosting",
      target: "host-vibe",
      done: false,
    });

    const done = buildOnboardingState({ ...host, hasHostingSchedule: true, hasHostVibe: true }, null).steps;
    expect(done.filter((s) => s.id.startsWith("host")).every((s) => s.done)).toBe(true);
  });

  it("a host isn't finished until the hosting steps are done", () => {
    const allButHosting = {
      hasHubProfile: true,
      latestProjectId: "p1",
      hasGoal: true,
      hasPricklePlan: true,
      isHost: true,
      hasHostingSchedule: false,
      hostedRecently: false,
      hasHostVibe: false,
      ...NOT_NEWCOMER,
    };
    const state = buildOnboardingState(allButHosting, record({ marked_steps: IDENTITY_DONE }));
    expect(state).toMatchObject({ completed: false, currentStepId: "hosting" });
  });
});

describe("isOnStepPage", () => {
  const step = { href: "/settings?tab=identity" };

  it("matches the path and the step's query params, ignoring others", () => {
    expect(isOnStepPage(step, "/settings", "tab=identity")).toBe(true);
    expect(isOnStepPage(step, "/settings", "tab=identity&x=1")).toBe(true);
  });

  it("doesn't match another tab or page", () => {
    expect(isOnStepPage(step, "/settings", "tab=profile")).toBe(false);
    expect(isOnStepPage(step, "/settings", "")).toBe(false);
    expect(isOnStepPage(step, "/settings/other", "tab=identity")).toBe(false);
  });

  it("matches a step without a query on its path alone", () => {
    expect(isOnStepPage({ href: "/projects/p1" }, "/projects/p1", "tab=x")).toBe(true);
    expect(isOnStepPage({ href: "/projects" }, "/projects/p1", "")).toBe(false);
  });
});

describe("newcomer steps", () => {
  const INTRO_URL = "https://slack.example/app_redirect?channel=C1";
  const newcomer = { ...NOTHING, isNewcomer: true, introUrl: INTRO_URL };
  const view = (signals: OnboardingSignals, id: string, rec: OnboardingRecord | null = null) =>
    buildOnboardingState(signals, rec).steps.find((s) => s.id === id);

  it("adds an external intro step after the profile step, only for newcomers", () => {
    expect(buildOnboardingState(newcomer, null).steps.map((s) => s.id)).toEqual([
      "identity",
      "profile",
      "intro",
      "writing",
      "prickles",
    ]);
    expect(view(newcomer, "intro")).toMatchObject({ externalHref: INTRO_URL, done: false });
    expect(view({ ...NOTHING, introUrl: INTRO_URL }, "intro")).toBeUndefined();
  });

  it("leaves the intro step out when the workspace has no intro channel", () => {
    expect(view({ ...newcomer, introUrl: null }, "intro")).toBeUndefined();
  });

  it("counts the intro step done once they've posted, or confirmed it by hand", () => {
    expect(view({ ...newcomer, hasIntroduced: true }, "intro")?.done).toBe(true);
    expect(view(newcomer, "intro", record({ marked_steps: ["intro"] }))?.done).toBe(true);
  });

  it("asks a newcomer who hasn't attended for a prickle on the calendar, not just a plan", () => {
    expect(view(newcomer, "prickles")).toMatchObject({ title: "Schedule your first prickle", done: false });
    expect(view({ ...newcomer, hasPricklePlan: true }, "prickles")?.done).toBe(false);
    expect(view({ ...newcomer, hasUpcomingPrickle: true }, "prickles")?.done).toBe(true);
  });

  it("counts attending as done for a newcomer, and puts a missed first prickle back", () => {
    expect(view({ ...newcomer, hasAttendedPrickle: true }, "prickles")).toMatchObject({
      title: "Join a prickle",
      done: true,
    });
    const scheduled = { ...newcomer, hasPricklePlan: true, hasUpcomingPrickle: true };
    expect(view(scheduled, "prickles")?.done).toBe(true);
    expect(view({ ...scheduled, hasUpcomingPrickle: false }, "prickles")?.done).toBe(false);
  });

  it("keeps the old rule for members past their first 90 days", () => {
    expect(view({ ...NOTHING, hasPricklePlan: true }, "prickles")).toMatchObject({ title: "Join a prickle", done: true });
  });
});
