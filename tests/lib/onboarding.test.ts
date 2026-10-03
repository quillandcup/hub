import { describe, it, expect } from "vitest";
import {
  buildOnboardingState,
  isOnStepPage,
  ONBOARDING_AUTO_START_DAYS,
  type OnboardingRecord,
  type OnboardingSignals,
} from "@/lib/onboarding";

const NOW = new Date("2026-10-03T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const NEW_ACCOUNT = new Date(NOW.getTime() - 2 * DAY);
const OLD_ACCOUNT = new Date(NOW.getTime() - (ONBOARDING_AUTO_START_DAYS + 1) * DAY);

const NOT_HOST = { isHost: false, hasHostingSchedule: false, hostedRecently: false, hasHostVibe: false };
const NOTHING: OnboardingSignals = { hasProfile: false, latestProjectId: null, hasGoal: false, hasPricklePlan: false, ...NOT_HOST };
const record = (r: Partial<OnboardingRecord> = {}): OnboardingRecord => ({
  marked_steps: [],
  dismissed_at: null,
  completed_at: null,
  ...r,
});

describe("buildOnboardingState", () => {
  it("lists the steps in order and starts at identity", () => {
    const state = buildOnboardingState(NOTHING, null, NEW_ACCOUNT, NOW);
    expect(state.steps.map((s) => s.id)).toEqual(["identity", "profile", "writing", "prickles"]);
    expect(state.currentStepId).toBe("identity");
    expect(state.completed).toBe(false);
  });

  it("starts on its own for a new account, not for an older one without a row", () => {
    expect(buildOnboardingState(NOTHING, null, NEW_ACCOUNT, NOW).active).toBe(true);
    expect(buildOnboardingState(NOTHING, null, OLD_ACCOUNT, NOW).active).toBe(false);
    expect(buildOnboardingState(NOTHING, null, null, NOW).active).toBe(false);
  });

  it("is active for an older account once started from the menu (a row exists)", () => {
    expect(buildOnboardingState(NOTHING, record(), OLD_ACCOUNT, NOW).active).toBe(true);
  });

  it("stays closed once dismissed or completed", () => {
    expect(buildOnboardingState(NOTHING, record({ dismissed_at: NOW.toISOString() }), NEW_ACCOUNT, NOW).active).toBe(false);
    expect(buildOnboardingState(NOTHING, record({ completed_at: NOW.toISOString() }), NEW_ACCOUNT, NOW).active).toBe(false);
  });

  it("counts steps done from data or from a hand mark, and moves to the first undone one", () => {
    const state = buildOnboardingState(
      { ...NOTHING, hasProfile: true },
      record({ marked_steps: ["identity"] }),
      NEW_ACCOUNT,
      NOW
    );
    expect(state.steps.filter((s) => s.done).map((s) => s.id)).toEqual(["identity", "profile"]);
    expect(state.currentStepId).toBe("writing");
  });

  it("only a hand mark finishes identity: names on file don't show they were checked", () => {
    const state = buildOnboardingState({ ...NOTHING, hasProfile: true, hasGoal: true, hasPricklePlan: true, ...NOT_HOST }, null, NEW_ACCOUNT, NOW);
    expect(state.currentStepId).toBe("identity");
    expect(state.steps[0].confirmLabel).toBeTruthy();
  });

  it("points the writing step at New project, then at the latest project's Add a goal", () => {
    const noProject = buildOnboardingState(NOTHING, null, NEW_ACCOUNT, NOW).steps.find((s) => s.id === "writing")!;
    expect(noProject).toMatchObject({ href: "/projects", target: "new-project" });

    const withProject = buildOnboardingState({ ...NOTHING, latestProjectId: "p1" }, null, NEW_ACCOUNT, NOW).steps.find(
      (s) => s.id === "writing"
    )!;
    expect(withProject).toMatchObject({ href: "/projects/p1", target: "add-goal", done: false });
  });

  it("is completed and still active (to say all set) when every step is done but not yet finished", () => {
    const state = buildOnboardingState(
      { hasProfile: true, latestProjectId: "p1", hasGoal: true, hasPricklePlan: true, ...NOT_HOST },
      record({ marked_steps: ["identity"] }),
      OLD_ACCOUNT,
      NOW
    );
    expect(state).toMatchObject({ completed: true, currentStepId: null, active: true });
  });
});

describe("hosting steps", () => {
  const ids = (signals: OnboardingSignals) => buildOnboardingState(signals, null, NEW_ACCOUNT, NOW).steps.map((s) => s.id);

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
    const steps = buildOnboardingState(host, null, NEW_ACCOUNT, NOW).steps;
    expect(steps.find((s) => s.id === "hosting")).toMatchObject({
      href: "/my-prickles?tab=hosting",
      target: "hosting-schedule",
      done: false,
    });
    expect(steps.find((s) => s.id === "host-vibe")).toMatchObject({
      href: "/settings?tab=hosting",
      target: "host-vibe",
      done: false,
    });

    const done = buildOnboardingState({ ...host, hasHostingSchedule: true, hasHostVibe: true }, null, NEW_ACCOUNT, NOW).steps;
    expect(done.filter((s) => s.id.startsWith("host")).every((s) => s.done)).toBe(true);
  });

  it("a host isn't finished until the hosting steps are done", () => {
    const allButHosting = {
      hasProfile: true,
      latestProjectId: "p1",
      hasGoal: true,
      hasPricklePlan: true,
      isHost: true,
      hasHostingSchedule: false,
      hostedRecently: false,
      hasHostVibe: false,
    };
    const state = buildOnboardingState(allButHosting, record({ marked_steps: ["identity"] }), NEW_ACCOUNT, NOW);
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
