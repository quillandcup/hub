import { describe, expect, it } from "vitest";
import { ICONS } from "@/components/Icon";
import { LIFECYCLE_ACTIONS, lifecycleConfirm, lifecycleIcon, lifecycleLabel, type LifecycleAction } from "@/lib/lifecycle-actions";

const ACTIONS = Object.keys(LIFECYCLE_ACTIONS) as LifecycleAction[];

describe("lifecycle actions", () => {
  it("gives every action an icon that exists in the icon set", () => {
    for (const action of ACTIONS) expect(ICONS, action).toHaveProperty(lifecycleIcon(action));
  });

  it("gives different actions different pictures, except bringing a version back, which is history's", () => {
    const seen = new Map<string, LifecycleAction>();
    for (const action of ACTIONS.filter((a) => a !== "restore")) {
      expect(seen.get(lifecycleIcon(action)), `${action} shares an icon with ${seen.get(lifecycleIcon(action))}`).toBeUndefined();
      seen.set(lifecycleIcon(action), action);
    }
    expect(lifecycleIcon("restore")).toBe(lifecycleIcon("history"));
  });

  it("labels an action with its noun where it has one", () => {
    expect(lifecycleLabel("delete", "page")).toBe("Delete page");
    expect(lifecycleLabel("duplicate", "lesson")).toBe("Duplicate lesson");
    expect(lifecycleLabel("publish")).toBe("Publish");
    expect(lifecycleLabel("reset")).toBe("Reset to published");
    expect(lifecycleLabel("viewLive")).toBe("View live");
    expect(lifecycleLabel("saveAsTemplate")).toBe("Save as template");
    expect(lifecycleLabel("overwrite", "template")).toBe("Overwrite template");
  });

  describe("the confirmations follow .claude/rules/confirmations.md", () => {
    const asking = ACTIONS.filter((a) => lifecycleConfirm(a, { noun: "page", title: "Spring" }));

    it("ask before the actions that destroy, discard, replace or take something down, and only those", () => {
      expect(asking).toEqual(["unpublish", "delete", "reset", "restore", "overwrite"]);
    });

    it("ask with a question title, a body that says what happens, and a confirm button that names the action", () => {
      for (const action of asking) {
        const spec = lifecycleConfirm(action, { noun: "page", title: "Spring" })!;
        expect(spec.title, action).toMatch(/\?$/);
        expect(spec.title, action).not.toMatch(/sure|confirm/i);
        expect(spec.confirmLabel, action).not.toMatch(/^(ok|yes|confirm)$/i);
        expect(spec.confirmLabel, `${action}: the button repeats the control's label`).toBe(lifecycleLabel(action, "page"));
        expect(spec.tone, action).toBe("danger");
        expect(String(spec.body).length, action).toBeGreaterThan(20);
      }
    });

    it("say what the thing is called and what else happens in a delete", () => {
      const spec = lifecycleConfirm("delete", { noun: "lesson", title: "Welcome", detail: "Its video link goes with it.", permanent: true })!;
      expect(spec.title).toBe("Delete lesson?");
      expect(spec.body).toBe("“Welcome” will be deleted for good. Its video link goes with it.");
      expect(lifecycleConfirm("delete", { noun: "page" })!.body).toBe("This page will be deleted.");
    });

    it("says in an overwrite that the old version is kept, and lets a place word a bring-back for what it restores", () => {
      const overwrite = lifecycleConfirm("overwrite", { noun: "template", title: "Spring" })!;
      expect(overwrite.title).toBe("Overwrite this template?");
      expect(overwrite.body).toContain("keeps its current version in its history");
      expect(lifecycleConfirm("restore", { noun: "template", detail: "It becomes the newest version." })!.body).toBe("It becomes the newest version.");
    });

    it("let the place add what only it knows to a take-down, with a plain default", () => {
      expect(lifecycleConfirm("unpublish", { noun: "course", detail: "Members can't open it." })!.body).toBe("Members can't open it.");
      expect(lifecycleConfirm("unpublish", { noun: "course" })!.body).toBe("It stops being available at once. Nothing is deleted.");
      expect(lifecycleConfirm("unpublish", { noun: "course" })!.title).toBe("Take this course down?");
    });
  });

  it("does not ask before publishing, copying, previewing, opening history or viewing the live page", () => {
    for (const action of ["publish", "duplicate", "preview", "history", "viewLive", "saveAsTemplate"] as const) expect(lifecycleConfirm(action, { noun: "page" }), action).toBeNull();
  });
});
