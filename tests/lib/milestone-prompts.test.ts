import { describe, expect, it } from "vitest";
import { PROJECT_PHASES } from "@/lib/writing-projects";
import { milestonesToAsk, STAGE_PROMPT } from "@/lib/milestone-prompts";

const ask = (from: string | null, to: string, hasBook = false) => milestonesToAsk(from, to, hasBook);

describe("milestonesToAsk: THE END", () => {
  it.each(["planning", "outlining", "drafting"])("asks when a project leaves %s for a later stage", (from) => {
    expect(ask(from, "first_read_through").kinds).toEqual(["the_end"]);
    expect(ask(from, "revising").kinds).toEqual(["the_end"]);
    expect(ask(from, "complete").kinds).toEqual(["the_end"]);
  });

  it("does not ask between the stages before the end of the first draft", () => {
    expect(ask("planning", "outlining").kinds).toEqual([]);
    expect(ask("planning", "drafting").kinds).toEqual([]);
    expect(ask("outlining", "drafting").kinds).toEqual([]);
  });

  it("does not ask for Hibernating, and never for a move back or sideways", () => {
    expect(ask("drafting", "hibernating")).toEqual({ kinds: [], offerPublish: false });
    expect(ask("revising", "drafting").kinds).toEqual([]);
    expect(ask("first_read_through", "planning").kinds).toEqual([]);
    expect(ask("drafting", "drafting").kinds).toEqual([]);
  });

  it("does not ask when a project wakes from Hibernating (we do not know where it was), unless it goes straight to Publishing", () => {
    expect(ask("hibernating", "drafting").kinds).toEqual([]);
    expect(ask("hibernating", "revising").kinds).toEqual([]);
    expect(ask("hibernating", "publishing").kinds).toEqual(["publish_ready"]);
  });

  it("does not ask from a stage after Drafting", () => {
    expect(ask("revising", "beta_readers").kinds).toEqual([]);
    expect(ask("first_read_through", "line_copy_edit").kinds).toEqual([]);
  });
});

describe("milestonesToAsk: publish-ready and the Publish flow", () => {
  it("asks publish-ready on reaching Publishing from a stage before it", () => {
    expect(ask("revising", "publishing").kinds).toEqual(["publish_ready"]);
    expect(ask("final_beta_read", "publishing").kinds).toEqual(["publish_ready"]);
  });

  it("asks both, in order, for a project that jumps straight to Publishing", () => {
    for (const from of ["planning", "outlining", "drafting"]) expect(ask(from, "publishing").kinds).toEqual(["the_end", "publish_ready"]);
  });

  it("does not ask publish-ready going back from Publishing, or from Complete", () => {
    expect(ask("complete", "publishing").kinds).toEqual([]);
    expect(ask("publishing", "revising").kinds).toEqual([]);
    expect(ask("publishing", "complete").kinds).toEqual([]);
  });

  it("offers the Publish flow on reaching Complete with no book, and not with one", () => {
    expect(ask("publishing", "complete")).toEqual({ kinds: [], offerPublish: true });
    expect(ask("drafting", "complete")).toEqual({ kinds: ["the_end"], offerPublish: true });
    expect(ask("publishing", "complete", true).offerPublish).toBe(false);
    expect(ask("complete", "complete").offerPublish).toBe(false);
    expect(ask("revising", "publishing").offerPublish).toBe(false);
  });
});

describe("milestonesToAsk: every pair", () => {
  it("never asks anything for Hibernating or for a move that does not go forward", () => {
    for (const from of PROJECT_PHASES) {
      expect(ask(from, "hibernating")).toEqual({ kinds: [], offerPublish: false });
      for (const to of PROJECT_PHASES) {
        if (from === "hibernating" || from === to) continue;
        const forward = PROJECT_PHASES.indexOf(to) > PROJECT_PHASES.indexOf(from);
        if (!forward && to !== "hibernating") expect(ask(from, to).kinds, `${from} to ${to}`).toEqual([]);
      }
    }
  });

  it("ignores an unknown stage", () => {
    expect(ask("drafting", "nonsense")).toEqual({ kinds: [], offerPublish: false });
  });
});

describe("the wording", () => {
  it("names the project in each question", () => {
    expect(STAGE_PROMPT.question("the_end", "A Fake Novel")).toBe("Did you write THE END on A Fake Novel?");
    expect(STAGE_PROMPT.question("publish_ready", "A Fake Novel")).toBe("Is A Fake Novel ready to publish?");
    expect(STAGE_PROMPT.both).toBe("Did you write THE END, and is it ready to publish?");
    expect(STAGE_PROMPT.publishTitle("A Fake Novel")).toContain("A Fake Novel");
  });
});
