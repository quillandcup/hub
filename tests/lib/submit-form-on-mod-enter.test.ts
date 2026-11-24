// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { submitFormOnModEnter, type ModEnterEvent } from "@/lib/submit-form-on-mod-enter";

function setup(attrs = "") {
  document.body.innerHTML = `<form ${attrs}><input id="field" /><button type="submit">Save</button></form><input id="loose" />`;
  const form = document.querySelector("form") as HTMLFormElement;
  const onSubmit = vi.fn();
  form.requestSubmit = onSubmit;
  return { form, onSubmit, field: document.getElementById("field")!, loose: document.getElementById("loose")! };
}

function event(target: EventTarget, over: Partial<ModEnterEvent> = {}): ModEnterEvent {
  return { key: "Enter", metaKey: false, ctrlKey: true, target, preventDefault: vi.fn(), nativeEvent: { isComposing: false }, ...over };
}

describe("submitFormOnModEnter", () => {
  it("requests a submit of the enclosing form and stops the default", () => {
    const { field, onSubmit } = setup();
    const e = event(field);
    expect(submitFormOnModEnter(e)).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it.each([
    ["a plain Enter", { ctrlKey: false }],
    ["another key", { key: "a" }],
    ["an input method composing", { nativeEvent: { isComposing: true } }],
    ["a key already handled", { defaultPrevented: true }],
  ])("ignores %s", (_name, over) => {
    const { field, onSubmit } = setup();
    expect(submitFormOnModEnter(event(field, over as Partial<ModEnterEvent>))).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("ignores a field outside a form, a form that opts out, and a disabled Save button", () => {
    const outside = setup();
    expect(submitFormOnModEnter(event(outside.loose))).toBe(false);
    expect(outside.onSubmit).not.toHaveBeenCalled();

    const optOut = setup("data-no-mod-enter-submit");
    expect(submitFormOnModEnter(event(optOut.field))).toBe(false);
    expect(optOut.onSubmit).not.toHaveBeenCalled();

    const disabled = setup();
    (disabled.form.querySelector("button") as HTMLButtonElement).disabled = true;
    expect(submitFormOnModEnter(event(disabled.field))).toBe(false);
    expect(disabled.onSubmit).not.toHaveBeenCalled();
  });

  it("ignores a target that is not an element", () => {
    setup();
    expect(submitFormOnModEnter(event(window))).toBe(false);
  });

  it("with focus on the dialog itself, submits its only form", () => {
    document.body.innerHTML = `<div id="dialog"><form><button type="submit">Save</button></form></div>`;
    const dialog = document.getElementById("dialog")!;
    const onSubmit = vi.fn();
    (dialog.querySelector("form") as HTMLFormElement).requestSubmit = onSubmit;
    expect(submitFormOnModEnter(event(dialog, { currentTarget: dialog }))).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("with focus on the dialog and several forms, submits none", () => {
    document.body.innerHTML = `<div id="dialog"><form><button type="submit">A</button></form><form><button type="submit">B</button></form></div>`;
    const dialog = document.getElementById("dialog")!;
    const onSubmit = vi.fn();
    document.querySelectorAll("form").forEach((f) => (f.requestSubmit = onSubmit));
    expect(submitFormOnModEnter(event(dialog, { currentTarget: dialog }))).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
