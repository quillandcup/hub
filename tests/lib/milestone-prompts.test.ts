import { describe, expect, it } from "vitest";
import { PROJECT_PHASES } from "@/lib/writing-projects";
import { milestonesToAsk, stageGroupOf, STAGE_PROMPT, type Snooze } from "@/lib/milestone-prompts";

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

describe("stageGroupOf", () => {
  it("puts every stage in one of four groups: before reading and editing, reading and editing, Publishing, Complete and Published", () => {
    expect(["planning", "outlining", "drafting", "hibernating", "not a stage"].map(stageGroupOf)).toEqual([0, 0, 0, 0, 0]);
    expect(stageGroupOf(null)).toBe(0);
    for (const phase of ["first_read_through", "revising", "developmental_edit", "beta_readers", "line_copy_edit", "final_read_through", "final_beta_read"]) {
      expect(stageGroupOf(phase)).toBe(1);
    }
    expect(stageGroupOf("publishing")).toBe(2);
    expect(stageGroupOf("complete")).toBe(3);
    expect(stageGroupOf("published")).toBe(3);
  });

  it("knows every stage the project can be in, so a new stage cannot slip into no group by accident", () => {
    const grouped = PROJECT_PHASES.filter((p) => stageGroupOf(p) > 0);
    const before = PROJECT_PHASES.filter((p) => stageGroupOf(p) === 0);
    expect(before).toEqual(["planning", "outlining", "drafting", "hibernating"]);
    expect(grouped).toHaveLength(PROJECT_PHASES.length - before.length);
  });
});

describe("milestonesToAsk: after a 'not yet' (a snooze)", () => {
  const theEnd = (group: number): Snooze[] => [{ kind: "the_end", stageGroup: group }];
  const ready = (group: number): Snooze[] => [{ kind: "publish_ready", stageGroup: group }];
  const askSnoozed = (from: string | null, to: string, snoozes: Snooze[]) => milestonesToAsk(from, to, false, snoozes).kinds;

  it("asks THE END again at Publishing, with publish-ready, when it was put off at First read-through", () => {
    expect(askSnoozed("first_read_through", "publishing", theEnd(1))).toEqual(["the_end", "publish_ready"]);
    expect(askSnoozed("revising", "publishing", theEnd(1))).toEqual(["the_end", "publish_ready"]);
  });

  it("asks THE END again at Complete or Published when it was put off at Publishing", () => {
    expect(askSnoozed("publishing", "complete", theEnd(2))).toEqual(["the_end"]);
    expect(askSnoozed("publishing", "published", theEnd(2))).toEqual(["the_end"]);
  });

  it("asks once per stage group: not again inside the group it was put off in", () => {
    expect(askSnoozed("first_read_through", "revising", theEnd(1))).toEqual([]);
    expect(askSnoozed("revising", "line_copy_edit", theEnd(1))).toEqual([]);
    expect(askSnoozed("publishing", "publishing", theEnd(2))).toEqual([]);
    expect(askSnoozed("complete", "published", theEnd(3))).toEqual([]);
  });

  it("does not repeat the first-time question inside the group it was already put off in (the project went back and forth)", () => {
    // Drafting to Revising asks THE END the first time; after a "not yet" at Revising, going back to Drafting and forward again does not.
    expect(ask("drafting", "revising").kinds).toEqual(["the_end"]);
    expect(askSnoozed("drafting", "revising", theEnd(1))).toEqual([]);
    expect(askSnoozed("drafting", "first_read_through", theEnd(1))).toEqual([]);
    // But the first time it is asked at a later group still comes.
    expect(askSnoozed("drafting", "publishing", theEnd(1))).toEqual(["the_end", "publish_ready"]);
  });

  it("never asks on a move back, or to Hibernating", () => {
    expect(askSnoozed("publishing", "revising", theEnd(2))).toEqual([]);
    expect(askSnoozed("revising", "hibernating", theEnd(1))).toEqual([]);
    expect(askSnoozed("planning", "drafting", theEnd(0))).toEqual([]);
  });

  it("asks publish-ready again only at Publishing, in a later group than the one it was put off in", () => {
    expect(askSnoozed("revising", "publishing", ready(1))).toEqual(["publish_ready"]);
    expect(askSnoozed("revising", "publishing", ready(2))).toEqual([]);
    expect(askSnoozed("publishing", "complete", ready(2))).toEqual([]);
    expect(askSnoozed("revising", "line_copy_edit", ready(0))).toEqual([]);
  });

  it("leaves kinds with no snooze to the usual rules, and does not mind a snooze that is not yet due", () => {
    expect(askSnoozed("drafting", "publishing", ready(1))).toEqual(["the_end", "publish_ready"]);
    expect(askSnoozed("first_read_through", "publishing", [])).toEqual(["publish_ready"]);
  });

  it("still offers the Publish flow whatever was put off", () => {
    expect(milestonesToAsk("publishing", "complete", false, theEnd(3)).offerPublish).toBe(true);
  });
});

describe("the prompt's words", () => {
  it("offers 'Not yet' (ask again later) and 'Not for this work' (never again) with their own notes", () => {
    expect(STAGE_PROMPT.notYet).toBe("Not yet");
    expect(STAGE_PROMPT.notForThisWork).toBe("Not for this work");
    expect(STAGE_PROMPT.notYetNote).toMatch(/ask again/);
    expect(STAGE_PROMPT.notForThisWorkNote).toMatch(/won't ask/);
  });
});
