import { describe, expect, it } from "vitest";
import { ROLE_CHANGE_REFUSALS as R, changeableRoles, roleChangeRefusal } from "@/lib/permissions";

/** Who may change whose roles: only below your own highest role, an admin any, never your own admin role or the last admin. */

const change = (actor: string[], target: string[], next: string[], extra: { self?: boolean; otherAdmins?: number } = {}) =>
  roleChangeRefusal({ actor, target, next, self: extra.self ?? false, otherAdmins: extra.otherAdmins ?? 1 });

describe("an assistant", () => {
  it("may give and take away community manager and conversion specialist, on a member or on someone holding only those", () => {
    expect(change(["assistant"], [], ["community_manager"])).toBeNull();
    expect(change(["assistant"], [], ["community_manager", "conversion_specialist"])).toBeNull();
    expect(change(["assistant"], ["community_manager"], ["conversion_specialist"])).toBeNull();
    expect(change(["assistant"], ["community_manager", "conversion_specialist"], [])).toBeNull();
  });

  it("may not give admin or assistant", () => {
    expect(change(["assistant"], [], ["admin"])).toBe(R.assistantRoles);
    expect(change(["assistant"], [], ["assistant"])).toBe(R.assistantRoles);
    expect(change(["assistant"], ["community_manager"], ["community_manager", "admin"])).toBe(R.assistantRoles);
  });

  it("may not change a person who holds admin or assistant, whatever the change", () => {
    expect(change(["assistant"], ["admin"], [])).toBe(R.assistantOnAdmin);
    expect(change(["assistant"], ["admin", "community_manager"], ["admin"])).toBe(R.assistantOnAdmin);
    expect(change(["assistant"], ["assistant"], [])).toBe(R.assistantOnAdmin);
    expect(change(["assistant"], ["assistant", "community_manager"], ["assistant"], { self: true })).toBe(R.assistantOnAdmin);
  });

  it("is judged by their highest role: an assistant who is also a community manager is still an assistant", () => {
    expect(change(["community_manager", "assistant"], [], ["admin"])).toBe(R.assistantRoles);
    expect(change(["community_manager", "assistant"], [], ["conversion_specialist"])).toBeNull();
  });
});

describe("an admin", () => {
  it("may give and take away any role, on anyone", () => {
    expect(change(["admin"], [], ["admin"])).toBeNull();
    expect(change(["admin"], ["assistant"], ["admin", "assistant"])).toBeNull();
    expect(change(["admin"], ["admin", "community_manager"], ["admin"])).toBeNull();
    expect(change(["admin"], ["assistant"], [])).toBeNull();
  });

  it("may remove another admin when there is one left", () => {
    expect(change(["admin"], ["admin"], [], { otherAdmins: 1 })).toBeNull();
  });

  it("may not remove the last admin", () => {
    expect(change(["admin"], ["admin"], [], { otherAdmins: 0 })).toBe(R.lastAdmin);
    expect(change(["admin"], ["admin", "assistant"], ["assistant"], { otherAdmins: 0 })).toBe(R.lastAdmin);
  });

  it("may not remove their own admin role, even when others exist, but may change their other roles", () => {
    expect(change(["admin", "community_manager"], ["admin", "community_manager"], ["community_manager"], { self: true, otherAdmins: 3 })).toBe(R.ownAdmin);
    expect(change(["admin"], ["admin"], ["admin", "community_manager"], { self: true })).toBeNull();
    expect(change(["admin", "community_manager"], ["admin", "community_manager"], ["admin"], { self: true })).toBeNull();
  });
});

describe("everyone else", () => {
  it.each([[[]], [["community_manager"]], [["conversion_specialist", "community_manager"]], [["member"]]])("%j may change no roles, not even their own", (actor) => {
    expect(change(actor, [], ["community_manager"])).toBe(R.notManager);
    expect(change(actor, actor, ["admin"], { self: true })).toBe(R.notManager);
  });

  it("is a no-op when nothing changes, whoever asks", () => {
    expect(change([], ["admin"], ["admin"])).toBeNull();
    expect(change(["assistant"], ["admin"], ["admin"])).toBeNull();
  });
});

describe("which checkboxes the page leaves enabled", () => {
  it("lets an admin flip every role on someone else, and every role but admin on themself", () => {
    expect(changeableRoles({ actor: ["admin"], target: ["community_manager"], self: false, otherAdmins: 1 })).toEqual(["admin", "assistant", "community_manager", "conversion_specialist"]);
    expect(changeableRoles({ actor: ["admin"], target: ["admin"], self: true, otherAdmins: 1 })).toEqual(["assistant", "community_manager", "conversion_specialist"]);
  });

  it("leaves the last admin's admin box off", () => {
    expect(changeableRoles({ actor: ["admin"], target: ["admin"], self: false, otherAdmins: 0 })).toEqual(["assistant", "community_manager", "conversion_specialist"]);
  });

  it("lets an assistant flip only the two roles below, on a person below", () => {
    expect(changeableRoles({ actor: ["assistant"], target: [], self: false, otherAdmins: 1 })).toEqual(["community_manager", "conversion_specialist"]);
    expect(changeableRoles({ actor: ["assistant"], target: ["admin"], self: false, otherAdmins: 1 })).toEqual([]);
    expect(changeableRoles({ actor: ["assistant"], target: ["assistant"], self: false, otherAdmins: 1 })).toEqual([]);
  });

  it("leaves nothing for a person who manages no roles, or an unknown viewer", () => {
    expect(changeableRoles({ actor: ["community_manager"], target: [], self: false, otherAdmins: 1 })).toEqual([]);
    expect(changeableRoles({ actor: [], target: [], self: false, otherAdmins: 1 })).toEqual([]);
  });
});
