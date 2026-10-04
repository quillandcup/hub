// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildOnboardingState, type OnboardingState } from "@/lib/onboarding";

const nav = vi.hoisted(() => ({ pathname: "/dashboard", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/app/actions/onboarding", () => ({
  getMyOnboardingState: vi.fn(),
  markOnboardingStep: vi.fn(),
  dismissOnboarding: vi.fn(),
  completeOnboarding: vi.fn(),
}));

import OnboardingGuide from "@/components/onboarding/OnboardingGuide";
import {
  completeOnboarding,
  dismissOnboarding,
  getMyOnboardingState,
  markOnboardingStep,
} from "@/app/actions/onboarding";

const NOW = new Date();
const NOT_HOST = { isHost: false, hasHostingSchedule: false, hostedRecently: false, hasHostVibe: false };
const IDENTITY_DONE = ["identity.basics", "identity.names", "identity.emails"];
const fresh = (): OnboardingState =>
  buildOnboardingState(
    { hasHubProfile: false, latestProjectId: null, hasGoal: false, hasPricklePlan: false, ...NOT_HOST },
    null,
    NOW,
    NOW
  );

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = "/dashboard";
  nav.search = "";
  document.body.innerHTML = "";
});

describe("OnboardingGuide", () => {
  it("lists the steps and links the current one to its page", async () => {
    vi.mocked(getMyOnboardingState).mockResolvedValue(fresh());
    render(<OnboardingGuide initialState={fresh()} />);

    expect(screen.getByRole("region", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.getByText("0 of 4 done ▾")).toBeInTheDocument();
    expect(screen.getByText("Check your details")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show me →" })).toHaveAttribute("href", "/settings/identity");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing when the tour isn't active", () => {
    const state = { ...fresh(), active: false };
    vi.mocked(getMyOnboardingState).mockResolvedValue(state);
    const { container } = render(<OnboardingGuide initialState={state} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("spotlights each stop on the step's page in turn, and the step is done after the last", async () => {
    nav.pathname = "/settings/identity";
    nav.search = "";
    for (const id of ["identity-basics", "identity-names", "identity-emails"]) {
      const target = document.createElement("div");
      target.setAttribute("data-tour", id);
      document.body.appendChild(target);
    }
    const withMarked = (marked: string[]) =>
      buildOnboardingState(
        { hasHubProfile: false, latestProjectId: null, hasGoal: false, hasPricklePlan: false, ...NOT_HOST },
        { marked_steps: marked, dismissed_at: null, completed_at: null },
        NOW,
        NOW
      );
    vi.mocked(getMyOnboardingState).mockResolvedValue(fresh());
    vi.mocked(markOnboardingStep).mockResolvedValue({ success: true });
    render(<OnboardingGuide initialState={fresh()} />);

    const first = await screen.findByRole("dialog", { name: "Your name and birthday" });
    expect(first).toHaveTextContent("Step 1 of 4 · 1 of 3");
    expect(first).toHaveTextContent(/celebrate you/);
    expect(screen.getByTestId("onboarding-highlight")).toBeInTheDocument();

    vi.mocked(getMyOnboardingState).mockResolvedValue(withMarked(["identity.basics"]));
    await userEvent.click(screen.getByRole("button", { name: "Looks right" }));
    expect(markOnboardingStep).toHaveBeenCalledWith("identity.basics");
    const second = await screen.findByRole("dialog", { name: "Pen names and Zoom/Slack names" });
    expect(second).toHaveTextContent("Step 1 of 4 · 2 of 3");

    vi.mocked(getMyOnboardingState).mockResolvedValue(withMarked(["identity.basics", "identity.names"]));
    await userEvent.click(screen.getByRole("button", { name: "My names look right" }));
    expect(markOnboardingStep).toHaveBeenCalledWith("identity.names");
    await screen.findByRole("dialog", { name: "Other email addresses" });

    vi.mocked(getMyOnboardingState).mockResolvedValue(withMarked(IDENTITY_DONE));
    await userEvent.click(screen.getByRole("button", { name: "My emails look right" }));
    expect(markOnboardingStep).toHaveBeenCalledWith("identity.emails");
    await waitFor(() => expect(screen.getByText(/1 of 4 done/)).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Hide closes the spotlight and offers Show me again", async () => {
    nav.pathname = "/settings/identity";
    nav.search = "";
    const target = document.createElement("div");
    target.setAttribute("data-tour", "identity-basics");
    document.body.appendChild(target);
    vi.mocked(getMyOnboardingState).mockResolvedValue(fresh());

    render(<OnboardingGuide initialState={fresh()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hide" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Show me →" }));
    expect(await screen.findByRole("dialog", { name: "Your name and birthday" })).toBeInTheDocument();
  });

  it("using the spotlit control works as normal and steps the spotlight aside", async () => {
    nav.pathname = "/projects";
    vi.mocked(getMyOnboardingState).mockResolvedValue({ ...fresh(), currentStepId: "writing" });
    const state = { ...fresh(), currentStepId: "writing" as const };

    function Page() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" data-tour="new-project" onClick={() => setOpen(true)}>
            New project
          </button>
          {open && <p>New project form</p>}
          <OnboardingGuide initialState={state} />
        </>
      );
    }
    render(<Page />);

    expect(await screen.findByRole("dialog", { name: "Set a writing goal" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(screen.getByText("New project form")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("folds the checklist to its header while a spotlight is up, and opens it on request", async () => {
    nav.pathname = "/settings/identity";
    nav.search = "";
    const target = document.createElement("div");
    target.setAttribute("data-tour", "identity-basics");
    document.body.appendChild(target);
    vi.mocked(getMyOnboardingState).mockResolvedValue(fresh());
    render(<OnboardingGuide initialState={fresh()} />);

    await screen.findByRole("dialog", { name: "Your name and birthday" });
    const header = screen.getByRole("button", { name: /Getting started/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Introduce yourself")).not.toBeInTheDocument();

    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Introduce yourself")).toBeInTheDocument();
  });

  it("starts folded on a phone-width screen", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      vi.mocked(getMyOnboardingState).mockResolvedValue(fresh());
      render(<OnboardingGuide initialState={fresh()} />);
      expect(screen.getByRole("button", { name: /Getting started/ })).toHaveAttribute("aria-expanded", "false");
      expect(matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("revisiting a finished step", () => {
    const identityDone = () =>
      buildOnboardingState(
        { hasHubProfile: false, latestProjectId: null, hasGoal: false, hasPricklePlan: false, ...NOT_HOST },
        { marked_steps: IDENTITY_DONE, dismissed_at: null, completed_at: null },
        NOW,
        NOW
      );
    const addTargets = () => {
      for (const id of ["identity-basics", "identity-names", "identity-emails"]) {
        const target = document.createElement("div");
        target.setAttribute("data-tour", id);
        document.body.appendChild(target);
      }
    };

    it("walks its stops again with Next and Done, without marking anything", async () => {
      vi.mocked(getMyOnboardingState).mockResolvedValue(identityDone());
      const { rerender } = render(<OnboardingGuide initialState={identityDone()} />);

      const revisit = screen.getByRole("link", { name: "Revisit Check your details" });
      expect(revisit).toHaveAttribute("href", "/settings/identity");
      await userEvent.click(revisit);

      // The link navigates; the mocked router just changes the path.
      nav.pathname = "/settings/identity";
      addTargets();
      rerender(<OnboardingGuide initialState={identityDone()} />);

      const first = await screen.findByRole("dialog", { name: "Your name and birthday" });
      expect(first).toHaveTextContent("1 of 3");
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByRole("dialog", { name: "Pen names and Zoom/Slack names" });
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByRole("dialog", { name: "Other email addresses" });
      await userEvent.click(screen.getByRole("button", { name: "Done" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(markOnboardingStep).not.toHaveBeenCalled();
    });

    it("ends when they leave the step's page", async () => {
      vi.mocked(getMyOnboardingState).mockResolvedValue(identityDone());
      const { rerender } = render(<OnboardingGuide initialState={identityDone()} />);
      await userEvent.click(screen.getByRole("link", { name: "Revisit Check your details" }));
      nav.pathname = "/settings/identity";
      addTargets();
      rerender(<OnboardingGuide initialState={identityDone()} />);
      await screen.findByRole("dialog", { name: "Your name and birthday" });

      nav.pathname = "/dashboard";
      rerender(<OnboardingGuide initialState={identityDone()} />);
      nav.pathname = "/settings/identity";
      rerender(<OnboardingGuide initialState={identityDone()} />);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("isn't offered for steps that aren't done", () => {
      vi.mocked(getMyOnboardingState).mockResolvedValue(fresh());
      render(<OnboardingGuide initialState={fresh()} />);
      expect(screen.queryByRole("link", { name: /^Revisit/ })).not.toBeInTheDocument();
    });
  });

  it("Close the tour dismisses it", async () => {
    vi.mocked(getMyOnboardingState).mockResolvedValue(fresh());
    vi.mocked(dismissOnboarding).mockResolvedValue({ success: true });
    render(<OnboardingGuide initialState={fresh()} />);

    await userEvent.click(screen.getByRole("button", { name: "Close the tour" }));
    expect(dismissOnboarding).toHaveBeenCalled();
  });

  it("says all set once every step is done, and Finish completes it", async () => {
    const done = buildOnboardingState(
      { hasHubProfile: true, latestProjectId: "p1", hasGoal: true, hasPricklePlan: true, ...NOT_HOST },
      { marked_steps: IDENTITY_DONE, dismissed_at: null, completed_at: null },
      NOW,
      NOW
    );
    vi.mocked(getMyOnboardingState).mockResolvedValue(done);
    vi.mocked(completeOnboarding).mockResolvedValue({ success: true });
    render(<OnboardingGuide initialState={done} />);

    expect(screen.getByText(/You're all set/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(completeOnboarding).toHaveBeenCalled();
  });

  it("shows an error from a failed action", async () => {
    vi.mocked(getMyOnboardingState).mockResolvedValue(fresh());
    vi.mocked(dismissOnboarding).mockResolvedValue({ error: "Couldn't save that" });
    render(<OnboardingGuide initialState={fresh()} />);

    await userEvent.click(screen.getByRole("button", { name: "Close the tour" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that");
  });
});
